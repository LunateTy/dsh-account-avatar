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

### Security

From an external review of `29fc3dd`. Three findings, all fixed here.

- **The Host routes failed open.** `rejected()` treated a missing or throwing
  `connection.requestRejection` as permission to continue, and the Host
  webserver calls route handlers without authenticating anything itself — so
  that check was the only barrier. A checker that cannot run now answers **503**
  instead of admitting the request. `test/` covers the library rules; the
  fixtures cover the painting path.
- **Stored pictures were trusted by prefix.** Values read from `localStorage`
  were only checked for `data:image/` before being interpolated into a
  stylesheet, so a value containing a quote could close `url("…")` and append
  rules. Every plugin on this origin shares that storage, so any of them could
  plant one. Values now match the exact base64 character set the Host already
  enforced, in one `isStoredImage` used by the cache, the local library, the
  Host response, and the painting path. `tampered-storage.html` runs the clean
  and hostile cases as a pair, and fails against the unfixed build.
- **The library file inherited the umask.** On a shared Unix host that left
  `avatars.json` at 0644 — readable by other local users. The directory is now
  created `0700` and each write `0600`; because the write replaces the file,
  an existing library is tightened on its next save. Windows ignores these bits
  and uses the user-directory ACL.

## [0.1.0] — 2026-11-26

Local-only build, never published.

- Replace the sidebar avatar with one uploaded picture: PNG, JPEG, WebP or GIF,
  cropped and zoomed in a dialog, stored as 256×256.
- **Replace** and **Reset to default** in Settings → Avatar.