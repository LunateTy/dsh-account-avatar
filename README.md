# dsh-account-avatar

Replaces the avatar at the bottom of the DeepSeek Harness sidebar with your own picture — and lets you give yourself a name.

## Why

The sidebar shows whatever your DeepSeek account says. Sign in with WeChat, or bind WeChat to the account, and that is your WeChat profile picture — and while the account is signed in that way, DSH offers no separate avatar setting.

DSH has no setting for this: the seat reads `AccountProfile.avatarUrl`, which is read-only, and the account service exposes no setter. This plugin paints your own picture and name over that one element, on this machine only.

## Install

```sh
dsh plugin --profile web add dsh-account-avatar
```

Until it is published to npm, install straight from a checkout:

```sh
dsh plugin --profile web add /path/to/dsh-account-avatar
```

Reload the page afterwards.

## Use

Open **Settings** (`Ctrl+Alt+,`, or click the sidebar avatar → Settings) → **Avatar**.

### Change the picture

1. **Upload** — PNG, JPEG, WebP or GIF, up to 12 MB
2. Drag to reposition, scroll or use the slider to zoom
3. **Save**

The picture is stored as 256×256 and processed on this machine only.

### History

Every save is kept, up to **100** pictures:

- Click a thumbnail to **pre-select** it: the right-hand preview switches immediately, the left preview and the sidebar do **not** change
- Click **Apply** under the left preview to actually use it
- Solid blue ring = in use, dashed blue ring = pre-selected
- Past 100, the **oldest** entry is dropped; the one in use is never dropped

### Bulk actions

**Bulk actions** in the history header enters selection mode:

- Each thumbnail gets a check circle
- **Select all** / **Delete selected (n)** / **Cancel**
- Deleting the entry in use falls back to the newest remaining one; delete them all and the account picture comes back

### Shape

Three options, applied globally to the sidebar avatar and the right preview (history thumbnails stay rounded squares):

| Shape | Radius |
|---|---|
| Circle | 50% |
| Rounded | 26% |
| Square | 10% |

Circle by default, matching the shipped look.

### Name

The first line is your name — **click it to edit**:

- Defaults to the account name shown after `@` (for example `demo-name`)
- Enter or blur saves, Esc cancels, 24 characters max
- Clearing it falls back to the account name
- The sidebar label follows whatever is shown here

If another plugin (Claude Style, for instance) also rewrites that label, Settings shows an amber warning next to the name and this plugin steps aside instead of fighting — two plugins repainting the same node every 200 ms just makes the text flicker.

## Where it is stored

- `$DSH_HOME/account-avatar/avatars.json` — the whole library (up to 100 pictures). The Host half reads and writes it through `GET/POST /account-avatar/api/state|mutate` plus `GET /account-avatar/api/image`, all passing the same `connection.requestRejection` check the shipped loopback routes use.
- `localStorage['dsh.account-avatar.v2']` — browser copy of the current picture, so the first painted frame is already right.
- `localStorage['dsh.account-avatar.name.v1']` — browser copy of the custom name.
- `localStorage['dsh.avatar-studio.account.v1']` (carried over) — cached account name, learned from the Settings account panel.

Each picture is kept twice: a 256×256 original (for display, usually 20–60 KB) and a 96×96 thumbnail (for the list, about 4 KB), so opening Settings does not pull the whole library. Nothing is uploaded anywhere.

A single-picture `avatar.json` from the first version is migrated into the history on first read.

## Limitations

- The avatar is repainted by one stylesheet keyed on the shipped `[data-avatar-status]` attribute. If a DSH release renames that marker the replacement stops applying — nothing breaks, the account picture simply shows again.
- The name is written into the seat's text node. If the shipped markup changes, or another plugin writes the same node, it falls back to the native name (Settings shows a warning).
- It applies while signed in: signed out, the seat is an ellipsis plus a "More" label, and there is no avatar to replace.
- The Host store needs the web GUI's HTTP server. A shell that loads the UI over `file://` falls back to the browser copy only.
- Local personalisation only: your DeepSeek account is untouched, so other people, browsers and machines still see the account picture and name.

## License

MIT