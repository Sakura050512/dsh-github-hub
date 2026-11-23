import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { unzipText, logsToText } from '../lib/github.mjs'

function buildZip(entries) {
	const locals = []
	const centrals = []
	let offset = 0
	for (const entry of entries) {
		const nameBytes = Buffer.from(entry.name, 'utf8')
		const raw = Buffer.from(entry.text, 'utf8')
		const useDeflate = entry.deflate === true
		const payload = useDeflate ? deflateRawSync(raw) : raw
		const method = useDeflate ? 8 : 0
		const crc = 0
		const local = Buffer.alloc(30 + nameBytes.length + payload.length)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0, 6)
		local.writeUInt16LE(method, 8)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(payload.length, 18)
		local.writeUInt32LE(raw.length, 22)
		local.writeUInt16LE(nameBytes.length, 26)
		local.writeUInt16LE(0, 28)
		nameBytes.copy(local, 30)
		payload.copy(local, 30 + nameBytes.length)
		locals.push(local)

		const central = Buffer.alloc(46 + nameBytes.length)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0, 8)
		central.writeUInt16LE(method, 10)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(payload.length, 20)
		central.writeUInt32LE(raw.length, 24)
		central.writeUInt16LE(nameBytes.length, 28)
		central.writeUInt16LE(0, 30)
		central.writeUInt16LE(0, 32)
		central.writeUInt32LE(offset, 42)
		nameBytes.copy(central, 46)
		centrals.push(central)

		offset += local.length
	}
	const centralSize = centrals.reduce((total, buffer) => total + buffer.length, 0)
	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(entries.length, 8)
	eocd.writeUInt16LE(entries.length, 10)
	eocd.writeUInt32LE(centralSize, 12)
	eocd.writeUInt32LE(offset, 16)
	return Buffer.concat([...locals, ...centrals, eocd])
}

test('unzipText 能解开 stored 与 deflate 两种条目', async () => {
	const zip = buildZip([
		{ name: '1_build.txt', text: 'hello build', deflate: false },
		{ name: '2_test.txt', text: 'hello '.repeat(40), deflate: true },
	])
	const text = await unzipText(new Uint8Array(zip))
	assert.equal(text.includes('hello build'), true)
	assert.equal(text.includes('hello '.repeat(40)), true)
})

test('unzipText 忽略非 .txt 条目', async () => {
	const zip = buildZip([
		{ name: 'readme.md', text: 'ignored', deflate: false },
		{ name: 'job.txt', text: 'kept', deflate: false },
	])
	const text = await unzipText(new Uint8Array(zip))
	assert.equal(text.includes('ignored'), false)
	assert.equal(text.includes('kept'), true)
})

test('unzipText 遇到非 zip 报 BAD_ZIP', async () => {
	await assert.rejects(() => unzipText(new Uint8Array(Buffer.from('nope'))), /不是合法的 zip/)
})

test('logsToText 对纯文本直出并去掉 BOM', async () => {
	const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('2026-11-20 log line')])
	const text = await logsToText(new Uint8Array(raw))
	assert.equal(text, '2026-11-20 log line')
})

test('logsToText 遇到 zip magic 会走解包', async () => {
	const zip = buildZip([{ name: 'job.txt', text: 'from zip', deflate: false }])
	const text = await logsToText(new Uint8Array(zip))
	assert.equal(text.includes('from zip'), true)
})

test('logsToText 对空字节返回提示', async () => {
	const text = await logsToText(new Uint8Array(0))
	assert.equal(text, '（这次运行没有日志）')
})
