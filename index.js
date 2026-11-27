/**
 * Host half of the avatar studio bundle.
 *
 * Owns the durable avatar library and the loopback HTTP routes the browser half
 * talks to: a list of up to 100 stored pictures with one of them selected, plus
 * the display shape. Everything lives in one JSON file under the Harness home
 * directory, so it survives browser restarts, port changes and storage clears.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const STATE_ROUTE = '/account-avatar/api/state'
const MUTATE_ROUTE = '/account-avatar/api/mutate'
const IMAGE_ROUTE = '/account-avatar/api/image'

/** Bumped when the thumbnail pipeline changes, so clients re-render old thumbs once. */
const THUMB_VERSION = 2

/**
 * Largest accepted request body.
 *
 * This bounds one JSON document on the wire, not the file a user picks: the
 * browser half crops to 256×256 *before* sending, so a stored picture plus its
 * thumbnail is tens of kilobytes. The 12 MB picker limit in the client governs
 * only what the browser will decode locally, and never reaches this route.
 */
const MAX_BODY_BYTES = 6 * 1024 * 1024
/** Largest accepted data: URL length for one stored picture. */
const MAX_IMAGE_CHARS = 2 * 1024 * 1024
/** Largest accepted data: URL length for one list thumbnail. */
const MAX_THUMB_CHARS = 256 * 1024

/** How many pictures the library keeps. */
const MAX_ITEMS = 100
const SHAPES = new Set(['circle', 'rounded', 'square'])
const DEFAULT_SHAPE = 'circle'

const DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

/** Absolute path of the library file, under the Harness home directory. */
function storeDir() {
  const home = process.env.DSH_HOME?.trim()
  return join(home !== undefined && home !== '' ? home : join(homedir(), '.dsh'), 'account-avatar')
}

const libraryPath = () => join(storeDir(), 'avatars.json')
/** The single-avatar file written by the first version of this plugin. */
const legacyPath = () => join(storeDir(), 'avatar.json')

/** Whether a value is a data: URL this plugin accepts. */
function isImage(value, maxChars) {
  return typeof value === 'string' && value.length <= maxChars && DATA_URL.test(value)
}

/** One stable, collision-free identifier for a stored picture. */
function makeId() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** How long a custom display name may be. */
const MAX_NAME_CHARS = 24

/** Normalise a parsed library into the shape this module serves. */
function normaliseLibrary(parsed) {
  const shape = SHAPES.has(parsed?.shape) ? parsed.shape : DEFAULT_SHAPE
  const displayName = typeof parsed?.displayName === 'string' ? parsed.displayName.slice(0, MAX_NAME_CHARS) : ''
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : []
  const items = []
  for (const item of rawItems) {
    if (item === null || typeof item !== 'object') continue
    if (typeof item.id !== 'string' || item.id === '') continue
    if (!isImage(item.image, MAX_IMAGE_CHARS)) continue
    const thumb = isImage(item.thumb, MAX_THUMB_CHARS) ? item.thumb : item.image
    items.push({
      id: item.id,
      image: item.image,
      thumb,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
    })
    if (items.length >= MAX_ITEMS) break
  }
  const currentId = typeof parsed?.currentId === 'string' && items.some((item) => item.id === parsed.currentId)
    ? parsed.currentId
    : null
  const thumbVersion = Number.isInteger(parsed?.thumbVersion) ? parsed.thumbVersion : 1
  return { version: 2, shape, currentId, displayName, thumbVersion, items }
}

/** Parse a JSON file, tolerating a UTF-8 BOM some editors add. */
function parseJson(raw) {
  return JSON.parse(raw.replace(/^\uFEFF/u, ''))
}

