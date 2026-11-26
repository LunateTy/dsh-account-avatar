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

    /** The signed-in account's own name, shown as @handle under the custom name. */
    let accountLabel = ''
    /** Kept so the settings page can look the account up on the client side. */
    let pluginCtx = null
    /** Cached DeepSeek account name, learned from the settings account panel. */
    const ACCOUNT_KEY = 'dsh.account-avatar.account.v1'
    /** Cached custom name, so the launcher shows it before Settings is ever opened. */
    const NAME_KEY = 'dsh.account-avatar.name.v1'
    /** The name painted into the launcher seat, kept in sync with the settings card. */
    let launcherName = ''
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

    /** Replace the text next to the sidebar avatar with the custom name. */
    function paintLauncherName() {
      if (launcherName === '') return
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
              if (node.textContent !== launcherName) {
                noteRepaint()
                node.textContent = launcherName
              }
              return
            }
            if (texts.length > 4) break
            scope = scope.parentElement
          }
        }

        // Fallback: the seat label still reads as the account name, and it sits in
        // the bottom strip of the window. Replace that one.
        const source = accountLabel !== '' ? accountLabel : readCachedAccount()
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
          node.textContent = launcherName
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
      if (next !== '') paintLauncherName()
    }

    /** Percent radii keep the launcher (24px) and the preview (72px) visually consistent. */
    const SHAPE_RADIUS = { circle: '50%', rounded: '26%', square: '10%' }
    /** Pixel radii for the fixed 96px sidebar preview. */
    const SHAPE_RADIUS_PX = { circle: '48px', rounded: '25px', square: '10px' }
    const SHAPE_ORDER = ['circle', 'rounded', 'square']

    /** The avatar element the shipped account launcher paints. */
    const AVATAR_SELECTOR = '[data-avatar-status]'

    const dictionaries = {
      zh: {
        sectionLabel: '头像',
        title: '个人头像',
        hint: '仅对此设备生效',
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
        nameConflict: '侧栏名字正被其他插件改写，显示可能不一致',
      },
      en: {
        sectionLabel: 'Avatar',
        title: 'Profile picture',
        hint: 'Applies to this device only.',
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
.ast_actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
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

    /** Apply one mutation on the Host and get the new state back. */
    async function mutate(op, payload = {}) {
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
        displayName: '',
        count: 0,
        max: 100,
        items: [],
      }))
      const [editing, setEditing] = useState(false)
      const [nameDraft, setNameDraft] = useState('')
      const [handle, setHandle] = useState(() => accountLabel)
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
        setModel(next)
        setPendingId(null)
        setPendingImage(null)
        writeCache(next.currentImage)
        writeShapeCache(next.shape)
        setAvatarPaint(next.currentImage, next.shape)
        setLauncherName(next.displayName !== '' ? next.displayName : accountLabel)
      }, [])

      useEffect(() => {
        let live = true
        void (async () => {
          const remote = await fetchState()
          if (!live || remote === undefined) return
          adopt(remote)
          const migrated = await migrateThumbs(remote)
          if (!live || migrated === remote) return
          adopt(migrated)
        })()
        return () => { live = false }
      }, [adopt])

      // The account panel may render after this page; pick the name up when it does.
      useEffect(() => {
        if (handle !== '') return undefined
        const timer = window.setInterval(() => {
          const next = accountLabel !== '' ? accountLabel : readCachedAccount()
          if (next !== '') {
            setHandle(next)
            window.clearInterval(timer)
          }
        }, 400)
        return () => window.clearInterval(timer)
      }, [handle])

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

      /** Persist the custom name; an empty value falls back to the default label. */
      const commitName = useCallback(async () => {
        if (!editing) return
        const next = nameDraft.trim().slice(0, MAX_NAME_CHARS)
        setEditing(false)
        if (next === model.displayName) return
        const result = await mutate('name', { name: next })
        if (!result.ok) {
          setError(tr('saveNameFailed'))
          return
        }
        setError(null)
        setModel((current) => ({ ...current, displayName: result.state.displayName }))
        setLauncherName(result.state.displayName !== '' ? result.state.displayName : accountLabel)
      }, [editing, model.displayName, nameDraft, tr])

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
      /** Default name is the account handle, until the user types their own. */
      const effectiveName = model.displayName !== '' ? model.displayName : (handle !== '' ? handle : tr('title'))
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
              handle === '' ? null : h('p', { className: 'ast_handle' }, `@${handle}`),
              h('span', { className: 'ast_tag' }, tr('hint')),
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
     * The DeepSeek account name only exists in the settings "account" panel, which
     * renders for a moment when Settings opens. Read it from there, next to the
     * masked phone number, and cache it.
     */
    function scanAccountName() {
      const masked = /^\d{3}\*+\d{2}$/u
      const usable = (text) => text !== '' && text.length <= 24 && !text.includes('*') && !text.includes('@')
      try {
        for (const node of document.querySelectorAll('div, span, p')) {
          if (node.children.length > 0) continue
          const text = (node.textContent ?? '').trim()
          if (!masked.test(text)) continue
          let scope = node.parentElement
          for (let depth = 0; depth < 3 && scope !== null; depth += 1) {
            for (const sibling of scope.children) {
              if (sibling === node) continue
              const candidate = (sibling.textContent ?? '').trim()
              if (usable(candidate)) return candidate
            }
            scope = scope.parentElement
          }
        }
      } catch {
        // fall through
      }
      return ''
    }

    function readCachedAccount() {
      try {
        return window.localStorage.getItem(ACCOUNT_KEY) ?? ''
      } catch {
        return ''
      }
    }

    function writeCachedAccount(name) {
      try {
        window.localStorage.setItem(ACCOUNT_KEY, name)
      } catch {
        // ignore
      }
    }

    /** Watch the DOM until the account panel shows up once, then stop. */
    function watchAccountName() {
      const known = readCachedAccount()
      if (known !== '') {
        accountLabel = known
        return () => undefined
      }
      let done = false
      let last = 0
      const attempt = () => {
        if (done) return
        const now = Date.now()
        if (now - last < 400) return
        last = now
        const name = scanAccountName()
        if (name === '') return
        done = true
        accountLabel = name
        writeCachedAccount(name)
        if (launcherName === '') launcherName = name
        paintLauncherName()
        observer.disconnect()
      }
      const observer = new MutationObserver(attempt)
      observer.observe(document.body, { childList: true, subtree: true })
      attempt()
      return () => observer.disconnect()
    }

    /** Slot registration and dictionaries; no side effects outside `apply`. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'account-avatar: dictionaries')
      ctx.effect(() => watchAccountName(), 'account-avatar: account name watcher')

      // React re-renders the seat with the shipped name; put the custom one back.
      ctx.effect(() => {
        let timer = 0
        const observer = new MutationObserver(() => {
          if (timer !== 0) return
          timer = window.setTimeout(() => {
            timer = 0
            paintLauncherName()
          }, 200)
        })
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        return () => {
          observer.disconnect()
          if (timer !== 0) window.clearTimeout(timer)
        }
      }, 'account-avatar: launcher name guard')

      accountLabel = readCachedAccount()
      pluginCtx = ctx
      // Seed from the cache so the seat label is right on a cold load.
      launcherName = readNameCache() !== '' ? readNameCache() : accountLabel

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.avatarStudio = ''
        document.head.appendChild(tag)
        paintTag = tag

        setAvatarPaint(readCache(), readShapeCache() ?? 'circle')
        void fetchState().then((remote) => {
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

      const t = ctx.locale.bind(NS)
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