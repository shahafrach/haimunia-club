# Findings

Codes and severities: STANDARD.md. Checks for Cursor: docs/audit/CURSOR-CHECKS.md.

| ID | Source | Code | Severity | Status | Finding | Evidence | Check |
|----|--------|------|----------|--------|---------|----------|-------|
| F-001 | grok-G3 | DATA-1 | critical (blocks launch) | open | The iOS install banner appears only after the member has logged in a Safari tab and says "so the data won't be deleted", but the installed app has its own storage and opens empty. The entries stay behind in Safari, and the banner says nothing about export or transfer first. Fix plan below. | `app.js:7600-7610` (shown only when `totalLoggedEntries() >= 1`), `index.html:3366-3367`, `src/transfer.js:15` (the repo's own premise: home-screen storage is separate from Safari's) | C4-1 |
| F-002 | grok-G2 | SEC-7 | low | open | Club staff actions (removing a member, deleting or pinning an announcement) leave no audit record. Announcements keep `author_id`, but a removal leaves nothing. The fix belongs in the sibling repo. | sibling `supabase/migrations/202611120001_haimunia_club.sql:305,420,432`; no `admin_actions` in that file | C2-1 |
| F-003 | owner (triage) | SEC-5 | high | open | `docs/` and the root audit files were served from the site root. Blocked in `functions/_middleware.js` on `triage/grok`. Stays open until C3-1 passes on the preview build. Do not merge `triage/grok` before that. | `functions/_middleware.js` `BLOCKED_PREFIXES`; `test/middleware.test.mjs` | C3-1 |

### F-001 fix plan

1. **Banner before install** (`index.html` `#iosInstallBanner`, `app.js` `maybeShowIOSInstallBanner()`): replace "כדי שהנתונים לא יימחקו" with a two-step message. Step one: back up now (a button that runs the existing backup export). Step two: add to the home screen. Say plainly that the installed app starts empty until the backup is imported.
2. **Installed app, first launch, empty log** (`isStandalone()` true and `totalLoggedEntries() === 0`): offer the import before anything else, with two choices. "יש לי קובץ גיבוי" runs the existing backup import. "יש לי קוד העברה" opens the existing transfer screen (`src/transfer.js`, installed-only already).
3. **Constraint:** a transfer code can only be made by the old app. `transfer-put` accepts only `https://haimuniya.github.io` (sibling `supabase/functions/_shared/transfer.mjs:15`). So a member who logged in the club app's own Safari tab moves the data by backup file. To let that tab make a code too, the sibling must accept `haimunia.pages.dev` for put. That is a backend change and the owner's call.
4. **Tests:** a jsdom test for each of steps 1 and 2. Import must stay lossless for old backups (`test/old-app-backup-imports.test.mjs`).
5. **Release:** bump `APP_VERSION` and `SW_VERSION` and add a `CHANGES.md` entry (CLAUDE.md, Releases).

## Triage log

### Paste 1 (2026-11-14): G3 (English and Hebrew copies, merged) and G2

bugs.webkit.org and openpwa.net are blocked by this session's network policy, so no G3 source could be fetched.

**G3: iOS PWA**

| Item | Label | Evidence |
|------|-------|----------|
| WebKit 324094: wedged DB after a dedicated worker ends mid-transaction | not relevant | No Worker in app code (no `new Worker` outside `vendor/`); every transaction runs on the page. |
| WebKit 277615: "Connection to Indexed Database server lost" until reload | unverified (U-1, check C5-1) | Source not fetchable. Code gap confirmed: `src/db.js:53-78` caches one connection in `_dbPromise` with no `onclose` or reopen; `app.js:552-558` shows "השמירה במכשיר נכשלה" without telling the member to reload. Promote to OFF-1/high if the source checks out. |
| WebKit 309251: iOS 26 jetsam with WASM and worker batch writes | not relevant | No WASM and no Worker. |
| Storage eviction under pressure; 7-day rule | already handled | `app.js:8189` `navigator.storage.persist()`; `app.js:552-556` QuotaExceededError message; export reminder `app.js:3187` (`boxlog:lastExportAt`). Server as source of truth: not relevant (by design the private log stays on the phone, CLAUDE.md). |
| Safari and Home Screen storage isolation | applies, F-001 | See F-001. The external source (OpenPWA, U-3, check C5-1) is unverified, but `src/transfer.js:15` states the same behaviour. |
| WebKit 283793: `indexedDB` undefined in a push wakeup | not relevant | `sw.js` has no push or notificationclick handler (`sw.js:83,101,129`: install, activate, fetch only). |
| WebKit 268797: notificationclick not firing; Web Push needs Home Screen | not relevant | No push in this app today (same evidence). Recheck when push with `app = 'club'` lands. |
| WebKit 313800: `visualViewport` short by the status bar in standalone (26.3.1) | unverified (U-2, check C5-1) | Source not fetchable. The app sizes overlays from `visualViewport.height` (`app.js:3841, 6950, 7349`) with `viewport-fit=cover` (`index.html:71`), so if true it would be UX/low (no UX code fits exactly; nearest A11Y-3). |
| No beforeinstallprompt; Share then Add to Home Screen | already handled | `app.js:7588-7610` iOS-only instructions banner; `isStandalone()` `app.js:7494`. |
| SW update lifecycle and stale caches | already handled | `sw.js:97,122` page-controlled SKIP_WAITING; `sw.js:108` old caches deleted on activate; `_headers:25-28` `no-cache` on `/sw.js`. |