/** Read the library, migrating the first version's single avatar when present. */
async function readLibrary() {
  try {
    const parsed = parseJson(await readFile(libraryPath(), 'utf8'))
    return normaliseLibrary(parsed)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[account-avatar] avatar library is unreadable, starting empty:', error?.message ?? error)
    }
  }
  // Migration: the first version stored exactly one picture in avatar.json.
  try {
    const legacy = parseJson(await readFile(legacyPath(), 'utf8'))
    if (isImage(legacy?.avatar, MAX_IMAGE_CHARS)) {
      const id = makeId()
      const migrated = {
        version: 2,
        shape: DEFAULT_SHAPE,
        currentId: id,
        displayName: '',
        thumbVersion: 1,
        items: [{ id, image: legacy.avatar, thumb: legacy.avatar, createdAt: typeof legacy.updatedAt === 'string' ? legacy.updatedAt : new Date().toISOString() }],
      }
      await writeLibrary(migrated)
      await rm(legacyPath(), { force: true })
      return migrated
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[account-avatar] legacy avatar is unreadable:', error?.message ?? error)
    }
  }
  return { version: 2, shape: DEFAULT_SHAPE, currentId: null, displayName: '', thumbVersion: THUMB_VERSION, items: [] }
}

/** Replace the library file through one atomic rename. */
async function writeLibrary(library) {
  const path = libraryPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(library), 'utf8')
  await rename(temporary, path)
}

/** The wire form: metadata plus thumbnails, never the whole library of originals. */
function toState(library) {
  const current = library.items.find((item) => item.id === library.currentId)
  return {
    shape: library.shape,
    currentId: library.currentId,
    currentImage: current === undefined ? null : current.image,
    displayName: library.displayName ?? '',
    thumbVersion: library.thumbVersion ?? 1,
    count: library.items.length,
    max: MAX_ITEMS,
    items: library.items.map((item) => ({ id: item.id, thumb: item.thumb, createdAt: item.createdAt })),
  }
}

/** Answer with one JSON document and no cache. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** Read one request body as UTF-8 text, refusing oversized payloads. */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Register the avatar library and its routes.
 *
 * `webServer` is injected rather than read once: the desktop shell composes the
 * listener during startup, so a plain `ctx.get('webServer')` in the plugin body
 * can run before the service exists and would silently disable every route —
 * which is exactly how a saved name turns into "could not save".
 *
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    registerRoutes(webCtx, webCtx.webServer)
  })
}

/**
 * Mount the state, mutate and image routes on one web server.
 * @param ctx - context that owns the effects, so reloading the plugin removes them.
 * @param webServer - the listener these routes answer on.
 */
