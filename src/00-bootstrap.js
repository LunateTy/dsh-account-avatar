// ═══ 00-bootstrap.js · React handles, module constants and the mutable state they describe.
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (typeof reactDom?.createPortal === 'function') createPortal = reactDom.createPortal
    } catch {
      createPortal = null
    }

    const NS = 'account-avatar'
    const CACHE_KEY = 'dsh.account-avatar.v2'
    const SHAPE_KEY = 'dsh.account-avatar.shape.v2'
    const STATE_URL = '/account-avatar/api/state'
    const MUTATE_URL = '/account-avatar/api/mutate'
    const IMAGE_URL = '/account-avatar/api/image'
    const THUMB_VERSION = 2
    const STAGE = 236
    const OUTPUT = 256
    const THUMB = 96
    const MAX_FILE_BYTES = 12 * 1024 * 1024
    /**
     * Largest stored data URL accepted from storage.
     *
     * Matches the Host's own cap. A 256×256 WebP at quality 0.92 lands in the
     * tens of kilobytes, so this only ever rejects a value something else wrote.
     */
    const MAX_IMAGE_CHARS = 2 * 1024 * 1024
    const MAX_NAME_CHARS = 24

    /** The signed-in account's label, shown as `@handle` under the custom name. */
    let accountLabel = ''
    /**
     * Whether `accountLabel` is a real Platform display name.
     *
     * A phone-only account has no identity profile, so its label is the masked
     * contact — that reads as `1XX******XX`, which is nobody's handle.
     */
    let accountLabelIsName = false
    /** Kept so the settings page can look the account up on the client side. */
    let pluginCtx = null
    /**
     * Cached account identity: `{ name, contact }`.
     *
     * The name alone cannot survive a sign-out and a different sign-in — the old
     * value would keep rendering as `@handle` forever. The masked contact is the
     * cheap fingerprint that tells the two apart.
     */
    const ACCOUNT_KEY = 'dsh.account-avatar.account.v2'
    /** The first version stored the bare name string under this key. */
    const LEGACY_ACCOUNT_KEY = 'dsh.account-avatar.account.v1'
    /** Anything longer is a status line or a sentence, not an account name. */
    const MAX_ACCOUNT_CHARS = 32
    /** Listeners waiting for the account name to change (the Settings card's @line). */
    const accountListeners = new Set()
    /** Cached custom name, so the launcher shows it before Settings is ever opened. */
    const NAME_KEY = 'dsh.account-avatar.name.v1'
    /** The name painted into the launcher seat, kept in sync with the settings card. */
    let launcherName = ''
    /**
     * The seat label while signed out.
     *
     * Read from the same dictionary the Settings card uses, resolved against the
     * browser language, so the sidebar and the card never disagree about the
     * wording. Set once the dictionaries exist; `paintLauncherName` is only ever
     * called after that.
     */
    let signedOutLabel = ''
    /** Set when the seat label keeps getting rewritten by another plugin. */
    let launcherConflict = false
    let repaintHits = 0
    let repaintLastAt = 0