**G3: Cloudflare Pages.** The site deploys by Git integration on every push to main (sibling `docs/club/LAUNCH.md:18`), not by Direct Upload.

| Item | Label | Evidence |
|------|-------|----------|
| Dashboard Direct Upload 403 (8000013) | not relevant | Git integration. |
| Stale `_headers` after a Direct Upload, custom domain | not relevant | Git integration; `haimunia.pages.dev` only, no custom domain. |
| Custom domain serves stale content | not relevant | No custom domain. |
| `_redirects` not applied | not relevant | No `_redirects` file. |
| Long `s-maxage` on HTML or SW | already handled | `_headers:21-28` `no-cache` on `/`, `/index.html`, `/sw.js`. |
| `_headers` does not apply to Functions | already handled | `_headers:10`; `functions/_middleware.js:56-58` sets its own headers on its 404. |
| Drag-and-drop does not compile `functions/`; file limits | not relevant | Git integration; the repo is far below 1,000 files. |

**G2: threat model (STRIDE)**

| # | Item | Label | Evidence |
|---|------|-------|----------|
| 1 | Shared project: RLS and SECURITY DEFINER isolation | already handled | sibling `202611120001_haimunia_club.sql:389-396` (`is_circle_member` read policy, aal2 restrictive policy); DEFINER functions use `set search_path = ''` and `auth.uid()`; sibling tests `0113_no_public_function_is_anon_executable`, `0138_circle_leaks`, `0152_haimunia_club`. |
| 2 | Admin role checked only on the client | already handled | `club_announcement_post` checks `is_club_staff` on the server, with a rate limit (sibling `202611120001:399+`); the table is select-only for clients (`:390-391`). |
| 3 | Weak transfer code redemption | already handled | `src/transfer.js:1-13` (104-bit code, key only on the phone); sibling `transfer_take` deletes on take, 24 h expiry, 10 per 15 min per IP, granted only to `service_role` (`202611120001:827`). |
| 4 | Fixed link plus anonymous sign-in abuse | already handled | Turnstile on anonymous sign-in (`src/connect.js:222`); `join_circle` 10 per hour (sibling `202610250004`); 250 cap; staff-only `rotate_club_link`, 5 per day. Anonymous joins are by design (sibling test `0139:189`). |
| 5 | IndexedDB unencrypted; XSS | already handled | `_headers:12` `script-src 'self'` plus Turnstile, no inline script. Encryption at rest is the phone's job: not relevant. |
| 6 | Brevo password reset (token, redirect) | not relevant | The club app has no email (`src/connect.js:11`); recovery is by code. |
| 7 | Headers and middleware coverage | already handled | `_headers`, `functions/_middleware.js`, `test/headers.test.mjs`, `test/middleware.test.mjs`. |
| 8 | Usage counts correlation | already handled | `src/usage.js:73-77`: body is `device_id`, `event`, `app` only, and only the `apikey` header is sent (no user JWT); `test/usage-counting.test.mjs`. |
| 9 | SECURITY DEFINER or anonymous endpoint abuse | duplicate of 1 | Dropped. |
| 10 | Repudiation: no log of staff actions | applies, F-002 | See F-002. |
