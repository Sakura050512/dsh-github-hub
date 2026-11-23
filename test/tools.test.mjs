import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerTools } from '../lib/tools.mjs'

function fakeCtx() {
	const registered = []
	return {
		registered,
		ctx: {
			tools: {
				register(definition) {
					registered.push(definition)
					return () => {}
				},
			},
		},
	}
}

const client = { request: async () => ({ data: [], headers: new Map() }) }
const member = async () => ({ api: {}, login: 'me' })

test('注册七个工具，名字唯一、参数是无损 JSON Schema', () => {
	const { ctx, registered } = fakeCtx()
	const dispose = registerTools(ctx, { client, member })
	assert.equal(typeof dispose, 'function')
	assert.deepEqual(
		registered.map((item) => item.name),
		['github_repo', 'github_issue', 'github_pr', 'github_push', 'github_notifications', 'github_code', 'github_actions'],
	)
	for (const definition of registered) {
		assert.equal(typeof definition.description, 'string')
		assert.notEqual(definition.description.trim(), '')
		assert.equal(typeof definition.output.render, 'function')
		assert.equal(definition.output.schema.type, 'object')
		assert.equal(definition.parameters.type, 'object')
		assert.equal(definition.parameters.additionalProperties, false)
		assert.doesNotThrow(() => JSON.parse(JSON.stringify(definition.parameters)))
	}
})

test('disposer 逐个释放', () => {
	const released = []
	const ctx = {
		tools: {
			register() {
				return () => released.push(1)
			},
		},
	}
	const dispose = registerTools(ctx, { client, member })
	dispose()
	assert.equal(released.length, 7)
})

test('github_push 缺少 files 会报错', async () => {
	const { ctx, registered } = fakeCtx()
	registerTools(ctx, { client, member })
	const tool = registered.find((item) => item.name === 'github_push')
	await assert.rejects(async () => tool.execute({ full: 'a/b', message: 'm' }), /文件/)
})

test('github_push 空提交信息会报错', async () => {
	const { ctx, registered } = fakeCtx()
	registerTools(ctx, { client, member })
	const tool = registered.find((item) => item.name === 'github_push')
	await assert.rejects(async () => tool.execute({ full: 'a/b', message: '  ', files: [{ path: 'a', content: 'x' }] }), /提交信息/)
})

test('github_notifications 的 read 缺 id 会报错', async () => {
	const { ctx, registered } = fakeCtx()
	registerTools(ctx, { client, member })
	const tool = registered.find((item) => item.name === 'github_notifications')
	await assert.rejects(async () => tool.execute({ action: 'read' }), /通知 id/)
})

test('github_repo 的 get 缺仓库名会报错', async () => {
	const { ctx, registered } = fakeCtx()
	registerTools(ctx, { client, member })
	const tool = registered.find((item) => item.name === 'github_repo')
	await assert.rejects(async () => tool.execute({ action: 'get' }), /owner\/name/)
})
