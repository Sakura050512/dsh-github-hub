import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CLIENT_ID, DeviceError, startDeviceFlow, pollDeviceFlow } from '../lib/device.mjs'

/** 把 globalThis.fetch 换成一次性桩，返回捕获到的调用。 */
async function withFetch(handler, run) {
	const original = globalThis.fetch
	const calls = []
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init })
		return handler(url, init)
	}
	try {
		return await run(calls)
	} finally {
		globalThis.fetch = original
	}
}

function jsonResponse(payload, status = 200) {
	return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

test('DEFAULT_CLIENT_ID 是 GitHub CLI 的公开 App，开箱可用', () => {
	assert.equal(DEFAULT_CLIENT_ID, '178c6fc778ccc68e1d6a')
})

test('startDeviceFlow 打到 device/code 并解析出 6 位码', async () => {
	await withFetch(
		() => jsonResponse({
			device_code: 'dev-123',
			user_code: 'ABCD-1234',
			verification_uri: 'https://github.com/login/device',
			expires_in: 900,
			interval: 5,
		}),
		async (calls) => {
			const flow = await startDeviceFlow(DEFAULT_CLIENT_ID, 'repo read:user')
			assert.equal(flow.deviceCode, 'dev-123')
			assert.equal(flow.userCode, 'ABCD-1234')
			assert.equal(flow.verifyUrl, 'https://github.com/login/device')
			assert.equal(flow.interval, 5)
			assert.equal(calls[0].url, 'https://github.com/login/device/code')
			assert.equal(calls[0].init.method, 'POST')
			const body = new URLSearchParams(calls[0].init.body)
			assert.equal(body.get('client_id'), DEFAULT_CLIENT_ID)
			assert.equal(body.get('scope'), 'repo read:user')
			assert.ok(Number.isFinite(flow.expiresAt) && flow.expiresAt > Date.now())
		},
	)
})

test('startDeviceFlow 遇到 error 字段抛 DeviceError', async () => {
	await withFetch(
		() => jsonResponse({ error: 'unauthorized_client', error_description: 'bad client' }),
		async () => {
			await assert.rejects(() => startDeviceFlow('bad'), (error) => {
				assert.ok(error instanceof DeviceError)
				assert.equal(error.code, 'unauthorized_client')
				return true
			})
		},
	)
})

test('pollDeviceFlow 把 authorization_pending / slow_down 翻译成状态', async () => {
	const cases = [
		[{ error: 'authorization_pending' }, (r) => assert.deepEqual(r, { status: 'pending' })],
		[{ error: 'slow_down', interval: 10 }, (r) => assert.deepEqual(r, { status: 'slow', interval: 10 })],
		[{ error: 'access_denied' }, (r) => assert.deepEqual(r, { status: 'denied' })],
		[{ error: 'expired_token' }, (r) => assert.deepEqual(r, { status: 'expired' })],
		[{ access_token: 'gho_x', scope: 'repo' }, (r) => assert.deepEqual(r, { status: 'ok', token: 'gho_x', scope: 'repo' })],
	]
	for (const [payload, check] of cases) {
		await withFetch(() => jsonResponse(payload), async (calls) => {
			check(await pollDeviceFlow(DEFAULT_CLIENT_ID, 'dev-123'))
			assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token')
			const body = new URLSearchParams(calls[0].init.body)
			assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code')
			assert.equal(body.get('device_code'), 'dev-123')
		})
	}
})

test('pollDeviceFlow 遇到网络错误抛 DeviceError(NETWORK)', async () => {
	await withFetch(
		() => { throw new Error('boom') },
		async () => {
			await assert.rejects(() => pollDeviceFlow('c', 'd'), (error) => {
				assert.ok(error instanceof DeviceError)
				assert.equal(error.code, 'NETWORK')
				return true
			})
		},
	)
})