function registerRoutes(ctx, webServer) {
  const connection = ctx.get('connection')

  /** Serialise mutations so two quick clicks cannot lose a picture. */
  let queue = Promise.resolve()
  const serialised = (operation) => {
    const next = queue.then(operation, operation)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  /** Mirror the trust check other loopback routes use; a rejection is a status code. */
  const rejected = (req, res) => {
    let rejection
    try {
      rejection = connection?.requestRejection?.(req)
    } catch {
      rejection = undefined
    }
    if (rejection === undefined || rejection === null || rejection === false) return false
    res.statusCode = typeof rejection === 'number' ? rejection : 403
    res.end()
    return true
  }

  /** Apply one mutation and answer with the whole new state. */
  async function mutate(body) {
    const library = await readLibrary()
    switch (body.op) {
      case 'add': {
        if (!isImage(body.image, MAX_IMAGE_CHARS)) return { error: 'invalid-image' }
        const thumb = isImage(body.thumb, MAX_THUMB_CHARS) ? body.thumb : body.image
        const item = {
          id: makeId(),
          image: body.image,
          thumb,
          createdAt: new Date().toISOString(),
        }
        library.items.push(item)
        // Drop the oldest picture that is not the one in use.
        while (library.items.length > MAX_ITEMS) {
          const index = library.items.findIndex((entry) => entry.id !== library.currentId)
          if (index < 0) break
          library.items.splice(index, 1)
        }
        library.currentId = item.id
        await writeLibrary(library)
        return { state: toState(library), addedId: item.id }
      }
      case 'select': {
        if (typeof body.id !== 'string' || !library.items.some((item) => item.id === body.id)) {
          return { error: 'unknown-id' }
        }
        library.currentId = body.id
        await writeLibrary(library)
        return { state: toState(library) }
      }
      case 'remove': {
        const ids = new Set()
        if (Array.isArray(body.ids)) {
          for (const id of body.ids) if (typeof id === 'string' && id !== '') ids.add(id)
        } else if (typeof body.id === 'string' && body.id !== '') {
          ids.add(body.id)
        }
        if (ids.size === 0) return { error: 'unknown-id' }
        const before = library.items.length
        library.items = library.items.filter((item) => !ids.has(item.id))
        if (library.items.length === before) return { error: 'unknown-id' }
        if (library.currentId !== null && ids.has(library.currentId)) {
          // Fall back to the newest remaining picture, or to the account avatar.
          const newest = library.items[library.items.length - 1]
          library.currentId = newest === undefined ? null : newest.id
        }
        await writeLibrary(library)
        return { state: toState(library), removed: before - library.items.length }
      }
      case 'shape': {
        if (!SHAPES.has(body.shape)) return { error: 'invalid-shape' }
        library.shape = body.shape
        await writeLibrary(library)
        return { state: toState(library) }
      }
      case 'reset': {
        library.currentId = null
        await writeLibrary(library)
        return { state: toState(library) }
      }
      case 'name': {
        library.displayName = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_CHARS) : ''
        await writeLibrary(library)
        return { state: toState(library) }
      }
      case 'rethumb': {
        // One batch from the browser after it re-rendered old thumbnails with the
        // current pipeline; the version stamp stops it from running twice.
        if (!Array.isArray(body.items)) return { error: 'invalid-items' }
        const incoming = new Map()
        for (const entry of body.items) {
          if (entry === null || typeof entry !== 'object') continue
          if (typeof entry.id !== 'string' || !isImage(entry.thumb, MAX_THUMB_CHARS)) continue
          incoming.set(entry.id, entry.thumb)
        }
        let changed = 0
        library.items = library.items.map((item) => {
          const thumb = incoming.get(item.id)
          if (thumb === undefined) return item
          changed += 1
          return { ...item, thumb }
        })
        library.thumbVersion = THUMB_VERSION
        await writeLibrary(library)
        return { state: toState(library), changed }
      }
      default:
        return { error: 'unknown-operation' }
    }
  }

  const stateRoute = {
    kind: 'exact',
    path: STATE_ROUTE,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const library = await serialised(readLibrary)
      sendJson(res, 200, toState(library))
    },
  }

  const mutateRoute = {
    kind: 'exact',
    path: MUTATE_ROUTE,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        sendJson(res, 415, { error: 'unsupported-media-type' })
        return
      }
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch (error) {
        sendJson(res, error?.status === 413 ? 413 : 400, { error: error?.status === 413 ? 'payload-too-large' : 'invalid-json' })
        return
      }
      if (body === null || typeof body !== 'object') {
        sendJson(res, 400, { error: 'invalid-body' })
        return
      }
      let result
      try {
        result = await serialised(() => mutate(body))
      } catch (error) {
        console.warn('[account-avatar] cannot apply', body.op, ':', error?.message ?? error)
        sendJson(res, 500, { error: 'store-failed' })
        return
      }
      if (result.error !== undefined) {
        sendJson(res, 400, result)
        return
      }
      sendJson(res, 200, result)
    },
  }

  /** Hand one original picture back so the browser can re-render its thumbnail. */
  const imageRoute = {
    kind: 'exact',
    path: IMAGE_ROUTE,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      let id = null
      try {
        id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('id')
      } catch {
        id = null
      }
      if (typeof id !== 'string' || id === '') {
        sendJson(res, 400, { error: 'missing-id' })
        return
      }
      const library = await serialised(readLibrary)
      const item = library.items.find((entry) => entry.id === id)
      if (item === undefined) {
        sendJson(res, 404, { error: 'unknown-id' })
        return
      }
      sendJson(res, 200, { id: item.id, image: item.image })
    },
  }

  ctx.effect(() => webServer.register(stateRoute), `account-avatar: GET ${STATE_ROUTE}`)
  ctx.effect(() => webServer.register(mutateRoute), `account-avatar: POST ${MUTATE_ROUTE}`)
  ctx.effect(() => webServer.register(imageRoute), `account-avatar: GET ${IMAGE_ROUTE}`)
}

// The three pure functions below carry the library's actual rules — which stored
// records survive a read, what the browser is told about them, and which strings
// count as pictures. Exported so `test/host.test.mjs` can check them without a
// Harness context or a filesystem; the plugin entry point is still `apply`.
export { isImage, normaliseLibrary, toState }