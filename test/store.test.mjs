import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStore, emptyStoreForTests } from '../lib/store.mjs'

test('empty store has sane defaults', () => {
	const store = emptyStoreForTests()
	assert.equal(store.settings.refreshHours, 6)
	assert.equal(store.settings.autoRefresh, true)
	assert.deepEqual(store.settings.tracked, [])
	assert.deepEqual(store.repos, {})
})

test('normalizeStore clamps refreshHours and drops bad tracked names', () => {
	const store = normalizeStore({ settings: { refreshHours: 999, tracked: ['a/b', 'nope', '', 'c/d/e'] } })
	assert.equal(store.settings.refreshHours, 168)
	assert.deepEqual(store.settings.tracked, ['a/b'])
})

test('normalizeStore keeps snapshots and history', () => {
	const store = normalizeStore({ repos: { 'a/b': { full: 'a/b', stars: 3, snapshots: [{ t: 1, s: 2 }, { t: 2, s: 3 }], history: [{ d: '2026-01-01', s: 1 }] } } })
	assert.equal(store.repos['a/b'].stars, 3)
	assert.equal(store.repos['a/b'].snapshots.length, 2)
	assert.equal(store.repos['a/b'].history.length, 1)
})
