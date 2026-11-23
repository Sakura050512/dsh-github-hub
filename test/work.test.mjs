import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	slimIssue,
	slimPull,
	slimComment,
	slimNotification,
	listIssues,
	issueQuery,
} from '../lib/work.mjs'

test('slimIssue 把 PR 标成 isPull', () => {
	const issue = slimIssue({ number: 7, title: 't', state: 'open', body: 'b', user: { login: 'a' }, labels: [{ name: 'bug' }, { name: 'p1' }] })
	assert.equal(issue.isPull, false)
	assert.deepEqual(issue.labels, ['bug', 'p1'])
	const pull = slimIssue({ number: 8, title: 'p', pull_request: { url: 'x' } })
	assert.equal(pull.isPull, true)
	assert.equal(slimIssue({ title: 'no number' }), null)
})

test('slimIssue 截断超长正文', () => {
	const issue = slimIssue({ number: 1, body: 'x'.repeat(9000) })
	assert.equal(issue.body.length, 4000)
})

test('slimPull 保留 head/base 和 draft', () => {
	const pull = slimPull({
		number: 12,
		title: 'feat',
		state: 'open',
		draft: true,
		head: { ref: 'feat', sha: 'abc' },
		base: { ref: 'main' },
		additions: 10,
		deletions: 2,
		changed_files: 3,
		user: { login: 'me' },
	})
	assert.equal(pull.head, 'feat')
	assert.equal(pull.base, 'main')
	assert.equal(pull.headSha, 'abc')
	assert.equal(pull.changedFiles, 3)
	assert.equal(pull.draft, true)
	assert.equal(pull.mergeable, null)
})

test('slimComment 与 slimNotification', () => {
	const comment = slimComment({ id: 5, body: 'hi', user: { login: 'u' }, created_at: '2024-01-01T00:00:00Z' })
	assert.equal(comment.id, 5)
	assert.equal(comment.author, 'u')
	const note = slimNotification({ id: 'n1', unread: true, reason: 'mention', subject: { title: 'T', type: 'Issue', url: 'u' }, repository: { full_name: 'a/b' }, updated_at: '2024-01-01T00:00:00Z' })
	assert.equal(note.id, 'n1')
	assert.equal(note.repo, 'a/b')
	assert.equal(note.unread, true)
})

test('issueQuery 拼出正确的查询', () => {
	const query = issueQuery({ state: 'all', perPage: 1000, page: 0, labels: ['bug', 'ui'], assignee: 'me', sort: 'created' })
	assert.equal(query.get('state'), 'all')
	assert.equal(query.get('per_page'), '100')
	assert.equal(query.get('page'), '1')
	assert.equal(query.get('labels'), 'bug,ui')
	assert.equal(query.get('assignee'), 'me')
	assert.equal(query.get('sort'), 'created')
})

test('listIssues 过滤掉 PR 并暴露 hasNext', async () => {
	const api = {
		async request() {
			return {
				data: [
					{ number: 1, title: 'real issue' },
					{ number: 2, title: 'a pr', pull_request: { url: 'x' } },
				],
				headers: new Map([['link', '<https://api.github.com/x?page=2>; rel="next"']]),
			}
		},
	}
	const result = await listIssues(api, 'a/b', { state: 'open' })
	assert.equal(result.items.length, 1)
	assert.equal(result.items[0].number, 1)
	assert.equal(result.hasNext, true)
})

test('listIssues 能保留 PR（includePulls）', async () => {
	const api = {
		async request() {
			return { data: [{ number: 2, title: 'a pr', pull_request: { url: 'x' } }], headers: new Map() }
		},
	}
	const result = await listIssues(api, 'a/b', { includePulls: true })
	assert.equal(result.items.length, 1)
	assert.equal(result.hasNext, false)
})
