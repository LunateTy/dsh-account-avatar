# Changelog

Notable changes to this plugin. Versions follow [semantic versioning](https://semver.org/);
while the major version is 0, a minor bump may still change stored data, and those
changes are called out under **Changed**.

## [0.2.0] — 2026-11-27

The first version published to npm. 0.1.0 existed only as a local checkout, so
there is no upgrade path from the registry; this entry records what changed for
anyone who ran the earlier build from source.

### Added

- **History** — the last 100 pictures are kept. Clicking one pre-selects it; the
  sidebar only changes on **Apply**. Past 100, the oldest entry is dropped, never
  the one in use.
- **Bulk actions** — select several pictures and delete them together.
- **Three shapes** — circle, rounded square, square, applied to the sidebar avatar
  and the Settings preview.
- **Custom name** — click the first line in Settings to rename the sidebar label,
  up to 24 characters.
- **Signed-out support** — the plugin inserts its own seat when DSH renders none,
  and the label reads 「未登录」 / "Not signed in".
- **Accounts with no uploaded picture** — DSH omits the `data-avatar-status`
  marker for these, so the plugin tags the seat itself and the replacement works
  there too.
- **Browser-side library** — when the Host's loopback routes are unreachable (the
  desktop shell loads the UI over `dsh-app:`), pictures and names fall back to
  `localStorage` instead of failing.

### Changed

- **Storage layout** — a single `$DSH_HOME/account-avatar/avatar.json` became
  `avatars.json` holding a library. The old file is migrated on first read and
  then removed.
- **Routes** — `GET/POST /account-avatar/api/state|avatar` became
  `/account-avatar/api/state|mutate`, plus `/api/image` for fetching one original.
- **Browser keys** — `dsh.account-avatar.v1` → `.v2`; shape, name and account
  identity each gained their own key.
- **Settings page** — "Upload picture / Replace / Reset to default" became a
  library with pre-select, apply, and history.

### Fixed

- Resizing the window no longer leaves Apply and Upload misaligned when the `@`
  account line is absent.
- Switching accounts no longer keeps the previous account's name in the sidebar;
  identity is cached by masked contact instead of by name alone.

## [0.1.0] — 2026-11-26

Local-only build, never published.

- Replace the sidebar avatar with one uploaded picture: PNG, JPEG, WebP or GIF,
  cropped and zoomed in a dialog, stored as 256×256.
- **Replace** and **Reset to default** in Settings → Avatar.