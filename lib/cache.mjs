/**
 * 进程内的小缓存：GitHub 的 GET 结果按 URL 缓存一小会儿，避免来回切标签页时重复打接口
 * （每次切 tab 都会重新拉一遍仓库列表，概览还要 2~5 秒）。
 *
 * 只缓存 GET，写操作（POST/PUT/PATCH/DELETE）成功后清掉整表 —— 宁可多拉一次，也不能显示旧数据。
 * 不做持久化：重启即失效，避免把上一次会话的陈旧数据带出来。
 */

const DEFAULT_TTL_MS = 60_000
const MAX_ENTRIES = 200

export function createCache(defaultTtlMs = DEFAULT_TTL_MS) {
	const entries = new Map()
	const stats = { hit: 0, miss: 0 }

	function get(key) {
		const entry = entries.get(key)
		if (entry === undefined) {
			stats.miss += 1
			return undefined
		}
		if (entry.expiresAt <= Date.now()) {
			entries.delete(key)
			stats.miss += 1
			return undefined
		}
		stats.hit += 1
		return entry.value
	}

	function set(key, value, ttlMs = defaultTtlMs) {
		if (ttlMs <= 0) return value
		// 超量就先删最早插入的（Map 保序），够用且没有额外依赖
		if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
			const oldest = entries.keys().next()
			if (!oldest.done) entries.delete(oldest.value)
		}
		entries.set(key, { value, expiresAt: Date.now() + ttlMs })
		return value
	}

	/** 命中就返回，没命中就跑 loader 并缓存。loader 抛错不缓存。 */
	async function remember(key, loader, ttlMs = defaultTtlMs) {
		const cached = get(key)
		if (cached !== undefined) return cached
		const value = await loader()
		set(key, value, ttlMs)
		return value
	}

	function clear() {
		entries.clear()
	}

	function size() {
		return entries.size
	}

	return { get, set, remember, clear, size, stats }
}
