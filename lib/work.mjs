/**
 * 协作层：Issues、Pull Requests、通知、搜索。
 * 全部复用 createClient 暴露的 request，不引入依赖，也不碰凭据。
 */

const MAX_PER_PAGE = 100

function text(value, fallback = '') {
	return typeof value === 'string' ? value : fallback
}

function num(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback
}

function labelList(raw) {
	if (!Array.isArray(raw)) return []
	return raw
		.map((item) => (item !== null && typeof item === 'object' && typeof item.name === 'string' ? item.name : typeof item === 'string' ? item : null))
		.filter((name) => name !== null)
		.slice(0, 12)
}

function userLogin(raw) {
	if (raw === null || typeof raw !== 'object') return ''
	return text(raw.login)
}

/** 统一成一个 issue 视图；`pull_request` 存在的条目在列表接口里其实是 PR。 */
export function slimIssue(raw) {
	if (raw === null || typeof raw !== 'object') return null
	const number = num(raw.number, 0)
	if (number === 0) return null
	return {
		number,
		title: text(raw.title),
		state: text(raw.state, 'open'),
		body: text(raw.body).slice(0, 4000),
		author: userLogin(raw.user),
		labels: labelList(raw.labels),
		comments: num(raw.comments),
		assignees: Array.isArray(raw.assignees) ? raw.assignees.map(userLogin).filter((login) => login !== '').slice(0, 6) : [],
		milestone: raw.milestone !== null && typeof raw.milestone === 'object' ? text(raw.milestone.title) : '',
		isPull: raw.pull_request !== undefined && raw.pull_request !== null,
		createdAt: text(raw.created_at) || null,
		updatedAt: text(raw.updated_at) || null,
		closedAt: text(raw.closed_at) || null,
		htmlUrl: text(raw.html_url),
	}
}

/** PR 视图：多带分支、合并状态、可合并性、review 结论。 */
export function slimPull(raw) {
	if (raw === null || typeof raw !== 'object') return null
	const number = num(raw.number, 0)
	if (number === 0) return null
	return {
		number,
		title: text(raw.title),
		state: text(raw.state, 'open'),
		draft: raw.draft === true,
		body: text(raw.body).slice(0, 4000),
		author: userLogin(raw.user),
		labels: labelList(raw.labels),
		head: text(raw.head?.ref),
		base: text(raw.base?.ref),
		headSha: text(raw.head?.sha),
		commits: num(raw.commits),
		changedFiles: num(raw.changed_files),
		additions: num(raw.additions),
		deletions: num(raw.deletions),
		mergeable: typeof raw.mergeable === 'boolean' ? raw.mergeable : null,
		mergeableState: text(raw.mergeable_state),
		merged: raw.merged === true,
		reviewDecision: text(raw.reviewDecision),
		comments: num(raw.comments) + num(raw.review_comments),
		createdAt: text(raw.created_at) || null,
		updatedAt: text(raw.updated_at) || null,
		htmlUrl: text(raw.html_url),
	}
}

export function slimComment(raw) {
	if (raw === null || typeof raw !== 'object') return null
	return {
		id: num(raw.id),
		author: userLogin(raw.user),
		body: text(raw.body).slice(0, 4000),
		createdAt: text(raw.created_at) || null,
		htmlUrl: text(raw.html_url),
	}
}

export function slimNotification(raw) {
	if (raw === null || typeof raw !== 'object') return null
	return {
		id: text(raw.id),
		reason: text(raw.reason),
		unread: raw.unread === true,
		title: text(raw.subject?.title),
		type: text(raw.subject?.type),
		number: num(raw.subject?.url?.match?.('') ?? 0),
		repo: text(raw.repository?.full_name),
		updatedAt: text(raw.updated_at) || null,
	}
}

