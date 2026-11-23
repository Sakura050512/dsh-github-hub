/**
 * GitHub REST v3 的最小客户端：只有 fetch，没有依赖。
 * 所有错误都收敛成带 code 的 GitHubError，让路由和界面能区分「Token 不对」「限流」「仓库不存在」。
 */

import { inflateRaw } from 'node:zlib'
import { createCache } from './cache.mjs'

const API_ROOT = 'https://api.github.com'
const UA = 'dsh-github-hub'
const REQUEST_TIMEOUT_MS = 20_000
const GET_TIMEOUT_MS = 60_000
/** GitHub 建议的搜索/列表页大小上限。 */
export const MAX_PER_PAGE = 100

export class GitHubError extends Error {
	constructor(code, message, extra) {
		super(message)
		this.name = 'GitHubError'
		this.code = code
		if (extra !== undefined) this.extra = extra
	}
}

function rateLimitOf(headers) {
	return {
		limit: Number(headers.get('x-ratelimit-limit') ?? 0) || 0,
		remaining: Number(headers.get('x-ratelimit-remaining') ?? 0) || 0,
		resetAt: Number(headers.get('x-ratelimit-reset') ?? 0) * 1000 || 0,
	}
}

/**
 * 从 zip 字节里取出所有 *.txt 条目的内容拼起来。Actions 的 job 日志包就是
 * 一个「<job>-<n>-<step>.txt」或单个日志文件，没有别的花样；走中心目录找条目，
 * 支持 stored(0) 与 deflate(8) 两种压缩方式。
 */
export async function unzipText(bytes) {
	const view = Buffer.from(bytes)
	// 找中央目录结尾（EOCD）：0x06054b50
	let eocd = -1
	for (let i = view.length - 22; i >= Math.max(0, view.length - 66_000); i -= 1) {
		if (view.readUInt32LE(i) === 0x06054b50) {
			eocd = i
			break
		}
	}
	if (eocd < 0) throw new GitHubError('BAD_ZIP', '日志包不是合法的 zip')
	const count = view.readUInt16LE(eocd + 10)
	let offset = view.readUInt32LE(eocd + 16)
	const parts = []
	for (let index = 0; index < count && offset + 46 <= view.length; index += 1) {
		if (view.readUInt32LE(offset) !== 0x02014b50) break
		const method = view.readUInt16LE(offset + 10)
		const compressedSize = view.readUInt32LE(offset + 20)
		const nameLength = view.readUInt16LE(offset + 28)
		const extraLength = view.readUInt16LE(offset + 30)
		const commentLength = view.readUInt16LE(offset + 32)
		const localOffset = view.readUInt32LE(offset + 42)
		const name = view.toString('utf8', offset + 46, offset + 46 + nameLength)
		offset += 46 + nameLength + extraLength + commentLength
		if (!name.toLowerCase().endsWith('.txt')) continue
		if (localOffset + 30 > view.length) continue
		const localNameLength = view.readUInt16LE(localOffset + 26)
		const localExtraLength = view.readUInt16LE(localOffset + 28)
		const dataStart = localOffset + 30 + localNameLength + localExtraLength
		const data = view.subarray(dataStart, dataStart + compressedSize)
		try {
			if (method === 0) parts.push(data.toString('utf8'))
			else if (method === 8) parts.push((await gunzipRaw(data)).toString('utf8'))
		} catch {
			parts.push(`（${name} 解压失败）`)
		}
	}
	if (parts.length === 0) return '（日志包是空的）'
	return parts.join('\n')
}

/**
 * GitHub 现在把 job 日志重定向到 Azure Blob，返回的是纯文本而不是 zip。
 * 这里先看 magic：PK\x03\x04 走解包，否则当文本直接返回。
 */
export async function logsToText(bytes) {
	const view = Buffer.from(bytes)
	if (view.length === 0) return '（这次运行没有日志）'
	if (view.length >= 4 && view.readUInt32LE(0) === 0x04034b50) return unzipText(bytes)
	return view.toString('utf8').replace(/^\uFEFF/, '')
}

/** 裸 deflate 流（zip 的 method 8），不带头部。 */
function gunzipRaw(data) {
	return new Promise((resolve, reject) => {
		inflateRaw(data, (error, result) => (error === null ? resolve(result) : reject(error)))
	})
}

