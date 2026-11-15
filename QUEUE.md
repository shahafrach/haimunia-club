# QUEUE: haimunia work queue

Branch `coord` in shahafrach/haimunia-club. **Never merge it to main.** It holds only this file.

## How it works
- **Owner** of a row: `fixes` (the haimunia-fixes session) or `release` (the lead session, which plans, sets versions and verifies). Shahaf only merges, tags, makes decisions and does the iPhone checks.
- **Status:** `todo` → `doing` → `done` → `verified` or `blocked` (with the reason in Notes).
- **fixes:** `git pull` coord, take the lowest-numbered `todo` row owned by `fixes` whose "After" rows are `verified`, and set it to `doing`. When finished, set it to `done` and put the PR link, head SHA and test counts in Notes. Push coord. Never edit another row's prompt.
- **release:** verifies every `done` row and sets it to `verified` or `blocked`, adds new `todo` rows, and keeps the order. Only release sets versions.
- One row is one task and one PR. The full prompt is in the row's section below the table.

| ID | Owner | Status | After | Task | PR | Notes |
|----|-------|--------|-------|------|----|-------|
| Q-01 | fixes | verified | – | 3.11.0: fix F-020 on PR #20 (update check can reload during a save) | [club #20](https://github.com/shahafrach/haimunia-club/pull/20) | Head `2747e37` on PR #20. `reloadOnce()` waits for saves on every update path and gives up without a reload after the limit (busySave); saves and deletes held with "רגע, האפליקציה מתעדכנת" during the update; `src/db.js` same as ac7bab1. update-check + db-connection-reopen + storage-compat: 18 pass, 0 fail. Full npm test: 464 pass, 1 fail (a source assertion in hunt-round5-pwa-multitab still expecting `location.reload()` in `reloadOnce()`; updated, that file 5/5; full suite not re-run). No browser checks. **release 2026-11-15:** verified on 2747e37. Real Chromium: - up to date, offline, error, and update with exactly one reload into the new version, with the set logged before the tap kept; - no controller at boot: a save started after the hand-off is held back with "רגע, האפליקציה מתעדכנת" and nothing is cut; - a save already writing when controllerchange or the backstop fires: the reload waits and the set is kept; - at most one reload in every run.  Code: `src/db.js` unchanged from ac7bab1 (only the counter versus main). Related tests 23/23. **Full npm test on 2747e37: 465 pass, 0 fail** (run by release). Note: a held save's draft is lost by the reload that follows; acceptable, and the toast says why. |
| Q-02 | release | blocked | Q-01 | Verify 3.11.0 (PR #20) | [club #20](https://github.com/shahafrach/haimunia-club/pull/20) | Re-run update.mjs (up to date, update, offline, error, set kept, no controller at boot plus a slow save, at most one reload), the db tests, and the F-010 checks. **release 2026-11-15:** functionally verified (see Q-01). Blocked only on release details: PR #20 still says 3.10.0 and has no CHANGES entry. Q-11. |
| Q-03 | fixes | todo | Q-02 | 3.12.0: anonymous client error reports and the feedback box (backend migration `202611150003`, then the club app) | – | One migration for both, the only open migration branch apart from the held #172. Before launch only if verified by 20.11. |
| Q-04 | release | todo | Q-03 | Verify 3.12.0 (both PRs; pgTAP in CI; real Chromium) | – | – |
| Q-05 | fixes | verified | – | Log screen redesign, step 1: 2 or 3 layout options for Shahaf to choose from | [club #21](https://github.com/shahafrach/haimunia-club/pull/21) | Draft PR, head `5a627ca`, branch `claude/log-layout-07dvsw`. Options A (controls first) and B (pinned dock), prototype behind `?layout=a` or `?layout=b`, screenshots at 390×844 and 360×780 in the PR. Both fit with no scroll; 3 identical sets: 6 taps + 1 swipe today, 5 taps + 0 swipes in A and B. Related jsdom: 82 pass, 0 fail. **release 2026-11-15:** verified as step 1. The prototype acts only with the query parameter; without it the screen is unchanged; `src/db.js` untouched; draft PR. Shahaf chose **A**, so step 2 is Q-09. |
| Q-06 | release | verified | – | Verify haimunia-app-demo #167 (club-admin: the username never reaches the public log) | [demo #167](https://github.com/shahafrach/haimunia-app-demo/pull/167) | Merges cleanly into main. Workflow-only. Needed before launch day (club-admin runs with usernames then). **release 2026-11-15:** the diff is sound. The username is read from the event file and masked before use; no `env:` holds `inputs.who`. The merge with main (af491fe) passes `test/club-workflows.test.mjs` 10/10. CI on c6fd6eb was all green, but on an old base. Shahaf: press Update branch, wait for green, merge, and delete the logs of run 43255246472. |
| Q-07 | release | done | – | Triage stale PRs: #162, #167, dependabot | – | #162: superseded (`docs/club/research.md` is on main; the branch conflicts): Shahaf closes it. #167: Q-06. Dependabot #153, #155, #174, #175, #176, #177: held until after launch (Q-08). Shahaf closes #162 (decided 2026-11-15). |
| Q-08 | release | blocked | launch | Dependabot in haimunia-app-demo after launch: #153 setup-cli, #155 supabase-js, #174 claude-code-action, #175 fake-indexeddb, #176 playwright 1.65 (browser-check), #177 jsdom 31 | – | Held until after launch (owner, 2026-11-15). #176 is a deliberate exact pin (scripts/browser-check/package.json: moving it means re-measuring). #177 is a jsdom major. Each one gets a full CI run on a branch updated from main. |
| Q-09 | fixes | doing | Q-01 | 3.13.0: log screen layout A, step 2 (implement for real, on PR #21) | [club #21](https://github.com/shahafrach/haimunia-club/pull/21) | Owner chose A (2026-11-15). Before launch only if verified by 20.11, else first after launch. fixes may start it while Q-02 waits. It ships after 3.12.0; if 3.12.0 slips past 20.11, release renumbers it to 3.12.0. |
| Q-10 | release | todo | Q-09 | Verify 3.13.0 (layout A) | [club #21](https://github.com/shahafrach/haimunia-club/pull/21) | Real Chromium at 390×844 and 360×780; the PR, share, sanity and plate flows; jsdom; data-shape check. |
| Q-11 | fixes | done | – | 3.11.0 release details on PR #20 | [club #20](https://github.com/shahafrach/haimunia-club/pull/20) | Head `ec9e381` on PR #20. APP_VERSION/SW_VERSION 3.11.0 (`check-version` OK), CHANGES.md 3.11.0 entry at the top, rollback-3.10.0 command and the new title in the PR text. No code change since 2747e37. `test/update-check.test.mjs`: 9 pass, 0 fail. |

## Owner decisions (from Shahaf)
- 2026-11-15: **Run to the end without waiting for "continue".** After finishing a task, take the next available row at once. Do not end the turn while you own an available row.
  When every row you own is waiting on the other session, schedule one check-in to yourself with send_later in 30 minutes ("continue the queue"), then end the turn. On that check-in, pull coord and continue. No sleep loops or polling inside a turn.
  Stop for good only when the queue has no row you can act on before launch, or a row needs Shahaf (merge, tag, iPhone check, decision). Then write what he must do in one short list at the top of your report, and schedule no further check-in until he answers.
  Launch freeze from 20.11: after that, only verification and fixes for blockers.
- 2026-11-15: Log screen layout **A** (controls first). release: add the step 2 row for fixes (implement A, plus the browser check that the steppers and save are visible without scrolling at 390x844 and 360x780) and verify it as 3.13.0. If it cannot be verified by 20.11, it ships after launch.
- 2026-11-15: Close haimunia-app-demo #162 (superseded). Shahaf closes it.
- 2026-11-15: Shahaf wants a finished product. Keep going through the queue without waiting for him, and stop only for merges, tags, iPhone checks and real decisions.

## Q-01: fix F-020 on PR #20
```
Lead here. PR #20 (3.11.0 check for update, ac7bab1) fails F-020 (FINDINGS.md on branch claude/adoring-dijkstra-yteqeb, PR #19). Fix it before the 3.12.0 work.
F-020: checkForUpdate() waits for savesIdle() and then calls applyUpdate(). But on a page that had no controller at boot (the first launch of a fresh install), the reload comes later, from the controllerchange listener (swapRequested) or the 4 s backstop setTimeout(reloadOnce, 4000). Neither looks at savesIdle() again. Real Chromium, ac7bab1: no controller at boot, a save started right after applyUpdate() with dbPut held 6 s: one reload, the set lost (events applyUpdate, put-start, no put-done).
Fix:
- reloadOnce(), used by every update path, waits for waitForSavesToFinish() before location.reload(). If saves are still running after the limit, it does not reload: show UPDATE_CHECK_TEXT.busySave, and let the update apply on the next start.
- While the update runs ("מעדכנים…"), block new saves: saveSet, saveWod and the delete actions. Use a guard that shows a short toast ("רגע, האפליקציה מתעדכנת"), and keep the member's draft.
- Keep it at most one reload per page, and keep src/db.js exactly as in ac7bab1. Do not touch withReopen beyond the counter.
Add a jsdom test: no controller at boot, a slow dbPut started after applyUpdate(); no reload until it finishes, and the entry is on disk afterwards. Add another: a save attempted during "מעדכנים…" is held back with the toast.
Run test/update-check.test.mjs, test/db-connection-reopen.test.mjs and test/storage-compat.test.mjs, then one full npm test in the foreground, and paste the counts in Notes. Push to the PR #20 branch. Do not merge.
```

## Q-03: 3.12.0, client error reports and the feedback box
```
Lead here. 3.12.0 = anonymous client error reports + the feedback box ("מה לא עובד טוב?"). Start after Q-02 is verified. Backend PR first, club PR second; both in one release.

BACKEND (shahafrach/haimunia-app-demo): ONE forward migration 202611150003_client_errors_and_feedback.sql. (202611150002 is applied; #172 is held and is renamed before it merges.) The existing bug_reports / bug_report_submit does not fit (it needs a signed-in, non-anonymous member, stores reporter_id, staff can read it, no purge). Leave it unchanged.
1. public.client_error_reports:
   - Columns: created_at, app ('club'|'old'|'unknown', from the Origin header as training_log_usage does), app_version, screen (allow-list), kind ('error'|'unhandledrejection'|'storage'), name (^[A-Za-z]{1,40}$ or null), message (max 200), file (own .js basename or 'other'), line, col, fp (8 hex).
   - No device_id, user_id, name or IP column.
   - Insert only through SECURITY DEFINER client_error_report(...), with an empty search_path, granted to anon and authenticated, returning void.
   - Limits: 2,000 rows a day in total, plus about 30 an hour per IP (HMAC of the IP, the transfer_rate_ok pattern; keep the hashes 2 days at most).
   - Purge after 30 days.
2. public.app_feedback:
   - Columns: id, created_at, app (from Origin), app_version, screen (allow-list), device_type ('ios'|'android'|'desktop'|'other'), standalone boolean, body (1 to 1000 characters).
   - No user_id, username, name or IP column.
   - Insert only through SECURITY DEFINER feedback_submit(...), with an empty search_path, granted to anon and authenticated, returning void.
   - Limits: 5 a day per device (HMAC of a random device id the app sends, as transfer-put's device), 20 a day per IP (HMAC), and 500 a day in total. Keep the hashes 2 days at most.
   - Daily purge of rows older than 12 months.
3. For both tables: RLS on and no policies. Revoke all from public, anon and authenticated. Only service_role reads.
4. A weekly read-only query: feedback_by_screen(p_since date), returning screen, count and the newest rows (created_at, app_version, device_type, body). Granted to no role. Put the exact SQL for the SQL editor in docs/ops/FEEDBACK.md.
5. pgTAP:
   - anon can call both functions and can select from neither table;
   - every limit holds;
   - bad fields and length bounds are refused;
   - both purges work;
   - review rows in 0135.

CLUB APP (shahafrach/haimunia-club), version 3.12.0 (npm run sync-version), a CHANGES.md entry, and the rollback-3.11.0 tag command in the PR:
1. Error reports: a new src/errors.js, loaded right after src/usage.js, and listed in OPTIONAL_ASSETS in sw.js.
   - Port the capture from haimunia-app-demo src/analytics.js (N10: window "error" and "unhandledrejection"), and add noteStorageError's failures as kind "storage".
   - Sanitize the message: drop quoted substrings, URLs, and anything after a colon that comes from JSON.parse, so no member text can pass. Keep at most 200 characters, and hash it into fp too.
   - At most 5 reports per page load, at most one per fp a day, and an offline queue of 8 at most.
   - It never throws or blocks the app.
   - It follows the usage-counting switch: off means no reports.
2. Feedback box:
   - A "שליחת משוב" row in Settings opens a sheet titled "מה לא עובד טוב?", with a textarea (maxlength 1000, with a counter) and "שליחה".
   - A small "שליחת משוב" link under the storage error message and the club share-failure toasts opens the same sheet, with that screen preselected.
   - After sending: "תודה. קראנו כל פנייה."
   - Offline or a failed send: keep it in a localStorage queue (5 at most), send it when the app is online or next starts, and say "נשלח כשיהיה חיבור".
   - Send only the typed text plus screen, version and device type. No name and no username, even when connected.
3. Tests never send a real request (see test/usage-counting.test.mjs).
4. privacy.html, for Shahaf to approve in the PR: two sections after "5. ספירת שימוש", with the following sections renumbered:
   "6. דיווח שגיאות אוטומטי
   כשמשהו נכשל באפליקציה, נשלחים סוג השגיאה, תיאור טכני קצר בלי שום דבר שכתבתם, המסך וגרסת האפליקציה. בלי מזהה, בלי שם ובלי נתוני יומן. הדיווחים נמחקים אחרי 30 יום. הם נשלחים רק כשספירת השימוש פועלת, וכיבוי ספירת השימוש מכבה גם אותם."
   "7. משוב
   מה שאתם כותבים בתיבת "מה לא עובד טוב?" נשלח לשרת עם המסך, גרסת האפליקציה וסוג המכשיר. בלי שם, בלי שם משתמש ובלי נתוני יומן, אלא אם כתבתם אותם בעצמכם. רק מפעיל האפליקציה קורא את המשוב. הוא נמחק אחרי 12 חודשים. למחיקה מוקדמת כתבו ל-haimuniya@gmail.com ותארו מה כתבתם ומתי."
   In the "איפה המידע נשמר" section, the Supabase line also names the error reports and the feedback. Update the privacy tests.
Run the related tests, then one full npm test in each repo in the foreground, and paste the counts in Notes. Do not merge.
```

## Q-05: log screen redesign, step 1
```
Lead here. Log screen redesign, step 1 only: options for Shahaf to choose from. Nothing is merged and nothing is released.
- Branch from main. Build 2 or 3 layout options for the log ("רישום") screen as separate, switchable variants behind a dev-only flag (localStorage "haimunia:dev:logLayout" = a | b | c). The default stays the current layout, so the branch is harmless.
- Tokens and existing components only (design tokens rule, RTL, 44px tap targets, no horizontal scroll at 390px). No IndexedDB or data-shape change.
- For each option: real-Chromium screenshots at 390px in light and dark, with an empty log and with a typical day (3 lifts and a WOD). Use deviceScaleFactor 2 and put them in the PR description.
- Write one line per option: what changes for the member and what it costs.
- Open a draft PR titled "[CHOOSE] Log screen layout options". Put the link in Notes and set done. Shahaf picks one; lead then writes step 2.
Run only the related tests. No full suite is needed for a draft that changes no default.
```

## Q-06: verify haimunia-app-demo #167 (release)
Read the workflow diff, then update the branch from main and check that CI is green. Check that no step's `env:` holds `inputs.who`, and that the mask runs before the username is used. If it passes, set `verified`. Shahaf then merges it and deletes the logs of run 43255246472, the one that leaked a username.

## Q-09: 3.13.0, log screen layout A, step 2
```
Lead here. Shahaf chose option A (controls first) from PR #21. Step 2: implement A for real on the same branch (claude/log-layout-07dvsw), and take PR #21 out of draft when it is ready.
- Build A in renderLogTab() in DOM order. Remove the ?layout prototype, arrangeLogLayout(), #logDock, option B and the <!--seg:*--> comments. Put the innerHTML-sink pin back to what main needs.
- Keep what both options added:
  - prefill from the last session of that exercise in the current mode, with "פעם קודמת · …" shown;
  - "עוד סט זהה" through saveSet(), so the sanity confirm, PR detection, the club share prompt (3.9.0) and the F-020 save guard (3.11.0) all apply;
  - 56 px steppers and a 52 px repeat button;
  - everything else under "עוד אפשרויות".
- The "נשמר" toast must not cover a control the member needs right after a save: it overlapped the sets stepper in step 1. Move it or shorten it.
- No IndexedDB or stored-data change; src/db.js untouched. Tokens only (test/design-tokens.test.mjs), RTL, no horizontal scroll.
- Do not add the screenshots under docs/layout-redesign/ to main: remove them from the branch and put them in the PR description as attachments or links to the step-1 commit.
- A new browser check, scripts/browser-check/log-layout-fits.mjs, at 390×844 and 360×780: after picking an exercise, the steppers, the repeat button (after a save) and save are on screen and are what elementFromPoint hits, with no scroll. Also: a PR still shows its card, then the share question (connected mode, fake client), and the plate visualizer is visible.
- Rebase on main after 3.12.0 merges. Version 3.13.0 (npm run sync-version), a CHANGES.md entry, and the rollback command for the then-current version in the PR. If release renumbers the row, use that number.
- Run the related tests and the new browser check, then one full npm test in the foreground. Put the counts in Notes and set done. Do not merge.
```

## Q-11: 3.11.0 release details on PR #20
```
Lead here. PR #20 is verified (2747e37, full npm test 465/0 run by lead). Only the release details are missing:
- APP_VERSION 3.11.0, then npm run sync-version (SW_VERSION 3.11.0), and npm run check-version.
- CHANGES.md at the top: "# 3.11.0 — בדיקת עדכון: a new version on demand, never during a save — 2026-11-15". Two or three lines: the Settings button and its four answers (up to date, updating, offline, error); no reload while a save runs (F-020); saves held with a toast during the update.
- The rollback command in the PR description, for rollback-3.10.0 (CLAUDE.md, Releases).
No code change. Run npm run check-version and test/update-check.test.mjs only. Put the head SHA in Notes and set done. Do not merge.
```

