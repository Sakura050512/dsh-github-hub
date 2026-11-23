import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLinkHeader, lastPageOf, slimRepo, starHistoryFromPages, dayOf } from '../lib/github.mjs'

test('parseLinkHeader reads rel names', () => {
	assert.deepEqual(parseLinkHeader('<https://x?page=2>; rel="next", <https://x?page=9>; rel="last"'), {
		next: 'https://x?page=2',
		last: 'https://x?page=9',
	})
	assert.deepEqual(parseLinkHeader(null), {})
})

test('lastPageOf extracts the page number', () => {
	assert.equal(lastPageOf({ last: 'https://x?per_page=100&page=57' }), 57)
	assert.equal(lastPageOf({}), null)
})

test('slimRepo keeps the fields we show', () => {
	const repo = slimRepo({ full_name: 'a/b', name: 'b', owner: { login: 'a' }, stargazers_count: 12, private: true, default_branch: 'main' }, 'a')
	assert.equal(repo.full, 'a/b')
	assert.equal(repo.stars, 12)
	assert.equal(repo.mine, true)
	assert.equal(repo.private, true)
	assert.equal(slimRepo(null, 'a'), null)
})

test('starHistoryFromPages keeps the max per day', () => {
	assert.deepEqual(starHistoryFromPages([{ day: '2026-01-02', stars: 5 }, { day: '2026-01-01', stars: 4 }, { day: '2026-01-02', stars: 6 }]), [
		{ d: '2026-01-01', s: 4 },
		{ d: '2026-01-02', s: 6 },
	])
})

test('dayOf slices a full ISO timestamp', () => {
	assert.equal(dayOf('2026-01-02T03:04:05Z'), '2026-01-02')
	assert.equal(dayOf(null), null)
})
