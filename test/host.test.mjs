// Unit tests for the Host half's pure functions.
//
// The browser fixtures cover what a user sees; these cover what the library will
// accept. Every rule here is defensive behaviour that is easy to break silently:
// a bad record that stops being filtered, or a full picture that starts leaking
// into the list payload, produces no error — just a slower or bigger response.
//
// Run with `npm test` (node --test, no dependencies).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isImage, normaliseLibrary, toState } from '../index.js'

// A data URL that passes the format check without carrying real bytes.
const png = (marker = 'A') => `data:image/png;base64,${marker.repeat(8)}`

const library = (overrides = {}) => ({
  version: 2,
  shape: 'circle',
  currentId: null,
  displayName: '',
  thumbVersion: 2,
  items: [],
  ...overrides,
})

const item = (id, extra = {}) => ({ id, image: png(id[0] ?? 'A'), thumb: png('T'), ...extra })

// --- isImage ---------------------------------------------------------------

test('isImage accepts every format the picker allows', () => {
  for (const type of ['png', 'jpeg', 'webp', 'gif']) {
    assert.equal(isImage(`data:image/${type};base64,AAAA`, 1024), true, type)
  }
})

test('isImage rejects anything that is not a base64 image URL', () => {
  assert.equal(isImage('https://example.com/a.png', 1024), false, 'remote url')
  assert.equal(isImage('data:image/png,AAAA', 1024), false, 'not base64')
  assert.equal(isImage('data:text/plain;base64,AAAA', 1024), false, 'wrong mime')
  assert.equal(isImage('', 1024), false, 'empty')
  assert.equal(isImage(null, 1024), false, 'null')
  assert.equal(isImage(42, 1024), false, 'number')
})

test('isImage enforces the length cap', () => {
  const short = 'data:image/png;base64,AAAA'
  assert.equal(isImage(short, short.length), true, 'exactly at the cap')
  assert.equal(isImage(short, short.length - 1), false, 'one over the cap')
})

// --- normaliseLibrary ------------------------------------------------------

test('normaliseLibrary turns absent or junk input into an empty library', () => {
  for (const input of [undefined, null, 0, '', 'text', []]) {
    const result = normaliseLibrary(input)
    assert.equal(result.version, 2)
    assert.equal(result.shape, 'circle', 'an unknown shape falls back to circle')
    assert.equal(result.currentId, null)
    assert.equal(result.displayName, '')
    assert.deepEqual(result.items, [])
  }
})

test('normaliseLibrary keeps any of the three shapes and rejects the rest', () => {
  for (const shape of ['circle', 'rounded', 'square']) {
    assert.equal(normaliseLibrary(library({ shape })).shape, shape, shape)
  }
  for (const shape of ['oval', '', null, 7, {}]) {
    assert.equal(normaliseLibrary(library({ shape })).shape, 'circle', String(shape))
  }
})

test('normaliseLibrary truncates an over-long display name', () => {
  const long = '名'.repeat(200)
  const result = normaliseLibrary(library({ displayName: long }))
  assert.ok(result.displayName.length < long.length, 'name was shortened')
  assert.ok(result.displayName.length <= 24, `kept ${result.displayName.length} chars`)
})

test('normaliseLibrary drops records it cannot display', () => {
  const result = normaliseLibrary(library({
    items: [
      item('good'),
      null,
      'string',
      { id: '', image: png() },            // no id
      { id: 'x', image: 'not-an-image' },  // bad picture
      { id: 'y' },                          // no picture at all
      item('alsoGood', { image: png('B') }),
    ],
  }))
  assert.deepEqual(result.items.map((entry) => entry.id), ['good', 'alsoGood'])
})

test('normaliseLibrary falls back to the full picture when a thumbnail is unusable', () => {
  const image = png('C')
  const result = normaliseLibrary(library({
    items: [{ id: 'a', image, thumb: 'data:image/png;base64,bad bad bad' }],
  }))
  assert.equal(result.items[0].thumb, image, 'thumb replaced by the image')
})

test('normaliseLibrary gives a missing timestamp a stable placeholder', () => {
  const result = normaliseLibrary(library({ items: [{ id: 'a', image: png() }] }))
  assert.equal(result.items[0].createdAt, new Date(0).toISOString())
})

test('normaliseLibrary caps the library at 100 entries', () => {
  const many = Array.from({ length: 130 }, (_, index) => item(`id${String(index)}`))
  const result = normaliseLibrary(library({ items: many }))
  assert.equal(result.items.length, 100)
  assert.equal(result.items[0].id, 'id0', 'keeps the oldest, drops the tail')
})

test('normaliseLibrary clears a currentId that points at no surviving record', () => {
  const result = normaliseLibrary(library({
    currentId: 'gone',
    items: [item('kept')],
  }))
  assert.equal(result.currentId, null)

  const pointing = normaliseLibrary(library({
    currentId: 'kept',
    items: [item('kept')],
  }))
  assert.equal(pointing.currentId, 'kept')
})

test('normaliseLibrary always reports version 2', () => {
  assert.equal(normaliseLibrary(library({ version: 1 })).version, 2)
  assert.equal(normaliseLibrary(library({ version: 'x' })).version, 2)
})

// --- toState ---------------------------------------------------------------

test('toState resolves the selected picture', () => {
  const image = png('S')
  const state = toState(library({
    currentId: 'a',
    items: [item('a'), item('b')].map((entry) => (entry.id === 'a' ? { ...entry, image } : entry)),
  }))
  assert.equal(state.currentId, 'a')
  assert.equal(state.currentImage, image)
  assert.equal(state.count, 2)
  assert.equal(state.max, 100)
})

test('toState reports no current picture when nothing is selected', () => {
  const state = toState(library({ currentId: null, items: [item('a')] }))
  assert.equal(state.currentImage, null)
  assert.equal(state.count, 1)
})

test('toState keeps full pictures out of the list payload', () => {
  // The list is what every Settings open downloads; sending whole images there
  // would make a 100-picture library megabytes on the wire.
  const state = toState(library({ currentId: 'a', items: [item('a'), item('b')] }))
  for (const entry of state.items) {
    assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'id', 'thumb'])
  }
})

test('toState survives a library with no display name or thumb version', () => {
  const state = toState({ ...library(), displayName: undefined, thumbVersion: undefined })
  assert.equal(state.displayName, '')
  assert.equal(state.thumbVersion, 1, 'missing thumb version falls back to 1')
})