// ═══ 10-seat.js · Everything drawn on the sidebar: the cached name, the signed-out seat, and the marker that lets one stylesheet repaint the avatar.
    function readNameCache() {
      try {
        return window.localStorage.getItem(NAME_KEY) ?? ''
      } catch {
        return ''
      }
    }

    function writeNameCache(name) {
      try {
        window.localStorage.setItem(NAME_KEY, name)
      } catch {
        // ignore
      }
    }

    /** Count one actual rewrite; frequent rewrites mean someone else owns the label. */
    function noteRepaint() {
      const now = Date.now()
      repaintHits = now - repaintLastAt < 10_000 ? repaintHits + 1 : 1
      repaintLastAt = now
      if (repaintHits >= 3) launcherConflict = true
    }

    /** Whether the shipped launcher is showing a signed-out button right now. */
    function launcherSignedOut() {
      try {
        for (const trigger of document.querySelectorAll('[aria-haspopup="menu"]')) {
          const box = trigger.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.top < window.innerHeight - 160) continue
          return trigger.getAttribute('data-signed-out') === 'true'
        }
      } catch {
        // fall through: assume signed in, which is the only case with a name
      }
      return false
    }

    /** Replace the text next to the sidebar avatar with the custom name. */
    function paintLauncherName() {
      // Signed out there is no account to name, so the seat says so instead of
      // repeating the shipped "More"/「更多」 and instead of keeping a name from
      // an account that has since signed out.
      const signedOut = launcherSignedOut()
      const target = signedOut ? (signedOutLabel !== '' ? signedOutLabel : '未登录') : launcherName
      if (target === '') return
      // Someone else owns the label; keep fighting and it just flickers.
      if (launcherConflict) return
      try {
        const marker = document.querySelector(AVATAR_SELECTOR)

        // Fast path: the first ancestor of the avatar whose subtree holds exactly
        // one non-empty text node — that node is the seat label.
        if (marker !== null) {
          let scope = marker.parentElement
          for (let depth = 0; depth < 5 && scope !== null; depth += 1) {
            const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
            const texts = []
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              if ((node.textContent ?? '').trim() === '') continue
              texts.push(node)
            }
            if (texts.length === 1) {
              const node = texts[0]
              if (node.textContent !== target) {
                noteRepaint()
                node.textContent = target
              }
              return
            }
            if (texts.length > 4) break
            scope = scope.parentElement
          }
        }

        // Fallback: the seat label still reads as the account name, and it sits in
        // the bottom strip of the window. Replace that one.
        const source = accountLabel !== '' ? accountLabel : readCachedAccountLabel()
        if (source === '') return
        const limit = window.innerHeight - 200
        const all = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let node = all.nextNode(); node !== null; node = all.nextNode()) {
          if ((node.textContent ?? '').trim() !== source) continue
          const host = node.parentElement
          if (host === null) continue
          const rect = host.getBoundingClientRect()
          if (rect.top < limit) continue
          noteRepaint()
          node.textContent = target
          return
        }
      } catch {
        // leave the shipped label alone
      }
    }

    /** Point the launcher label at one name, or clear it back to the shipped one. */
    function setLauncherName(name) {
      const next = typeof name === 'string' ? name.trim() : ''
      launcherName = next
      writeNameCache(next)
      // Signed out the seat reads 「未登录」 regardless of what the custom name is,
      // but the paint still has to run: `launcherName` switching is not the only
      // reason the label needs writing.
      if (next !== '' || launcherSignedOut()) paintLauncherName()
    }

    /** Percent radii keep the launcher (24px) and the preview (72px) visually consistent. */
    const SHAPE_RADIUS = { circle: '50%', rounded: '26%', square: '10%' }
    /** Pixel radii for the fixed 96px sidebar preview. */
    const SHAPE_RADIUS_PX = { circle: '48px', rounded: '25px', square: '10px' }
    const SHAPE_ORDER = ['circle', 'rounded', 'square']

    /**
     * The avatar seat in the sidebar account launcher.
     *
     * The shipped launcher writes `data-avatar-status={account.avatar?.status}` and
     * React drops an attribute whose value is undefined, so an account that never
     * uploaded a picture has no marker at all — the launcher paints a plain icon
     * there instead. Match a runtime tag as well, otherwise the plugin silently
     * does nothing for exactly the people who want it most.
     */
    const SEAT_ATTR = 'data-ast-avatar'
    const AVATAR_SELECTOR = `:is([data-avatar-status],[${SEAT_ATTR}])`
    /** Class on the launcher button while this plugin supplies a signed-out seat. */
    const SIGNED_OUT_CLASS = 'ast-signed-out-seat'
    /**
     * Inline geometry for a seat this plugin had to create.
     *
     * The shipped seat is styled by a hashed CSS module class that no plugin can
     * name, and the injected stylesheet only paints pictures over it. A node that
     * has to exist before the stylesheet is written therefore carries its own box.
     */
    const SEAT_STYLE = [
      'flex:none', 'display:flex', 'align-items:center', 'justify-content:center',
      'width:24px', 'height:24px', 'border-radius:50%', 'order:-1',
      'background:var(--dsw-alias-bg-skeleton, rgba(127,127,127,.18))',
      'color:var(--dsw-alias-label-tertiary, #8a8a8a)',
    ].join(';')

    /**
     * The placeholder inside a seat this plugin created.
     *
     * Same 16px person silhouette the shipped launcher renders for an account
     * with no picture, inlined because that icon component is not importable
     * from a client bundle. Hidden by the same `> svg` rule that hides the
     * shipped one once a picture is painted over it.
     */
    const SIGNED_OUT_GLYPH = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">'
      + '<circle cx="8" cy="5.7" r="2.7"></circle>'
      + '<path d="M2.8 14c0-2.9 2.3-4.7 5.2-4.7s5.2 1.8 5.2 4.7z"></path>'
      + '</svg>'

    /**
     * Hide the shipped ellipsis behind a signed-out seat.
     *
     * The launcher renders `IconEllipsisOutlineMedium` in place of the avatar
     * span when signed out, and it sits at index 0 of the button's children.
     * Removing it would renumber every sibling React still holds — the same trap
     * that makes the seat get *appended* rather than inserted — so it is hidden
     * with `display:none`, which also drops it out of the flex `gap`.
     *
     * Only direct `svg` children are matched, so the person glyph inside the new
     * seat survives; the "More" label is a `span` and stays as shipped.
     */
    const SIGNED_OUT_CSS = `.${SIGNED_OUT_CLASS}>svg{display:none!important}`

    /** Paint the rule once; every signed-out launcher in this document needs it. */
    function ensureSignedOutStyles() {
      if (document.querySelector('style[data-ast-signed-out]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.astSignedOut = ''
      tag.textContent = SIGNED_OUT_CSS
      document.head.appendChild(tag)
    }

    /**
     * Give the signed-out launcher a seat of its own.
     *
     * Signed out, the shipped button renders an ellipsis instead of a `span`
     * (AccountMenu.tsx switches to `IconEllipsisOutlineMedium`), so there is no
     * element to paint a picture onto. The seat is *appended*, never inserted:
     * React reconciles a button's children by index, and a node pushed onto the
     * end cannot shift the children it already owns. `order:-1` puts it first on
     * screen, which is where an avatar belongs.
     *
     * @param trigger - the account menu button carrying `data-signed-out="true"`.
     * @returns whether a seat is now in place.
     */
    function ensureSignedOutSeat(trigger) {
      trigger.classList.add(SIGNED_OUT_CLASS)
      ensureSignedOutStyles()
      if (trigger.querySelector(`[${SEAT_ATTR}]`) !== null) return true
      const seat = document.createElement('span')
      seat.setAttribute(SEAT_ATTR, '')
      seat.style.cssText = SEAT_STYLE
      // Until a picture is chosen the seat shows the same person glyph the
      // shipped seat uses when an account has no picture, so a signed-out
      // launcher does not read as an empty grey box.
      seat.innerHTML = SIGNED_OUT_GLYPH
      trigger.appendChild(seat)
      return true
    }

    /**
     * Drop a signed-out seat once the button is signed in again.
     *
     * Signing in replaces the button's children with the shipped avatar, but a
     * node this plugin appended can survive that; leaving it behind would put a
     * second, stale picture next to the real one.
     *
     * @returns nothing.
     */
    function sweepSignedOutSeat() {
      for (const trigger of document.querySelectorAll(`.${SIGNED_OUT_CLASS}`)) {
        if (trigger.getAttribute('data-signed-out') === 'true') continue
        trigger.classList.remove(SIGNED_OUT_CLASS)
        const stale = trigger.querySelector(`[${SEAT_ATTR}]`)
        if (stale !== null) stale.remove()
      }
      // The rule has no users left once every launcher is signed in again.
      if (document.querySelector(`.${SIGNED_OUT_CLASS}`) === null) {
        document.querySelector('style[data-ast-signed-out]')?.remove()
      }
    }

    /**
     * Tag the launcher's avatar seat when the shipped marker is missing.
     *
     * Finds the account menu button pinned to the bottom strip of the window and
     * takes its square, icon-bearing span. `aria-haspopup` is semantic and stable,
     * unlike the hashed CSS module class names. A signed-out button has no such
     * span, so that case gets one appended instead.
     */
    function markLauncherSeat() {
      try {
        sweepSignedOutSeat()
        const limit = window.innerHeight - 160
        const candidates = []
        for (const trigger of document.querySelectorAll('[aria-haspopup="menu"]')) {
          const box = trigger.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.top < limit) continue
          candidates.push(trigger)
        }
        // A shipped account launcher also carries `data-collapsed`; another menu
        // button pinned near the bottom must not win on geometry alone.
        candidates.sort((a, b) => Number(b.hasAttribute('data-collapsed')) - Number(a.hasAttribute('data-collapsed')))
        for (const trigger of candidates) {
          if (trigger.getAttribute('data-signed-out') === 'true') return ensureSignedOutSeat(trigger)
          // This trigger already carries the runtime tag.
          if (trigger.querySelector(`[${SEAT_ATTR}]`) !== null) return true
          // A shipped marker inside this trigger means the seat is already
          // addressable; leave it alone so the two selectors never disagree.
          if (trigger.querySelector('[data-avatar-status]') !== null) return true
          for (const span of trigger.querySelectorAll('span')) {
            const rect = span.getBoundingClientRect()
            if (rect.width < 12 || rect.width > 48) continue
            // The seat is square; a wide one is the name label.
            if (Math.abs(rect.width - rect.height) > 6) continue
            if (span.querySelector('img, svg') === null) continue
            span.setAttribute(SEAT_ATTR, '')
            return true
          }
        }
      } catch {
        // No launcher on this screen; the DOM observer retries.
      }
      return false
    }

    /**
     * Retry the tag for a few seconds after boot.
     *
     * The launcher mounts on the first shell render, which may land after this
     * bundle applies and before any mutation wakes the observer; a short bounded
     * poll covers that gap without a permanent timer.
     *
     * @param onReady - called once the seat exists, so the stored name can be
     * painted without waiting for an unrelated DOM change.
     * @param attempts - polls left before giving up.
     * @returns nothing.
     */
    function retryLauncherSeat(onReady, attempts = 10) {
      if (markLauncherSeat()) {
        if (typeof onReady === 'function') onReady()
        return
      }
      if (attempts <= 1) return
      window.setTimeout(() => { retryLauncherSeat(onReady, attempts - 1) }, 300)
    }

