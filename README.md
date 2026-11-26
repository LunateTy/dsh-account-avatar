# dsh-account-avatar

Replaces the avatar at the bottom of the DeepSeek Harness sidebar with your own picture. Upload it in **Settings → Avatar**, drag and zoom to crop, and it stays there — across reloads, browser restarts and port changes. The account menu is untouched: Settings, feedback, sign-out, notifications and quota notices stay exactly as shipped.

## Why

The sidebar avatar is whatever your DeepSeek account says it is. When you sign in with WeChat, or have WeChat bound to the account, that is your WeChat profile picture — and while the account is signed in through WeChat, the DSH avatar cannot be changed on its own.

DSH has no setting for this: the launcher reads `AccountProfile.avatarUrl`, which is read-only, and the account service exposes no setter. This plugin paints your own image over that element and leaves every other part of the launcher alone.

## Install

```sh
dsh plugin --profile web add dsh-account-avatar
```

Reload the page afterwards.

## Use

1. Settings (`Ctrl+Alt+,`) → **Avatar**.
2. **Upload picture** — PNG, JPEG, WebP or GIF, up to 12 MB.
3. Drag to reposition, scroll or use the slider to zoom.
4. **Save**.

**Replace** swaps the picture; **Reset to default** brings the account picture back.

## Where it is stored

- `$DSH_HOME/account-avatar/avatar.json` — the durable copy. The Host half writes it through `GET/POST /account-avatar/api/state|avatar`, and both routes pass the same `connection.requestRejection` check the shipped loopback routes use.
- `localStorage['dsh.account-avatar.v1']` — a browser-side copy, so the first painted frame already shows your picture instead of flashing the account one.

The stored image is a 256×256 WebP (PNG when the browser cannot encode WebP), usually 20–60 KB. The picture is processed on this machine and never uploaded anywhere.

## Limitations

- The avatar is repainted by one stylesheet keyed on the shipped `[data-avatar-status]` attribute. If a DSH release renames that marker the replacement stops applying — nothing breaks, the account picture simply shows again.
- It applies while signed in, because that element only exists in the signed-in launcher. Signed out, the seat is an ellipsis plus a "More" label; there is no avatar to replace.
- The Host store needs the web GUI's HTTP server. A shell that loads the UI over `file://` falls back to the browser copy only.
- Local personalisation only: your DeepSeek account is never touched, so other people, other browsers and other machines still see the account picture.

## License

MIT