/**
 * GitHub 的 Link 头解析成 `rel -> url`。 */
export function parseLinkHeader(value) {
	const links = {}
	if (typeof value !== 'string' || value === '') return links
	for (const part of value.split(',')) {
		const match = /<([^>]+)>\s*;\s*rel="?([^";]+)"?/.exec(part.trim())
		if (match !== null) links[match[2]] = match[1]
	}
	return links
}

/** 从 Link 的 last 页地址里取出页码；没有就返回 null。 */
export function lastPageOf(links) {
	if (typeof links.last !== 'string') return null
	const match = /[?&]page=(\d+)/.exec(links.last)
	return match === null ? null : Number(match[1])
}

export function encodeContent(text) {
	return Buffer.from(text, 'utf8').toString('base64')
}

/**
 * 建一个绑定 Token 的客户端。token 为空时仍可发请求，只是拿不到私有内容。
 * @param {string | undefined} token
 */
/** accept 头会改变响应内容（star 列表带 starred_at 就是靠它），所以进缓存 key。 */
function acceptTag(options) {
	return typeof options.accept === 'string' ? options.accept : ''
}

export function createClient(token, options = {}) {
	const state = { rateLimit: null }
	// 读请求缓存：默认 60 秒；传 cacheTtlMs: 0 就关掉（测试里这么用）。
	const cache = createCache(options.cacheTtlMs ?? 60_000)

	async function request(path, requestOptions = {}) {
		const options = requestOptions
		const url = path.startsWith('http') ? path : `${API_ROOT}${path}`
		const headers = {
			accept: options.accept ?? 'application/vnd.github+json',
			'user-agent': UA,
			'x-github-api-version': '2022-11-28',
			...(options.headers ?? {}),
		}
		if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
		let body
		if (options.body !== undefined) {
			headers['content-type'] = 'application/json'
			body = JSON.stringify(options.body)
		}
		const method = options.method ?? 'GET'
		const cacheKey = method === 'GET' && options.cache !== false ? `${url}|${acceptTag(options)}` : null
		if (cacheKey !== null) {
			const cached = cache.get(cacheKey)
			if (cached !== undefined) return cached
		}
		if (method !== 'GET') cache.clear()
		// 大响应（2MB 的 PR 列表之类）走代理偶尔会整段卡住：连接建立了、body 却传不完。
		// 因此把「取头 + 读完 body」整体放进重试，GET 重试 3 次；POST 不重试，避免重复提交。
		const attempts = method === 'GET' ? 3 : 1
		const timeoutMs = options.timeoutMs ?? (method === 'GET' ? GET_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
		let response
		let text = ''
		let rawBytes = null
		let lastError = null
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
				if (options.raw === true) {
					rawBytes = new Uint8Array(await response.arrayBuffer())
					text = ''
				} else {
					text = await response.text()
				}
				lastError = null
				break
			} catch (error) {
				lastError = error
				response = undefined
				text = ''
				if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
			}
		}
		if (lastError !== null || response === undefined) {
			const reason = lastError instanceof Error ? lastError.message : String(lastError)
			const slow = lastError instanceof Error && lastError.name === 'TimeoutError'
			throw new GitHubError('NETWORK', `${slow ? 'GitHub 响应太慢（已重试 ' + attempts + ' 次）' : '连不上 GitHub'}：${reason}`)
		}
		state.rateLimit = rateLimitOf(response.headers)
		// 日志接口返回的是 zip，不能按 JSON 解析；这类请求直接把字节交出去。
		if (options.raw === true && response.ok) {
			return { data: rawBytes, headers: response.headers, rateLimit: state.rateLimit }
		}
		let parsed = null
		if (text !== '') {
			try {
				parsed = JSON.parse(text)
			} catch {
				parsed = null
			}
		}
		if (!response.ok) {
			const apiMessage = parsed !== null && typeof parsed.message === 'string' ? parsed.message : `HTTP ${response.status}`
			const rateLimited = response.status === 403 && state.rateLimit.remaining === 0
			if (response.status === 401) {
				throw new GitHubError('TOKEN_INVALID', 'Token 无效或已过期，请重新填写', { status: 401 })
			}
			if (rateLimited) {
				throw new GitHubError('RATE_LIMITED', `GitHub 限流了，${formatReset(state.rateLimit.resetAt)} 后恢复`, {
					status: 403,
					rateLimit: state.rateLimit,
				})
			}
			if (response.status === 404) throw new GitHubError('NOT_FOUND', apiMessage, { status: 404 })
			if (response.status === 403 || response.status === 429) {
				throw new GitHubError('FORBIDDEN', apiMessage, { status: response.status })
			}
			throw new GitHubError('HTTP_ERROR', apiMessage, { status: response.status })
		}
		const result = { data: parsed, headers: response.headers, rateLimit: state.rateLimit }
		if (cacheKey !== null) cache.set(cacheKey, result, options.cacheTtlMs !== undefined ? options.cacheTtlMs : undefined)
		return result
	}

	return {
		request,
		state,
		cache,
		async viewer() {
			const { data } = await request('/user')
			return data
		},
		async viewerEmail() {
			try {
				const { data } = await request('/user/emails')
				if (!Array.isArray(data)) return null
				const primary = data.find((item) => item !== null && typeof item === 'object' && item.primary === true)
				const verified = data.find((item) => item !== null && typeof item === 'object' && item.verified === true)
				return (primary ?? verified ?? data[0] ?? null)?.email ?? null
			} catch {
				return null
			}
		},
		/**
		 * 列出仓库；`affiliation` 覆盖自己的、协作的、组织的。
		 * @param {{ perPage?: number, page?: number, sort?: string, affiliation?: string, visibility?: string }} [options]
		 */
		async listRepos(options = {}) {
			const perPage = Math.min(options.perPage ?? MAX_PER_PAGE, MAX_PER_PAGE)
			const query = new URLSearchParams({
				per_page: String(perPage),
				page: String(options.page ?? 1),
				sort: options.sort ?? 'updated',
				direction: 'desc',
			})
			if (typeof options.affiliation === 'string') query.set('affiliation', options.affiliation)
			if (typeof options.visibility === 'string') query.set('visibility', options.visibility)
			const { data, headers } = await request(`/user/repos?${query.toString()}`)
			return {
				repos: Array.isArray(data) ? data : [],
				link: parseLinkHeader(headers.get('link')),
			}
		},
		async repo(full) {
			const { data } = await request(`/repos/${full}`)
			return data
		},
		async commits(full, branch) {
			const query = new URLSearchParams({ per_page: '30' })
			if (typeof branch === 'string' && branch !== '') query.set('sha', branch)
			const { data } = await request(`/repos/${full}/commits?${query.toString()}`)
			return Array.isArray(data) ? data : []
		},
		async releases(full) {
			const { data } = await request(`/repos/${full}/releases?per_page=10`)
			return Array.isArray(data) ? data : []
		},
		/** 最近 52 周的每日提交数（GitHub 自己的贡献图数据）。仓库太大时 GitHub 会返回 202，等一会儿再来。 */
		async commitActivity(full) {
			const { data } = await request(`/repos/${full}/stats/commit_activity`)
			if (!Array.isArray(data)) return []
			const days = []
			for (const week of data) {
				const total = Number.isFinite(week?.total) ? week.total : 0
				const perDay = Array.isArray(week?.days) ? week.days : []
				if (total === 0 && perDay.every((count) => !Number.isFinite(count) || count === 0)) continue
				const stamp = Number.isFinite(week?.week) ? week.week * 1000 : null
				if (stamp === null) continue
				for (let index = 0; index < 7; index += 1) {
					const count = Number.isFinite(perDay[index]) ? perDay[index] : 0
					if (count === 0) continue
					days.push({ t: stamp + index * 86400000, n: count })
				}
			}
			return days
		},
		async events(login) {
			const { data } = await request(`/users/${encodeURIComponent(login)}/events/public?per_page=100`)
			return Array.isArray(data) ? data : []
		},
		/** 一页 stargazers，带 starred_at 时间（star+json 媒体类型）。 */
		async stargazerPage(full, page) {
			const { data, headers } = await request(`/repos/${full}/stargazers?per_page=100&page=${page}`, {
				accept: 'application/vnd.github.star+json',
			})
			return {
				items: Array.isArray(data) ? data : [],
				lastPage: lastPageOf(parseLinkHeader(headers.get('link'))),
			}
		},
		async branches(full) {
			const { data } = await request(`/repos/${full}/branches?per_page=100`)
			return Array.isArray(data) ? data : []
		},
		async branchHead(full, branch) {
			const { data } = await request(`/repos/${full}/git/ref/heads/${encodeURIComponent(branch)}`)
			return data
		},
		async commitObject(full, sha) {
			const { data } = await request(`/repos/${full}/git/commits/${sha}`)
			return data
		},
		async createBlob(full, content, encoding) {
			const { data } = await request(`/repos/${full}/git/blobs`, {
				method: 'POST',
				body: { content, encoding },
			})
			return data
		},
		async createTree(full, baseTree, entries) {
			const { data } = await request(`/repos/${full}/git/trees`, {
				method: 'POST',
				body: { base_tree: baseTree, tree: entries },
			})
			return data
		},
		async createCommit(full, message, treeSha, parents, author) {
			const body = { message, tree: treeSha, parents }
			if (author !== undefined) body.author = author
			const { data } = await request(`/repos/${full}/git/commits`, { method: 'POST', body })
			return data
		},
		async updateRef(full, branch, sha, force) {
			const { data } = await request(`/repos/${full}/git/refs/heads/${encodeURIComponent(branch)}`, {
				method: 'PATCH',
				body: { sha, force: force === true },
			})
			return data
		},
		/** 我 star 过的仓库名集合（最多 300 个，够标记列表用）。 */
		async starredNames(maxPages = 3) {
			const names = new Set()
			for (let page = 1; page <= maxPages; page += 1) {
				let data, headers
				try {
					({ data, headers } = await request(`/user/starred?per_page=100&page=${page}`))
				} catch (error) {
					if (error instanceof GitHubError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) break
					throw error
				}
				if (!Array.isArray(data) || data.length === 0) break
				for (const item of data) {
					if (item !== null && typeof item.full_name === "string") names.add(item.full_name)
				}
				if (parseLinkHeader(headers.get("link")).next === undefined) break
			}
			return names
		},
		/** 仓库是否已 star（204/404）。 */
		async isStarred(full) {
			try {
				await request(`/user/starred/${full}`)
				return true
			} catch (error) {
				if (error instanceof GitHubError && error.code === 'NOT_FOUND') return false
				throw error
			}
		},
		async starRepo(full) {
			await request(`/user/starred/${full}`, { method: 'PUT' })
		},
		async unstarRepo(full) {
			await request(`/user/starred/${full}`, { method: 'DELETE' })
		},
		/**
		 * 一次 GitHub Actions 运行列表。
		 * @param {string} full
		 * @param {{ perPage?: number, page?: number, branch?: string }} [options]
		 */
		async workflowRuns(full, options = {}) {
			const query = new URLSearchParams({ per_page: String(options.perPage ?? 20), page: String(options.page ?? 1) })
			if (typeof options.branch === 'string' && options.branch !== '') query.set('branch', options.branch)
			const { data, headers } = await request(`/repos/${full}/actions/runs?${query.toString()}`)
			return {
				runs: Array.isArray(data?.workflow_runs) ? data.workflow_runs : [],
				total: Number.isFinite(data?.total_count) ? data.total_count : 0,
				link: parseLinkHeader(headers.get('link')),
			}
		},
		/** 一次运行里的 job 与步骤（GitHub 不给我们日志原文，步骤状态已足够判断卡在哪）。 */
		async runJobs(full, runId) {
			const { data } = await request(`/repos/${full}/actions/runs/${runId}/jobs?per_page=30`)
			return Array.isArray(data?.jobs) ? data.jobs : []
		},
		async rerunRun(full, runId) {
			await request(`/repos/${full}/actions/runs/${runId}/rerun`, { method: 'POST' })
		},
		async cancelRun(full, runId) {
			await request(`/repos/${full}/actions/runs/${runId}/cancel`, { method: 'POST' })
		},
		/** 仓库某个路径下的内容；目录返回数组，文件返回单条带 base64 content。 */
		async contents(full, path, ref) {
			const clean = String(path ?? '').replace(/^\/+/, '')
			const query = new URLSearchParams()
			if (typeof ref === 'string' && ref !== '') query.set('ref', ref)
			const suffix = query.toString() === '' ? '' : `?${query.toString()}`
			const { data } = await request(`/repos/${full}/contents/${clean}${suffix}`)
			return data
		},
		/** 整个仓库的文件树（recursive），用于目录树侧栏。 */
		async tree(full, ref) {
			const { data } = await request(`/repos/${full}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
			return Array.isArray(data?.tree) ? data.tree : []
		},
		/** 建 Release（DeepSeek-GitHub 的亮点，直接搬过来）。 */
		async createRelease(full, options = {}) {
			const payload = {
				tag_name: options.tagName,
				name: options.name ?? options.tagName,
				body: options.body ?? '',
				draft: options.draft === true,
				prerelease: options.prerelease === true,
			}
			if (typeof options.target === 'string' && options.target !== '') payload.target_commitish = options.target
			const { data } = await request(`/repos/${full}/releases`, { method: 'POST', body: payload })
			return data
		},
		/** 一次运行的耗时（毫秒），跑完才有意义。 */
	}
}

function formatReset(resetAt) {
	if (!Number.isFinite(resetAt) || resetAt <= 0) return '稍后'
	const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000))
	return `${minutes} 分钟`
}

/** 仓库列表里我们关心的字段，剔掉 GitHub 返回的大对象。 */
export function slimRepo(raw, viewerLogin) {
	if (raw === null || typeof raw !== 'object') return null
	const full = typeof raw.full_name === 'string' ? raw.full_name : ''
	if (full === '') return null
	const owner = raw.owner !== null && typeof raw.owner === 'object' ? raw.owner : {}
	return {
		full,
		name: typeof raw.name === 'string' ? raw.name : full,
		owner: typeof owner.login === 'string' ? owner.login : full.split('/')[0],
		mine: typeof owner.login === 'string' && owner.login === viewerLogin,
		private: raw.private === true,
		fork: raw.fork === true,
		archived: raw.archived === true,
		description: typeof raw.description === 'string' ? raw.description : '',
		language: typeof raw.language === 'string' ? raw.language : '',
		stars: Number.isFinite(raw.stargazers_count) ? raw.stargazers_count : 0,
		forks: Number.isFinite(raw.forks_count) ? raw.forks_count : 0,
		openIssues: Number.isFinite(raw.open_issues_count) ? raw.open_issues_count : 0,
		watchers: Number.isFinite(raw.subscribers_count) ? raw.subscribers_count : 0,
		watchersTotal: Number.isFinite(raw.watchers_count) ? raw.watchers_count : 0,
		defaultBranch: typeof raw.default_branch === 'string' ? raw.default_branch : 'main',
		htmlUrl: typeof raw.html_url === 'string' ? raw.html_url : `https://github.com/${full}`,
		homepage: typeof raw.homepage === 'string' ? raw.homepage : '',
		pushedAt: typeof raw.pushed_at === 'string' ? raw.pushed_at : null,
		updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null,
		createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
		topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => typeof t === 'string').slice(0, 12) : [],
		sizeKb: Number.isFinite(raw.size) ? raw.size : 0,
		license: raw.license !== null && typeof raw.license === 'object' && typeof raw.license.spdx_id === 'string'
			? raw.license.spdx_id
			: '',
	}
}

/** 一天一个点：把 star 时间戳折成 `{ d: 'YYYY-MM-DD', s }` 的累计曲线。 */
export function starHistoryFromPages(samples) {
	const days = new Map()
	for (const sample of samples) {
		if (typeof sample.day !== 'string' || !Number.isFinite(sample.stars)) continue
		const previous = days.get(sample.day)
		if (previous === undefined || sample.stars > previous) days.set(sample.day, sample.stars)
	}
	return [...days.entries()]
		.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
		.map(([d, s]) => ({ d, s }))
}

export function dayOf(iso) {
	if (typeof iso !== 'string') return null
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
	return match === null ? null : match[1]
}
