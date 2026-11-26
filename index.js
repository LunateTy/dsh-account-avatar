/**
 * Host half of the avatar studio bundle.
 *
 * Owns the durable copy of the user's custom avatar and the two loopback HTTP
 * routes the browser half talks to. The stored value is a single small
 * data: URL, so one JSON file keeps it independent of the browser profile,
 * its port, and its storage clear-outs.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const STATE_ROUTE = '/account-avatar/api/state'
const AVATAR_ROUTE = '/account-avatar/api/avatar'

/** Largest accepted request body; a 256px avatar is far below this. */
const MAX_BODY_BYTES = 4 * 1024 * 1024
/** Largest accepted data: URL length once decoded into the JSON body. */
const MAX_AVATAR_CHARS = 3 * 1024 * 1024

const DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

/** Absolute path of the stored record, under the Harness home directory. */
function storePath() {
  const home = process.env.DSH_HOME?.trim()
  return join(home !== undefined && home !== '' ? home : join(homedir(), '.dsh'), 'account-avatar', 'avatar.json')
}

/** Read the stored record; a missing or unreadable file reads as "no avatar". */
async function readRecord() {
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.avatar === 'string' && DATA_URL.test(parsed.avatar)) {
      return { avatar: parsed.avatar, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[account-avatar] stored avatar is unreadable:', error?.message ?? error)
  }
  return { avatar: null }
}

/** Replace or clear the stored record through one atomic rename. */
async function writeRecord(avatar) {
  const path = storePath()
  if (avatar === null) {
    await rm(path, { force: true })
    return
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ avatar, updatedAt: new Date().toISOString() }), 'utf8')
  await rename(temporary, path)
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
 * Register the durable avatar store and its routes.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const connection = ctx.get('connection')

  // The browser may be the desktop shell's IPC bridge instead; the client half
  // keeps working from its local cache in that case.
  if (webServer === undefined) {
    console.info('[account-avatar] no web server in this composition; the browser keeps its local copy only')
    return
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
      const record = await readRecord()
      sendJson(res, 200, record)
    },
  }

  const avatarRoute = {
    kind: 'exact',
    path: AVATAR_ROUTE,
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
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch (error) {
        sendJson(res, error?.status === 413 ? 413 : 400, { error: error?.status === 413 ? 'payload-too-large' : 'invalid-json' })
        return
      }
      if (payload === null || typeof payload !== 'object' || !('avatar' in payload)) {
        sendJson(res, 400, { error: 'missing-avatar-field' })
        return
      }
      const avatar = payload.avatar
      if (avatar !== null && (typeof avatar !== 'string' || avatar.length > MAX_AVATAR_CHARS || !DATA_URL.test(avatar))) {
        sendJson(res, 400, { error: 'invalid-avatar' })
        return
      }
      try {
        await writeRecord(avatar)
      } catch (error) {
        console.warn('[account-avatar] cannot store the avatar:', error?.message ?? error)
        sendJson(res, 500, { error: 'store-failed' })
        return
      }
      sendJson(res, 200, { ok: true, avatar })
    },
  }

  ctx.effect(() => webServer.register(stateRoute), `account-avatar: GET ${STATE_ROUTE}`)
  ctx.effect(() => webServer.register(avatarRoute), `account-avatar: POST ${AVATAR_ROUTE}`)
}