/**
 * Browser half of the avatar studio bundle.
 *
 * Adds a "Profile picture" page to Settings and repaints the sidebar account
 * launcher's avatar with the user's own image. The launcher seat itself stays
 * with the shipped account menu; this module only overrides the avatar paint
 * through one scoped stylesheet, so sign-in, notifications and the account
 * menu keep working untouched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-account-avatar',
  factory(require) {
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

    const dictionaries = {
      zh: {
        sectionLabel: '头像',
        title: '个人头像',
        hint: '仅对此设备生效',
        signedOutName: '未登录',
        signedOutHint: '还没登录 DeepSeek，头像先存在本机，登录后自动生效',
        upload: '上传图片',
        replace: '上传',
        reset: '恢复默认',
        statusCustom: '正在用你自己的头像',
        statusDefault: '正在用账号原来的头像',
        pickFailed: '读不出这张图片，换一张试试',
        tooLarge: '图片太大，请选择 12 MB 以内的图片',
        saveFailed: '没写进本地存储，头像只在当前浏览器里有效',
        cropTitle: '调整头像',
        cropHint: '拖动图片调整位置，滚轮或滑块缩放',
        zoom: '缩放',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        shapeTitle: '头像形状',
        shapeCircle: '圆形',
        shapeRounded: '圆角方形',
        shapeSquare: '方形',
        historyTitle: '历史头像',
        historyCount: '已存 {n} / {max}',
        historyEmpty: '还没有历史头像。上传的第一张会出现在这里，最多留 100 张。',
        historyFull: '已存满 100 张，再传会顶掉最旧的那张。',
        useThis: '用这张',
        select: '选择',
        remove: '删除',
        deleteMode: '批量操作',
        selectAll: '全选',
        selectNone: '取消全选',
        deleteSelected: '删除选中',
        cancelSelect: '取消',
        selectedCount: '已选 {n} 个',
        removeFailed: '删除失败，再试一次',
        selectFailed: '切换失败，再试一次',
        shapeFailed: '形状没保存成功',
        stageCaption: '侧栏效果',
        pendingHint: '待应用',
        apply: '应用',
        editName: '点击修改名字',
        saveNameFailed: '名字没保存成功',
        saveNameLocalOnly: '名字已在本机生效，但没同步给后台（重启后可能需要重设）',
        nameConflict: '侧栏名字正被其他插件改写，显示可能不一致',
      },
      en: {
        sectionLabel: 'Avatar',
        title: 'Profile picture',
        hint: 'Applies to this device only.',
        signedOutName: 'Not signed in',
        signedOutHint: 'Not signed in to DeepSeek yet. The picture is kept on this device and shows up once you sign in.',
        upload: 'Upload picture',
        replace: 'Upload',
        reset: 'Reset to default',
        statusCustom: 'Showing your own picture',
        statusDefault: 'Showing the account picture',
        pickFailed: "Couldn't read that image. Try another one.",
        tooLarge: 'That image is larger than 12 MB.',
        saveFailed: 'The local store refused it; the picture lives in this browser only.',
        cropTitle: 'Adjust picture',
        cropHint: 'Drag to reposition. Scroll or use the slider to zoom.',
        zoom: 'Zoom',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        shapeTitle: 'Shape',
        shapeCircle: 'Circle',
        shapeRounded: 'Rounded',
        shapeSquare: 'Square',
        historyTitle: 'History',
        historyCount: '{n} of {max} saved',
        historyEmpty: 'No saved pictures yet. The first one you upload shows up here; up to 100 are kept.',
        historyFull: 'You have 100 saved. The oldest one is dropped when you add another.',
        useThis: 'Use this one',
        select: 'Select',
        remove: 'Remove',
        deleteMode: 'Bulk actions',
        selectAll: 'Select all',
        selectNone: 'Clear selection',
        deleteSelected: 'Delete selected',
        cancelSelect: 'Cancel',
        selectedCount: '{n} selected',
        removeFailed: "Couldn't remove it. Try again.",
        selectFailed: "Couldn't switch. Try again.",
        shapeFailed: "Couldn't save the shape.",
        stageCaption: 'In the sidebar',
        pendingHint: 'not applied yet',
        apply: 'Apply',
        editName: 'Click to rename',
        saveNameFailed: "Couldn't save the name.",
        saveNameLocalOnly: 'The name applies in this browser, but the stored copy did not update; it may reset after a restart.',
        nameConflict: 'Another plugin is rewriting the sidebar name; it may not match.',
      },
    }

    const CSS = `
.ast_page{display:flex;flex-direction:column;gap:16px;max-width:680px}
.ast_card{position:relative;display:flex;align-items:stretch;gap:16px;padding:16px 156px 16px 16px;border-radius:var(--dsw-radius-md, 10px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ast_previewWrap{flex:none;display:flex;flex-direction:column;justify-content:space-between;align-items:center;gap:8px}
.ast_previewWrap .ast_button{width:72px;padding:0}
.ast_stage{position:absolute;top:16px;right:16px;display:flex;flex-direction:column;align-items:center;gap:8px}
.ast_preview{position:relative;flex:none;width:72px;height:72px;overflow:hidden;background:linear-gradient(140deg, var(--dsw-alias-brand-primary), color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-bg-base)));color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.ast_previewImage{width:100%;height:100%;object-fit:cover;display:block}
.ast_previewGlyph{width:34px;height:34px;display:block}
.ast_body{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.ast_title{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ast_name{margin:0;padding:0;border:0;background:transparent;font:inherit;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);text-align:left;cursor:text;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ast_name:hover{color:var(--dsw-alias-brand-primary)}
.ast_nameRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:24px}
.ast_warn{margin:0;display:inline-flex;align-items:center;gap:4px;padding:0 6px;height:18px;border-radius:5px;background:color-mix(in srgb, #d97706 14%, transparent);color:#b45309;font-size:11px;line-height:18px;white-space:nowrap}
.ast_nameInput{width:220px;max-width:100%;height:28px;padding:0 8px;box-sizing:border-box;border-radius:6px;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:22px;font-weight:600;outline:none}
.ast_handle{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ast_hint{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.ast_tag{display:inline-flex;align-items:center;align-self:flex-start;height:20px;padding:0 8px;border-radius:6px;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);color:var(--dsw-alias-brand-primary);font-size:11px;line-height:20px;white-space:nowrap}
.ast_status{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ast_actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:4px}
.ast_button{height:32px;padding:0 14px;border-radius:var(--dsw-radius-md, 10px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.ast_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent))}
.ast_button:disabled{opacity:.55;cursor:default}
.ast_buttonPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.ast_buttonPrimary:hover:not(:disabled){filter:brightness(1.06)}
.ast_error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.ast_fileInput{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ast_block{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:var(--dsw-radius-md, 10px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ast_blockHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.ast_blockTitle{margin:0;font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ast_blockNote{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ast_shapes{display:flex;flex-wrap:wrap;gap:8px}
.ast_shape{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px 0 8px;border-radius:var(--dsw-radius-md, 10px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.ast_shape:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent))}
.ast_shape[data-active=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}
.ast_shape:disabled{opacity:.55;cursor:default}
.ast_shapeSwatch{width:18px;height:18px;flex:none;display:block;background:currentColor;opacity:.75}
.ast_headActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.ast_grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(56px, 1fr));gap:10px}
.ast_slot{position:relative;aspect-ratio:1;display:flex}
.ast_slotFrame{position:relative;width:100%;height:100%;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-skeleton, color-mix(in srgb, currentColor 10%, transparent));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);padding:0;border:0;cursor:pointer;display:block}
.ast_slot[data-active=true] .ast_slotFrame{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary)}
.ast_slot[data-pending=true] .ast_slotFrame{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-2px}
.ast_slot:hover:not(:disabled) .ast_slotFrame{filter:brightness(1.06)}
.ast_slotImage{width:100%;height:100%;object-fit:cover;display:block;background:var(--dsw-alias-bg-skeleton, color-mix(in srgb, currentColor 10%, transparent))}
.ast_slotCheck{position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:50%;border:1.5px solid #fff;background:rgba(0,0,0,.18);color:#fff;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.ast_slot[data-selected=true] .ast_slotCheck{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.ast_slot[data-selected=true] .ast_slotFrame::after{content:'';position:absolute;inset:0;pointer-events:none;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent)}
.ast_overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.44);animation:ast_rise .14s ease-out}
.ast_dialog{width:min(320px, 100%);box-sizing:border-box;padding:18px;display:flex;flex-direction:column;gap:14px;border-radius:16px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 24px 64px rgba(0,0,0,.3);color:var(--dsw-alias-label-primary)}
.ast_dialogTitle{margin:0;font-size:15px;line-height:22px;font-weight:600}
.ast_dialogHint{margin:-8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ast_stageWrap{position:relative;width:${STAGE}px;height:${STAGE}px;margin:0 auto;border-radius:50%;overflow:hidden;background:var(--dsw-alias-bg-skeleton, color-mix(in srgb, currentColor 10%, transparent));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);cursor:grab;touch-action:none}
.ast_stageWrap:active{cursor:grabbing}
.ast_stageImage{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none;pointer-events:none;display:block;will-change:transform}
.ast_zoomRow{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ast_range{flex:1;min-width:0;accent-color:var(--dsw-alias-brand-primary)}
.ast_dialogActions{display:flex;justify-content:flex-end;gap:8px}
@keyframes ast_rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ast_overlay{animation:none}}
`

    /** Element-id-safe translator with a browser-language fallback. */
    function makeTranslator(t) {
      const fallback = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en'
      return (key) => {
        if (typeof t === 'function') {
          try {
            const value = t(key)
            if (typeof value === 'string' && value !== '' && value !== key) return value
          } catch {
            // fall through to the built-in dictionary
          }
        }
        return dictionaries[fallback][key] ?? dictionaries.en[key] ?? key
      }
    }

    /**
     * Resolve the signed-out seat label from the same dictionary the card uses.
     *
     * @param t - the locale binder, or undefined before the slot is registered.
     * @returns the label to paint into the launcher while signed out.
     */
    function resolveSignedOutLabel(t) {
      return makeTranslator(t)('signedOutName')
    }

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

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('read failed'))
        reader.readAsDataURL(file)
      })
    }

    const PersonGlyph = h('svg', {
      viewBox: '0 0 16 16', width: 34, height: 34, fill: 'currentColor', 'aria-hidden': true, className: 'ast_previewGlyph',
    }, [
      h('circle', { key: 'head', cx: 8, cy: 5.7, r: 2.7 }),
      h('path', { key: 'body', d: 'M2.8 14c0-2.9 2.3-4.7 5.2-4.7s5.2 1.8 5.2 4.7z' }),
    ])

    function CropDialog({ src, tr, onCancel, onSave }) {
      const [size, setSize] = useState(null)
      const [zoom, setZoom] = useState(1)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const imageRef = useRef(null)
      const stageRef = useRef(null)
      const dragRef = useRef(null)
      const saveRef = useRef(null)

      const base = size === null ? 1 : Math.max(STAGE / size.width, STAGE / size.height)
      const scale = base * zoom
      const drawWidth = size === null ? STAGE : size.width * scale
      const drawHeight = size === null ? STAGE : size.height * scale
      const limitX = Math.max(0, (drawWidth - STAGE) / 2)
      const limitY = Math.max(0, (drawHeight - STAGE) / 2)
      const panX = clamp(offset.x, -limitX, limitX)
      const panY = clamp(offset.y, -limitY, limitY)

      useEffect(() => {
        saveRef.current?.focus()
      }, [])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onCancel])

      useEffect(() => {
        const stage = stageRef.current
        if (stage === null) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          setZoom((current) => clamp(current * (1 - event.deltaY * 0.0016), 1, 4))
        }
        stage.addEventListener('wheel', onWheel, { passive: false })
        return () => stage.removeEventListener('wheel', onWheel)
      }, [])

      const onPointerDown = (event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        dragRef.current = { x: event.clientX, y: event.clientY, panX, panY }
      }

      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (drag === null || drag === undefined) return
        setOffset({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) })
      }

      const onPointerUp = (event) => {
        dragRef.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }

      const commit = async () => {
        const image = imageRef.current
        if (image === null || size === null || busy) return
        setBusy(true)
        setError(null)
        try {
          const ratio = OUTPUT / STAGE
          const canvas = document.createElement('canvas')
          canvas.width = OUTPUT
          canvas.height = OUTPUT
          const context = canvas.getContext('2d')
          if (context === null) throw new Error('no 2d context')
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          const width = drawWidth * ratio
          const height = drawHeight * ratio
          const left = (STAGE / 2 + panX) * ratio - width / 2
          const top = (STAGE / 2 + panY) * ratio - height / 2
          context.drawImage(image, left, top, width, height)
          let dataUrl = canvas.toDataURL('image/webp', 0.92)
          if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png')
          await onSave(dataUrl)
        } catch {
          setError(tr('saveFailed'))
          setBusy(false)
        }
      }

      return h('div', {
        className: 'ast_overlay',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onCancel()
        },
      },
        h('div', { className: 'ast_dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('cropTitle') },
          h('h2', { className: 'ast_dialogTitle' }, tr('cropTitle')),
          h('p', { className: 'ast_dialogHint' }, tr('cropHint')),
          h('div', {
            ref: stageRef,
            className: 'ast_stageWrap',
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
          },
            h('img', {
              ref: imageRef,
              src,
              alt: '',
              draggable: false,
              className: 'ast_stageImage',
              onLoad: (event) => {
                const node = event.currentTarget
                setSize({ width: node.naturalWidth, height: node.naturalHeight })
              },
              style: {
                width: `${drawWidth}px`,
                height: `${drawHeight}px`,
                transform: `translate(${STAGE / 2 - drawWidth / 2 + panX}px, ${STAGE / 2 - drawHeight / 2 + panY}px)`,
              },
            }),
          ),
          h('div', { className: 'ast_zoomRow' },
            h('span', null, tr('zoom')),
            h('input', {
              className: 'ast_range',
              type: 'range',
              min: 1,
              max: 4,
              step: 0.01,
              value: zoom,
              'aria-label': tr('zoom'),
              onChange: (event) => setZoom(Number(event.currentTarget.value)),
            }),
          ),
          error === null ? null : h('p', { className: 'ast_error' }, error),
          h('div', { className: 'ast_dialogActions' },
            h('button', { type: 'button', className: 'ast_button', onClick: onCancel, disabled: busy }, tr('cancel')),
            h('button', {
              ref: saveRef,
              type: 'button',
              className: 'ast_button ast_buttonPrimary',
              onClick: () => { void commit() },
              disabled: busy || size === null,
            }, busy ? tr('saving') : tr('save')),
          ),
        ),
      )
    }

    function AvatarSection(props) {
      const tr = useMemo(() => makeTranslator(props.t), [props.t])
      const [model, setModel] = useState(() => ({
        shape: readShapeCache() ?? 'circle',
        currentId: null,
        currentImage: readCache(),
        // Seed from this browser's own copy, so a rename survives until the Host
        // answers — and stays even if it never does.
        displayName: readNameCache(),
        count: 0,
        max: 100,
        items: [],
      }))
      const [editing, setEditing] = useState(false)
      const [nameDraft, setNameDraft] = useState('')
      /** The account's own label plus whether it is a real name (not a masked contact). */
      const [handle, setHandle] = useState(() => ({ label: accountLabel, isName: accountLabelIsName }))
      const [conflict, setConflict] = useState(false)
      const [draft, setDraft] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [selecting, setSelecting] = useState(false)
      const [selected, setSelected] = useState([])
      const [pendingId, setPendingId] = useState(null)
      const [pendingImage, setPendingImage] = useState(null)
      const inputRef = useRef(null)

      /** Adopt one Host state everywhere it shows: model, caches, launcher paint. */
      const adopt = useCallback((next) => {
        // The custom name is device-local: a nameless Host state (a fresh store, or
        // routes that never mounted) must not erase what this browser already has.
        const localName = readNameCache()
        const merged = localName !== '' && next.displayName === ''
          ? { ...next, displayName: localName }
          : next
        setModel(merged)
        setPendingId(null)
        setPendingImage(null)
        writeCache(merged.currentImage)
        writeShapeCache(merged.shape)
        setAvatarPaint(merged.currentImage, merged.shape)
        setLauncherName(merged.displayName !== '' ? merged.displayName : accountLabel)
      }, [])

      useEffect(() => {
        let live = true
        void (async () => {
          const remote = await readInitialState()
          if (!live || remote === undefined) return
          adopt(remote)
          // Only the Host library carries stale thumbnails to migrate; the local
          // one is generated by this same browser and is already current.
          if (!(await probeHost())) return
          const migrated = await migrateThumbs(remote)
          if (!live || migrated === remote) return
          adopt(migrated)
        })()
        return () => { live = false }
      }, [adopt])

      // The identity may land after this page mounts, and it changes whenever a
      // different account signs in; follow it instead of sampling once.
      useEffect(() => {
        if (accountLabel !== '') setHandle({ label: accountLabel, isName: accountLabelIsName })
        return subscribeAccount((label, isName) => setHandle({ label, isName }))
      }, [])

      // Surface a warning when another plugin keeps taking the seat label back.
      useEffect(() => {
        if (conflict) return undefined
        const timer = window.setInterval(() => {
          if (launcherConflict) setConflict(true)
        }, 1200)
        return () => window.clearInterval(timer)
      }, [conflict])

      const onFileChange = useCallback(async (event) => {
        const input = event.currentTarget
        const file = input.files?.[0]
        input.value = ''
        if (file === undefined || file === null) return
        setError(null)
        if (!file.type.startsWith('image/')) {
          setError(tr('pickFailed'))
          return
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(tr('tooLarge'))
          return
        }
        try {
          const src = await readFileAsDataUrl(file)
          setDraft({ src })
        } catch {
          setError(tr('pickFailed'))
        }
      }, [tr])

      /** Save the cropped picture as a new library entry and select it. */
      const applyCropped = useCallback(async (dataUrl) => {
        setBusy(true)
        const thumb = await makeThumb(dataUrl, gridBackdrop())
        const result = await mutate('add', { image: dataUrl, thumb: thumb ?? dataUrl })
        setBusy(false)
        setDraft(null)
        if (!result.ok) {
          setError(tr('saveFailed'))
          return
        }
        setError(null)
        adopt(result.state)
      }, [adopt, tr])

      /**
       * Point the sidebar preview at one stored picture without applying it.
       * The launcher and the left preview keep showing the applied picture until
       * the user presses Apply.
       */
      const previewAvatar = useCallback(async (id) => {
        if (busy) return
        if (id === model.currentId) {
          setPendingId(null)
          setPendingImage(null)
          return
        }
        const item = model.items.find((entry) => entry.id === id)
        setPendingId(id)
        setPendingImage(item === undefined ? null : item.thumb)
        const full = await fetchImage(id)
        if (full !== null) setPendingImage(full)
      }, [busy, model.currentId, model.items])

      const applyPending = useCallback(async () => {
        if (busy || pendingId === null || pendingId === model.currentId) return
        setBusy(true)
        const goal = pendingId
        const result = await mutate('select', { id: goal })
        setBusy(false)
        if (!result.ok) {
          setError(tr('selectFailed'))
          return
        }
        setError(null)
        adopt(result.state)
      }, [adopt, busy, model.currentId, pendingId, tr])

      const removeAvatar = useCallback(async (ids) => {
        if (busy || ids.length === 0) return
        setBusy(true)
        const result = await mutate('remove', { ids })
        setBusy(false)
        if (!result.ok) {
          setError(tr('removeFailed'))
          return
        }
        setError(null)
        adopt(result.state)
        setSelected([])
        if (result.state.items.length === 0) setSelecting(false)
      }, [adopt, busy, tr])

      const toggleSelected = useCallback((id) => {
        setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
      }, [])

      const enterSelect = useCallback(() => {
        setSelected([])
        setSelecting(true)
      }, [])

      const exitSelect = useCallback(() => {
        setSelected([])
        setSelecting(false)
      }, [])

      const toggleAll = useCallback(() => {
        setSelected((current) => (current.length === model.items.length ? [] : model.items.map((item) => item.id)))
      }, [model.items])

      /**
       * Persist the custom name.
       *
       * The name is device-local by design — it never leaves this browser — so the
       * local write is the authoritative one and the Host copy is a best-effort
       * mirror that keeps a reload in step. Requiring the Host round trip first
       * turned a working rename into "could not save" whenever the loopback
       * routes were not mounted, which says nothing about whether the name stuck.
       */
      const commitName = useCallback(async () => {
        if (!editing) return
        const next = nameDraft.trim().slice(0, MAX_NAME_CHARS)
        setEditing(false)
        if (next === model.displayName) return

        setModel((current) => ({ ...current, displayName: next }))
        const fallback = next !== '' ? next : accountLabel
        setLauncherName(fallback)
        if (next === '' && launcherSignedOut()) paintLauncherName()

        // Refresh the name the launcher shows, then mirror to the Host silently.
        paintLauncherName()
        const result = await mutate('name', { name: next })
        // A rejected mirror is reported, but the value above already took effect in
        // this browser; nothing the user typed is lost.
        setError(result.ok ? null : tr('saveNameLocalOnly'))
      }, [editing, model.displayName, nameDraft, tr, accountLabel])

      const changeShape = useCallback(async (shape) => {
        const previous = model.shape
        if (previous === shape) return
        setModel((current) => ({ ...current, shape }))
        setAvatarPaint(model.currentImage, shape)
        setBusy(true)
        const result = await mutate('shape', { shape })
        setBusy(false)
        if (!result.ok) {
          setModel((current) => ({ ...current, shape: previous }))
          setAvatarPaint(model.currentImage, previous)
          setError(tr('shapeFailed'))
          return
        }
        setError(null)
        writeShapeCache(shape)
        setModel((current) => ({ ...current, shape: result.state.shape }))
      }, [model.currentImage, model.shape, tr])

      const resetAvatar = useCallback(async () => {
        setBusy(true)
        const result = await mutate('reset')
        setBusy(false)
        if (!result.ok) {
          setError(tr('saveFailed'))
          return
        }
        setError(null)
        adopt(result.state)
      }, [adopt, tr])

      const portalize = (node) => (createPortal === null ? node : createPortal(node, document.body))
      const countText = tr('historyCount').replace('{n}', String(model.count)).replace('{max}', String(model.max))
      /**
       * The card's first line, until the user types their own.
       *
       * Signed out there is no account to name; a phone-only account has no
       * Platform name either, so its label is the masked contact. Showing that
       * masked contact as `@1XX******XX` would be noise, not an identity, and the
       * line is skipped for both of those cases below.
       */
      const signedOut = handle.label === ''
      const effectiveName = model.displayName !== '' ? model.displayName
        : (handle.label !== '' ? handle.label : tr('signedOutName'))
      /** The preview shows the picked-but-unapplied picture, else the applied one. */
      const stageImage = pendingImage ?? model.currentImage
      const hasPending = pendingId !== null && pendingId !== model.currentId
      const stageCaption = hasPending ? `${tr('stageCaption')} · ${tr('pendingHint')}` : tr('stageCaption')

      return h(React.Fragment, null,
        h('style', { 'data-ast-style': '' }, CSS),
        h('div', { className: 'ast_page' },
          h('div', { className: 'ast_card' },
            h('div', { className: 'ast_previewWrap' },
              h('div', {
                className: 'ast_preview',
                style: { width: 72, height: 72, flex: 'none', overflow: 'hidden', borderRadius: SHAPE_RADIUS[model.shape] },
              },
                model.currentImage === null ? PersonGlyph : h('img', { className: 'ast_previewImage', src: model.currentImage, alt: '', draggable: false }),
              ),
              h('button', {
                type: 'button',
                className: 'ast_button ast_buttonPrimary',
                onClick: () => { void applyPending() },
                disabled: busy || pendingId === null || pendingId === model.currentId,
              }, tr('apply')),
            ),
            h('div', { className: 'ast_body' },
              h('div', { className: 'ast_nameRow' },
                editing
                  ? h('input', {
                  className: 'ast_nameInput',
                  value: nameDraft,
                  maxLength: MAX_NAME_CHARS,
                  placeholder: effectiveName,
                  autoFocus: true,
                  onChange: (event) => setNameDraft(event.currentTarget.value),
                  onBlur: () => { void commitName() },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setNameDraft(model.displayName)
                      setEditing(false)
                    }
                  },
                })
                : h('button', {
                  type: 'button',
                  className: 'ast_name',
                  title: tr('editName'),
                  onClick: () => {
                    setNameDraft(model.displayName)
                    setEditing(true)
                  },
                }, effectiveName),
                conflict ? h('span', { className: 'ast_warn', title: tr('nameConflict') }, `⚠ ${tr('nameConflict')}`) : null,
              ),
              handle.label === '' || !handle.isName ? null : h('p', { className: 'ast_handle' }, `@${handle.label}`),
              h('span', { className: 'ast_tag' }, tr('hint')),
              signedOut ? h('p', { className: 'ast_status' }, tr('signedOutHint')) : null,
              error === null ? null : h('p', { className: 'ast_error' }, error),
              h('div', { className: 'ast_actions' },
                h('button', {
                  type: 'button',
                  className: 'ast_button ast_buttonPrimary',
                  onClick: () => inputRef.current?.click(),
                  disabled: busy,
                }, model.currentImage === null ? tr('upload') : tr('replace')),
                model.currentImage === null ? null : h('button', {
                  type: 'button',
                  className: 'ast_button',
                  onClick: () => { void resetAvatar() },
                  disabled: busy,
                }, tr('reset')),
              ),
            ),
            h('div', {
              className: 'ast_stage',
            },
              h('div', {
                className: 'ast_stageAvatar',
                style: {
                  width: 96,
                  height: 96,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: SHAPE_RADIUS_PX[model.shape],
                  backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)',
                  backgroundImage: stageImage === null ? undefined : `url("${stageImage}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  color: '#fff',
                },
              }, stageImage === null ? PersonGlyph : null),
              h('p', {
                className: 'ast_stageCaption',
                style: { margin: 0, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
              }, stageCaption),
            ),
            h('input', {
              ref: inputRef,
              className: 'ast_fileInput',
              type: 'file',
              accept: 'image/*',
              tabIndex: -1,
              'aria-hidden': true,
              onChange: (event) => { void onFileChange(event) },
            }),
          ),
          h('div', { className: 'ast_block' },
            h('div', { className: 'ast_blockHead' },
              h('h4', { className: 'ast_blockTitle' }, tr('shapeTitle')),
            ),
            h('div', { className: 'ast_shapes' },
              SHAPE_ORDER.map((shape) => h('button', {
                key: shape,
                type: 'button',
                className: 'ast_shape',
                'data-active': model.shape === shape,
                'aria-pressed': model.shape === shape,
                disabled: busy,
                onClick: () => { void changeShape(shape) },
              },
                h('span', {
                  className: 'ast_shapeSwatch',
                  'aria-hidden': true,
                  style: { borderRadius: SHAPE_RADIUS[shape] },
                }),
                tr(`shape${shape.charAt(0).toUpperCase()}${shape.slice(1)}`),
              )),
            ),
          ),
          h('div', { className: 'ast_block' },
            h('div', { className: 'ast_blockHead' },
              h('h4', { className: 'ast_blockTitle' }, tr('historyTitle')),
              h('div', { className: 'ast_headActions' },
                selecting ? null : h('p', { className: 'ast_blockNote' }, countText),
                selecting
                  ? h('button', {
                    type: 'button',
                    className: 'ast_button',
                    onClick: toggleAll,
                    disabled: busy || model.items.length === 0,
                  }, selected.length === model.items.length && model.items.length > 0 ? tr('selectNone') : tr('selectAll'))
                  : null,
                selecting
                  ? h('button', {
                    type: 'button',
                    className: 'ast_button ast_buttonPrimary',
                    onClick: () => { void removeAvatar(selected) },
                    disabled: busy || selected.length === 0,
                  }, selected.length === 0 ? tr('deleteSelected') : `${tr('deleteSelected')} (${selected.length})`)
                  : null,
                selecting
                  ? h('button', {
                    type: 'button',
                    className: 'ast_button',
                    onClick: exitSelect,
                    disabled: busy,
                  }, tr('cancelSelect'))
                  : h('button', {
                    type: 'button',
                    className: 'ast_button',
                    onClick: enterSelect,
                    disabled: busy || model.items.length === 0,
                  }, tr('deleteMode')),
              ),
            ),
            model.items.length === 0
              ? h('p', { className: 'ast_blockNote' }, tr('historyEmpty'))
              : h('div', { className: 'ast_grid' },
                model.items.map((item) => h('div', {
                  key: item.id,
                  className: 'ast_slot',
                  'data-active': item.id === model.currentId,
                  'data-pending': !selecting && item.id === pendingId && item.id !== model.currentId,
                  'data-selected': selected.includes(item.id),
                },
                  h('button', {
                    type: 'button',
                    className: 'ast_slotFrame',
                    title: selecting ? tr('select') : tr('useThis'),
                    'aria-label': selecting ? tr('select') : tr('useThis'),
                    'aria-pressed': selecting ? selected.includes(item.id) : undefined,
                    disabled: busy,
                    onClick: () => {
                      if (selecting) toggleSelected(item.id)
                      else void previewAvatar(item.id)
                    },
                  },
                    h('img', { className: 'ast_slotImage', src: item.thumb, alt: '', draggable: false }),
                    selecting ? h('span', { className: 'ast_slotCheck' }, selected.includes(item.id) ? '✓' : '') : null,
                  ),
                )),
              ),
          ),
        ),
        draft === null ? null : portalize(h(CropDialog, {
          src: draft.src,
          tr,
          onCancel: () => setDraft(null),
          onSave: applyCropped,
        })),
      )
    }

    /** The one stylesheet that repaints the shipped launcher avatar. */
    let paintTag = null

    /** Repaint the launcher: the picture itself plus the shared corner radius. */
    function setAvatarPaint(image, shape) {
      if (paintTag === null) return
      const radius = SHAPE_RADIUS[SHAPE_ORDER.includes(shape) ? shape : 'circle']
      const rules = [`:root{--ast-radius:${radius}}`]
      if (typeof image === 'string' && image.startsWith('data:image/')) {
        rules.push([
          `${AVATAR_SELECTOR}{`,
          `background-image:url("${image}")!important;`,
          'background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;',
          `border-radius:${radius}!important;`,
          '}',
        ].join(''))
        rules.push(`${AVATAR_SELECTOR} > img,${AVATAR_SELECTOR} > svg{display:none!important}`)
      } else {
        rules.push(`${AVATAR_SELECTOR}{border-radius:${radius}!important}`)
      }
      paintTag.textContent = rules.join('')
    }

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

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})