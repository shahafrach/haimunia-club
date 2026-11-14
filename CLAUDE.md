# CLAUDE.md

האימוניה training log (the club app). The live PWA members use every day, served at
haimunia.pages.dev. The backend (Supabase project `hvwakffluwvegedefoth`: migrations,
Edge Functions, RLS, docs) lives in `shahafrach/haimunia-app-demo`; never change it from here. Members' training data lives in IndexedDB on
their phones. Losing or corrupting it is the worst possible failure.

## Stack

- Buildless vanilla JS. No framework, bundler or TypeScript. Do not add one.
- `index.html` loads the scripts in order with `<script defer>`; they share one
  global scope. `src/boot-guard.js`, `src/shared/safe-helpers.js`, `app-config.js`, `src/usage.js`,
  `src/constants.js`, `src/format.js`, `src/sanitize.js`, `src/db.js`, `src/connect.js`, `src/club.js`, `src/transfer.js`, `app.js`.
- `sw.js`: service worker. A new file loaded by `index.html` must be added to
  `REQUIRED_ASSETS` or `OPTIONAL_ASSETS`.
- CSP in `index.html` allows only the app's own origin, the Supabase host and Turnstile (script and frame). No
  inline scripts.
- `_headers` (Cloudflare Pages) sends the same CSP as a real header, plus `frame-ancestors`, HSTS, nosniff,
  no-referrer, Permissions-Policy, COOP, and `no-cache` for `/`, `/index.html`, `/sw.js`. Change the
  `<meta>` CSP and `_headers` together; `test/headers.test.mjs` fails if they drift.
- `functions/_middleware.js` answers 404 for `test/`, `scripts/`, `package*.json`, top-level `.md`/`.sql`/`.mjs` and
  similar (the repo root is the site). A new top-level file is served unless blocked there;
  `test/middleware.test.mjs` forces that to be a decision.
- `package.json` is dev-only (tests, version sync). Nothing from it ships.

## Design tokens

- Every color lives in one place: `<style id="tokens">` in `index.html`. Primitives are named by value
  (`--p-*`), and semantic tokens sit on `:root` (light) and `:root[data-scheme="dark"]` (dark).
- Outside that block (other CSS, inline `style`, `app.js`, `src/*.js`) only `var(--...)`, never a hex,
  `rgb()`, `hsl()`, `white` or `black`. `test/design-tokens.test.mjs` fails on one, and checks text
  contrast (4.5:1) in both schemes.
- Rules key on `data-scheme` (the resolved light/dark, stamped by `theme-init.js` and
  `applyThemePref()`), never on `data-theme` (the choice) or `prefers-color-scheme`. Dark is written once.

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
  that data. Allowed fields: `device_id`, `event`, `screen`, `app` (always `"club"`).
- Tests and browser checks must never send a real count. Test: `test/usage-counting.test.mjs`.

## Connected mode (src/connect.js)

- Optional. A member chooses at first run to connect with a username or stay offline; opening the app
  never touches the network for an offline device. `vendor/supabase.js` and Turnstile load only on demand.
- Private log stays on the phone. No cloud copy, no email, phone, payment or health data. Body weight
  never leaves the device, except inside the encrypted transfer code (phase 3).
- Always send `app = "club"` where the backend asks (push subscriptions, `notif_list` /
  `notif_unread_count` `p_app`, bug reports).
- The club is joined by one fixed link (`#join=<64 hex>`, read from the fragment only).
- The design is this app's own: reuse its components and tokens, never BOX-LOG's.

## Sibling repo

`shahafrach/haimunia-app-demo` holds the backend and BOX-LOG. Read its `docs/circles/decisions.md`
("Haimunia club") and `docs/club/research.md` before connected-mode work. A fix to shared screens
may belong in both; every PR says whether the sibling needs the same fix.

## Releases

- Bump `APP_VERSION` in `app.js` and `SW_VERSION` in `sw.js` together
  (`npm run sync-version`). Without the SW bump members keep the old version.
- Add a `CHANGES.md` entry at the top: `# <version> — <title> — <YYYY-MM-DD>`.
- `RELEASE_NOTES` in `app.js` (in-app "what's new", Hebrew) gets an entry only
  when the owner asks for one.
- Before merging a release the owner creates `rollback-<current version>` on
  main. Sessions cannot push tags, so put this in the PR for him:

  ```sh
  gh api repos/shahafrach/haimunia-club/git/refs \
    -f ref=refs/tags/rollback-<current version> \
    -f sha=$(gh api repos/shahafrach/haimunia-club/commits/main --jq .sha)
  ```

## Session rules

- One session, one task, one PR. Never merge.
- While working, run only the related test files.
- At the end, one full `npm test` in the foreground.
- No background watchers, sleep loops or polling. Do not re-run a suite that
  passed.
- Short final report.
