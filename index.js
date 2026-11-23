/**
 * GitHub 中心的宿主端：保存 Token、代理 GitHub REST、记录 star 快照、通过 Git Data API 提交代码。
 * 只依赖 node 内置模块，界面端用 fetch 打这里的 /dsh-github-hub/* 路由。
 */
import { createClient, slimRepo, starHistoryFromPages, dayOf, GitHubError, logsToText } from './lib/github.mjs'
import { readStore, updateStore } from './lib/store.mjs'
import {
	listIssues, getIssue, issueComments, createIssue, commentIssue, editIssue, issueLabels,
	listPulls, getPull, pullFiles, pullComments, submitReview, mergePull,
	listNotifications, markNotificationRead, searchIssues, listBranches,
} from './lib/work.mjs'
import { registerTools } from './lib/tools.mjs'
import { startDeviceFlow, pollDeviceFlow, DEFAULT_CLIENT_ID } from './lib/device.mjs'

export const name = 'github-hub'
export const inject = ['webServer', 'credentials', 'timer', 'tools']

const ROUTE_PREFIX = '/dsh-github-hub'
/** 凭据引用名：走 credentials 的 refs 空间，落在 $DSH_HOME/.credentials.yaml。 */
const TOKEN_REF = 'GITHUB_TOKEN'
const BODY_LIMIT = 2 * 1024 * 1024
const BACKFILL_PAGES = 20
const REFRESH_TICK_MS = 10 * 60 * 1000

class HttpError extends Error {
	constructor(status, code, message) {
		super(message)
		this.status = status
		this.code = code
	}
}

function sendJson(res, status, value) {
	const body = JSON.stringify(value)
	res.statusCode = status
	res.setHeader('content-type', 'application/json; charset=utf-8')
	res.setHeader('cache-control', 'no-store')
	res.setHeader('content-length', Buffer.byteLength(body))
	res.end(body)
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let size = 0
		req.on('data', (chunk) => {
			size += chunk.length
			if (size > BODY_LIMIT) {
				reject(new HttpError(413, 'BODY_TOO_LARGE', '请求体太大'))
				req.destroy()
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8')
			if (raw.trim() === '') return resolve({})
			try {
				const parsed = JSON.parse(raw)
				resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
			} catch {
				reject(new HttpError(400, 'BAD_JSON', '请求体不是合法 JSON'))
			}
		})
		req.on('error', (error) => reject(new HttpError(400, 'BODY_ERROR', String(error))))
	})
}

function assertFull(value) {
	if (typeof value !== 'string' || !/^[^/]+\/[^/]+$/.test(value)) {
		throw new HttpError(400, 'BAD_REPO', '仓库名要写成 owner/name')
	}
	return value
}