export function issueQuery(options) {
	const query = new URLSearchParams({
		state: options.state === 'closed' || options.state === 'all' ? options.state : 'open',
		per_page: String(Math.min(MAX_PER_PAGE, Math.max(1, options.perPage ?? 30))),
		page: String(Math.max(1, options.page ?? 1)),
		sort: text(options.sort, 'updated'),
		direction: text(options.direction, 'desc'),
	})
	// 路由那边传的是 URL 里的字符串，直接调用时可能给数组，两种都收。
	const labels = Array.isArray(options.labels) ? options.labels.filter((name) => typeof name === 'string' && name !== '').join(',') : options.labels
	if (typeof labels === 'string' && labels !== '') query.set('labels', labels)
	if (typeof options.assignee === 'string' && options.assignee !== '') query.set('assignee', options.assignee)
	if (typeof options.since === 'string' && options.since !== '') query.set('since', options.since)
	return query
}

/** 有下一页吗？Headers.get 正常返回 null，但测试里的假 headers 可能给 undefined，这里一并兜住。 */
function hasNextPage(headers) {
	const link = headers.get('link')
	return typeof link === 'string' && link.includes('rel="next"')
}

/** 列 issue（自动剔除 PR，除非 options.includePulls）。 */
export async function listIssues(api, full, options = {}) {
	const { data, headers } = await api.request(`/repos/${full}/issues?${issueQuery(options).toString()}`)
	const rows = Array.isArray(data) ? data : []
	const items = rows
		.map(slimIssue)
		.filter((item) => item !== null)
		.filter((item) => options.includePulls === true || item.isPull === false)
	return { items, hasNext: hasNextPage(headers) }
}

/** 单个 issue 或 PR（GitHub 用同一个端点，PR 会带 pull_request 字段）。 */
export async function getIssue(api, full, number) {
	const { data } = await api.request(`/repos/${full}/issues/${number}`)
	return slimIssue(data)
}

export async function issueComments(api, full, number) {
	const { data } = await api.request(`/repos/${full}/issues/${number}/comments?per_page=100`)
	return (Array.isArray(data) ? data : []).map(slimComment).filter((item) => item !== null)
}

export async function createIssue(api, full, input) {
	const { data } = await api.request(`/repos/${full}/issues`, {
		method: 'POST',
		body: {
			title: input.title,
			body: typeof input.body === 'string' ? input.body : '',
			...(Array.isArray(input.labels) && input.labels.length > 0 ? { labels: input.labels } : {}),
			...(Array.isArray(input.assignees) && input.assignees.length > 0 ? { assignees: input.assignees } : {}),
		},
	})
	return slimIssue(data)
}

export async function commentIssue(api, full, number, body) {
	const { data } = await api.request(`/repos/${full}/issues/${number}/comments`, { method: 'POST', body: { body } })
	return slimComment(data)
}

/** 改状态（open/closed）或改标题/正文/标签。 */
export async function editIssue(api, full, number, patch) {
	const { data } = await api.request(`/repos/${full}/issues/${number}`, { method: 'PATCH', body: patch })
	return slimIssue(data)
}

export async function issueLabels(api, full) {
	const { data } = await api.request(`/repos/${full}/labels?per_page=100`)
	return (Array.isArray(data) ? data : []).map((item) => (typeof item?.name === 'string' ? item.name : null)).filter((name) => name !== null)
}

/** 列 PR。GitHub 的 /pulls 不返回 mergeable，要单个查。 */
export async function listPulls(api, full, options = {}) {
	const query = new URLSearchParams({
		state: options.state === 'closed' || options.state === 'all' ? options.state : 'open',
		per_page: String(Math.min(MAX_PER_PAGE, Math.max(1, options.perPage ?? 30))),
		page: String(Math.max(1, options.page ?? 1)),
		sort: text(options.sort, 'updated'),
		direction: text(options.direction, 'desc'),
	})
	const { data, headers } = await api.request(`/repos/${full}/pulls?${query.toString()}`)
	const items = (Array.isArray(data) ? data : []).map(slimPull).filter((item) => item !== null)
	return { items, hasNext: hasNextPage(headers) }
}

export async function getPull(api, full, number) {
	const { data } = await api.request(`/repos/${full}/pulls/${number}`)
	return slimPull(data)
}

