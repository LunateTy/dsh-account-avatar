// ═══ 20-i18n.js · The eight dictionaries, the scoped stylesheet, and the translator that resolves one string.
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

