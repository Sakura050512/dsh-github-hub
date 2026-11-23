/**
 * Agent 工具层：把 GitHub 的能力暴露给对话里的模型，而不是只给人点按钮。
 * 工具定义只用 @deepseek-ai/dsh-tools 支持的 JSON Schema 子集
 * （type/properties/required/additionalProperties/items/enum/const/description）。
 */

const outputSchema = { type: 'object', additionalProperties: true }

function text(value) {
	return typeof value === 'string' ? value : ''
}

function repoParam(extra) {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			action: {
				type: 'string',
				enum: extra.actions,
				description: extra.actionHint,
			},
			full: { type: 'string', description: '仓库全名，形如 owner/name。列表类操作可省略。' },
			...extra.properties,
		},
		required: ['action'],
	}
}

function fail(code, message) {
	const error = new Error(message)
	error.code = code
	return error
}

function lines(items, map) {
	return items.length === 0 ? '（空）' : items.map(map).join('\n')
}

/**
 * 注册全部工具。
 * @param {object} ctx 宿主 Context（需要 ctx.tools）
 * @param {{ client: () => Promise<any>, member: () => Promise<{api:any,login:string}>, readStore: Function }} deps
 */
export function registerTools(ctx, deps) {
	const disposers = []

	function define(definition) {
		disposers.push(ctx.tools.register(definition))
	}

	define({
		name: 'github_repo',
		description: '查看或管理 GitHub 仓库：列出当前账号可见的仓库、看单个仓库详情、新建仓库、加/取消 star。需要用户已经在插件里连过 Token。',
		parameters: repoParam({
			actions: ['list', 'get', 'create', 'star'],
			actionHint: 'list=列出仓库；get=看一个仓库；create=新建；star=加星或取消星',
			properties: {
				name: { type: 'string', description: 'action=create 时的仓库名（只需名字，不用 owner/）。' },
				description: { type: 'string', description: 'action=create 时的仓库描述。' },
				private: { type: 'boolean', description: 'action=create 时是否私有。' },
				starred: { type: 'boolean', description: 'action=star 时 true=加星，false=取消，省略则取反。' },
				limit: { type: 'number', description: 'action=list 时返回多少个，默认 30，最多 100。' },
				affiliation: { type: 'string', enum: ['all', 'owner', 'organization_member'], description: 'action=list 的过滤范围，默认 all。' },
			},
		}),
		async execute(args) {
			const { api, login } = await deps.member()
			if (args.action === 'list') {
				const perPage = Math.max(1, Math.min(100, Number(args.limit ?? 30)))
				const affiliation = args.affiliation === 'owner'
					? 'owner'
					: args.affiliation === 'organization_member' ? 'organization_member' : 'owner,collaborator,organization_member'
				const { repos } = await api.listRepos({ perPage, affiliation })
				return {
					ok: true,
					login,
					count: repos.length,
					repos: repos.map((raw) => ({
						full: text(raw.full_name),
						private: raw.private === true,
						stars: Number(raw.stargazers_count ?? 0),
						language: text(raw.language),
						updatedAt: text(raw.updated_at),
						description: text(raw.description),
						htmlUrl: text(raw.html_url),
					})),
				}
			}
			const full = requireFull(args.full)
			if (args.action === 'get') {
				const raw = await api.repo(full)
				return {
					ok: true,
					repo: {
						full: text(raw.full_name),
						description: text(raw.description),
						private: raw.private === true,
						stars: Number(raw.stargazers_count ?? 0),
						forks: Number(raw.forks_count ?? 0),
						openIssues: Number(raw.open_issues_count ?? 0),
						language: text(raw.language),
						defaultBranch: text(raw.default_branch),
						pushedAt: text(raw.pushed_at),
						htmlUrl: text(raw.html_url),
						topics: Array.isArray(raw.topics) ? raw.topics : [],
					},
				}
			}
			if (args.action === 'create') {
				const name = text(args.name).trim()
				if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw fail('BAD_NAME', '仓库名只能用字母、数字、点、下划线、短横线')
				const created = await api.request('/user/repos', {
					method: 'POST',
					body: { name, description: text(args.description).slice(0, 350), private: args.private === true, auto_init: true },
				})
				return { ok: true, full: text(created.data?.full_name), htmlUrl: text(created.data?.html_url), private: created.data?.private === true }
			}
			if (args.action === 'star') {
				const current = await api.isStarred(full)
				const want = typeof args.starred === 'boolean' ? args.starred : !current
				if (want && !current) await api.starRepo(full)
				if (!want && current) await api.unstarRepo(full)
				return { ok: true, full, starred: want }
			}
			throw fail('BAD_ACTION', `不认识的 action：${String(args.action)}`)
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				if (Array.isArray(value.repos)) {
					return [{ type: 'text', text: `共 ${value.count} 个仓库：\n${lines(value.repos, (repo) => `- ${repo.full}${repo.private ? '（私有）' : ''} ★${repo.stars} ${repo.language || ''}`.trimEnd())}` }]
				}
				if (value.repo !== undefined) {
					const repo = value.repo
					return [{ type: 'text', text: `**${repo.full}** ★${repo.stars} · fork ${repo.forks} · open issue ${repo.openIssues}\n${repo.description || '（没有描述）'}\n${repo.htmlUrl}` }]
				}
				if (typeof value.starred === 'boolean') return [{ type: 'text', text: `${value.full} 现在${value.starred ? '已 star' : '未 star'}` }]
				return [{ type: 'text', text: `已创建 ${value.full}：${value.htmlUrl}` }]
			},
		},
	})

	define({
		name: 'github_issue',
		description: 'GitHub issue 操作：列出/查看/新建/评论/关闭/重开。用它可以真正处理仓库里的待办，而不只是看列表。',
		parameters: repoParam({
			actions: ['list', 'get', 'create', 'comment', 'close', 'reopen'],
			actionHint: 'list=列 issue；get=看详情含评论；create=新建；comment=评论；close=关闭；reopen=重开',
			properties: {
				number: { type: 'number', description: 'issue 编号，get/comment/close/reopen 必填。' },
				title: { type: 'string', description: 'action=create 的标题。' },
				body: { type: 'string', description: 'create 的正文，或 comment 的内容。' },
				labels: { type: 'array', items: { type: 'string' }, description: 'action=create 的标签名列表。' },
				state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'action=list 的状态过滤，默认 open。' },
				limit: { type: 'number', description: 'action=list 返回多少条，默认 20。' },
			},
		}),
		async execute(args, exec) {
			const { api } = await deps.member()
			const full = requireFull(args.full)
			if (args.action === 'list') {
				const { listIssues } = await import('./work.mjs')
				const result = await listIssues(api, full, { state: args.state ?? 'open', perPage: Math.max(1, Math.min(100, Number(args.limit ?? 20))) })
				return { ok: true, full, count: result.items.length, issues: result.items }
			}
			const number = Number(args.number)
			if (!Number.isInteger(number) || number <= 0) throw fail('BAD_NUMBER', '这个操作要带 issue 编号（number）')
			if (args.action === 'get') {
				const { getIssue, issueComments } = await import('./work.mjs')
				const [issue, comments] = await Promise.all([getIssue(api, full, number), issueComments(api, full, number).catch(() => [])])
				return { ok: true, full, issue, comments }
			}
			if (args.action === 'create') {
				const { createIssue } = await import('./work.mjs')
				const title = text(args.title).trim()
				if (title === '') throw fail('BAD_TITLE', '新建 issue 要带标题（title）')
				const issue = await createIssue(api, full, { title, body: text(args.body), labels: Array.isArray(args.labels) ? args.labels : [] })
				return { ok: true, full, issue }
			}
			if (args.action === 'comment') {
				const { commentIssue } = await import('./work.mjs')
				const body = text(args.body).trim()
				if (body === '') throw fail('BAD_BODY', '评论要有内容（body）')
				return { ok: true, full, number, comment: await commentIssue(api, full, number, body) }
			}
			const { editIssue } = await import('./work.mjs')
			const issue = await editIssue(api, full, number, { state: args.action === 'close' ? 'closed' : 'open' })
			return { ok: true, full, number, state: issue?.state ?? '' }
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				if (Array.isArray(value.issues)) {
					return [{ type: 'text', text: `${value.full} 有 ${value.count} 个 issue：\n${lines(value.issues, (item) => `- #${item.number} [${item.state}] ${item.title}${item.labels.length > 0 ? ` (${item.labels.join(', ')})` : ''}`)}` }]
				}
				if (value.issue !== undefined) {
					const issue = value.issue
					const comments = Array.isArray(value.comments) ? value.comments : []
					return [{ type: 'text', text: `#${issue.number} ${issue.title}（${issue.state}，${issue.author}）\n${issue.body.slice(0, 1500)}\n评论 ${comments.length} 条\n${issue.htmlUrl}` }]
				}
				if (value.comment !== undefined) return [{ type: 'text', text: `已在 #${value.number} 下评论` }]
				return [{ type: 'text', text: `#${value.number} 现在是 ${value.state}` }]
			},
		},
	})

	define({
		name: 'github_pr',
		description: 'GitHub Pull Request 操作：列出、看详情（含 diff）、提 review（通过/打回/评论）、合并（merge/squash/rebase）。',
		parameters: repoParam({
			actions: ['list', 'get', 'review', 'merge'],
			actionHint: 'list=列 PR；get=看详情含改动 diff；review=提审核意见；merge=合并',
			properties: {
				number: { type: 'number', description: 'PR 编号，get/review/merge 必填。' },
				event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], description: 'action=review 的结论。' },
				body: { type: 'string', description: 'review 或合并的附言。' },
				method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'action=merge 的合并方式，默认 merge。' },
				state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'action=list 的状态过滤，默认 open。' },
				limit: { type: 'number', description: 'action=list 返回多少条，默认 20。' },
			},
		}),
		async execute(args) {
			const { api } = await deps.member()
			const full = requireFull(args.full)
			if (args.action === 'list') {
				const { listPulls } = await import('./work.mjs')
				const result = await listPulls(api, full, { state: args.state ?? 'open', perPage: Math.max(1, Math.min(100, Number(args.limit ?? 20))) })
				return { ok: true, full, count: result.items.length, pulls: result.items }
			}
			const number = Number(args.number)
			if (!Number.isInteger(number) || number <= 0) throw fail('BAD_NUMBER', '这个操作要带 PR 编号（number）')
			if (args.action === 'get') {
				const { getPull, pullFiles, pullComments } = await import('./work.mjs')
				const [pull, files, comments] = await Promise.all([
					getPull(api, full, number),
					pullFiles(api, full, number).catch(() => []),
					pullComments(api, full, number).catch(() => []),
				])
				return { ok: true, full, pull, files, comments }
			}
			if (args.action === 'review') {
				const { submitReview } = await import('./work.mjs')
				const review = await submitReview(api, full, number, { event: args.event ?? 'COMMENT', body: text(args.body) })
				return { ok: true, full, number, review }
			}
			if (args.action === 'merge') {
				const { mergePull } = await import('./work.mjs')
				const result = await mergePull(api, full, number, { method: args.method, commitMessage: text(args.body) })
				if (!result.merged) throw fail('NOT_MERGEABLE', result.message || '这个 PR 现在不能合并')
				return { ok: true, full, number, ...result }
			}
			throw fail('BAD_ACTION', `不认识的 action：${String(args.action)}`)
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				if (Array.isArray(value.pulls)) {
					return [{ type: 'text', text: `${value.full} 有 ${value.count} 个 PR：\n${lines(value.pulls, (item) => `- #${item.number} [${item.state}${item.draft ? ', draft' : ''}] ${item.title} (${item.head}→${item.base}) +${item.additions}/-${item.deletions}`)}` }]
				}
				if (value.pull !== undefined) {
					const pull = value.pull
					const files = Array.isArray(value.files) ? value.files : []
					const body = files.slice(0, 5).map((file) => `### ${file.filename} (+${file.additions}/-${file.deletions})\n\`\`\`diff\n${file.patch.slice(0, 4000)}\n\`\`\``).join('\n\n')
					return [{ type: 'text', text: `#${pull.number} ${pull.title}（${pull.state}，${pull.head}→${pull.base}）\n改动 ${files.length} 个文件\n\n${body}\n\n${pull.htmlUrl}` }]
				}
				if (value.review !== undefined) return [{ type: 'text', text: `已对 #${value.number} 提交 ${value.review.state}` }]
				return [{ type: 'text', text: `#${value.number} 已合并：${value.sha}` }]
			},
		},
	})

	define({
		name: 'github_push',
		description: '把文件内容直接提交到 GitHub 仓库（Git Data API，一次可以提交多个文件）。不覆盖别人的提交：父提交永远取当前分支头，并发时 GitHub 会拒绝。',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				full: { type: 'string', description: '仓库全名，形如 owner/name。' },
				branch: { type: 'string', description: '目标分支，默认用仓库的默认分支。' },
				message: { type: 'string', description: '提交信息。' },
				files: {
					type: 'array',
					description: '要写入的文件列表，每个含 path 与 content。',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							path: { type: 'string', description: '仓库内路径，形如 src/a.ts。' },
							content: { type: 'string', description: '文件的完整内容。' },
						},
						required: ['path', 'content'],
					},
				},
			},
			required: ['full', 'message', 'files'],
		},
		async execute(args) {
			const { api } = await deps.member()
			const full = requireFull(args.full)
			const message = text(args.message).trim()
			if (message === '') throw fail('BAD_MESSAGE', '提交信息不能是空的')
			const files = Array.isArray(args.files) ? args.files : []
			if (files.length === 0) throw fail('NO_FILES', '至少要给一个文件')
			const info = await api.repo(full)
			const branch = text(args.branch).trim() || text(info.default_branch) || 'main'
			const head = await api.branchHead(full, branch)
			const headSha = text(head?.object?.sha)
			const base = await api.commitObject(full, headSha)
			const entries = []
			for (const file of files) {
				const path = text(file.path).trim().replace(/^\/+/, '')
				if (path === '') throw fail('BAD_PATH', '文件路径不能是空的')
				const blob = await api.createBlob(full, text(file.content), 'utf-8')
				entries.push({ path, mode: '100644', type: 'blob', sha: text(blob.sha) })
			}
			const tree = await api.createTree(full, text(base.tree?.sha), entries)
			const commit = await api.createCommit(full, message, text(tree.sha), [headSha])
			await api.updateRef(full, branch, text(commit.sha), false)
			return { ok: true, full, branch, sha: text(commit.sha), url: `https://github.com/${full}/commit/${text(commit.sha)}`, files: entries.map((entry) => entry.path) }
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				return [{ type: 'text', text: `已提交 ${value.files.length} 个文件到 ${value.full}@${value.branch}\n${value.url}` }]
			},
		},
	})

	define({
		name: 'github_notifications',
		description: '看 GitHub 未读通知（谁 @ 了你、哪个 PR 等你 review、哪个 issue 有回复），也可以把某条标记为已读。',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				action: { type: 'string', enum: ['list', 'read'], description: 'list=看通知；read=标记已读。' },
				id: { type: 'string', description: 'action=read 时的通知 id。' },
				all: { type: 'boolean', description: 'list 时是否包含已读，默认只看未读。' },
			},
			required: ['action'],
		},
		async execute(args) {
			const { api } = await deps.member()
			if (args.action === 'read') {
				const id = text(args.id).trim()
				if (id === '') throw fail('BAD_ID', '标记已读要带通知 id')
				const { markNotificationRead } = await import('./work.mjs')
				await markNotificationRead(api, id)
				return { ok: true, id }
			}
			const { listNotifications } = await import('./work.mjs')
			const items = await listNotifications(api, { all: args.all === true, perPage: 30 })
			return { ok: true, unread: items.filter((item) => item.unread).length, items }
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				if (value.id !== undefined) return [{ type: 'text', text: `通知 ${value.id} 已标记已读` }]
				return [{ type: 'text', text: value.items.length === 0 ? '没有未读通知' : `${value.unread} 条未读：\n${lines(value.items, (item) => `- [${item.reason}] ${item.repo} ${item.type}：${item.title}`)}` }]
			},
		},
	})

	define({
		name: 'github_code',
		description: '浏览 GitHub 仓库的代码，不用 clone：列文件树、读某个文件的全文、发 Release。适合快速看一个仓库里有什么、某个文件写了什么。',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				action: { type: 'string', enum: ['tree', 'file', 'release'], description: 'tree=列文件树；file=读文件内容；release=发布 Release' },
				full: { type: 'string', description: '仓库全名，形如 owner/name。' },
				ref: { type: 'string', description: '分支或提交 sha，默认用仓库的默认分支。' },
				path: { type: 'string', description: 'action=file 时的文件路径。' },
				prefix: { type: 'string', description: 'action=tree 时只看以它开头的路径，比如 src/。' },
				tag: { type: 'string', description: 'action=release 时的 tag 名，比如 v1.0.0。' },
				name: { type: 'string', description: 'action=release 时的标题，默认同 tag。' },
				body: { type: 'string', description: 'action=release 时的说明正文。' },
				prerelease: { type: 'boolean', description: 'action=release 时是否标记为预发布。' },
			},
			required: ['action', 'full'],
		},
		async execute(args) {
			const { api } = await deps.member()
			const full = requireFull(args.full)
			if (args.action === 'release') {
				const tag = text(args.tag).trim()
				if (tag === '') throw fail('BAD_TAG', '发 Release 要带 tag')
				const created = await api.createRelease(full, {
					tagName: tag,
					name: text(args.name).trim() || tag,
					body: text(args.body),
					prerelease: args.prerelease === true,
				})
				return { ok: true, full, tag, url: text(created.html_url) }
			}
			const ref = text(args.ref).trim()
			if (args.action === 'file') {
				const path = text(args.path).trim()
				if (path === '') throw fail('BAD_PATH', '读文件要带 path')
				const file = await api.contents(full, path, ref)
				const data = Array.isArray(file) ? file[0] : file
				const base64 = text(data?.content).replace(/\s/g, '')
				const decoded = base64 === '' ? '' : Buffer.from(base64, 'base64').toString('utf8')
				return {
					ok: true,
					full,
					path: text(data?.path) || path,
					size: Number(data?.size) || 0,
					url: text(data?.html_url),
					text: decoded.slice(0, 60000),
					truncated: decoded.length > 60000,
				}
			}
			const refLabel = ref === '' ? text((await api.repo(full)).default_branch) || 'main' : ref
			const tree = await api.tree(full, refLabel)
			const prefix = text(args.prefix).trim()
			const blobs = (Array.isArray(tree) ? tree : []).filter((entry) => entry.type === 'blob')
			const picked = (prefix === '' ? blobs : blobs.filter((entry) => text(entry.path).startsWith(prefix))).slice(0, 400)
			return { ok: true, full, ref: refLabel, count: blobs.length, shown: picked.length, items: picked.map((entry) => ({ path: text(entry.path), size: Number(entry.size) || 0 })) }
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				if (value.tag !== undefined) return [{ type: 'text', text: `已发布 ${value.full} ${value.tag}\n${value.url}` }]
				if (value.path !== undefined) return [{ type: 'text', text: `${value.full}/${value.path} · ${value.size} B${value.truncated ? '（已截断）' : ''}\n\n${value.text.slice(0, 4000)}` }]
				return [{ type: 'text', text: `${value.full}@${value.ref} 共 ${value.count} 个文件（显示前 ${value.shown} 个）\n${lines(value.items, (item) => `- ${item.path} (${item.size} B)`)}` }]
			},
		},
	})

	define({
		name: 'github_actions',
		description: '看 GitHub Actions 的 workflow 运行：列运行、看某次运行的 job 与步骤、重跑、取消。CI 挂了可以用它定位是哪一步失败。',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				action: { type: 'string', enum: ['list', 'jobs', 'rerun', 'cancel'], description: 'list=列运行；jobs=看某次运行的 job；rerun=重跑；cancel=取消' },
				full: { type: 'string', description: '仓库全名，形如 owner/name。' },
				id: { type: 'number', description: 'action=jobs/rerun/cancel 时的运行 id。' },
				branch: { type: 'string', description: 'list 时只看某个分支。' },
			},
			required: ['action', 'full'],
		},
		async execute(args) {
			const { api } = await deps.member()
			const full = requireFull(args.full)
			if (args.action === 'rerun' || args.action === 'cancel') {
				const id = Number(args.id)
				if (!Number.isInteger(id) || id <= 0) throw fail('BAD_ID', '要带运行 id')
				if (args.action === 'rerun') await api.rerunRun(full, id)
				else await api.cancelRun(full, id)
				return { ok: true, full, id, action: args.action }
			}
			if (args.action === 'jobs') {
				const id = Number(args.id)
				if (!Number.isInteger(id) || id <= 0) throw fail('BAD_ID', '要带运行 id')
				const data = await api.runJobs(full, id)
				const jobs = (Array.isArray(data) ? data : []).map((job) => ({
					name: text(job.name),
					status: text(job.status),
					conclusion: text(job.conclusion),
					steps: (Array.isArray(job.steps) ? job.steps : []).map((step) => ({ name: text(step.name), conclusion: text(step.conclusion) })),
				}))
				return { ok: true, full, id, count: jobs.length, jobs }
			}
			const data = await api.workflowRuns(full, { perPage: 10, branch: text(args.branch).trim() || undefined })
			const runs = (Array.isArray(data?.runs) ? data.runs : []).map((run) => ({
				id: Number(run.id),
				title: text(run.display_title) || text(run.name),
				status: text(run.status),
				conclusion: text(run.conclusion),
				branch: text(run.head_branch),
				event: text(run.event),
				createdAt: text(run.created_at),
			}))
			return { ok: true, full, total: Number(data?.total) || runs.length, count: runs.length, runs }
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				if (value.action !== undefined) return [{ type: 'text', text: `${value.full} 运行 ${value.id} 已${value.action === 'rerun' ? '重新排队' : '取消'}` }]
				if (value.jobs !== undefined) {
					const failed = value.jobs.filter((job) => job.conclusion === 'failure')
					const head = failed.length === 0 ? `${value.count} 个 job` : `${failed.length}/${value.count} 个 job 失败`
					return [{ type: 'text', text: `${value.full} 运行 ${value.id}：${head}\n${lines(value.jobs, (job) => `- ${job.name} · ${job.conclusion || job.status}\n${lines(job.steps, (step) => `    ${step.conclusion === 'failure' ? '✗' : step.conclusion === 'success' ? '✓' : '·'} ${step.name}`)}`)}` }]
				}
				return [{ type: 'text', text: `${value.full} 共 ${value.total} 次运行（显示 ${value.count} 次）\n${lines(value.runs, (run) => `- #${run.id} ${run.title} · ${run.conclusion || run.status} · ${run.branch} · ${run.event}`)}` }]
			},
		},
	})
	return () => {
		for (const dispose of disposers) dispose()
	}
}

function requireFull(value) {
	const full = typeof value === 'string' ? value.trim() : ''
	if (!/^[^/]+\/[^/]+$/.test(full)) {
		const error = new Error('仓库名要写成 owner/name')
		error.code = 'BAD_REPO'
		throw error
	}
	return full
}