export function apply(ctx, config) {
	const log = (message) => ctx.logger?.info?.(`[github-hub] ${message}`)

	async function readToken() {
		try {
			const resolved = await ctx.credentials.resolve(TOKEN_REF)
			const value = resolved !== null && typeof resolved === 'object' ? resolved.value : undefined
			return typeof value === 'string' && value !== '' ? value : null
		} catch (error) {
			log(`读 Token 失败：${error instanceof Error ? error.message : String(error)}`)
			return null
		}
	}

	// 同一个 token 复用一份 client，缓存才不会每次请求都重建（重建就白缓存了）。
	let shared = null

	function clientFor(token) {
		if (shared === null || shared.token !== token) shared = { token, api: createClient(token) }
		return shared.api
	}

	async function client() {
		const token = await readToken()
		if (token === null) throw new HttpError(400, 'NOT_CONNECTED', '还没有连接 GitHub，先填一个 Token')
		return clientFor(token)
	}

	/** 记录一次 star 快照（同一天只保留最新一条）。 */
	function pushSnapshot(entry, stars, atMs) {
		if (!Number.isFinite(stars)) return
		const recorded = { t: atMs, s: stars }
		const last = entry.snapshots[entry.snapshots.length - 1]
		if (last !== undefined && last.s >= 0 && Math.floor(last.t / 86_400_000) === Math.floor(atMs / 86_400_000)) {
			last.t = atMs
			last.s = stars
		} else {
			entry.snapshots.push(recorded)
		}
		entry.stars = stars
	}

	/**
	 * 拉取 star 曲线。取「最后若干页」的 starred_at，之后每天的值都是精确的：
	 * stars(day) = 当前总数 - 晚于 day 的采样数。
	 */
	async function backfillStarHistory(api, full, totalStars) {
		try {
			const first = await api.stargazerPage(full, 1)
			const lastPage = typeof first.lastPage === 'number' ? first.lastPage : 1
			const startPage = Math.max(1, lastPage - BACKFILL_PAGES + 1)
			const samples = []
			const collect = (page) => {
				for (const item of page.items) {
					const stamped = item !== null && typeof item === 'object' && typeof item.starred_at === 'string' ? item.starred_at : null
					samples.push(stamped)
				}
			}
			if (startPage === 1) collect(first)
			for (let page = Math.max(2, startPage); page <= lastPage; page += 1) {
				collect(await api.stargazerPage(full, page))
			}
			const stampedDays = samples.filter((stamped) => stamped !== null).map((stamped) => dayOf(stamped)).filter((day) => day !== null)
			if (stampedDays.length === 0) return null
			const oldest = stampedDays.reduce((left, right) => (left < right ? left : right))
			const counts = new Map()
			for (const day of stampedDays) counts.set(day, (counts.get(day) ?? 0) + 1)
			const days = [...counts.keys()].sort()
			const history = []
			let stars = totalStars - stampedDays.length
			for (const day of days) {
				stars += counts.get(day) ?? 0
				history.push({ d: day, s: Math.max(0, stars) })
			}
			return { oldest, history, sampled: samples.length, truncated: lastPage > BACKFILL_PAGES }
		} catch (error) {
			log(`backfill ${full} 失败：${error instanceof Error ? error.message : String(error)}`)
			return null
		}
	}

	/** 刷新指定仓库（或所有被跟踪仓库）的 star 数，并在首次刷新时补历史曲线。 */
	async function refreshStars(fulls) {
		const api = await client()
		const store = await readStore()
		const targets = fulls !== undefined && fulls.length > 0 ? fulls : store.settings.tracked
		if (targets.length === 0) return { refreshed: [], failed: [] }
		const refreshed = []
		const failed = []
		for (const full of targets) {
			try {
				const raw = await api.repo(full)
				const stars = Number.isFinite(raw?.stargazers_count) ? raw.stargazers_count : 0
				const at = Date.now()
				const needsBackfill = store.repos[full]?.backfilledAt == null
				const backfill = needsBackfill ? await backfillStarHistory(api, full, stars) : null
				await updateStore((draft) => {
					const entry = draft.repos[full] ?? { full, stars: 0, forks: 0, issues: 0, backfilledAt: null, snapshots: [], history: [] }
					entry.full = full
					entry.forks = Number.isFinite(raw?.forks_count) ? raw.forks_count : entry.forks
					entry.issues = Number.isFinite(raw?.open_issues_count) ? raw.open_issues_count : entry.issues
					pushSnapshot(entry, stars, at)
					if (backfill !== null) {
						entry.history = backfill.history
						entry.backfilledAt = at
						entry.historyTruncated = backfill.truncated
					} else if (entry.history.length === 0) {
						entry.history = entry.snapshots.map((snapshot) => ({ d: dayOf(new Date(snapshot.t).toISOString()), s: snapshot.s }))
					}
					draft.repos[full] = entry
				})
				refreshed.push({ full, stars })
			} catch (error) {
				failed.push({ full, code: error instanceof Error && 'code' in error ? String(error.code) : 'ERROR', message: error instanceof Error ? error.message : String(error) })
			}
		}
		await updateStore((draft) => {
			draft.settings.lastRefreshAt = Date.now()
			draft.settings.lastError = failed.length > 0 ? failed[0].message : null
		})
		return { refreshed, failed }
	}

	async function state() {
		const token = await readToken()
		const store = await readStore()
		let viewer = null
		let rateLimit = null
		let error = null
		if (token !== null) {
			try {
				const api = clientFor(token)
				const raw = await api.viewer()
				viewer = {
					login: typeof raw?.login === 'string' ? raw.login : '',
					name: typeof raw?.name === 'string' ? raw.name : '',
					avatar: typeof raw?.avatar_url === 'string' ? raw.avatar_url : '',
					htmlUrl: typeof raw?.html_url === 'string' ? raw.html_url : '',
					publicRepos: Number.isFinite(raw?.public_repos) ? raw.public_repos : 0,
					followers: Number.isFinite(raw?.followers) ? raw.followers : 0,
				}
				rateLimit = api.state.rateLimit
			} catch (error_) {
				error = error_ instanceof GitHubError ? { code: error_.code, message: error_.message } : { code: 'ERROR', message: String(error_) }
			}
		}
		return { ok: true, connected: token !== null, viewer, rateLimit, error, settings: store.settings, repos: store.repos }
	}

	async function listRepos(url) {
		const api = await client()
		const store = await readStore()
		const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
		const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('perPage') ?? '30') || 30))
		const sort = url.searchParams.get('sort') ?? 'updated'
		const affiliation = url.searchParams.get('affiliation') ?? 'owner,collaborator,organization_member'
		const visibility = url.searchParams.get('visibility') ?? 'all'
		const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
		const viewer = await api.viewer()
		const login = typeof viewer?.login === 'string' ? viewer.login : ''
		const [listed, starred] = await Promise.all([
			api.listRepos({ perPage, page, sort, affiliation, visibility }),
			api.starredNames().catch(() => new Set()),
		])
		let repos = listed.repos.map((raw) => slimRepo(raw, login)).filter((repo) => repo !== null)
		repos = repos.map((repo) => {
			const stored = store.repos[repo.full]
			return {
				...repo,
				tracked: store.settings.tracked.includes(repo.full),
				starred: starred.has(repo.full),
				recordedStars: stored?.stars ?? null,
				snapshots: stored?.snapshots?.length ?? 0,
			}
		})
		if (query !== '') {
			repos = repos.filter((repo) => repo.full.toLowerCase().includes(query) || repo.description.toLowerCase().includes(query) || repo.language.toLowerCase().includes(query))
		}
		return { ok: true, items: repos, page, perPage, hasNext: listed.link.next !== undefined, viewer: login }
	}

	async function repoDetail(url) {
		const api = await client()
		const store = await readStore()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const viewer = await api.viewer()
		const login = typeof viewer?.login === 'string' ? viewer.login : ''
		const raw = await api.repo(full)
		const repo = slimRepo(raw, login)
		const [commits, releases] = await Promise.all([
			api.commits(full, repo.defaultBranch).catch(() => []),
			api.releases(full).catch(() => []),
		])
		const stored = store.repos[full]
		return {
			ok: true,
			repo,
			tracked: store.settings.tracked.includes(full),
			commits: commits.slice(0, 20).map((commit) => ({
				sha: typeof commit?.sha === 'string' ? commit.sha.slice(0, 7) : '',
				message: typeof commit?.commit?.message === 'string' ? commit.commit.message.split('\n')[0] : '',
				author: typeof commit?.commit?.author?.name === 'string' ? commit.commit.author.name : '',
				date: typeof commit?.commit?.author?.date === 'string' ? commit.commit.author.date : null,
				url: typeof commit?.html_url === 'string' ? commit.html_url : '',
			})),
			releases: releases.slice(0, 5).map((release) => ({
				tag: typeof release?.tag_name === 'string' ? release.tag_name : '',
				name: typeof release?.name === 'string' ? release.name : '',
				publishedAt: typeof release?.published_at === 'string' ? release.published_at : null,
				url: typeof release?.html_url === 'string' ? release.html_url : '',
			})),
			starHistory: stored?.history ?? [],
			snapshots: stored?.snapshots ?? [],
			stars: repo.stars,
		}
	}

	/** 项目更新流：自己最近的公开事件，加上跟踪仓库的最新提交。 */
	async function feed() {
		const api = await client()
		const store = await readStore()
		const viewer = await api.viewer()
		const login = typeof viewer?.login === 'string' ? viewer.login : ''
		const events = login === '' ? [] : await api.events(login).catch(() => [])
		const items = []
		for (const event of events) {
			const repo = typeof event?.repo?.name === 'string' ? event.repo.name : ''
			if (repo === '') continue
			const type = typeof event?.type === 'string' ? event.type : ''
			let summary = ''
			if (type === 'PushEvent') {
				const commits = Array.isArray(event.payload?.commits) ? event.payload.commits : []
				const head = commits.length > 0 && typeof commits[commits.length - 1]?.message === 'string' ? commits[commits.length - 1].message.split('\n')[0] : ''
				summary = commits.length === 0 ? '推送了更新' : `推送 ${commits.length} 个提交${head === '' ? '' : `：${head}`}`
			} else if (type === 'CreateEvent') {
				summary = `创建了 ${event.payload?.ref_type ?? '资源'} ${event.payload?.ref ?? ''}`.trim()
			} else if (type === 'WatchEvent') {
				summary = `star 了仓库`
			} else if (type === 'IssuesEvent') {
				summary = `${event.payload?.action ?? '更新'} issue #${event.payload?.issue?.number ?? ''}`
			} else if (type === 'PullRequestEvent') {
				summary = `${event.payload?.action ?? '更新'} PR #${event.payload?.pull_request?.number ?? ''}`
			} else if (type === 'ReleaseEvent') {
				summary = `发布 ${event.payload?.release?.tag_name ?? ''}`
			} else {
				summary = type.replace(/Event$/, '')
			}
			items.push({
				kind: 'event',
				type,
				repo,
				summary,
				at: typeof event?.created_at === 'string' ? event.created_at : null,
				url: `https://github.com/${repo}`,
			})
		}
		const trackedCommits = []
		for (const full of store.settings.tracked.slice(0, 8)) {
			try {
				const commits = await api.commits(full)
				for (const commit of commits.slice(0, 3)) {
					trackedCommits.push({
						kind: 'commit',
						type: 'Commit',
						repo: full,
						summary: typeof commit?.commit?.message === 'string' ? commit.commit.message.split('\n')[0] : '',
						author: typeof commit?.commit?.author?.name === 'string' ? commit.commit.author.name : '',
						at: typeof commit?.commit?.author?.date === 'string' ? commit.commit.author.date : null,
						url: typeof commit?.html_url === 'string' ? commit.html_url : `https://github.com/${full}`,
					})
				}
			} catch {
				// 单个仓库读不到（可能已删除或没权限）不该挡住整个时间线
			}
		}
		const all = [...items, ...trackedCommits]
			.filter((item) => typeof item.at === 'string')
			.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
			.slice(0, 60)
		return { ok: true, items: all, viewer: login }
	}

	/** 用 Git Data API 提交一组文件：blob → tree → commit → 移动分支头。 */
	async function pushCode(payload) {
		const api = await client()
		const full = assertFull(payload.full)
		const message = typeof payload.message === 'string' && payload.message.trim() !== '' ? payload.message : 'chore: update from dsh'
		const files = Array.isArray(payload.files) ? payload.files : []
		if (files.length === 0) throw new HttpError(400, 'NO_FILES', '没有要提交的文件')
		const repo = await api.repo(full)
		const branch = typeof payload.branch === 'string' && payload.branch !== '' ? payload.branch : repo.default_branch
		let headSha = null
		try {
			const head = await api.branchHead(full, branch)
			headSha = head?.object?.sha ?? null
		} catch (error_) {
			if (!(error_ instanceof GitHubError) || error_.code !== 'NOT_FOUND') throw error_
			// 分支还不存在：从默认分支的头上创建
			const baseHead = await api.branchHead(full, repo.default_branch)
			headSha = baseHead?.object?.sha ?? null
		}
		if (headSha === null) throw new HttpError(400, 'NO_HEAD', '拿不到分支的最新提交')
		const baseCommit = await api.commitObject(full, headSha)
		const entries = []
		for (const file of files) {
			const filePath = typeof file?.path === 'string' ? file.path.trim() : ''
			if (filePath === '') continue
			const content = typeof file?.content === 'string' ? file.content : ''
			const blob = await api.createBlob(full, content, 'utf-8')
			entries.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha })
		}
		if (entries.length === 0) throw new HttpError(400, 'NO_FILES', '文件路径都是空的')
		const tree = await api.createTree(full, baseCommit.tree.sha, entries)
		const viewer = await api.viewer()
		const email = await api.viewerEmail()
		const author = {
			name: typeof viewer?.login === 'string' ? viewer.login : 'dsh',
			email: email !== null ? email : `${viewer?.id ?? 0}+${viewer?.login ?? 'dsh'}@users.noreply.github.com`,
		}
		const commit = await api.createCommit(full, message, tree.sha, [headSha], author)
		try {
			await api.updateRef(full, branch, commit.sha, false)
		} catch (error_) {
			// 分支不存在时创建它
			if (error_ instanceof GitHubError && error_.code === 'NOT_FOUND') {
				await api.request(`/repos/${full}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha } })
			} else {
				throw error_
			}
		}
		return { ok: true, full, branch, commit: commit.sha, url: `https://github.com/${full}/commit/${commit.sha}`, files: entries.map((entry) => entry.path) }
	}

	// ---- 协作层：Issues / PR / 通知 / 搜索 -------------------------------

	function assertNumber(value) {
		const number = Number(value)
		if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, 'BAD_NUMBER', '编号要是正整数')
		return number
	}

	/** 需要 Token 才能读写协作内容，且必须知道是谁在操作。 */
	async function member() {
		const api = await client()
		const viewer = await api.viewer()
		const login = typeof viewer?.login === 'string' ? viewer.login : ''
		return { api, login }
	}

	async function issuesRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const result = await listIssues(api, full, {
			state: url.searchParams.get('state') ?? 'open',
			perPage: Number(url.searchParams.get('perPage') ?? '10'),
			page: Number(url.searchParams.get('page') ?? '1'),
			labels: url.searchParams.get('labels') ?? undefined,
			assignee: url.searchParams.get('assignee') ?? undefined,
			sort: url.searchParams.get('sort') ?? 'updated',
		})
		return { ok: true, full, ...result }
	}

	async function issueDetail(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const number = assertNumber(url.searchParams.get('number'))
		const [issue, comments] = await Promise.all([
			getIssue(api, full, number),
			issueComments(api, full, number).catch(() => []),
		])
		if (issue === null) throw new HttpError(404, 'NOT_FOUND', '找不到这个 issue')
		return { ok: true, full, issue, comments }
	}

	async function issueCreate(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const title = typeof body.title === 'string' ? body.title.trim() : ''
		if (title === '') throw new HttpError(400, 'BAD_TITLE', '标题不能是空的')
		const issue = await createIssue(api, full, {
			title,
			body: typeof body.body === 'string' ? body.body : '',
			labels: Array.isArray(body.labels) ? body.labels.filter((item) => typeof item === 'string') : [],
			assignees: Array.isArray(body.assignees) ? body.assignees.filter((item) => typeof item === 'string') : [],
		})
		return { ok: true, full, issue }
	}

	async function issueComment(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const number = assertNumber(body.number)
		const text = typeof body.body === 'string' ? body.body.trim() : ''
		if (text === '') throw new HttpError(400, 'BAD_BODY', '评论不能是空的')
		const comment = await commentIssue(api, full, number, text)
		return { ok: true, full, number, comment }
	}

	async function issueEdit(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const number = assertNumber(body.number)
		const patch = {}
		if (body.state === 'open' || body.state === 'closed') patch.state = body.state
		if (typeof body.title === 'string' && body.title.trim() !== '') patch.title = body.title.trim()
		if (typeof body.body === 'string') patch.body = body.body
		if (Array.isArray(body.labels)) patch.labels = body.labels.filter((item) => typeof item === 'string')
		if (Array.isArray(body.assignees)) patch.assignees = body.assignees.filter((item) => typeof item === 'string')
		if (Object.keys(patch).length === 0) throw new HttpError(400, 'EMPTY_PATCH', '没有要改的字段')
		const issue = await editIssue(api, full, number, patch)
		return { ok: true, full, number, issue }
	}

	async function labelsRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		return { ok: true, full, labels: await issueLabels(api, full) }
	}

	async function pullsRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const result = await listPulls(api, full, {
			state: url.searchParams.get('state') ?? 'open',
			// PR 对象单个约 70KB，30 条就是 2MB；代理传大包容易卡，默认只要 10 条。
			perPage: Number(url.searchParams.get('perPage') ?? '10'),
			page: Number(url.searchParams.get('page') ?? '1'),
			sort: url.searchParams.get('sort') ?? 'updated',
		})
		return { ok: true, full, ...result }
	}

	async function pullDetail(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const number = assertNumber(url.searchParams.get('number'))
		const [pull, files, comments] = await Promise.all([
			getPull(api, full, number),
			pullFiles(api, full, number).catch(() => []),
			pullComments(api, full, number).catch(() => []),
		])
		if (pull === null) throw new HttpError(404, 'NOT_FOUND', '找不到这个 PR')
		return { ok: true, full, pull, files, comments }
	}

	async function pullReview(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const number = assertNumber(body.number)
		const result = await submitReview(api, full, number, {
			event: body.event,
			body: typeof body.body === 'string' ? body.body : '',
			comments: Array.isArray(body.comments) ? body.comments : [],
		})
		return { ok: true, full, number, review: result }
	}

	async function pullMerge(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const number = assertNumber(body.number)
		const result = await mergePull(api, full, number, {
			method: body.method,
			commitTitle: body.commitTitle,
			commitMessage: body.commitMessage,
		})
		if (!result.merged) throw new HttpError(409, 'NOT_MERGEABLE', result.message || '这个 PR 现在不能合并')
		return { ok: true, full, number, ...result }
	}

	async function notificationsRoute(url) {
		const { api } = await member()
		const notifications = await listNotifications(api, {
			all: url.searchParams.get('all') === 'true',
			perPage: Number(url.searchParams.get('perPage') ?? '30'),
		}).catch((error) => {
			if (error instanceof GitHubError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) return []
			throw error
		})
		return {
			ok: true,
			unread: notifications.filter((item) => item.unread).length,
			items: notifications,
		}
	}

	async function notificationRead(req) {
		const body = await readBody(req)
		const { api } = await member()
		const id = typeof body.id === 'string' ? body.id.trim() : ''
		if (id === '') throw new HttpError(400, 'BAD_ID', '通知 id 不能是空的')
		await markNotificationRead(api, id)
		return { ok: true, id }
	}

	async function searchRoute(url) {
		const { api, login } = await member()
		const raw = (url.searchParams.get('q') ?? '').trim()
		if (raw === '') throw new HttpError(400, 'BAD_QUERY', '搜索词不能是空的')
		const scope = url.searchParams.get('scope') ?? 'all'
		const owner = url.searchParams.get('owner') ?? login
		const perPage = Number(url.searchParams.get('perPage') ?? '20')
		const build = (kind) => {
			let query = raw
			if (owner !== '') query = `${query} user:${owner}`
			return `${query} ${kind}`
		}
		// GitHub 搜索必须带 is:issue / is:pull-request，所以 all 就是两次查询再合并。
		if (scope === 'prs') {
			const query = build('is:pull-request')
			return { ok: true, query, ...(await searchIssues(api, query, { perPage })) }
		}
		if (scope === 'issues') {
			const query = build('is:issue')
			return { ok: true, query, ...(await searchIssues(api, query, { perPage })) }
		}
		const [issueHits, pullHits] = await Promise.all([
			searchIssues(api, build('is:issue'), { perPage }),
			searchIssues(api, build('is:pull-request'), { perPage }),
		])
		const items = [...issueHits.items, ...pullHits.items]
			.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
			.slice(0, Math.min(50, Math.max(1, perPage)))
		return { ok: true, query: build('is:issue / is:pull-request'), total: issueHits.total + pullHits.total, items }
	}

	async function branchesRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		return { ok: true, full, branches: await listBranches(api, full) }
	}


	// ---- Actions / 代码浏览 / Release / 设备流 ----------------------------

	function slimRun(raw) {
		const run = raw !== null && typeof raw === 'object' ? raw : {}
		return {
			id: Number.isFinite(run.id) ? run.id : 0,
			name: typeof run.name === 'string' ? run.name : typeof run.display_title === 'string' ? run.display_title : '',
			title: typeof run.display_title === 'string' ? run.display_title : '',
			event: typeof run.event === 'string' ? run.event : '',
			branch: typeof run.head_branch === 'string' ? run.head_branch : '',
			sha: typeof run.head_sha === 'string' ? run.head_sha.slice(0, 7) : '',
			status: typeof run.status === 'string' ? run.status : '',
			conclusion: typeof run.conclusion === 'string' ? run.conclusion : '',
			runNumber: Number.isFinite(run.run_number) ? run.run_number : 0,
			attempt: Number.isFinite(run.run_attempt) ? run.run_attempt : 1,
			createdAt: typeof run.created_at === 'string' ? run.created_at : null,
			updatedAt: typeof run.updated_at === 'string' ? run.updated_at : null,
			url: typeof run.html_url === 'string' ? run.html_url : '',
			actor: typeof run.actor?.login === 'string' ? run.actor.login : '',
		}
	}

	function slimJob(raw) {
		const job = raw !== null && typeof raw === 'object' ? raw : {}
		const steps = Array.isArray(job.steps) ? job.steps : []
		return {
			id: Number.isFinite(job.id) ? job.id : 0,
			name: typeof job.name === 'string' ? job.name : '',
			status: typeof job.status === 'string' ? job.status : '',
			conclusion: typeof job.conclusion === 'string' ? job.conclusion : '',
			startedAt: typeof job.started_at === 'string' ? job.started_at : null,
			completedAt: typeof job.completed_at === 'string' ? job.completed_at : null,
			url: typeof job.html_url === 'string' ? job.html_url : '',
			steps: steps.slice(0, 20).map((step) => ({
				name: typeof step?.name === 'string' ? step.name : '',
				status: typeof step?.status === 'string' ? step.status : '',
				conclusion: typeof step?.conclusion === 'string' ? step.conclusion : '',
				number: Number.isFinite(step?.number) ? step.number : 0,
			})),
		}
	}

	async function actionsRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const listed = await api.workflowRuns(full, {
			perPage: Math.min(50, Math.max(1, Number(url.searchParams.get('perPage') ?? '20') || 20)),
			page: Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1),
			branch: url.searchParams.get('branch') ?? undefined,
		})
		return { ok: true, full, total: listed.total, items: listed.runs.map(slimRun), hasNext: listed.link.next !== undefined }
	}

	async function actionJobs(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const id = assertNumber(url.searchParams.get('id'))
		const jobs = await api.runJobs(full, id)
		return { ok: true, full, id, items: jobs.map(slimJob) }
	}

	async function actionRerun(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const id = assertNumber(body.id)
		await api.rerunRun(full, id)
		return { ok: true, full, id, action: 'rerun' }
	}

	async function actionCancel(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const id = assertNumber(body.id)
		await api.cancelRun(full, id)
		return { ok: true, full, id, action: 'cancel' }
	}


	/**
	 * 某次运行的原始日志。GitHub 没有「一次给全文本」的接口：
	 * 要先拿 jobs，再按 job 拉 zip（二进制），所以这里把 zip 解出纯文本。
	 * 单次运行日志常常几 MB，压缩包上限设 60MB，超出直接报错，不冒险塞进内存。
	 */
	const LOG_ZIP_LIMIT = 60 * 1024 * 1024
	const LOG_TEXT_LIMIT = 400_000

	async function actionLogs(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const id = assertNumber(url.searchParams.get('id'))
		const jobs = await api.runJobs(full, id)
		const login = (await api.viewer())?.login ?? null
		const target = url.searchParams.get('job')
		const wanted = target === null || target === '' ? jobs : jobs.filter((job) => String(job?.id) === target)
		if (wanted.length === 0) throw new HttpError(404, 'NOT_FOUND', '这次运行里没有这个 job')
		const parts = []
		for (const job of wanted.slice(0, 8)) {
			const name = typeof job?.name === 'string' ? job.name : String(job?.id ?? '')
			try {
				const response = await api.request(`/repos/${full}/actions/jobs/${job?.id}/logs`, { accept: 'application/vnd.github+json', raw: true })
				const bytes = response instanceof Object && response.data !== undefined ? response.data : response
				if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
					parts.push(`===== ${name} =====\n（没有拿到日志流）`)
					continue
				}
				const buffer = Buffer.from(bytes)
				if (buffer.byteLength > LOG_ZIP_LIMIT) {
					parts.push(`===== ${name} =====\n（日志包 ${Math.round(buffer.byteLength / 1048576)}MB，太大，这次不展开）`)
					continue
				}
				const text = await logsToText(buffer)
				parts.push(`===== ${name} =====\n${text}`)
			} catch (error_) {
				const reason = error_ instanceof Error ? error_.message : String(error_)
				parts.push(`===== ${name} =====\n（拉日志失败：${reason}）`)
			}
		}
		let text = parts.join('\n\n')
		const truncated = text.length > LOG_TEXT_LIMIT
		if (truncated) text = text.slice(0, LOG_TEXT_LIMIT) + '\n\n…（后面还有，已截断）'
		return { ok: true, full, id, login, jobs: wanted.length, text, bytes: text.length, truncated }
	}

	/** 目录或文件。文件超过 1MB 或二进制时不给正文，只给元信息，避免把大包塞进面板。 */
	async function contentsRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const path = url.searchParams.get('path') ?? ''
		const ref = url.searchParams.get('ref') ?? undefined
		const data = await api.contents(full, path, ref)
		if (Array.isArray(data)) {
			const items = data
				.map((entry) => ({
					name: typeof entry?.name === 'string' ? entry.name : '',
					path: typeof entry?.path === 'string' ? entry.path : '',
					type: typeof entry?.type === 'string' ? entry.type : '',
					size: Number.isFinite(entry?.size) ? entry.size : 0,
					sha: typeof entry?.sha === 'string' ? entry.sha : '',
					url: typeof entry?.html_url === 'string' ? entry.html_url : '',
				}))
				.sort((left, right) => (left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'dir' ? -1 : 1))
			return { ok: true, full, path, kind: 'dir', items }
		}
		const size = Number.isFinite(data?.size) ? data.size : 0
		const encoding = typeof data?.encoding === 'string' ? data.encoding : ''
		const binary = encoding !== 'base64' || /\.(png|jpe?g|gif|webp|ico|zip|gz|tar|pdf|woff2?|ttf|otf|exe|dll|so|dylib|mp4|mp3)$/i.test(path)
		let text = null
		let truncated = false
		if (!binary && typeof data?.content === 'string') {
			if (size <= 1024 * 1024) text = Buffer.from(data.content, 'base64').toString('utf8')
			else truncated = true
		}
		return {
			ok: true,
			full,
			path: typeof data?.path === 'string' ? data.path : path,
			kind: 'file',
			size,
			sha: typeof data?.sha === 'string' ? data.sha : '',
			url: typeof data?.html_url === 'string' ? data.html_url : '',
			binary,
			truncated,
			text,
		}
	}

	async function treeRoute(url) {
		const { api } = await member()
		const full = assertFull(url.searchParams.get('full') ?? '')
		const ref = url.searchParams.get('ref') ?? ''
		let branch = ref
		if (branch === '') {
			const repo = await api.repo(full)
			branch = typeof repo?.default_branch === 'string' ? repo.default_branch : 'main'
		}
		const entries = await api.tree(full, branch)
		const paths = entries
			.filter((entry) => entry?.type === 'blob')
			.map((entry) => ({ path: String(entry.path ?? ''), size: Number.isFinite(entry.size) ? entry.size : 0 }))
			.filter((entry) => entry.path !== '')
		return { ok: true, full, ref: branch, count: paths.length, items: paths.slice(0, 3000) }
	}

	async function releaseRoute(req) {
		const body = await readBody(req)
		const { api } = await member()
		const full = assertFull(body.full)
		const tag = typeof body.tag === 'string' ? body.tag.trim() : ''
		if (tag === '') throw new HttpError(400, 'BAD_TAG', 'Tag 不能是空的')
		const release = await api.createRelease(full, {
			tagName: tag,
			name: typeof body.name === 'string' ? body.name.trim() : tag,
			body: typeof body.body === 'string' ? body.body : '',
			draft: body.draft === true,
			prerelease: body.prerelease === true,
			target: typeof body.target === 'string' ? body.target : undefined,
		})
		return {
			ok: true,
			full,
			tag,
			url: typeof release?.html_url === 'string' ? release.html_url : '',
			publishedAt: typeof release?.published_at === 'string' ? release.published_at : null,
		}
	}

	/** 设备流：先拿 user_code，界面把码和链接给用户，再轮询换 Token。 */
	async function deviceStart() {
		const clientId = (await readStore()).settings.deviceClientId || DEFAULT_CLIENT_ID
		const flow = await startDeviceFlow(clientId)
		return {
			ok: true,
			deviceCode: flow.deviceCode,
			userCode: flow.userCode,
			verifyUrl: flow.verifyUrl,
			expiresAt: flow.expiresAt,
			interval: flow.interval,
		}
	}

	async function devicePoll(req) {
		const body = await readBody(req)
		const clientId = (await readStore()).settings.deviceClientId || DEFAULT_CLIENT_ID
		const code = typeof body.deviceCode === 'string' ? body.deviceCode.trim() : ''
		if (code === '') throw new HttpError(400, 'BAD_DEVICE_CODE', 'deviceCode 不能是空的')
		const result = await pollDeviceFlow(clientId, code)
		if (result.status !== 'ok') return { ok: true, status: result.status, interval: result.interval ?? null }
		// 拿到 token 先验一次身份，避免把坏 token 写进凭据库
		const probe = createClient(result.token)
		const viewer = await probe.viewer()
		await ctx.credentials.set(TOKEN_REF, result.token)
		return {
			ok: true,
			status: 'ok',
			login: typeof viewer?.login === 'string' ? viewer.login : '',
			avatar: typeof viewer?.avatar_url === 'string' ? viewer.avatar_url : '',
			scope: result.scope,
		}
	}

	/** Star 日报：把跟踪仓库的起伏整理成一段能直接贴出去的 Markdown。 */
	async function starReport() {
		const store = await readStore()
		const head = ['## GitHub Star 日报', '', '| 仓库 | 当前 | 24h | 7d | 30d |', '| --- | ---: | ---: | ---: | ---: |']
		const rows = []
		for (const full of store.settings.tracked) {
			const entry = store.repos[full]
			if (entry === undefined) continue
			const history = Array.isArray(entry.history) && entry.history.length > 0
				? entry.history
				: entry.snapshots.map((snapshot) => ({ d: dayOf(new Date(snapshot.t).toISOString()), s: snapshot.s }))
			if (history.length === 0) continue
			const at = (daysAgo) => {
				const target = dayOf(new Date(Date.now() - daysAgo * 86_400_000).toISOString())
				let value = null
				for (const point of history) {
					if (point.d <= target) value = point.s
				}
				return value
			}
			const current = Number.isFinite(entry.stars) ? entry.stars : history[history.length - 1].s
			const delta = (past) => {
				if (past === null) return '—'
				const diff = current - past
				return (diff >= 0 ? '+' : '') + String(diff)
			}
			const row = { full, current, d1: delta(at(1)), d7: delta(at(7)), d30: delta(at(30)) }
			rows.push(row)
			head.push('| ' + full + ' | ' + current + ' | ' + row.d1 + ' | ' + row.d7 + ' | ' + row.d30 + ' |')
		}
		if (rows.length === 0) return { ok: true, empty: true, markdown: '## GitHub Star 日报\n\n还没有记录任何仓库。', rows: [] }
		const total = rows.reduce((sum, row) => sum + row.current, 0)
		head.push('', '合计 **' + total + '** star，共 ' + rows.length + ' 个仓库。')
		return { ok: true, empty: false, markdown: head.join('\n'), rows, total }
	}

	/** 概览：一次就把看板要的数字全算好，界面端不用串行打十几个请求。 */
	async function overview() {
		const api = await client()
		const store = await readStore()
		const viewer = await api.viewer()
		const login = typeof viewer?.login === 'string' ? viewer.login : ''
		const [listed, notifications] = await Promise.all([
			api.listRepos({ perPage: 100, page: 1 }),
			listNotifications(api).catch(() => []),
		])
		const repos = listed.repos.map((raw) => slimRepo(raw, login)).filter((repo) => repo !== null)
		let totalStars = 0
		let totalForks = 0
		let totalIssues = 0
		const languageCount = new Map()
		for (const repo of repos) {
			totalStars += repo.stars
			totalForks += repo.forks
			totalIssues += repo.openIssues
			if (repo.language !== '') languageCount.set(repo.language, (languageCount.get(repo.language) ?? 0) + 1)
		}
		const languages = [...languageCount.entries()]
			.sort((left, right) => right[1] - left[1])
			.slice(0, 8)
			.map(([language, count]) => ({ language, count, ratio: repos.length === 0 ? 0 : count / repos.length }))

		// 活动日历：优先用推送仓的提交统计（52 周每天的真实提交数），
		// 拿不到时退回公开事件里能看到的推送，保证热力图不至于空着。
		const activityCount = new Map()
		const bump = (iso, weight) => {
			const day = dayOf(iso)
			if (day === null) return
			activityCount.set(day, (activityCount.get(day) ?? 0) + weight)
		}
		const pushRepos = [...repos].filter((repo) => repo.mine && !repo.fork && !repo.archived).sort((left, right) => (left.pushedAt < right.pushedAt ? 1 : -1)).slice(0, 6)
		let statsUsed = false
		for (const repo of pushRepos) {
			try {
				const days = await api.commitActivity(repo.full)
				if (days.length === 0) continue
				for (const point of days) bump(new Date(point.t).toISOString(), point.n)
				statsUsed = true
			} catch {
				// 仓库没有统计（太大、刚建、没权限）就跳过
			}
		}
		if (!statsUsed) {
			const events = login === '' ? [] : await api.events(login).catch(() => [])
			for (const event of events) {
				const commits = Array.isArray(event?.payload?.commits) ? event.payload.commits.length : 0
				const weight = event?.type === 'PushEvent' ? Math.max(1, commits) : 1
				bump(typeof event?.created_at === 'string' ? event.created_at : null, weight)
			}
		}
		const activity = [...activityCount.entries()].map(([d, n]) => ({ d, n })).sort((left, right) => (left.d < right.d ? -1 : 1))

		// star 合计曲线：把每个被跟踪仓库的日快照按日期对齐后求和。
		const trackedSeries = store.settings.tracked.map((full) => {
			const entry = store.repos[full]
			const history = Array.isArray(entry?.history) ? entry.history : []
			return { full, history, stars: entry?.stars ?? null }
		})
		const daySet = new Set()
		for (const series of trackedSeries) for (const point of series.history) daySet.add(point.d)
		const days = [...daySet].sort()
		const total = []
		for (const day of days) {
			let sum = 0
			let seen = false
			for (const series of trackedSeries) {
				let latest = null
				for (const point of series.history) {
					if (point.d > day) break
					latest = point.s
				}
				if (latest !== null) {
					sum += latest
					seen = true
				}
			}
			if (seen) total.push({ d: day, s: sum })
		}

		const topRepos = [...repos].sort((left, right) => right.stars - left.stars).slice(0, 6)
		const recent = [...repos].filter((repo) => repo.pushedAt !== null).sort((left, right) => (left.pushedAt < right.pushedAt ? 1 : -1)).slice(0, 5)

		return {
			ok: true,
			login,
			repos: repos.length,
			totalStars,
			totalForks,
			totalIssues,
			unread: notifications.filter((item) => item.unread).length,
			tracked: store.settings.tracked.length,
			languages,
			activity,
			total,
			series: trackedSeries,
			topRepos,
			recent,
			rateLimit: api.state.rateLimit,
		}
	}

	async function handle(req, res) {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1')
		const pathname = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) || '/' : url.pathname
		const method = req.method ?? 'GET'
		try {
			if (method === 'GET' && pathname === '/state') return sendJson(res, 200, await state())
			if (method === 'GET' && pathname === '/overview') return sendJson(res, 200, await overview())
			if (method === 'POST' && pathname === '/token') {
				const body = await readBody(req)
				const token = typeof body.token === 'string' ? body.token.trim() : ''
				if (token === '') throw new HttpError(400, 'EMPTY_TOKEN', 'Token 是空的')
				const probe = createClient(token)
				const viewer = await probe.viewer()
				await ctx.credentials.set(TOKEN_REF, token)
				shared = null
				return sendJson(res, 200, { ok: true, login: viewer?.login ?? '', avatar: viewer?.avatar_url ?? '' })
			}
			if (method === 'DELETE' && pathname === '/token') {
				await ctx.credentials.unset(TOKEN_REF)
				shared = null
				return sendJson(res, 200, { ok: true })
			}
			if (method === 'GET' && pathname === '/repos') return sendJson(res, 200, await listRepos(url))
			if (method === 'GET' && pathname === '/repo') return sendJson(res, 200, await repoDetail(url))
			if (method === 'GET' && pathname === '/feed') return sendJson(res, 200, await feed())
			if (method === 'POST' && pathname === '/refresh') {
				const body = await readBody(req)
				const fulls = Array.isArray(body.fulls) ? body.fulls.filter((item) => typeof item === 'string') : undefined
				const result = await refreshStars(fulls)
				return sendJson(res, 200, { ok: true, ...result, state: await state() })
			}
			if (method === 'POST' && pathname === '/track') {
				const body = await readBody(req)
				const full = assertFull(body.full)
				const on = body.tracked !== false
				const store = await updateStore((draft) => {
					const set = new Set(draft.settings.tracked)
					if (on) set.add(full)
					else set.delete(full)
					draft.settings.tracked = [...set]
					return draft
				})
				return sendJson(res, 200, { ok: true, tracked: store.settings.tracked })
			}
			if (method === 'POST' && pathname === '/settings') {
				const body = await readBody(req)
				const store = await updateStore((draft) => {
					if (typeof body.refreshHours === 'number' && Number.isFinite(body.refreshHours)) {
						draft.settings.refreshHours = Math.min(168, Math.max(1, Math.round(body.refreshHours)))
					}
					if (typeof body.autoRefresh === 'boolean') draft.settings.autoRefresh = body.autoRefresh
					if (Array.isArray(body.tracked)) {
						draft.settings.tracked = body.tracked.filter((item) => typeof item === 'string' && /^[^/]+\/[^/]+$/.test(item))
					}
					return draft
				})
				return sendJson(res, 200, { ok: true, settings: store.settings })
			}
			if (method === 'POST' && pathname === '/star') {
				const body = await readBody(req)
				const full = assertFull(body.full)
				const api = await client()
				const current = await api.isStarred(full)
				const want = typeof body.starred === 'boolean' ? body.starred : !current
				if (want === true && current === false) await api.starRepo(full)
				if (want === false && current === true) await api.unstarRepo(full)
				return sendJson(res, 200, { ok: true, full, starred: want })
			}
			if (method === 'POST' && pathname === '/create-repo') {
				const body = await readBody(req)
				const repoName = typeof body.name === 'string' ? body.name.trim() : ''
				if (!/^[A-Za-z0-9._-]{1,100}$/.test(repoName)) throw new HttpError(400, 'BAD_NAME', '仓库名只能用字母、数字、点、下划线、短横线')
				const api = await client()
				const created = await api.request('/user/repos', {
					method: 'POST',
					body: {
						name: repoName,
						description: typeof body.description === 'string' ? body.description.slice(0, 350) : '',
						private: body.private === true,
						auto_init: body.autoInit !== false,
					},
				})
				const data = created.data
				if (typeof body.tracked === 'boolean') {
					await updateStore((draft) => {
						const set = new Set(draft.settings.tracked)
						if (body.tracked) set.add(data.full_name)
						else set.delete(data.full_name)
						draft.settings.tracked = [...set]
						return draft
					})
				}
				return sendJson(res, 200, { ok: true, full: data.full_name, htmlUrl: data.html_url, private: data.private === true })
			}
			if (method === 'POST' && pathname === '/push') {
				const body = await readBody(req)
				return sendJson(res, 200, await pushCode(body))
			}
			if (method === 'GET' && pathname === '/stars') {
				const store = await readStore()
				const full = url.searchParams.get('full')
				if (full !== null && full !== '') {
					assertFull(full)
					const entry = store.repos[full]
					return sendJson(res, 200, { ok: true, full, history: entry?.history ?? [], snapshots: entry?.snapshots ?? [], stars: entry?.stars ?? null })
				}
				return sendJson(res, 200, { ok: true, repos: store.repos })
			}
			if (method === 'GET' && pathname === '/issues') return sendJson(res, 200, await issuesRoute(url))
			if (method === 'GET' && pathname === '/issue') return sendJson(res, 200, await issueDetail(url))
			if (method === 'POST' && pathname === '/issue') return sendJson(res, 200, await issueCreate(req))
			if (method === 'POST' && pathname === '/issue/comment') return sendJson(res, 200, await issueComment(req))
			if (method === 'POST' && pathname === '/issue/edit') return sendJson(res, 200, await issueEdit(req))
			if (method === 'GET' && pathname === '/labels') return sendJson(res, 200, await labelsRoute(url))
			if (method === 'GET' && pathname === '/pulls') return sendJson(res, 200, await pullsRoute(url))
			if (method === 'GET' && pathname === '/pull') return sendJson(res, 200, await pullDetail(url))
			if (method === 'POST' && pathname === '/pull/review') return sendJson(res, 200, await pullReview(req))
			if (method === 'POST' && pathname === '/pull/merge') return sendJson(res, 200, await pullMerge(req))
			if (method === 'GET' && pathname === '/notifications') return sendJson(res, 200, await notificationsRoute(url))
			if (method === 'POST' && pathname === '/notifications/read') return sendJson(res, 200, await notificationRead(req))
			if (method === 'GET' && pathname === '/search') return sendJson(res, 200, await searchRoute(url))
			if (method === 'GET' && pathname === '/branches') return sendJson(res, 200, await branchesRoute(url))
			if (method === 'GET' && pathname === '/actions') return sendJson(res, 200, await actionsRoute(url))
			if (method === 'GET' && pathname === '/actions/jobs') return sendJson(res, 200, await actionJobs(url))
			if (method === 'POST' && pathname === '/actions/rerun') return sendJson(res, 200, await actionRerun(req))
			if (method === 'POST' && pathname === '/actions/cancel') return sendJson(res, 200, await actionCancel(req))
			if (method === 'GET' && pathname === '/actions/logs') return sendJson(res, 200, await actionLogs(url))
			if (method === 'GET' && pathname === '/contents') return sendJson(res, 200, await contentsRoute(url))
			if (method === 'GET' && pathname === '/tree') return sendJson(res, 200, await treeRoute(url))
			if (method === 'POST' && pathname === '/release') return sendJson(res, 200, await releaseRoute(req))
			if (method === 'POST' && pathname === '/device/start') return sendJson(res, 200, await deviceStart())
			if (method === 'POST' && pathname === '/device/poll') return sendJson(res, 200, await devicePoll(req))
			if (method === 'GET' && pathname === '/report') return sendJson(res, 200, await starReport())
			return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: `未知路由 ${method} ${pathname}` })
		} catch (error) {
			if (error instanceof HttpError) return sendJson(res, error.status, { ok: false, code: error.code, message: error.message })
			if (error instanceof GitHubError) {
				const status = error.code === 'TOKEN_INVALID' ? 400 : error.code === 'NOT_FOUND' ? 404 : error.code === 'RATE_LIMITED' ? 429 : 502
				return sendJson(res, status, { ok: false, code: error.code, message: error.message })
			}
			log(`处理 ${method} ${pathname} 出错：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
			return sendJson(res, 500, { ok: false, code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) })
		}
	}

	// Agent 工具：让模型能直接调 GitHub，而不是只能点界面。
	ctx.effect(() => registerTools(ctx, { client, member }), 'github-hub: agent tools')

	ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle }), 'github-hub: routes')

	// 周期性刷新：只做「到点了就刷新跟踪仓库」，避免每次启动都打卡。
	ctx.effect(() => ctx.interval(() => {
		readStore().then(async (store) => {
			if (!store.settings.autoRefresh || store.settings.tracked.length === 0) return
			const due = store.settings.lastRefreshAt === null
				|| Date.now() - store.settings.lastRefreshAt >= store.settings.refreshHours * 3_600_000
			if (!due) return
			if (await readToken() === null) return
			try {
				const result = await refreshStars()
				log(`自动刷新 ${result.refreshed.length} 个仓库，失败 ${result.failed.length} 个`)
			} catch (error) {
				log(`自动刷新失败：${error instanceof Error ? error.message : String(error)}`)
			}
		}).catch(() => {})
	}, REFRESH_TICK_MS), 'github-hub: star refresh tick')
}
