// ═══ 30-store.js · Persistence: shape and picture caches, the Host routes, the browser-local library that stands in for them, and thumbnail generation.
    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value
    }

    function readCache() {
      try {
        const value = window.localStorage.getItem(CACHE_KEY)
        return typeof value === 'string' && value.startsWith('data:image/') ? value : null
      } catch {
        return null
      }
    }

    function writeCache(value) {
      try {
        if (value === null) window.localStorage.removeItem(CACHE_KEY)
        else window.localStorage.setItem(CACHE_KEY, value)
      } catch {
        // A full or disabled storage keeps the in-memory avatar.
      }
    }

    function readShapeCache() {
      try {
        const value = window.localStorage.getItem(SHAPE_KEY)
        return SHAPE_ORDER.includes(value) ? value : null
      } catch {
        return null
      }
    }

    function writeShapeCache(shape) {
      try {
        window.localStorage.setItem(SHAPE_KEY, shape)
      } catch {
        // ignored: the Host copy still carries the shape
      }
    }

    /** Narrow one wire payload into the state this module renders. */
    function normaliseState(payload) {
      if (payload === null || typeof payload !== 'object') return undefined
      return {
        shape: SHAPE_ORDER.includes(payload.shape) ? payload.shape : 'circle',
        currentId: typeof payload.currentId === 'string' ? payload.currentId : null,
        currentImage: typeof payload.currentImage === 'string' ? payload.currentImage : null,
        displayName: typeof payload.displayName === 'string' ? payload.displayName.slice(0, MAX_NAME_CHARS) : '',
        thumbVersion: Number.isInteger(payload.thumbVersion) ? payload.thumbVersion : 1,
        count: Number.isFinite(payload.count) ? payload.count : 0,
        max: Number.isFinite(payload.max) ? payload.max : 100,
        items: Array.isArray(payload.items)
          ? payload.items.filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string' && typeof item.thumb === 'string')
          : [],
      }
    }

    /** Read the Host state; `undefined` means the channel is unavailable. */
    async function fetchState() {
      try {
        const response = await fetch(STATE_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
        if (!response.ok) return undefined
        return normaliseState(await response.json())
      } catch {
        return undefined
      }
    }

    /**
     * Whether this shell exposes the Host's loopback routes at all.
     *
     * The desktop shell loads the UI over its own `dsh-app:` scheme instead of
     * HTTP, so a relative `/account-avatar/api/...` request has no handler and can
     * never succeed. One probe decides which store the session uses: the Host
     * library when it answers, a browser-local library when it does not. Without
     * that fallback, uploading on desktop reports a storage failure forever.
     */
    let hostAvailable = null
    async function probeHost() {
      if (hostAvailable !== null) return hostAvailable
      try {
        const response = await fetch(STATE_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
        // A 404 means the route is absent; any JSON answer means it is mounted.
        hostAvailable = response.ok
      } catch {
        hostAvailable = false
      }
      return hostAvailable
    }

    /** Apply one mutation on the Host and get the new state back. */
    async function mutate(op, payload = {}) {
      if (!(await probeHost())) return mutateLocal(op, payload)
      try {
        const response = await fetch(MUTATE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, ...payload }),
        })
        if (!response.ok) return { ok: false }
        const result = await response.json()
        const state = normaliseState(result?.state)
        if (state === undefined) return { ok: false, error: result?.error }
        return { ok: true, state, addedId: typeof result?.addedId === 'string' ? result.addedId : undefined }
      } catch {
        return { ok: false }
      }
    }

    /** The browser-local library key; used only when the Host routes are absent. */
    const LOCAL_LIBRARY_KEY = 'dsh.account-avatar.library.v1'

    /** @returns the browser-local library, normalised so callers always see items. */
    function readLocalLibrary() {
      try {
        const raw = window.localStorage.getItem(LOCAL_LIBRARY_KEY)
        if (typeof raw !== 'string' || raw === '') return { shape: 'circle', currentId: null, displayName: '', items: [] }
        const parsed = JSON.parse(raw)
        return {
          shape: SHAPE_ORDER.includes(parsed?.shape) ? parsed.shape : 'circle',
          currentId: typeof parsed?.currentId === 'string' ? parsed.currentId : null,
          displayName: typeof parsed?.displayName === 'string' ? parsed.displayName : '',
          items: Array.isArray(parsed?.items)
            ? parsed.items.filter((item) => item !== null && typeof item === 'object'
              && typeof item.id === 'string' && typeof item.image === 'string')
            : [],
        }
      } catch {
        return { shape: 'circle', currentId: null, displayName: '', items: [] }
      }
    }

    function writeLocalLibrary(library) {
      try {
        window.localStorage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(library))
        return true
      } catch {
        // Quota exceeded: the caller reports it rather than pretending to work.
        return false
      }
    }

    /** Project a local library into the state shape the UI renders. */
    function localState(library) {
      const current = library.items.find((item) => item.id === library.currentId) ?? null
      return normaliseState({
        shape: library.shape,
        currentId: current === null ? null : current.id,
        currentImage: current === null ? null : current.image,
        displayName: library.displayName,
        thumbVersion: THUMB_VERSION,
        count: library.items.length,
        max: 100,
        items: library.items.map((item) => ({ id: item.id, thumb: item.thumb ?? item.image })),
      })
    }

    /**
     * Apply one mutation to the browser-local library.
     *
     * Mirrors the Host's operations so the Settings page behaves the same either
     * way: add keeps at most 100 and drops the oldest, remove falls back to the
     * newest remaining picture, and the one in use is never evicted.
     *
     * @param op - add, remove, reset, shape or name.
     * @param payload - operation arguments.
     * @returns the same result shape the HTTP path returns.
     */
    function mutateLocal(op, payload) {
      const library = readLocalLibrary()
      if (op === 'add') {
        const image = typeof payload.image === 'string' ? payload.image : ''
        if (image === '') return { ok: false, error: 'missing-image' }
        const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
        library.items.push({
          id,
          image,
          thumb: typeof payload.thumb === 'string' ? payload.thumb : image,
        })
        // Cap at 100 without ever dropping the entry currently in use.
        while (library.items.length > 100) {
          const victim = library.items.findIndex((item) => item.id !== library.currentId)
          if (victim < 0) break
          library.items.splice(victim, 1)
        }
        library.currentId = id
      } else if (op === 'remove') {
        const ids = Array.isArray(payload.ids) ? payload.ids : []
        library.items = library.items.filter((item) => !ids.includes(item.id))
        if (library.currentId !== null && ids.includes(library.currentId)) {
          library.currentId = library.items.length > 0 ? library.items[library.items.length - 1].id : null
        }
      } else if (op === 'reset') {
        library.currentId = null
      } else if (op === 'select') {
        const id = typeof payload.id === 'string' ? payload.id : ''
        if (!library.items.some((item) => item.id === id)) return { ok: false, error: 'unknown-id' }
        library.currentId = id
      } else if (op === 'shape') {
        if (SHAPE_ORDER.includes(payload.shape)) library.shape = payload.shape
      } else if (op === 'name') {
        library.displayName = typeof payload.name === 'string'
          ? payload.name.trim().slice(0, MAX_NAME_CHARS)
          : ''
      } else {
        return { ok: false, error: 'unknown-op' }
      }
      if (!writeLocalLibrary(library)) return { ok: false, error: 'quota' }
      return { ok: true, state: localState(library) }
    }

    /** Read the initial state from whichever store this shell actually has. */
    async function readInitialState() {
      if (await probeHost()) {
        const remote = await fetchState()
        if (remote !== undefined) return remote
      }
      return localState(readLocalLibrary())
    }

    /** Downscale one stored picture into the list thumbnail, flattening transparency. */
    function makeThumb(dataUrl, backdrop) {
      return new Promise((resolve) => {
        const image = new Image()
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = THUMB
            canvas.height = THUMB
            const context = canvas.getContext('2d')
            if (context === null) {
              resolve(null)
              return
            }
            // A picture with transparent corners would otherwise show the grid
            // through them and read as "not filling the cell". Flatten instead.
            context.fillStyle = typeof backdrop === 'string' && backdrop !== '' && backdrop !== 'transparent'
              ? backdrop
              : '#f2f3f5'
            context.fillRect(0, 0, THUMB, THUMB)
            context.imageSmoothingEnabled = true
            context.imageSmoothingQuality = 'high'
            context.drawImage(image, 0, 0, THUMB, THUMB)
            let thumb = canvas.toDataURL('image/webp', 0.8)
            if (!thumb.startsWith('data:image/webp')) thumb = canvas.toDataURL('image/png')
            resolve(thumb)
          } catch {
            resolve(null)
          }
        }
        image.onerror = () => resolve(null)
        image.src = dataUrl
      })
    }

    /** Background colour of one grid cell, so flattened thumbnails blend in. */
    function gridBackdrop() {
      try {
        const probe = document.querySelector('.ast_slotFrame')
        if (probe === null) return null
        return window.getComputedStyle(probe).backgroundColor
      } catch {
        return null
      }
    }

    /** Fetch one original picture, used to rebuild its thumbnail. */
    async function fetchImage(id) {
      // The local library already holds the original inline; there is no route to ask.
      if (!(await probeHost())) {
        const item = readLocalLibrary().items.find((entry) => entry.id === id)
        return item === undefined ? null : item.image
      }
      try {
        const response = await fetch(`${IMAGE_URL}?id=${encodeURIComponent(id)}`, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        if (!response.ok) return null
        const payload = await response.json()
        return typeof payload?.image === 'string' && payload.image.startsWith('data:image/') ? payload.image : null
      } catch {
        return null
      }
    }

    /**
     * Old libraries kept the transparent corners of the source picture, which read
     * as "the thumbnail does not fill its cell". Re-render each stored thumbnail
     * through the flattening pipeline once, then stamp the version on the Host.
     */
    async function migrateThumbs(state) {
      if (state.thumbVersion >= THUMB_VERSION || state.items.length === 0) return state
      const backdrop = gridBackdrop()
      const rebuilt = []
      for (const item of state.items) {
        const image = await fetchImage(item.id)
        if (image === null) continue
        const thumb = await makeThumb(image, backdrop)
        if (thumb === null) continue
        rebuilt.push({ id: item.id, thumb })
      }
      if (rebuilt.length === 0) return state
      const result = await mutate('rethumb', { items: rebuilt })
      return result.ok ? result.state : state
    }

