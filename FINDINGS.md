# Findings

Consolidated 2026-11-15 from `audit/c1` to `audit/c6` and `audit/pre-merge` (each row once, newest status). 2026-11-18: merged Cursor's `audit/final` (#34, F-025, F-026) and `audit/security` (#35, its F-025..F-027 renumbered F-028..F-030; F-027 is unused).

Codes and severities: STANDARD.md. Checks for Cursor: docs/audit/CURSOR-CHECKS.md.

| ID | Source | Code | Severity | Status | Finding | Evidence | Check |
|----|--------|------|----------|--------|---------|----------|-------|
| F-001 | grok-G3 | DATA-1 | critical (blocks launch) | fixed: https://github.com/shahafrach/haimunia-club/pull/11, https://github.com/shahafrach/haimunia-app-demo/pull/170 (C4-3 pass 2026-11-14; C4-1 code review still for Cursor; C4-2 needs a real iPhone) | The iOS install banner appears only after the member has logged in a Safari tab and says "so the data won't be deleted", but the installed app has its own storage and opens empty. The entries stay behind in Safari, and the banner says nothing about export or transfer first. Fix plan below. Owners: app part here, backend part (step 3) in `shahafrach/haimunia-app-demo`. | `app.js:7600-7610` (shown only when `totalLoggedEntries() >= 1`), `index.html:3366-3367`, `src/transfer.js:15` (the repo's own premise: home-screen storage is separate from Safari's) | C4-1, C4-2, C4-3 |
| F-002 | grok-G2 | SEC-7 | low | fixed: https://github.com/shahafrach/haimunia-app-demo/pull/170; C2-1 verified 2026-11-14 on `audit/c2` (local `supabase test db`, `0155` + `0157`) | Club staff actions (removing a member, deleting or pinning an announcement) leave no audit record. Announcements keep `author_id`, but a removal leaves nothing. The fix belongs in the sibling repo. | sibling `202611140001_club_staff_audit.sql` (`club_staff_log` from `remove_member`, `club_announcement_delete`, `club_announcement_set_pinned`) | C2-1 |
| F-003 | owner (triage) | SEC-5 | high | fixed: `triage/grok`; C3-1 PASS 2026-11-14 on `https://haimunia.pages.dev` (all six paths 404) | `docs/` and the root audit files were served from the site root. Blocked in `functions/_middleware.js` (on main). C3-1 pass closes F-003. | `functions/_middleware.js` `BLOCKED_PREFIXES`; live curl 404 for `/docs/audit/CURSOR-CHECKS.md`, `/docs/`, `/FINDINGS.md`, `/STANDARD.md`, `/CLAUDE.md`, `/CHANGES.md`; `test/middleware.test.mjs` | C3-1 |
| F-004 | owner (CI) | OPS | low | fix merged with haimunia-app-demo #173 (bound 200 to 190 ms); close after a few green CI runs | `test/waitfor-helper.test.mjs` "THE ORDERING THAT MAKES A LATE POLL SAFE" is flaky in CI: it failed once on haimunia-app-demo PR #170 (commit 9fe84d0, assertion "and this really did poll after the deadline, not before it") and passed on the run before and locally. Timing-dependent. No fix now. | sibling `test/waitfor-helper.test.mjs:43`; CI run on 9fe84d0, job node-tests | none |
| F-005 | cursor-C2 | PERF-1 | medium | fixed 2026-11-16: demo #172 merged (f868484) after a green backup-database run; migration-status green (run 7) | Many public RLS policies call `auth.uid()` / `aal_satisfied()` per row (splinter `0003_auth_rls_initplan`, WARN). Not a confidentiality break; hurts plan caching at scale. Prefer `(select auth.uid())` form. | Local splinter run 2026-11-14 on `audit/c2`; policies on `private_records`, `workout_posts`, `profiles`, `notifications`, … | C2 |
| F-006 | cursor-C2 | OPS | low | open | `supabase/tests/0153_club_load_test.sql` test 12 ("the feed page uses workout_posts_circle_feed_idx") is flaky on local `supabase test db` (passed once, failed once). EXPLAIN-sensitive. | Local runs on `audit/c2` 2026-11-14 | C2 |
| F-007 | cursor-C3 | SEC-4 | low | accepted as low (owner, 2026-11-16): the allowance is for style attributes only; there is no inline script and script-src has no 'unsafe-inline', so no script-injection path exists; member text is escaped before it reaches the page (test/app-innerhtml-sinks.test.mjs). Not a launch gate | CSP allows `style-src 'unsafe-inline'` for dynamic `style=""` attributes (documented; no inline scripts). Style injection remains possible if unsanitized markup ever reaches the DOM. | `_headers:13`, `index.html:50`, `test/headers.test.mjs` (inline only on `style-src`) | C3 |
| F-008 | cursor-C3 | SEC-4 | high | fixed, live Turnstile check pending: haimunia-app-demo #171 (af491fe), full header CSP incl. Turnstile in connect-src (2690444); lead verified the merge in real Chromium (boot-smoke 6/6, founder-link 23/23, circles-client 78/78, frame-guard 4/4); owner check of live sign-up loading Turnstile (from a computer) still pending. Site still shuts down 2026-12-15, then remove it and its Pages project | Legacy sibling site `https://box-log.pages.dev` serves a sparse CSP: live `Content-Security-Policy` is only `frame-ancestors 'none'`, not the full policy the club app uses. | `curl -sI https://box-log.pages.dev/` 2026-11-14 | C3 |
| F-009 | cursor-C3 | SEC-6 | high | fixed: `findings/consolidated` (`npm audit fix`: lockfile only, `npm audit` 0 vulnerabilities) | `npm audit` reports 2 high-severity issues in dev dependencies (`source-map-js`, `undici`). Nothing from `package.json` ships to members; CI and local test runs still pull them. | `npm audit` 2026-11-14 on `audit/c3`; `package.json` dev-only | C3 |
| F-010 | cursor-C5 | OFF-1 | high | fixed: `findings/consolidated` (`src/db.js` `withReopen`, `onclose`; `test/db-connection-reopen.test.mjs`) | WebKit bug 277615: IndexedDB connection can be lost until a full reload. The app caches one DB connection in `src/db.js` with no `onclose` handler or reopen path; the save error does not tell the member to reload. | `src/db.js:53-78` (`_dbPromise`, no `onclose`); `app.js:552-558`; WebKit 277615 confirmed (was U-1) | C5-1 |
| F-011 | cursor-C5 | UX | low | open | WebKit bug 313800 (NEW): `visualViewport` may be short by the status bar in standalone iOS 26.3.1. Overlays sized from `visualViewport.height` could sit under the status bar. | `app.js:3841, 6950, 7349`; `index.html:71` `viewport-fit=cover`; WebKit 313800 (was U-2) | C5-1 |
| F-012 | cursor-C1 | OPS | medium | fixed 2026-11-15: owner created `v3.8.0` and `rollback-3.8.0` at 21bbc7f, `rollback-3.8.1` at 1c73cee, `rollback-3.9.0` at 9ba46bb (lead checked with `git ls-remote --tags`) | No `v3.8.0` git tag on `haimunia-club`; share-preview URL still reports `3.9.0` ahead of production `3.8.0`, so rollback and audit pointers are ambiguous. | `git ls-remote --tags origin v3.8.0` empty 2026-11-14; live `https://haimunia.pages.dev/` APP/SW 3.8.0 | C1 |
| F-013 | cursor-C1 | UX | low | open | WebKit logs a console warning for `interactive-widget=resizes-content` in the viewport meta (harmless elsewhere; noisy in Safari Web Inspector during C1 runs). | `index.html:65,71`; C1 Chromium + WebKit console capture | C1 |
| F-014 | cursor-C4 | OPS | medium | fixed 2026-11-16: club #25 merged (2e8b9e0): synthetic 3-year log, lossless import and re-import, transfer 142,700 bytes, about 7× under 1 MiB | Sibling `haimunia-fixes` 3-year member export is not reachable from this audit session; C4 used `test/fixtures/old-app-backup-v1.json` instead of the longest real export. | fixture path + missing haimunia-fixes access 2026-11-14 | C4 |
| F-015 | lead (verify 3.9.0) | UX | high (blocks 3.9.0) | fixed: PR #12 f4e6dc9 (self-issued history.back() counted, its popstate ignored, 1.5 s limit); lead verified 2026-11-15 in real Chromium. Sibling decision (owner 2026-11-15): not fixed in haimunia-app-demo (BOX-LOG shuts down 2026-12-15) or in haimunia-app (old app, frozen during the move) | After a PR or first-entry card, the "לשתף במועדון?" question can open and close by itself and the workout is recorded as "לא הפעם". Closing the card calls `history.back()` (dialog history layer); the popstate lands after `askClubShare` has opened the question, and the popstate handler closes the dialog now on top. Privacy-safe (nothing is shared) but the member never gets to answer. Same race for any dialog closed right before another opens (e.g. the save-set sanity confirm, then the share question). On main (3.8.1) the layer race exists too (lead, real Chromium, two dialogs opened programmatically one after the other): a dialog opened right after a celebration closes was closed by itself in 3 of 12 runs (celebration then confirm 2/6, celebration then celebration 1/6; confirm then celebration 0/6). Member impact on 3.8.1: a held celebration card shown by flushDeferredCelebration() can vanish; no data is lost. | `app.js` `closeCelebration` (setTimeout 0 to `askClubShare`), `syncAppDialogHistoryState` `history.back()`, popstate handler `dlg.close()`; real Chromium 2 of 3 runs, trace: history.back, askAppConfirm, pushState, popstate | lead browser check (share-per-workout): f4e6dc9 6 runs x 2 card-then-question flows, 0 self-closes; two dialogs in a row 40/40; back press closes a dialog, also 100-1400 ms after a close |
| F-016 | lead (verify 3.10.0) | SEC-2 | high (blocks #173) | fixed: #173 96079bf (aal_satisfied in both deletion paths, pgTAP aal1 cases); lead reviewed 2026-11-15 | `delete_my_account()` does not check `aal_satisfied()`. A password-only (aal1) session of a member with two-step login, which 202611070002 limits to proving the code, can delete the account at once and for good. Twin: `request_account_deletion()` (202610290003) has the same gap and no null-uid check. | sibling `202611150002_usage_180_days_and_delete_my_account.sql` (`delete_my_account`), `202611070002_mfa_aal2.sql` header | pgTAP: aal1 session with a verified factor gets an error and nothing is deleted |
| F-017 | lead (verify 3.10.0) | OPS | high (blocks #173) | fixed: #173 96079bf, CI migration-check green (58 files, 1685 tests) | CI `migration-check` is red: `0157_delete_my_account_test.sql:56` inserts `notifications.club_id`, a column that does not exist, so the file stops after 2 of its tests and none of the delete checks ran. 0135 and 0152 passed. | CI job 132740124247 on 55df825 | CI green on #173 |
| F-018 | lead (G5 check) | UX | medium | fixed: PR #16 c3d7637 (showToast owes its own paint); lead verified 7c52652 in real Chromium, both toasts on screen with no action | When sharing fails (network), the member never sees the message. `src/club.js` `toast()` only queues it (`showToast` stores `pendingToast`; `render()` paints it), and nothing renders before it expires, so "השינוי נשמר בטלפון. המועדון לא התעדכן הפעם." and "השיא נשמר בטלפון. השיתוף במועדון לא הצליח הפעם." are lost unless the member taps something. The workout's answer stays "shared", and the next save of that day posts it. A failed PR card is never retried. Not a data loss: the log is safe. | `src/club.js:44` `toast`, `:400`, `:433`; `app.js` `showToast` (2566); real Chromium on main 9ba46bb: toast queued in `pendingToast`, not on screen within 3 s; next edit of that day posted the workout | lead browser check (share-netfail) |
| F-019 | lead (G5 check) | UX | low | fixed 2026-11-16: shipped in 3.14.0 (club #26, 155e255) | The first-launch "יש לכם כבר נתונים?" sheet shows when the installed app opens with no lifts or WODs and "מתחילים מאפס" was never chosen. It shows again on later launches while that holds, by design ("offered again"). A member who chose "יש לי קוד העברה" or a file, imported nothing and then logged only body weight or measurements sees it on every launch, because `totalLoggedEntries()` counts only entries and WODs. | `app.js` `shouldOfferFirstImport` (2999), `totalLoggedEntries` (1961), `FIRST_IMPORT_KEY` | none |
| F-020 | lead (verify 3.11.0) | DATA-2 | high (blocks 3.11.0) | fixed: PR #20 2747e37 (reloadOnce waits for saves on every path; saves held during the update); lead verified in real Chromium, full npm test 465/0 | The update check can reload the page in the middle of a save. `checkForUpdate()` waits for saves to be idle (`savesIdle()`), then calls `applyUpdate()`. On a page that had no controller at boot (the first launch of a fresh install), the reload comes later, from the `controllerchange` listener or the 4 s backstop `setTimeout(reloadOnce, 4000)`. Neither looks at `savesIdle()` again, so a save started in that window is cut and the set is lost. The normal path (controlled at boot) reloads at once after the idle wait and is safe. | real Chromium on ac7bab1: no controller at boot, a save started right after `applyUpdate()` with `dbPut` held 6 s: one reload, the set lost (`entries=0`); events `applyUpdate`, `put-start`, no `put-done` | lead browser check (update.mjs) |
| F-021 | lead (Q-12 CI sweep) | SEC-3 | medium | fixed 2026-11-16: demo #179 merged (1a06407); comment triggers need OWNER, MEMBER or COLLABORATOR | haimunia-app-demo `claude-review.yml`: the `issue_comment` and `pull_request_review_comment` paths have no `author_association` guard. On a public repo anyone can comment "@claude" on an open same-repo PR; the job then reads `CLAUDE_CODE_OAUTH_TOKEN` with `pull-requests: write` and `id-token: write`. Not confirmed here whether claude-code-action itself refuses actors without write access. The only secret any untrusted trigger can reach. | sibling `.github/workflows/claude-review.yml` job `if:` (main af491fe) | Q-13 |
| F-022 | lead (Q-12 CI sweep) | SEC-6 | low | wontfix while the old app is frozen | haimuniya/haimunia-app `test.yml` uses `actions/checkout@v4` and `actions/setup-node@v4` by tag, not by SHA. It holds no secrets and runs with `contents: read`, so the exposure is a compromised tag running tests. | old app `.github/workflows/test.yml:15-16` | none |
| F-023 | owner (advisor) / lead | OPS | medium | open: owner's set-vault-secrets run (2026-11-16 13:20) did not fix it, the 401s continued; the real fix is QUEUE Q-26 (a dedicated cron secret) | scheduled-job-alert has failed on every run since about 2026-11-13, and it is right. job_health_state lists `edge: notif_push_send` and `edge: purge_abandoned_profiles`. In the last 24 h both Edge Functions answered 401 `{"error":"unauthorized"}` to every cron call (480/480 and 1/1): the Vault secret `edge_functions_service_role_key` that `cron_invoke_edge_function()` sends no longer equals the functions' env `SUPABASE_SERVICE_ROLE_KEY`. Effect: abandoned sign-ups are not purged (a privacy promise), and BOX-LOG push sends fail (the club app has no push). The operator hint points at `scheduled_job_health()`, which cannot see Edge Function answers (Q-24). | read-only SQL 2026-11-16 on job_health_state, edge_function_invocations, net._http_response; sibling `202609230008`, `supabase/functions/{notif_push_send,purge_abandoned_profiles}/index.ts` | Q-23 |
| F-024 | lead (Q-21 live pass) | UX | low | fixed: club #31 a08921e (3.17.1); re-verified audit/final 2026-11-16 (`scripts/browser-check/log-layout-fits.mjs` iPhone 13 profile: steppers/plates/save hit with compact dock) | In the iPhone Safari tab (iPhone 13, 390×664), the two-step iOS install banner covers the layout A steppers and the plate visualizer until it is dismissed; save stays reachable. After dismissing, every control is reachable. | live 3.13.0, real Chromium iPhone 13 profile: elementFromPoint on the steppers returns `#iosInstallBanner` | Q-25 |
| F-025 | cursor-final | OFF-2 | medium | open | On a first visit (no service-worker controller at boot), when a new `sw.js` lands while the page is visible, tapping `#updateBanner` does not reload. `sw.js` calls `skipWaiting()` during `install` (3.7.0/3.7.1 recovery), so the new worker activates and `clients.claim()` fires `controllerchange` before the page sets `swapRequested`. Because `hadControllerAtBoot` is false for that whole first session, `controllerAlreadySwapped` stays false; the tap posts `SKIP_WAITING` to an already-active worker (no-op) and waits for a second `controllerchange` that never comes. Returning sessions (`hadControllerAtBoot` true) reload via the `controllerAlreadySwapped` branch. No training data is lost; the member stays on the old page until a manual refresh. | `sw.js:112` `self.skipWaiting()` on install; `app.js` `applyUpdate` / `controllerchange` (`hadControllerAtBoot`); `scripts/browser-check/update-flow.mjs` scenario 3 FAIL twice 2026-11-16 on `audit/final` (fresh context); after a reload in the same profile the tap reloads | C5, update-flow |
| F-026 | cursor-final | A11Y-1 | high | open | Calendar view toggle fails axe `label-content-name-mismatch` (serious): visible text is "לוח" / "רשימה" while `aria-label` is "הצגת לוח שנה" / "הצגת רשימת אימונים". A11Y-1 requires zero serious/critical. | `app.js` `cal-view-btn` (~5798); `scripts/browser-check/a11y-axe-scan.mjs` FAIL on Calendar 2026-11-16 | C6 |
| F-028 | cursor-security 2026-11-16 | SEC-2 | high | open | MFA incomplete for club staff SECURITY DEFINER RPCs. A password-only (aal1) session of a club owner/coach who has a verified TOTP factor can still `rotate_club_link` (returns the new 64-hex join token), `club_announcement_post` / `club_announcement_delete` / `club_announcement_set_pinned`, and `remove_member`. Table RLS has restrictive `aal2_required`, but these DEFINER functions bypass RLS and do not call `aal_satisfied()` (unlike `delete_my_account` / `request_account_deletion`, fixed in F-016). Same class as F-016, wider surface. Fix in `shahafrach/haimunia-app-demo`: require `aal_satisfied()` at the top of every authenticated staff/member mutating DEFINER RPC (at least the staff ones above; prefer the full missing list from the audit harness). | Local Supabase (sibling migrations through `202611150004`): enrolled verified factor on audit_user_a; password login JWT `aal=aal1`, `aal_satisfied()=false`; `rotate_club_link` → 200 + new token; `club_announcement_post` → 200; `remove_member` → 204 and row gone from `circle_members`; `club_staff_actions` logged the three. Failing proof: `AUDIT_LOCAL=1 node --test test/audit-aal1-staff-rpcs.test.mjs` (and `scripts/audit-security-harness.mjs`). | security final |
| F-029 | cursor-security 2026-11-16 | SEC-7 | low | open | Sign-up username/email enumeration via GoTrue: existing synthetic email returns HTTP 422 `user_already_exists`; a fresh email returns 200 with tokens. Club usernames map 1:1 to `<user>@members.haimuniya.invalid`. Recover endpoint responses match (both 200). Platform Auth behaviour; mitigate with identical client errors and/or Turnstile (already on anon sign-in). | Local Auth: signup existing → 422; signup fresh → 200. | security final |
| F-030 | cursor-security 2026-11-16 | OPS | low | open | Dependabot alerts API is disabled (HTTP 403) on `haimunia-club` and `haimunia-app-demo`. `npm audit` is currently clean (0 vulns) on both; without Dependabot there is no ongoing GitHub alert stream. | `gh api repos/.../dependabot/alerts` → 403; `npm audit` 0/0. | security final |

- F-008: planned shutdown date 2026-12-15, then remove the site (`box-log.pages.dev`) and its Pages project. **Re-check audit/final 2026-11-16:** live `https://box-log.pages.dev/` now serves a full CSP (script/style/connect/frame including Turnstile), not the sparse `frame-ancestors`-only policy from 2026-11-14. Owner live Turnstile sign-up check still pending; club `connect-src` still omits `https://challenges.cloudflare.com` (script-src + frame-src only).

## Final independent pass (launch gate 5) — `audit/final` — 2026-11-16 (Asia/Jerusalem)

Independent verifier. No app code fixed. No production writes. Supabase MCP advisors declined by owner.

| Step | Result | Notes |
|------|--------|-------|
| 0 Setup | partial | Repos in `~/dev`; npm ci; Supabase CLI 2.116.0; Playwright Chromium+WebKit; axe; gitleaks; `.cursor/rules/audit.mdc`. Docker C2C bridge broken in this VM → full `supabase start` failed; host-published Postgres + GoTrue/storage schema + all project migrations applied instead. `~/dev/audit.env` written (gitignored); Auth API users not created (no GoTrue container). |
| 1 Database | pass (local + CI) | 0 public tables without RLS; 0 SECURITY DEFINER without `search_path=""`. `delete_my_account` / `request_account_deletion` check `auth.uid` + `aal_satisfied`. `feedback_submit` / `client_error_report` DEFINER, fixed search_path, anon+authenticated (intentional). `transfer_put`/`transfer_take` service_role only; limits present. F-005: 46/46 uid policies use `(select auth.uid())`. C2-1: `club_staff_log` in remove/delete/pin. CI `migration-check` green on demo main. Local `supabase test db` / advisors not run (no full stack; advisors auth declined). |
| 2 Live security | pass | Live 3.17.1. Club + box-log headers/CSP present. Listed non-public paths 404. `npm audit` 0. Gitleaks: public publishable anon keys in `app-config.js` history only (expected). |
| 3 Member flows | pass with gaps | Chromium browser-checks: boot, first-run, install dock, layout A (390/360 + iPhone 13), PR→share, percentage chart, monthly summary. Live Chromium+WebKit 390/360/1440 shell OK (WebKit: F-013 warning only). Connected feed/reactions/delete-account/feedback: mocked or unit-covered; no live club join (no invite). C4-2 real iPhone not run. |
| 4 Data safety | pass | `test/heavy-log.test.mjs` 5/5 (3y counts+hashes, re-import, transfer &lt;1 MiB). Backup/transfer/old-app/upgrade-in-place/storage-compat pass. `upgrade-rehearsal.mjs` needs old-app commit `16d0cd8` (not in this repo). |
| 5 Offline / SW | fail (F-025) | Offline log → reload → reconnect: no dupes. F-020 unit tests pass. `update-flow.mjs` scenario 3 FAIL (F-025). |
| 6 a11y / RTL | fail (F-026) | axe serious on Calendar (F-026). Keyboard dialogs + text-scale pass. Contrast via design-tokens + monthly-summary light/dark ≥4.5:1. RTL live+local. |
| 7 Code review | pass | `src/db.js` reopen path present; `reloadOnce` waits for saves; `src/transfer.js` HKDF/AES-GCM/1 MiB; C4-1 banner has backup+transfer (old “כדי שהנתונים לא יימחקו” gone). C5-1: WebKit 277615 title confirmed RESOLVED; 313800 NEW; OpenPWA page fetched. |

**CURSOR-CHECKS.md:** C2-1 pass; C3-1 pass (live); C4-1 pass (code); C4-2 not run (needs iPhone); C4-3 covered by heavy-log + transfer tests (not live old-app create); C5-1 sources fetched; C6 fail F-026.

**Open medium+ (launch gate 5):** F-023 (OPS medium), F-025 (OFF-2 medium), F-026 (A11Y-1 high); F-008 Turnstile owner check still pending.

## Security assessment (cursor, 2026-11-16, Asia/Jerusalem)

Branch `audit/security`. Method: find / prove / propose fix / retest. No app-code fixes. Local stack: sibling `haimunia-app-demo` Supabase CLI 2.116.0 with all migrations; test users A/B/C + anonymous in `~/dev/audit.env`. Live sites: read-only headers/paths/one page load only.

### New open findings
See F-028 (high), F-029 (low), F-030 (low) above.

### Tested and found safe (with proof sketch)

| Area | Result |
|------|--------|
| IDOR clubs / private_records / workout_posts / circle_members / announcements | A cannot read B's friends circle or private_records; B cannot read A's club; anon selects return empty / denied. Insert into B's private_records as A → 403 RLS. |
| Staff RPCs as plain member C | `club_announcement_*` → not authorized; `owner_create_club` → permission denied; wrong-arg staff names → 404. |
| Anon Postgres role vs transfer | `transfer_put`/`transfer_take` execute denied (service_role only). |
| MFA aal1 on account deletion | `delete_my_account` / `request_account_deletion` → not authorized (F-016 holds). `private_records` insert blocked by restrictive `aal2_required`. |
| Transfer code | 13 bytes / 104-bit Crockford; put stores; take once then `not_found`; wrong takes rate-limit (observed at 9/window after prior takes); device put 3/day; global caps in `transfer_put` source (300 blobs / 150 MB / 1 MiB). |
| Join link | 32 random bytes hex; stored as sha256; after `rotate_club_link` old token → `invalid`, new token joins; fragment-only client read; live `Referrer-Policy: no-referrer`. |
| Stored XSS | Announcements/posts/names go through `bidiText`→`esc` (`src/club.js`, `safe-helpers.js`); `test/app-innerhtml-sinks.test.mjs` green. Script payloads stored in `app_feedback` / `client_error_reports` as text; members cannot SELECT those tables (42501). CSP `script-src` has no unsafe-inline. |
| Feedback / errors | Caps in SQL (500/day feedback, 5/device/day, 20/IP/day; 2000/day errors, 30/IP/hour); over-cap returns void. Staff read via Management API workflow, not client grants. |
| Client secrets / maps | `app-config.js` publishable + Turnstile site key only (public by design). No `.map` files; live `app.js.map` 404. gitleaks: publishable key hits only (expected). |
| Same-device storage | `haimunia:auth` and IndexedDB `box-log-db` readable to anyone with device/XSS — expected offline-first posture; CSP + esc are the web boundary. |
| SW cache | Versioned cache name; REQUIRED_ASSETS fail-closed install; no push handlers (PD-1). |
| Headers / CSP live | Club: full CSP + HSTS + COOP + nosniff + DENY + no-referrer. Box-log: full CSP now (F-008 live). Blocked paths 404 including docs/FINDINGS/package.json/test. `/src/*.js` and `/app-config.js` 200 by design (buildless). |
| npm audit | 0 vulnerabilities on club and demo. |
| CI (demo) | No `pull_request_target`; actions SHA-pinned; F-021 author_association guard present on claude-review comment paths. Club repo has no GitHub Actions (Cloudflare Pages git deploy). Old app: F-022 unpinned tags, wontfix while frozen. |

### Could not test / limits
| Item | Why |
|------|-----|
| Production Supabase active exploit | Rules of engagement: local only for active tests. |
| Real Turnstile / captcha bypass | Needs live site interaction beyond read-only; owner check still pending (F-008 note). |
| Real iPhone transfer redeem (C4-2) | Needs owner's device. |
| Edge Function Deno runtime locally | Transfer proved via `transfer_put`/`transfer_take` RPCs as service_role (same DB path the Edge Functions call). |
| Dependabot alert contents | API disabled (F-030). |
| Full pgTAP `supabase test db` wall clock | Budget: targeted RPC/REST proofs + existing F-016 coverage instead of full 1600+ assertion rerun. |
| Anonymous JWT `delete_my_account` | Self-delete only (`auth.uid()`); role is `authenticated`. Not filed as a vulnerability; product may still want to refuse `is_anonymous`. |

## C3 audit (2026-11-14, UTC)

Branch `audit/c3` from `origin/main` (`21bbc7f`). Site and hosting security (check C3 in `docs/audit/CURSOR-CHECKS.md`).

| Area | Result | Notes |
|------|--------|-------|
| Headers / CSP (club) | pass | Live `https://haimunia.pages.dev/` matches `_headers` and `index.html` meta; `test/headers.test.mjs`, `test/middleware.test.mjs`. F-007 open for intentional `style-src 'unsafe-inline'`. |
| Paths (C3-1, F-003) | pass | `triage/grok` middleware block; live site: `/docs/audit/CURSOR-CHECKS.md`, `/docs/`, `/FINDINGS.md`, `/STANDARD.md`, `/CLAUDE.md`, `/CHANGES.md` all **404**. |
| Gitleaks / secrets (SEC-5) | pass | No leaked credentials in tracked sources; `app-config.js` holds only the public anon key. |
| Transfer protocol | pass | `src/transfer.js`: HKDF lookup key, AES-GCM, gzip; codes and keys stay on the phone; sibling `transfer_take` single-use and rate-limited. |
| Auth / connect | pass | Turnstile on anonymous sign-in (`src/connect.js`); no email recovery path in the club app; usage counts send `device_id`/`event`/`app` only (`src/usage.js`, `test/usage-counting.test.mjs`). |

**G3: Cloudflare Pages (hosting).** Git integration deploy on every push to main; `haimunia.pages.dev` only. `_headers` `no-cache` on `/`, `/index.html`, `/sw.js`; middleware sets security headers on its 404. New C3 findings: F-007, F-008, F-009.

### Notes for G1 (privacy)

No `docs/privacy-policy.he.md` exists in either repo, so these wait for the G1 paste (owner decisions 2026-11-14). The live policy is `privacy.html`.

- Club staff audit log (`club_staff_actions`, F-002): who did what as club staff, ids and time only, kept 12 months, then purged daily.
- Transfer codes (F-001): an encrypted code is stored in the database table `transfer_blobs` for at most 24 hours, at most 1 MiB each and 150 MB in all.
- Transfer codes (F-001): each code created in the club app sends a random device id, stored on the server only as an HMAC in the rate-limit table, for at most 2 days (`transfer_purge`). Limits: 3 codes per device and 30 per IP a day.
- Owner decision 2026-11-15: usage counts are kept 180 days. The backend purge changes from 400 to 180 days (new migration in `shahafrach/haimunia-app-demo`). App text and privacy text stay at 180.
- Owner decision 2026-11-15: the club app gets a self-serve delete-account button before launch (3.10.0, with its backend migration).
- Owner fact 2026-11-15: the Supabase project is in eu-central-1 (Frankfurt), not ap-southeast-1 (Singapore). `privacy.html` must change.
- Full inventory for the G1 paste: `docs/grok-inputs.he.md`.

### Release plan (lead, 2026-11-15)

| Version | Content | Repo | Status |
|---------|---------|------|--------|
| 3.8.1 | F-010 IndexedDB reopen | haimunia-club | shipped, tag rollback-3.8.1 |
| 3.9.0 | Per-workout sharing (PR #12), F-015 | haimunia-club | shipped, tag rollback-3.9.0 |
| 3.10.0 | Self-serve delete account (PR #16), F-018, new privacy.html (G1) | haimunia-club | live (039aec7) |
| (backend) | Usage purge 180 days, delete_my_account with aal2 (F-016) | haimunia-app-demo #173, migration 202611150002 | live, migration-status green |
| 3.11.0 | Check-for-update button (PR #20), F-020 | haimunia-club | live (f344875) |
| 3.12.0 | Anonymous client error reports and the feedback box ("מה לא עובד טוב?"), with their privacy.html sections | haimunia-club #22 + haimunia-app-demo #178 (migration `202611150003`) | live (club d8f4672, backend 4ce4542) |
| 3.13.0 | Log screen layout A (PR #21) | haimunia-club | live (00a5f71) |
| 3.14.0 | Small fixes: F-019, feedback preselect and 4xx handling (QUEUE Q-16, PR #26) | haimunia-club | live (155e255) |
| (backend) | F-005 RLS initplan (PR #172), renumbered after 202611150003 (QUEUE Q-14) | haimunia-app-demo | after #178 merges |
| (tests) | F-014: synthetic 3-year log, backup, import and transfer size (QUEUE Q-15) | haimunia-club | planned |
| 3.15.0 | Percentage chart from each lift's 1RM (Q-17, PR #28) | haimunia-club | live (319117f) |
| 3.16.0 | Personal weekly streak, no leaderboard (Q-18, PR #29) | haimunia-club | live (2006f39) |
| 3.17.0 | Monthly personal summary card (Q-19, PR #30) | haimunia-club | live (d190e33); sw.js 3.17.0 |
| (repo) | Standard template repository (Q-20) | new repo | needs the owner to create it |

Launch postponed with no date (owner, 2026-11-15): everything ships when it passes verification. Versions after 3.12.0 are a plan, not a promise. A later item takes the next free version when it ships, and only lead assigns them.

All three after-launch features are computed on the phone from the existing records. They add no IndexedDB store or field, and nothing is sent to the server.

Migration numbers: the held F-005 migration is `202611150001_rls_auth_uid_initplan.sql` (haimunia-app-demo PR #172). Every new migration uses a later version. `202611150002` is applied, so the next one is `202611150003` or later. Once a later migration is applied, F-005 is older than the newest applied migration, and `supabase db push` refuses an out-of-order file without `--include-all`. So before F-005 merges, rename it (it was never applied) to a version later than the newest migration on main. The usage-purge change and the delete-account migration may share one file, or go in order, one open migration branch at a time (sibling CLAUDE.md).

### Platform decisions (owner, 2026-11-15)

Also in STANDARD.md, "Platform decisions".
- PD-1: no web push for now. WebKit bug 315804, owner report: in an iOS 26 installed PWA, an IndexedDB write never completes after a push subscribe. Lead could not open the bug (bugs.webkit.org is blocked in these sessions), so the source is the owner's report. Today's code has no push: `sw.js` has no push handler, and the club app makes no `PushManager.subscribe` call.
- PD-2: never rely on persistent storage on iOS. Installing to the home screen is the only real protection, so the F-001 install flow and backup reminders stay a priority. privacy.html already says the browser may delete site data.

### Capacity check (lead, 2026-11-15, read-only)

Project `box-log`, eu-central-1, Postgres 17, free plan.
- Database: 22 MB of 500 MB. Largest tables: `cron.job_run_details` 2.7 MB (pg_cron's run log, no purge, grows about 1 MB a week), `supabase_migrations` 1.5 MB, `edge_function_invocations` 0.7 MB; `workout_posts` 0.2 MB.
- Connections: 15 open of 60.
- Rows: 3 auth users, 3 memberships, 2 posts, 95 usage rows.
- 200 members in one evening:
  - Database size and connections are no risk.
  - `join_circle` allows 10 tries an hour per user, not per club, so no risk.
  - The club cap is 250 members (`circle_member_cap('club')`): enough for 200, with little headroom.
  - Turnstile on the free plan has no request limit.
  - **Risk:** the anonymous sign-in limit is per IP, and members at the gym share one IP. Run `set-auth-config` with `anon_limit = 300` before announcing (docs/LAUNCH.md step 6).
  - The password sign-in limit (Supabase default, per IP) is not set by the workflow. Watch the auth logs on launch evening.

### Launch gates (owner, 2026-11-15: launch postponed, no date; launch only when every gate is green)

| # | Gate | Status |
|---|------|--------|
| 1 | C4-2 on a real iPhone: create a transfer code in Safari, install, redeem | open (owner) |
| 2 | G4 club message approved | open (owner) |
| 3 | Cursor final pass, or lead's full real-Chromium pass on the live site (QUEUE Q-21) | green for 3.13.0 (lead, 2026-11-16, fake backend); Cursor final pass on 3.17.1 done 2026-11-16 with gaps (C4-2 not run, connected flows mocked); lead re-runs the live pass on the final version before launch |
| 4 | Q-12 CI sweep clean | green (F-021 fixed, demo #179) |
| 5 | No open critical, high or medium finding | open 2026-11-18: F-023 (fix: demo #181), F-025, F-026, F-028 (high, Cursor security pass); F-008 Turnstile owner check still pending |

Done earlier: 3.8.1 (F-010), 3.9.0 (sharing), G1 privacy policy (live since 3.10.0), 3.10.0 (delete account), 3.11.0 (update check).

CI sweep 2026-11-15 (Q-12): no unknown PRs, branches or actors in any of the three repos, no run-number gaps, no pull_request_target, every action pinned by SHA in haimunia-app-demo. Findings: F-021, F-022.

Low items, not gates: F-004 (watch CI), F-006, F-007 (accepted), F-011, F-013, F-019 (Q-16), F-022, F-024 (Q-25), F-029, F-030 (QUEUE Q-31). Owner task: shut down box-log.pages.dev on 2026-12-15 (F-008 follow-up).

### F-001 fix plan

Order of work: 3 (backend origin), then 3b (create-code screen), then 1 (banner). Steps 2, 4 and 5 are unchanged.

1. **Banner before install** (`index.html` `#iosInstallBanner`, `app.js` `maybeShowIOSInstallBanner()`): replace "כדי שהנתונים לא יימחקו" with a two-step message. Step one: back up now (a button that runs the existing backup export). Step two: add to the home screen. Say plainly that the installed app starts empty until the backup is imported. On iOS Safari the banner shows on the first visit, before the first entry: drop the `totalLoggedEntries() < 1` and first-day gates (`app.js:7610` and the `firstOpenDate` line after it).
2. **Installed app, first launch, empty log** (`isStandalone()` true and `totalLoggedEntries() === 0`): offer the import before anything else, with two choices. "יש לי קובץ גיבוי" runs the existing backup import. "יש לי קוד העברה" opens the existing transfer screen (`src/transfer.js`, installed-only already).
3. **Transfer codes from the club app** (owner decision 2026-11-14; **backend owned by `shahafrach/haimunia-app-demo`**): the sibling accepts `https://haimunia.pages.dev` as an allowed put origin in `supabase/functions/_shared/transfer.mjs` (today only `PUT_ORIGIN = "https://haimuniya.github.io"`, line 15). Expiry (24 hours), single use (the row is deleted on take) and the rate limits stay exactly as they are today (`transfer_take`, sibling `202611120001`). The sibling PR carries its own tests. This repo then uses that path from the Safari tab.
3b. **Create-code screen in the club app** (this repo): port the existing create flow from the old app (`haimuniya/haimunia-app`). Reuse the same encryption, payload format and API calls; write no new crypto. The protocol stays as fixed in `src/transfer.js:7-13`: HKDF lookup and key, AES-GCM, gzip payload, then `transfer-put`. A code created in either app must redeem in the new installed app. Entry points: the iOS install banner ("העבר לאפליקציה המותקנת") and the backup screen in settings. The code and its instructions are shown in Hebrew and state the 24-hour expiry. Needs step 3 deployed first.
4. **Tests:** a jsdom test for each of steps 1 and 2. Import must stay lossless for old backups (`test/old-app-backup-imports.test.mjs`).
5. **Release:** bump `APP_VERSION` and `SW_VERSION` and add a `CHANGES.md` entry (CLAUDE.md, Releases).

## PRE-MERGE results (2026-11-14, Asia/Jerusalem)

Verified against `fix/f-001` in both apps (`haimunia-club` `57436c1`, `haimunia-app-demo` `f843af4`). Local stack: Supabase from `haimunia-app-demo` + Node transfer proxy (Deno edge runtime BOOT_ERROR on this host; same shared handlers + `transfer_put`/`transfer_take` RPCs).

| Check | Result | Notes |
|-------|--------|-------|
| CI (app-demo PR #170) | pass | One-shot: `migration-check` green; e2e / `user-tests` green on latest `fix/f-001` commit. |
| pgTAP (`supabase db reset` then `supabase test db`) | pass | 57 files / 1640 assertions, including `0155` and `0156`. |
| C2-1 (F-002) | pass | `202611140001_club_staff_audit.sql`: `remove_member`, `club_announcement_delete`, and `club_announcement_set_pinned` each call `club_staff_log` → `club_staff_actions` (actor, target, time). |
| C3-1 (F-003) | pass | `https://fix-f-001.haimunia.pages.dev`: `/docs/audit/CURSOR-CHECKS.md`, `/docs/`, `/FINDINGS.md`, `/STANDARD.md`, `/CLAUDE.md`, `/CHANGES.md` all returned **404**. F-003 marked fixed. |
| C4-3 (F-001) | pass | Chromium + WebKit. Create code in old app and in new club tab; redeem each in standalone new app. Entity counts matched 100% (entries, wodEntries, customWods, customMovements, bodyweightEntries, measureTypes, measureEntries, sessionNotes). Prefs matched. Payload >1 MiB → HTTP 413 and Hebrew `היומן גדול מדי להעברה בקוד. אפשר להשתמש בקובץ גיבוי.` |

**Re-verify (2026-11-14 ~22:10 Asia/Jerusalem):** fetched `origin/fix/f-001` at `57436c1` (merge of triage/grok). Re-ran **C3-1** and **C4-3** only — both pass (preview all 404; Chromium+WebKit create/redeem counts match; >1 MiB Hebrew 413). No merge blockers.

**Merge blockers from this pass:** none for F-002 / F-003 / C4-3. Remaining Cursor checks not in this pass: C4-1 (banner/first-launch code review), C4-2 (real iPhone), C5/C6 as listed in `docs/audit/CURSOR-CHECKS.md`. F-004 (flaky waitfor helper) stays open, low.

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

### C1 notes

Live `https://haimunia.pages.dev/` (3.8.0): response headers match repo `_headers` and `index.html` CSP meta (C1 deploy check). Chromium and WebKit Playwright runs at 390×844 and 1440×900 captured full-tab screenshots of the log shell and settings; no layout breaks observed. Club-connected flows (join, feed, announcements) were not exercised end-to-end without a live invite link. Console: F-013 `interactive-widget` warning on WebKit; otherwise clean on boot. F-012: no `v3.8.0` tag on the repo.

### C5 notes

`e2e/c5-offline-updates.spec.mjs` (Chromium + WebKit): offline navigation after service worker activation, SW upgrade 3.7.2→3.8.0 preserves a `localStorage` marker, and precached `./index.html` / navigate responses are stored without the `redirected` flag (simulated 308 like Cloudflare Pages). Playwright pass on `audit/c5`. Triage: U-1 promoted to F-010; U-2 to F-011.

### C6 notes

`scripts/browser-check/a11y-axe-scan.mjs` on local static server: **0 serious** axe violations; moderate/minor items logged only. RTL shell (`dir=rtl`), tab order, and chart accessible names covered by existing jsdom tests plus the axe pass.

### C4 notes

C4-1 (old-app backup export/import lossless): **pass** via `test/old-app-backup-imports.test.mjs` and F-001 install/transfer jsdom tests on main (`test/fixtures/old-app-backup-v1.json`). **F-014**: sibling `haimunia-fixes` 3-year export not reachable from this audit session; longest real export not replayed. C4-2 and C4-3 (real iPhone install and transfer flows) were not run here. Transfer put-origin fix is on the sibling (haimunia-app-demo #170). The club create-code screen (F-001 step 3b) is on main since 3.8.0 (PR #11, `src/transfer.js` `open("create")`).

## Triage log

### Paste 1 (2026-11-14): G3 (English and Hebrew copies, merged) and G2

bugs.webkit.org and openpwa.net are blocked by this session's network policy, so no G3 source could be fetched.

**G3: iOS PWA**

| Item | Label | Evidence |
|------|-------|----------|
| WebKit 324094: wedged DB after a dedicated worker ends mid-transaction | not relevant | No Worker in app code (no `new Worker` outside `vendor/`); every transaction runs on the page. |
| WebKit 277615: "Connection to Indexed Database server lost" until reload | **F-010** (was U-1) | WebKit 277615 confirmed; code gap: `src/db.js:53-78` caches one connection in `_dbPromise` with no `onclose` or reopen; `app.js:552-558` shows "השמירה במכשיר נכשלה" without telling the member to reload. |
| WebKit 309251: iOS 26 jetsam with WASM and worker batch writes | not relevant | No WASM and no Worker. |
| Storage eviction under pressure; 7-day rule | already handled | `app.js:8189` `navigator.storage.persist()`; `app.js:552-556` QuotaExceededError message; export reminder `app.js:3187` (`boxlog:lastExportAt`). Server as source of truth: not relevant (by design the private log stays on the phone, CLAUDE.md). |
| Safari and Home Screen storage isolation | **confirms F-001** (was U-3) | See F-001. OpenPWA / external source still not fetched here, but `src/transfer.js:15` and C4/C1 behaviour match isolated Home Screen storage. |
| WebKit 283793: `indexedDB` undefined in a push wakeup | not relevant | `sw.js` has no push or notificationclick handler (`sw.js:83,101,129`: install, activate, fetch only). |
| WebKit 268797: notificationclick not firing; Web Push needs Home Screen | not relevant | No push in this app today (same evidence). Recheck when push with `app = 'club'` lands. |
| WebKit 313800: `visualViewport` short by the status bar in standalone (26.3.1) | **F-011** (was U-2) | WebKit 313800 NEW. The app sizes overlays from `visualViewport.height` (`app.js:3841, 6950, 7349`) with `viewport-fit=cover` (`index.html:71`). |
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
