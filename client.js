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
    const CACHE_KEY = 'dsh.account-avatar.v1'
    const STATE_URL = '/account-avatar/api/state'
    const AVATAR_URL = '/account-avatar/api/avatar'
    const STAGE = 236
    const OUTPUT = 256
    const MAX_FILE_BYTES = 12 * 1024 * 1024

    /** The avatar element the shipped account launcher paints. */
    const AVATAR_SELECTOR = '[data-avatar-status]'

    const dictionaries = {
      zh: {
        sectionLabel: '头像',
        title: '个人头像',
        hint: '左侧栏最下面那个头像，换成你自己的图。只在这台电脑上生效，不影响账号在别处显示的头像。',
        upload: '上传图片',
        replace: '换一张',
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
      },
      en: {
        sectionLabel: 'Avatar',
        title: 'Profile picture',
        hint: 'Replaces the avatar at the bottom of the sidebar with your own picture. Local to this computer; the picture your account shows elsewhere is unchanged.',
        upload: 'Upload picture',
        replace: 'Replace',
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
      },
    }

    const CSS = `
.ast_page{display:flex;flex-direction:column;gap:16px;max-width:640px}
.ast_card{display:flex;align-items:flex-start;gap:16px;padding:16px;border-radius:var(--dsw-radius-md, 10px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ast_preview{position:relative;flex:none;width:72px;height:72px;border-radius:50%;overflow:hidden;background:linear-gradient(140deg, var(--dsw-alias-brand-primary), color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-bg-base)));color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.ast_previewImage{width:100%;height:100%;object-fit:cover;display:block}
.ast_previewGlyph{width:34px;height:34px;display:block}
.ast_body{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.ast_title{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ast_hint{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.ast_status{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ast_actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.ast_button{height:32px;padding:0 14px;border-radius:var(--dsw-radius-md, 10px);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.ast_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent))}
.ast_button:disabled{opacity:.55;cursor:default}
.ast_buttonPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.ast_buttonPrimary:hover:not(:disabled){filter:brightness(1.06)}
.ast_error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.ast_fileInput{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
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

    /** Read the Host copy; `undefined` means the channel is unavailable. */
    async function fetchStoredAvatar() {
      try {
        const response = await fetch(STATE_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
        if (!response.ok) return undefined
        const payload = await response.json()
        if (payload === null || typeof payload !== 'object') return undefined
        return typeof payload.avatar === 'string' && payload.avatar.startsWith('data:image/') ? payload.avatar : null
      } catch {
        return undefined
      }
    }

    /** Write the Host copy; false means this browser keeps the avatar alone. */
    async function storeAvatar(avatar) {
      try {
        const response = await fetch(AVATAR_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ avatar }),
        })
        return response.ok
      } catch {
        return false
      }
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
      const [avatar, setAvatar] = useState(() => readCache())
      const [draft, setDraft] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const inputRef = useRef(null)

      useEffect(() => {
        let live = true
        void fetchStoredAvatar().then((stored) => {
          if (!live || stored === undefined) return
          setAvatar(stored)
          writeCache(stored)
          setAvatarPaint(stored)
        })
        return () => { live = false }
      }, [])

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

      const applyAvatar = useCallback(async (next) => {
        setBusy(true)
        setAvatar(next)
        setAvatarPaint(next)
        writeCache(next)
        const stored = await storeAvatar(next)
        setBusy(false)
        setDraft(null)
        if (!stored) setError(tr('saveFailed'))
      }, [tr])

      const resetAvatar = useCallback(() => {
        setError(null)
        void applyAvatar(null)
      }, [applyAvatar])

      const portalize = (node) => (createPortal === null ? node : createPortal(node, document.body))

      return h(React.Fragment, null,
        h('style', { 'data-ast-style': '' }, CSS),
        h('div', { className: 'ast_page' },
          h('div', { className: 'ast_card' },
            h('div', { className: 'ast_preview' },
              avatar === null ? PersonGlyph : h('img', { className: 'ast_previewImage', src: avatar, alt: '', draggable: false }),
            ),
            h('div', { className: 'ast_body' },
              h('h3', { className: 'ast_title' }, tr('title')),
              h('p', { className: 'ast_hint' }, tr('hint')),
              h('p', { className: 'ast_status' }, avatar === null ? tr('statusDefault') : tr('statusCustom')),
              error === null ? null : h('p', { className: 'ast_error' }, error),
              h('div', { className: 'ast_actions' },
                h('button', {
                  type: 'button',
                  className: 'ast_button ast_buttonPrimary',
                  onClick: () => inputRef.current?.click(),
                  disabled: busy,
                }, avatar === null ? tr('upload') : tr('replace')),
                avatar === null ? null : h('button', {
                  type: 'button',
                  className: 'ast_button',
                  onClick: resetAvatar,
                  disabled: busy,
                }, tr('reset')),
              ),
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
        ),
        draft === null ? null : portalize(h(CropDialog, {
          src: draft.src,
          tr,
          onCancel: () => setDraft(null),
          onSave: applyAvatar,
        })),
      )
    }

    /** The one stylesheet that repaints the shipped launcher avatar. */
    let paintTag = null

    function setAvatarPaint(dataUrl) {
      if (paintTag === null) return
      paintTag.textContent = dataUrl === null || dataUrl === undefined ? '' : [
        `${AVATAR_SELECTOR}{`,
        `background-image:url("${dataUrl}")!important;`,
        'background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;',
        '}',
        `${AVATAR_SELECTOR} > img,${AVATAR_SELECTOR} > svg{display:none!important}`,
      ].join('')
    }

    /** Slot registration and dictionaries; no side effects outside `apply`. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'account-avatar: dictionaries')

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.avatarStudio = ''
        document.head.appendChild(tag)
        paintTag = tag

        const cached = readCache()
        setAvatarPaint(cached)
        void fetchStoredAvatar().then((stored) => {
          if (stored === undefined) return
          writeCache(stored)
          setAvatarPaint(stored)
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