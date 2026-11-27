// ═══ 70-account.js · Reading the account identity out of the shipped panel, caching it by contact, and following it when the account changes.
    /**
     * The account identity only exists in the Settings "account" panel.
     *
     * The identity block renders `[avatar] [name / contact]`. Every locale's
     * signed-in placeholder names the product ("Signed in to DeepSeek"), so a
     * name that reads like that placeholder is not a name — an account signed up
     * by phone or email carries no Platform identity profile at all, and the
     * panel falls back to the placeholder plus the masked contact.
     *
     * @returns the visible identity, or undefined while the panel is not mounted.
     */
    function scanAccountIdentity() {
      const contactish = (text) => text !== '' && text.length <= 48 && !/\s/u.test(text)
        && (text.includes('*') || /^[^@]+@[^@]+$/u.test(text) || /^\+?\d{6,}$/u.test(text))
      const nameish = (text) => text !== '' && text.length <= MAX_ACCOUNT_CHARS
        && !text.includes('*') && !text.includes('@') && !/deepseek/iu.test(text)
      try {
        for (const node of document.querySelectorAll('div, span, p')) {
          if (node.children.length > 0) continue
          const contact = (node.textContent ?? '').trim()
          if (!contactish(contact)) continue
          const copy = node.parentElement
          if (copy === null) continue
          // Require the identity block to carry an avatar seat, so a status line
          // elsewhere on the page cannot pass for an account.
          const identity = copy.parentElement
          if (identity === null || identity.querySelector('img, svg') === null) continue
          for (const sibling of copy.children) {
            if (sibling === node) continue
            const name = (sibling.textContent ?? '').trim()
            if (nameish(name)) return { name, contact }
          }
          // No usable name: the account has no identity profile, but the masked
          // contact still identifies which account is signed in.
          return { name: '', contact }
        }
      } catch {
        // fall through
      }
      return undefined
    }

    /** @returns `{ name, contact }`; contact is '' for a record written by v1. */
    function readCachedAccount() {
      try {
        const raw = window.localStorage.getItem(ACCOUNT_KEY)
        if (typeof raw === 'string' && raw !== '') {
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object') {
            return {
              name: typeof parsed.name === 'string' ? parsed.name : '',
              contact: typeof parsed.contact === 'string' ? parsed.contact : '',
            }
          }
        }
      } catch {
        // fall through to the legacy key
      }
      try {
        const legacy = window.localStorage.getItem(LEGACY_ACCOUNT_KEY)
        if (typeof legacy === 'string' && legacy !== '') return { name: legacy, contact: '' }
      } catch {
        // ignore
      }
      return { name: '', contact: '' }
    }

    function writeCachedAccount(identity) {
      try {
        window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ name: identity.name, contact: identity.contact }))
        // The bare-name key would otherwise keep winning on the next read.
        window.localStorage.removeItem(LEGACY_ACCOUNT_KEY)
      } catch {
        // ignore
      }
    }

    /** @returns the label cached from the last identity, name first then contact. */
    function readCachedAccountLabel() {
      return labelOf(readCachedAccount())
    }

    /** The label a phone-only account shows: its masked contact, exactly as the sidebar does. */
    function labelOf(identity) {
      return identity.name !== '' ? identity.name : identity.contact
    }

    /** Adopt one identity and tell everyone showing it. @returns whether the label changed. */
    function adoptAccount(identity) {
      const name = typeof identity?.name === 'string' ? identity.name.trim().slice(0, MAX_ACCOUNT_CHARS) : ''
      const contact = typeof identity?.contact === 'string' ? identity.contact.trim().slice(0, 48) : ''
      if (name === '' && contact === '') return false
      const label = name !== '' ? name : contact
      const isName = name !== ''
      if (label === accountLabel) {
        // Same account: refresh the fingerprint silently so a later switch is caught.
        accountLabelIsName = isName
        writeCachedAccount({ name, contact })
        return false
      }
      const previous = accountLabel
      accountLabel = label
      accountLabelIsName = isName
      writeCachedAccount({ name, contact })
      // A different account means the previous `@handle` and any name derived from
      // it are stale; only a custom name the user typed should survive.
      if (launcherName === '' || launcherName === previous) {
        launcherName = label
        paintLauncherName()
      }
      for (const listener of accountListeners) {
        try {
          listener(label, isName)
        } catch {
          // one broken listener must not stop the others
        }
      }
      return true
    }

    /** Subscribe to identity changes. @returns the unsubscribe function. */
    function subscribeAccount(listener) {
      accountListeners.add(listener)
      return () => { accountListeners.delete(listener) }
    }

    /**
     * Keep the account identity current.
     *
     * A cached identity is a startup shortcut, not the truth: the panel is the
     * only place the signed-in account is visible, and it re-renders on every
     * Settings visit. So the watcher keeps observing instead of stopping after
     * the first hit, and adopts whatever it finds once the contact fingerprint
     * moves — that is how a sign-out and a different sign-in get picked up.
     */
    function watchAccountName() {
      const cached = readCachedAccount()
      const cachedLabel = labelOf(cached)
      if (cachedLabel !== '') {
        accountLabel = cachedLabel
        accountLabelIsName = cached.name !== ''
      }
      let last = 0
      let tail = 0
      /**
       * Read once, then make sure a throttled pass is not simply dropped.
       *
       * Throttling keeps a busy DOM from rescanning on every mutation, but the
       * last mutation of a burst is usually the one that finished rendering the
       * card — dropping it would leave the identity one account behind.
       */
      const attempt = () => {
        const now = Date.now()
        const quiet = now - last
        if (quiet < 600) {
          if (tail === 0) {
            tail = window.setTimeout(() => { tail = 0; attempt() }, 600 - quiet)
          }
          return
        }
        last = now
        const identity = scanAccountIdentity()
        if (identity === undefined) return
        adoptAccount(identity)
      }
      const observer = new MutationObserver(attempt)
      observer.observe(document.body, { childList: true, subtree: true })
      attempt()
      return () => {
        observer.disconnect()
        if (tail !== 0) window.clearTimeout(tail)
      }
    }

