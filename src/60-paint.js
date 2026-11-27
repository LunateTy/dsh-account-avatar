// ═══ 60-paint.js · The one stylesheet that repaints the launcher avatar, and the call that applies it.
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

