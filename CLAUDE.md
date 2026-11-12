# CLAUDE.md

האימוניה training log. The live PWA members use every day, served at
haimuniya.github.io/haimunia-app/. Members' training data lives in IndexedDB on
their phones. Losing or corrupting it is the worst possible failure.

## Stack

- Buildless vanilla JS. No framework, bundler or TypeScript. Do not add one.
- `index.html` loads the scripts in order with `<script defer>`; they share one
  global scope. `src/shared/safe-helpers.js`, `app-config.js`, `src/usage.js`,
  `src/constants.js`, `src/format.js`, `src/sanitize.js`, `src/db.js`, `app.js`.
- `sw.js`: service worker. A new file loaded by `index.html` must be added to
  `REQUIRED_ASSETS` or `OPTIONAL_ASSETS`.
- CSP in `index.html` allows only the app's own origin plus the usage host. No
  inline scripts.
- `package.json` is dev-only (tests, version sync). Nothing from it ships.

## Commands

```sh
npm install
node --test test/<file>.test.mjs   # one test file
npm test                           # full suite (node --test)
npm run sync-version               # copy APP_VERSION into SW_VERSION
npm run check-version              # fail if they differ
```

Real-Chromium checks (on demand only): `scripts/browser-check/`,
`node scripts/browser-check/<check>.mjs`. Use Chromium at
`/opt/pw-browsers/chromium`; do not run `playwright install`.

Tests boot the real `index.html` in jsdom with fake-indexeddb via
`test/helpers/boot.mjs`. Fixtures: `test/fixtures/`.

## Member data (IndexedDB)

- `src/db.js`: `box-log-db` at version 7, eight stores. The name, version and
  stores are 2.x's own; `test/storage-compat.test.mjs` asserts them.
- Settings and localStorage keys keep their 2.x names (`haimunia:*`,
  `boxlog:lastExportAt`, `sessionNote:<date>`).
- `haimunia:schemaEdition` (app.js `EDITION_KEY`) marks the data edition.
- Never change the IndexedDB schema or stored data shape without a migration
  path for existing members and a test that upgrades old data
  (see `test/upgrade-in-place.test.mjs`, `test/fixtures/v2.34.0-device.json`).
- Imports of old backups must keep working (`test/old-app-backup-imports.test.mjs`).

## Usage counting

- `src/usage.js` sends pseudonymous counts to the `training_log_usage` table
  (Supabase, config in `app-config.js`).
- Never add names, emails, free text or anything that identifies a member to
  that data. Allowed fields: `device_id`, `event`, `screen`.
- Tests and browser checks must never send a real count. Test: `test/usage-counting.test.mjs`.

## Sibling repo

`haimuniya/haimunia-app-demo` is the community edition. A fix to shared screens
usually belongs in both. Every PR says whether the sibling needs the same fix.

## Releases

- Bump `APP_VERSION` in `app.js` and `SW_VERSION` in `sw.js` together
  (`npm run sync-version`). Without the SW bump members keep the old version.
- Add a `CHANGES.md` entry at the top: `# <version> — <title> — <YYYY-MM-DD>`.
- `RELEASE_NOTES` in `app.js` (in-app "what's new", Hebrew) gets an entry only
  when the owner asks for one.
- Before merging a release the owner creates `rollback-<current version>` on
  main. Sessions cannot push tags, so put this in the PR for him:

  ```sh
  gh api repos/haimuniya/haimunia-app/git/refs \
    -f ref=refs/tags/rollback-<current version> \
    -f sha=$(gh api repos/haimuniya/haimunia-app/commits/main --jq .sha)
  ```

## Session rules

- One session, one task, one PR. Never merge.
- While working, run only the related test files.
- At the end, one full `npm test` in the foreground.
- No background watchers, sleep loops or polling. Do not re-run a suite that
  passed.
- Short final report.
