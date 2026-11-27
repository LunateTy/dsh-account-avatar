// ═══ 80-apply.js · Slot registration: the Settings section and the launcher-name guard.
    /** Slot registration and dictionaries; no side effects outside `apply`. */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'account-avatar: dictionaries')
      // Before any paint: a signed-out launcher has to know what to call itself.
      signedOutLabel = resolveSignedOutLabel(t)
      ctx.effect(() => watchAccountName(), 'account-avatar: account name watcher')

      // React re-renders the seat with the shipped name; put the custom one back.
      ctx.effect(() => {
        let timer = 0
        const observer = new MutationObserver(() => {
          if (timer !== 0) return
          timer = window.setTimeout(() => {
            timer = 0
            // React may have replaced the seat node; the tag goes with it.
            markLauncherSeat()
            paintLauncherName()
          }, 200)
        })
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        // Signing in or out swaps the whole button, which is a childList change;
        // reacting to it keeps 「未登录」 from waiting behind a name rewrite.
        const signedOutWatcher = new MutationObserver(() => {
          if (timer !== 0) return
          timer = window.setTimeout(() => {
            timer = 0
            markLauncherSeat()
            paintLauncherName()
          }, 120)
        })
        for (const trigger of document.querySelectorAll('[aria-haspopup="menu"]')) {
          signedOutWatcher.observe(trigger, { attributes: true, attributeFilter: ['data-signed-out'] })
        }
        return () => {
          observer.disconnect()
          signedOutWatcher.disconnect()
          if (timer !== 0) window.clearTimeout(timer)
        }
      }, 'account-avatar: launcher name guard')

      accountLabel = readCachedAccountLabel()
      pluginCtx = ctx
      // Seed from the cache so the seat label is right on a cold load.
      launcherName = readNameCache() !== '' ? readNameCache() : accountLabel
      // The launcher may already be mounted; the observer only fires on change.
      // A cold load renders the shell after this bundle applies, so poll briefly.
      // The name is painted right after the seat exists, because the fast path
      // looks the label up from that seat.
      retryLauncherSeat(() => { paintLauncherName() })

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.avatarStudio = ''
        document.head.appendChild(tag)
        paintTag = tag

        setAvatarPaint(readCache(), readShapeCache() ?? 'circle')
        void readInitialState().then((remote) => {
          if (remote === undefined) return
          writeCache(remote.currentImage)
          writeShapeCache(remote.shape)
          setAvatarPaint(remote.currentImage, remote.shape)
          if (remote.displayName !== '') setLauncherName(remote.displayName)
        })

        return () => {
          tag.remove()
          paintTag = null
        }
      }, 'account-avatar: launcher avatar paint')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'account-avatar',
        order: 6,
        label: () => t('sectionLabel'),
        locale: NS,
      }, AvatarSection))
    }
