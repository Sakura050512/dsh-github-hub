/**
 * 本地数据仓：`$DSH_HOME/github-hub.json`。
 * 只存公开的仓库元信息与 star 快照，Token 从不写进这个文件（它在 credentials 里）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const STORE_VERSION = 1
/** 每个仓库最多保留多少个采样点，超出丢最旧的。 */
const MAX_SNAPSHOTS = 800
/** 回填的 star 历史最多保留几天，超出丢最早的。 */
const MAX_HISTORY_DAYS = 2000
const PENDING = new WeakMap()

export function storeFile() {
	const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
		? process.env.DSH_HOME
		: join(homedir(), '.dsh')
	return join(home, 'github-hub.json')
}

function emptyStore() {
	return {
		version: STORE_VERSION,
		settings: { refreshHours: 6, autoRefresh: true, tracked: [], lastRefreshAt: null, lastError: null },
		repos: {},
	}
}

function normalizeRepo(entry) {
	const snapshots = Array.isArray(entry.snapshots) ? entry.snapshots.filter(isSnapshot) : []
	const history = Array.isArray(entry.history) ? entry.history.filter(isHistoryPoint) : []
	const repos = {
		full: String(entry.full ?? ''),
		stars: Number.isFinite(entry.stars) ? entry.stars : null,
		forks: Number.isFinite(entry.forks) ? entry.forks : null,
		issues: Number.isFinite(entry.issues) ? entry.issues : null,
		backfilledAt: Number.isFinite(entry.backfilledAt) ? entry.backfilledAt : null,
		snapshots: trimTail(snapshots, MAX_SNAPSHOTS),
		history: trimTail(history, MAX_HISTORY_DAYS),
	}
	return repos
}

function isSnapshot(point) {
	return point !== null && typeof point === 'object' && Number.isFinite(point.t) && Number.isFinite(point.s)
}

function isHistoryPoint(point) {
	return point !== null && typeof point === 'object' && typeof point.d === 'string' && Number.isFinite(point.s)
}

function trimTail(list, max) {
	return list.length > max ? list.slice(list.length - max) : list
}

export function normalizeStore(raw) {
	const base = emptyStore()
	if (raw === null || typeof raw !== 'object') return base
	const settings = raw.settings !== null && typeof raw.settings === 'object' ? raw.settings : {}
	const hours = Number(settings.refreshHours)
	base.settings.refreshHours = Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.round(hours))) : 6
	base.settings.autoRefresh = settings.autoRefresh !== false
	base.settings.tracked = Array.isArray(settings.tracked)
		? settings.tracked.filter((name) => typeof name === 'string' && /^[^/]+\/[^/]+$/.test(name)).slice(0, 2000)
		: []
	base.settings.lastRefreshAt = Number.isFinite(settings.lastRefreshAt) ? settings.lastRefreshAt : null
	base.settings.lastError = typeof settings.lastError === 'string' ? settings.lastError : null
	if (raw.repos !== null && typeof raw.repos === 'object') {
		for (const [key, entry] of Object.entries(raw.repos)) {
			if (entry === null || typeof entry !== 'object') continue
			base.repos[key] = normalizeRepo({ full: key, ...entry })
		}
	}
	return base
}

/** 读一次磁盘；文件不存在或坏掉都从空仓开始，绝不抛给路由。 */
export async function readStore() {
	try {
		const text = await readFile(storeFile(), 'utf8')
		return normalizeStore(JSON.parse(text))
	} catch {
		return emptyStore()
	}
}

/** 原子写（临时文件 + rename），并把同一进程内的写串行化。 */
export async function writeStore(store) {
	const previous = PENDING.get(globalThis) ?? Promise.resolve()
	const next = previous.then(async () => {
		const file = storeFile()
		await mkdir(dirname(file), { recursive: true })
		const temp = `${file}.${process.pid}.${Date.now()}.tmp`
		await writeFile(temp, JSON.stringify(store, null, '\t'), 'utf8')
		await rename(temp, file)
	}).catch(() => {})
	PENDING.set(globalThis, next)
	await next
}

/** 读—改—写 一次，改的是归一化后的对象。 */
export async function updateStore(mutate) {
	const store = await readStore()
	const result = await mutate(store)
	await writeStore(store)
	return result
}

export function emptyStoreForTests() {
	return emptyStore()
}
