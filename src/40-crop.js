// ═══ 40-crop.js · The crop dialog: drag, zoom, and the canvas write that produces the 256px picture.
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

