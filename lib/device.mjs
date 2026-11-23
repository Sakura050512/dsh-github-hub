/**
 * GitHub OAuth Device Flow：让用户在一台没有 Token 的机器上也能连上账号。
 *
 * 这就是 VS Code / gh CLI / 插件市场里 dsh-github-connect 那一类插件的做法：
 * 拿一个公开的 OAuth App client_id，向 github.com 要 device_code，
 * 用户在浏览器里输入 6 位 user_code 授权，我们再轮询换 access_token。
 *
 * 注意：这两个端点不在 api.github.com，走的是 github.com 的表单接口，
 * 所以不能复用 lib/github.mjs 里那套 JSON 请求。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const REQUEST_TIMEOUT_MS = 20_000

/**
 * GitHub CLI 的公开 OAuth App client_id：开箱能跑设备流，不需要用户自己注册应用。
 * 想用自己的应用就改这里（或传 config.deviceClientId）。
 */
export const DEFAULT_CLIENT_ID = '178c6fc778ccc68e1d6a'

export class DeviceError extends Error {
	constructor(code, message) {
		super(message)
		this.name = 'DeviceError'
		this.code = code
	}
}

async function postForm(url, fields) {
	const body = new URLSearchParams(fields).toString()
	let response
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'content-type': 'application/x-www-form-urlencoded',
				'user-agent': 'dsh-github-hub',
			},
			body,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new DeviceError('NETWORK', `连不上 GitHub 授权服务：${reason}`)
	}
	const text = await response.text()
	let parsed = null
	try {
		parsed = JSON.parse(text)
	} catch {
		parsed = null
	}
	if (parsed === null || typeof parsed !== 'object') {
		throw new DeviceError('BAD_RESPONSE', 'GitHub 授权服务返回了看不懂的内容')
	}
	return parsed
}

/**
 * 申请一次设备码。
 * @param {string} clientId
 * @param {string} [scope]
 * @returns {Promise<{ deviceCode: string, userCode: string, verifyUrl: string, expiresAt: number, interval: number }>}
 */
export async function startDeviceFlow(clientId, scope = 'repo read:user notifications') {
	const data = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope })
	if (typeof data.error === 'string') {
		// GitHub 明确拒绝了这次申请（client_id 不对、scope 非法等），把原始错误码透出去更好排查
		throw new DeviceError(data.error, typeof data.error_description === 'string' ? data.error_description : 'GitHub 拒绝了这个 client_id')
	}
	if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string') {
		throw new DeviceError('BAD_RESPONSE', typeof data.error_description === 'string' ? data.error_description : '拿不到设备码，client_id 可能不对')
	}
	const expiresIn = Number.isFinite(data.expires_in) ? data.expires_in : 900
	const interval = Number.isFinite(data.interval) ? data.interval : 5
	return {
		deviceCode: data.device_code,
		userCode: data.user_code,
		verifyUrl: typeof data.verification_uri === 'string' ? data.verification_uri : 'https://github.com/login/device',
		expiresAt: Date.now() + expiresIn * 1000,
		interval,
	}
}

/**
 * 轮询一次换 Token 的请求。pending / slow_down 是正常状态，交给界面继续轮询。
 * @param {string} clientId
 * @param {string} deviceCode
 * @returns {Promise<{ status: 'ok', token: string, scope: string } | { status: 'pending' } | { status: 'slow', interval: number } | { status: 'denied' } | { status: 'expired' }>}
 */
export async function pollDeviceFlow(clientId, deviceCode) {
	const data = await postForm(ACCESS_TOKEN_URL, {
		client_id: clientId,
		device_code: deviceCode,
		grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
	})
	if (typeof data.access_token === 'string' && data.access_token !== '') {
		return { status: 'ok', token: data.access_token, scope: typeof data.scope === 'string' ? data.scope : '' }
	}
	const error = typeof data.error === 'string' ? data.error : ''
	if (error === 'authorization_pending') return { status: 'pending' }
	if (error === 'slow_down') return { status: 'slow', interval: Number.isFinite(data.interval) ? data.interval : 10 }
	if (error === 'expired_token') return { status: 'expired' }
	if (error === 'access_denied') return { status: 'denied' }
	throw new DeviceError('OAUTH_ERROR', typeof data.error_description === 'string' ? data.error_description : `授权失败：${error || '未知原因'}`)
}