/** 改动的文件列表，含 patch 文本——界面靠它渲染 diff。 */
export async function pullFiles(api, full, number) {
	const { data } = await api.request(`/repos/${full}/pulls/${number}/files?per_page=100`)
	return (Array.isArray(data) ? data : []).map((file) => ({
		filename: text(file?.filename),
		status: text(file?.status),
		additions: num(file?.additions),
		deletions: num(file?.deletions),
		changes: num(file?.changes),
		patch: typeof file?.patch === 'string' ? file.patch.slice(0, 20000) : '',
	})).filter((file) => file.filename !== '')
}

export async function pullComments(api, full, number) {
	const [review, issue] = await Promise.all([
		api.request(`/repos/${full}/pulls/${number}/comments?per_page=100`).then((r) => r.data).catch(() => []),
		api.request(`/repos/${full}/issues/${number}/comments?per_page=100`).then((r) => r.data).catch(() => []),
	])
	const rows = [
		...(Array.isArray(review) ? review : []),
		...(Array.isArray(issue) ? issue : []),
	]
	return rows.map(slimComment).filter((item) => item !== null)
}

/** 提交 review：APPROVE / REQUEST_CHANGES / COMMENT。 */
export async function submitReview(api, full, number, input) {
	const event = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(input.event) ? input.event : 'COMMENT'
	const { data } = await api.request(`/repos/${full}/pulls/${number}/reviews`, {
		method: 'POST',
		body: {
			event,
			...(typeof input.body === 'string' && input.body !== '' ? { body: input.body } : {}),
			...(Array.isArray(input.comments) && input.comments.length > 0 ? { comments: input.comments } : {}),
		},
	})
	return { id: num(data?.id), state: text(data?.state), url: text(data?.html_url) }
}

/** 合并：method 取 merge / squash / rebase。 */
export async function mergePull(api, full, number, input = {}) {
	const method = ['merge', 'squash', 'rebase'].includes(input.method) ? input.method : 'merge'
	const body = { merge_method: method }
	if (typeof input.commitTitle === 'string' && input.commitTitle !== '') body.commit_title = input.commitTitle
	if (typeof input.commitMessage === 'string' && input.commitMessage !== '') body.commit_message = input.commitMessage
	const { data } = await api.request(`/repos/${full}/pulls/${number}/merge`, { method: 'PUT', body })
	return { merged: data?.merged === true, message: text(data?.message), sha: text(data?.sha) }
}

/** 未读通知。 */
export async function listNotifications(api, options = {}) {
	const query = new URLSearchParams({ per_page: String(Math.min(50, Math.max(1, options.perPage ?? 30))) })
	if (options.all === true) query.set('all', 'true')
	if (options.participating === true) query.set('participating', 'true')
	const { data } = await api.request(`/notifications?${query.toString()}`)
	return (Array.isArray(data) ? data : []).map(slimNotification).filter((item) => item !== null)
}

export async function markNotificationRead(api, id) {
	await api.request(`/notifications/threads/${id}`, { method: 'PATCH' })
}

/** 跨仓库搜 issue/PR。 */
export async function searchIssues(api, query, options = {}) {
	const params = new URLSearchParams({
		q: query,
		per_page: String(Math.min(50, Math.max(1, options.perPage ?? 20))),
		sort: text(options.sort, 'updated'),
		order: 'desc',
	})
	const { data } = await api.request(`/search/issues?${params.toString()}`)
	const rows = Array.isArray(data?.items) ? data.items : []
	return {
		total: num(data?.total_count),
		items: rows.map(slimIssue).filter((item) => item !== null),
	}
}

/** 分支列表（带默认分支标记，界面选分支用）。 */
export async function listBranches(api, full) {
	const { data } = await api.request(`/repos/${full}/branches?per_page=100`)
	return (Array.isArray(data) ? data : []).map((item) => ({
		name: text(item?.name),
		sha: text(item?.commit?.sha).slice(0, 7),
		protected: item?.protected === true,
	})).filter((item) => item.name !== '')
}
