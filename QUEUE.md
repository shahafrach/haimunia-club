# QUEUE: haimunia work queue

Branch `coord` in shahafrach/haimunia-club. **Never merge it to main.** It holds only this file.

## Waiting for Shahaf
(release keeps this list current, newest first; one line each)
- **Rollback tags missing for 3.10.0, 3.11.0 and 3.12.0** (the newest is rollback-3.9.0). On main: rollback-3.10.0 at ccd1946, rollback-3.11.0 at 2e7d425, rollback-3.12.0 at d8f4672 (each is the main commit just before the next release merged). Then rollback-3.13.0 at main (now 2e8b9e0) before #26.
- Ship 3.14.0: create rollback-3.13.0 at main, merge club #26, and check that sw.js says 3.14.0.
- Merge demo #179 (F-021 guard, workflow only) once its CI is green. (#25 is merged: F-014 closed.)
- Merge docs PR #27 (F-005 fixed, F-007 accepted, F-023).
- Q-23: run the read-only SQL in that row in the Supabase SQL editor and paste the result, unless my connector comes back first.
- The Supabase connector fails in the lead session ("Failed to resolve project for permission check"); reconnect it if you can (Q-22, Q-23).
- Live Turnstile check on box-log sign-up from a computer (closes F-008, the last open high).
- G4 approval; C4-2 on a real iPhone; for Q-20, an empty template repository.

## How it works
- **Owner** of a row: `fixes` (the haimunia-fixes session) or `release` (the lead session, which plans, sets versions and verifies). Shahaf only merges, tags, makes decisions and does the iPhone checks.
- **Status:** `todo` → `doing` → `done` → `verified` or `blocked` (with the reason in Notes).
- **fixes:** `git pull` coord, take the lowest-numbered `todo` row owned by `fixes` whose "After" rows are `verified`, and set it to `doing`. When finished, set it to `done` and put the PR link, head SHA and test counts in Notes. Push coord. Never edit another row's prompt.
- **release:** verifies every `done` row and sets it to `verified` or `blocked`, adds new `todo` rows, and keeps the order. Only release sets versions.
- One row is one task and one PR. The full prompt is in the row's section below the table.

| ID | Owner | Status | After | Task | PR | Notes |
|----|-------|--------|-------|------|----|-------|
| Q-01 | fixes | verified | – | 3.11.0: fix F-020 on PR #20 (update check can reload during a save) | [club #20](https://github.com/shahafrach/haimunia-club/pull/20) | Head `2747e37` on PR #20. `reloadOnce()` waits for saves on every update path and gives up without a reload after the limit (busySave); saves and deletes held with "רגע, האפליקציה מתעדכנת" during the update; `src/db.js` same as ac7bab1. update-check + db-connection-reopen + storage-compat: 18 pass, 0 fail. Full npm test: 464 pass, 1 fail (a source assertion in hunt-round5-pwa-multitab still expecting `location.reload()` in `reloadOnce()`; updated, that file 5/5; full suite not re-run). No browser checks. **release 2026-11-15:** verified on 2747e37. Real Chromium: - up to date, offline, error, and update with exactly one reload into the new version, with the set logged before the tap kept; - no controller at boot: a save started after the hand-off is held back with "רגע, האפליקציה מתעדכנת" and nothing is cut; - a save already writing when controllerchange or the backstop fires: the reload waits and the set is kept; - at most one reload in every run.  Code: `src/db.js` unchanged from ac7bab1 (only the counter versus main). Related tests 23/23. **Full npm test on 2747e37: 465 pass, 0 fail** (run by release). Note: a held save's draft is lost by the reload that follows; acceptable, and the toast says why. |
| Q-02 | release | verified | Q-01 | Verify 3.11.0 (PR #20) | [club #20](https://github.com/shahafrach/haimunia-club/pull/20) | Re-run update.mjs (up to date, update, offline, error, set kept, no controller at boot plus a slow save, at most one reload), the db tests, and the F-010 checks. **release 2026-11-15:** functionally verified (see Q-01). Blocked only on release details: PR #20 still says 3.10.0 and has no CHANGES entry. Q-11. **release 2026-11-15:** 3.11.0 ready to ship at ec9e381. **Shahaf:** create rollback-3.10.0 at main, merge PR #20, and check that https://haimunia.pages.dev/sw.js says 3.11.0. |
| Q-03 | fixes | verified | Q-02 | 3.12.0: anonymous client error reports and the feedback box (backend migration `202611150003`, then the club app) | [demo #178](https://github.com/shahafrach/haimunia-app-demo/pull/178), [club #22](https://github.com/shahafrach/haimunia-club/pull/22) | Backend #178 head `fa5826f`: migration 202611150003, pgTAP 0158 + 0113/0134/0135/0138; CI migration-check PASS (59 files, 1761 tests); full npm test 1621/0. Review finding fixed: the IP is cf-connecting-ip, else the last x-forwarded-for entry (which headers this project's PostgREST gets is to be confirmed after deploy). Club #22 head `ba5540e` (3.12.0): src/errors.js, src/feedback.js (both OPTIONAL_ASSETS; sw-precache test names exactly these two), privacy sections 6 and 7, rollback-3.11.0 in the PR; test/errors-feedback.test.mjs 15/15; full npm test 480/0; browser checks not run. Deploy #178 first. **release 2026-11-15:** see Q-04. |
| Q-04 | release | verified | Q-03 | Verify 3.12.0 (both PRs; pgTAP in CI; real Chromium) | – | – **release 2026-11-15:** both PRs verified. **Backend #178 (fa5826f):** CI all green (migration-check, node-tests, user-tests, browser-checks); it merges cleanly with main. Migration reviewed: two definer functions with an empty search_path, granted to anon and authenticated; every field validated; the hash, IP and key helpers have no grant at all; both tables have RLS on with no policies and every client grant revoked, and no user, device or IP column; global daily caps come before the per-IP and per-device HMAC counters; both purges are scheduled; feedback_by_screen is granted to no role and refuses any auth.uid(). **Club #22 (ba5540e, 3.12.0):** real Chromium 20/20 with a faked backend: one sanitized error report (Hebrew, quoted text and the URL gone) with exactly the 9 allowed fields; 5 per page load; nothing when usage counting is off; the Settings row opens the sheet "מה לא עובד טוב?"; feedback carries exactly the 6 allowed fields and the typed text; "תודה. קראנו כל פנייה."; offline it says "נשלח כשיהיה חיבור", queues, and sends when back online; Escape closes it; it fits 390 px; the storage error shows the link and is reported as kind storage; no other request left the page. Related tests 70/0; src/db.js untouched; check-version OK; the privacy sections match the approved wording. **Non-blocking notes:** (a) feedback opened from the Settings row preselects the current tab, not "הגדרות"; (b) a 400 from feedback_submit is queued and retried at every start (at most 5 entries); (c) if 3.12.0 ships after 15.11, privacy.html "עודכן לאחרונה" needs the ship date; (d) fixes' open point: whether PostgREST receives cf-connecting-ip, to check after deploy (the global caps hold either way). **Shahaf:** run backup-database; merge demo #178; wait for migration-status green; create rollback-3.11.0 at main; merge club #22. |
| Q-05 | fixes | verified | – | Log screen redesign, step 1: 2 or 3 layout options for Shahaf to choose from | [club #21](https://github.com/shahafrach/haimunia-club/pull/21) | Draft PR, head `5a627ca`, branch `claude/log-layout-07dvsw`. Options A (controls first) and B (pinned dock), prototype behind `?layout=a` or `?layout=b`, screenshots at 390×844 and 360×780 in the PR. Both fit with no scroll; 3 identical sets: 6 taps + 1 swipe today, 5 taps + 0 swipes in A and B. Related jsdom: 82 pass, 0 fail. **release 2026-11-15:** verified as step 1. The prototype acts only with the query parameter; without it the screen is unchanged; `src/db.js` untouched; draft PR. Shahaf chose **A**, so step 2 is Q-09. |
| Q-06 | release | verified | – | Verify haimunia-app-demo #167 (club-admin: the username never reaches the public log) | [demo #167](https://github.com/shahafrach/haimunia-app-demo/pull/167) | Merges cleanly into main. Workflow-only.  **release 2026-11-15:** the diff is sound. The username is read from the event file and masked before use; no `env:` holds `inputs.who`. The merge with main (af491fe) passes `test/club-workflows.test.mjs` 10/10. CI on c6fd6eb was all green, but on an old base. Shahaf: press Update branch, wait for green, merge, and delete the logs of run 43255246472. Merged by Shahaf (2026-11-15). |
| Q-07 | release | done | – | Triage stale PRs: #162, #167, dependabot | – | #162: superseded (`docs/club/research.md` is on main; the branch conflicts): Shahaf closes it. #167: Q-06. Dependabot #153, #155, #174, #175, #176, #177: held until after launch (Q-08). Shahaf closes #162 (decided 2026-11-15). #162 closed by Shahaf (2026-11-15). |
| Q-08 | release | blocked | Q-21 | Dependabot in haimunia-app-demo after launch: #153 setup-cli, #155 supabase-js, #174 claude-code-action, #175 fake-indexeddb, #176 playwright 1.65 (browser-check), #177 jsdom 31 | – | Held until after launch (owner, 2026-11-15). #176 is a deliberate exact pin (scripts/browser-check/package.json: moving it means re-measuring). #177 is a jsdom major. Each one gets a full CI run on a branch updated from main. **release 2026-11-15:** launch postponed; take these after the gate pass (Q-21), one at a time. |
| Q-09 | fixes | verified | Q-01 | 3.13.0: log screen layout A, step 2 (implement for real, on PR #21) | [club #21](https://github.com/shahafrach/haimunia-club/pull/21) | Built on PR #21 (still draft), head `9138468`. Layout A in DOM order; prototype, option B, #logDock, seg comments and docs/ screenshots removed; sink pin back to 40. Prefill on pick + "פעם קודמת", "עוד סט זהה" via saveSet(), 56/52 px targets, inline "נשמר" instead of the toast on the log screen. log-layout-fits.mjs 19 PASS / 0 FAIL (both sizes, PR card then share question, plate visualizer). Existing checks equal to main (training-log-polish 59/2 on both); ladder/superset/duration/%/log-UX checks now open "עוד אפשרויות" first. jsdom: test/log-layout.test.mjs 7/7; full npm test 463 pass, 0 fail. **Not yet:** rebase + version 3.13.0 + CHANGES + rollback command, which the prompt puts after 3.12.0 merges; I will do them then. Playwright 1.63.0 locally (pin is 1.62.1); axe scan cannot run (no axe-core). **release 2026-11-15:** 3.12.0 is verified (Q-04). Rebase onto main after club #22 merges, then do the version 3.13.0 details. **release:** waits for club #22 (3.12.0) to merge; the date condition is dropped (owner, launch postponed). **release 2026-11-15:** club #22 merged (d8f4672), so the rebase and the 3.13.0 details can start now. **Version step done 2026-11-15:** rebased on main d8f4672 (3.12.0), 3.13.0 + CHANGES + rollback-3.12.0, PR #21 out of draft; head `ef38950`; log-layout-fits 19/0; related 55/0; full npm test 487/0. **release 2026-11-16:** see Q-10. |
| Q-10 | release | verified | Q-09 | Verify 3.13.0 (layout A) | [club #21](https://github.com/shahafrach/haimunia-club/pull/21) | Real Chromium at 390×844 and 360×780; the PR, share, sanity and plate flows; jsdom; data-shape check. **release 2026-11-16:** 3.13.0 verified on ef38950: based on main d8f4672, both versions 3.13.0 (check-version OK), src/db.js untouched, no new write path. "עוד סט זהה" and the prefill only set the steppers and then go through saveSet(), so the sanity confirm, PR detection, the share question and the F-020 guard all apply. Real Chromium: log-layout-fits 19/0 at both sizes; my per-workout sharing check 21/0 (PR card, then the share question; לשתף and לא הפעם; edit asks nothing); the repeat button is hidden while editing an older set and when logging for a past day, so it never overwrites or misdates a set. Related tests 57/0; fixes' full npm test 487/0. **Shahaf:** create rollback-3.12.0 at main, merge club #21, and check that sw.js says 3.13.0. |
| Q-11 | fixes | verified | – | 3.11.0 release details on PR #20 | [club #20](https://github.com/shahafrach/haimunia-club/pull/20) | Head `ec9e381` on PR #20. APP_VERSION/SW_VERSION 3.11.0 (`check-version` OK), CHANGES.md 3.11.0 entry at the top, rollback-3.10.0 command and the new title in the PR text. No code change since 2747e37. `test/update-check.test.mjs`: 9 pass, 0 fail. **release 2026-11-15:** the diff from 2747e37 to ec9e381 touches only the version lines (3.11.0 in app.js and sw.js) and CHANGES.md. `check-version` OK. It merges cleanly with main ccd1946 (docs only on main). |
| Q-12 | release | done | – | CI/CD security sweep after the wfx-loot campaign report (owner request 2026-11-15) | – | Advisor already checked haimunia-club and haimunia-app-demo: no PR or branch matching "docs: dependency audit notes" or wfx, no workflow-run number gaps in the last 100 runs, no pull_request_target, actions pinned by SHA, claude-review skips forks. Still to do: see section below. **release 2026-11-15:** (1) Old app haimuniya/haimunia-app: 9 PRs, all by shahafrach or haimuniya; branches all known; nothing titled "docs: dependency audit notes" or containing wfx; 77 workflow runs with run numbers 1..71 and no gaps; actors are only the owner's two accounts. Its only workflow is test.yml (push and pull_request, contents: read, no secrets), with actions/checkout@v4 and setup-node@v4 not pinned to a SHA: F-022, low; no task while the old app is frozen. (2) demo claude-review.yml: the issue_comment and pull_request_review_comment paths have no author_association guard, and the job reads CLAUDE_CODE_OAUTH_TOKEN with pull-requests: write and id-token: write. I could not confirm here whether claude-code-action refuses actors without write access (its source is outside this session's repositories). Add the guard regardless: F-021, medium, fix in Q-13. (3) Secrets referenced by workflows (the full secret list needs the repo settings): SUPABASE_ACCESS_TOKEN (11 workflows, all workflow_dispatch, schedule or push to main), BACKUP_PASSPHRASE (backup-database), ALERT_WEBHOOK_URL (scheduled-job-alert), CLAUDE_CODE_OAUTH_TOKEN (claude-review). The only secret readable by a workflow that untrusted input can start is CLAUDE_CODE_OAUTH_TOKEN (F-021). test.yml and e2e.yml run on pull_request with no secrets. haimunia-club has no workflows. (4) Recorded as F-021 and F-022 in FINDINGS.md (docs branch claude/adoring-dijkstra-yteqeb). |
| Q-13 | fixes | verified | – | haimunia-app-demo claude-review.yml: author_association guard on comment triggers (F-021) | [demo #179](https://github.com/shahafrach/haimunia-app-demo/pull/179) | Head `dc35fac`. Both comment branches of the job-level if: require author_association OWNER/MEMBER/COLLABORATOR; pull_request keeps its same-repo check; nothing else changed, pins intact. claude-code-action at ae68417 does check write access itself (run.ts → checkWritePermissions → getCollaboratorPermissionLevel, admin/write only; [bot] actors and allowed_non_write_users bypass), but inside the job after the runner and OIDC start, so the guard stays. workflow-minutes + workflow-action-pinning 41/0 (new test fails on main); full npm test 1622/0. **release 2026-11-15:** verified on dc35fac. The guard is on both comment paths, the pull_request path is unchanged, and every action is still pinned. The workflow tests (minutes and pinning) pass 41/0 on dc35fac. It merges cleanly with main 4ce4542. In CI, migration-check and the edge-function jobs are green; node-tests and browser-checks were still running at the check. **Shahaf:** merge demo #179 when its CI is all green (workflow only, so no backup needed). |
| Q-14 | fixes | verified | demo #178 merged | F-005: renumber and ship the RLS initplan migration (haimunia-app-demo #172) | [demo #172](https://github.com/shahafrach/haimunia-app-demo/pull/172) | Head `f91e6f6` on demo #172, all CI checks green (migration-check included). Migration renamed to 202611150004_rls_auth_uid_initplan.sql after #178. Full `npm test` 1622 pass, 0 fail; related 27 pass, 0 fail. `supabase test db` not runnable here (no Docker); CI's migration-check ran pgTAP green. **release 2026-11-16:** verified on f91e6f6. The migration content is identical to the reviewed 7e26970 except its header comment (43 alter policy statements, each only wrapping auth.uid() in a select). None of those policies was redefined by any migration after 2026-11-14, so the snapshot still holds. It is the newest migration (after 202611150003) and merges cleanly with main. CI is all green, migration-check (pgTAP) included. **Shahaf:** after the advisor's backup-database, merge demo #172 and wait for migration-status green. That closes F-005. |
| Q-15 | fixes | verified | – | F-014: a synthetic 3-year member log; backup, import and transfer-code size tested | [club #25](https://github.com/shahafrach/haimunia-club/pull/25) | Head `22ed09f`, no app change. Fixture: 6,249 sets / 40 movements, 469 WODs / 30 custom, 1,096 body weights, 144 measurements, 262 Hebrew notes (7,998 records). Old-app import and export→reimport lossless (counts + SHA-256 per record). Import = 1 readwrite transaction, 213–270 ms in jsdom (bound 3000 ms). **Transfer ciphertext 142,700 bytes = 13.6% of 1 MiB**, so the too-large path is not hit. Chromium 390×844 (unthrottled / CPU 4×): import 739 ms; cold open 218 / 448 ms; log tab 13–28 / 23–94 ms; **history 80–102 / 318–450 ms (slowest)**; calendar 31–47 / 81–169 ms. No console errors. Related tests 13/0; full `npm test` 485 pass, 0 fail. **release 2026-11-16:** verified on 22ed09f (club #25), tests only, no app file changed. The fixture regenerates byte-identical from its seed (3.1 MB, under test/, which the site does not serve). heavy-log, old-app-backup-imports and middleware tests: 13/0. Lossless import and re-import (every record hashed). Transfer ciphertext 142,700 bytes, about 7× under 1 MiB. Chromium timings are acceptable; history is the slowest tab at 318–450 ms with CPU throttled 4×, noted, not a finding. F-014 closes when #25 merges. **Shahaf:** merge club #25 (tests only, no release). |
| Q-16 | fixes | verified | Q-10 | 3.14.0: small fixes: F-019, and the two feedback notes from Q-04 | [club #26](https://github.com/shahafrach/haimunia-club/pull/26) | Low items, bundled into one release. **release 2026-11-16:** available now; Q-10 is verified. Branch from club #21 (3.13.0) and rebase after it merges. **fixes 2026-11-16:** draft PR #26, head `2e379c5`, stacked on #21; rebase after #21 merges. 3.14.0 (check-version OK), CHANGES entry, rollback-3.13.0 command in the PR. (1) F-019 `hasAnyMemberData()` gates the sheet; twin `transfer.js hasData()` now uses it too. (2) Settings row → הגדרות. (3) 4xx except 408/429 not queued, says 'המשוב לא נשלח. נסו לקצר או לנסח אחרת.' and keeps the draft; refused queued entries dropped on flush. Related 36/0; full `npm test` 491 pass, 0 fail. No browser check run (no layout change). **release 2026-11-16:** verified on 2e379c5 (draft #26, stacked on #21); src/db.js untouched; check-version 3.14.0; CHANGES entry present. hasAnyMemberData() reads only arrays loaded from IndexedDB (nothing is seeded at first run), and the transfer twin uses the same rule. Real Chromium, as an installed app: on a fresh install the import sheet still shows; with only a body weight logged it no longer shows. Feedback: a 4xx other than 408 or 429 is not queued and keeps the draft; a refused entry already queued is dropped. Related tests 38/0; fixes' full npm test 491/0. **After #21 merges:** fixes rebases #26 onto main and takes it out of draft; release re-checks the rebased diff only. Then **Shahaf:** create rollback-3.13.0 and merge #26. **fixes 06:30:** #21 merged; #26 rebased cleanly onto main 5aee5e9, head `103a2f2`, marked ready. Related 37/0 after rebase. **release 2026-11-16 06:58:** re-checked 103a2f2. It is based on main 5aee5e9 and its diff against main is line-for-line the diff I verified. Ready to ship. **Shahaf:** create rollback-3.13.0 at main, merge club #26, and check that sw.js says 3.14.0. |
| Q-17 | fixes | done | Q-16 | 3.15.0: percentage chart from each lift's 1RM (50% to 95%) on the exercise screen | [club #28](https://github.com/shahafrach/haimunia-club/pull/28) | Post-launch list. Computed on the phone, no data change. **release 2026-11-16:** available; Q-16 is verified. Branch from #26 and rebase after it merges. **fixes 2026-11-16:** draft #28, head `ac73f6b`, stacked on #26; rebase after #26 merges. 3.15.0 (check-version OK), CHANGES, rollback-3.14.0 command. Chart 95–50% of bestEst1RM, nearest bar+1.25 kg pairs, plates per side ('לכל צד: 25 + 25 + 1.25' / 'מוט ריק'); non-barbell 2.5 kg, no plates; no-1RM one line. **Decision for release:** chips are always on in this edition, so the chart sits under them, collapsed; `strength-pct-and-rx-plus.mjs`'s 'never two surfaces' assertion changed to 'chart collapsed'. Chips and chart agree at the 2.5 kg increment on 20/15 kg bars (jsdom-pinned); they differ on the 8 kg bar or 1/2 kg increments by design. Also fixed: plate 1.25 printed as '1.3'. jsdom percentage-chart 6/0; related 35/0; Chromium percentage-chart 18/0 at 390×844 and 360×780; log-layout-fits 19/0; strength-pct all PASS; full `npm test` 497 pass, 0 fail. |
| Q-18 | fixes | done | Q-17 | 3.16.0: personal weekly streak, no leaderboard | [club #29](https://github.com/shahafrach/haimunia-club/pull/29) | Post-launch list. Computed on the phone, no data change. **fixes 2026-11-16 (owner: post-launch rows in scope now):** draft #29, head `a5d2216`, stacked on #28 → #26. 3.16.0 (check-version OK), CHANGES, rollback-3.15.0 command. Streak card on התקדמות: Sun–Sat weeks by Asia/Jerusalem date, current week counts once it has one; computed at render, nothing stored or sent. weekly-streak 6/0 (Sat-night/Sun-morning, DST March/October/summer, empty, gap, date change); related 34/0; full `npm test` 503 pass, 0 fail. |
| Q-19 | fixes | done | Q-18 | 3.17.0: monthly personal summary card (workouts, PRs, best lift) | [club #30](https://github.com/shahafrach/haimunia-club/pull/30) | Post-launch list. Reuses the PR and streak calculations. **fixes 2026-11-16:** draft #30, head `34a5356`, stacked on #29 → #28 → #26. 3.17.0 (check-version OK), CHANGES, rollback-3.16.0 command. 'סיכום חודשי' on התקדמות: last full month + this month (Jerusalem dates, Hebrew names): workouts (lift/WOD days), PRs (celebratablePrEntryIds), best lift by clubPrPercent else heaviest set, streak line; empty month one line. **For release:** progress-no-duplicate-lifts now counts the lift name outside the summary card (the card names the best lift in prose; it has no rows or data-id). Fixed in Chromium: '+10%' rendered '10%+' → LTR bdi. monthly-summary 5/0; related 33/0; Chromium monthly-summary 16/0 at 390×844 light and dark (contrast ≥5.43); full `npm test` 508 pass, 0 fail. |
| Q-20 | release | blocked | Shahaf | Standard template repository from haimunia-club | – | Needs Shahaf to create an empty repository and add it to the session. release then writes the fixes row. |
| Q-21 | release | todo | Q-13, Q-14, Q-15, Q-16 | The full real-Chromium pass on the live site (launch gate, in place of the Cursor final pass if Cursor has not run) | – | install banner, transfer code, log a set, share, delete account, update button, feedback box, layout A; fake backend, no production data. |
| Q-22 | release | doing | first real report | After 3.12.0 is live: confirm which IP headers the database receives for client_error_report and feedback_submit (per-IP limits, see backend #178) | – | Added by the advisor 2026-11-15. If no usable IP header arrives, the per-IP limit is a no-op and only the global and per-device caps hold: record a finding with severity and a fix plan. Use one test call each, and note the test rows so the purge or a manual delete removes them. **release:** renumbered from Q-14, which clashed with the F-005 row; text unchanged. Note: it writes one test row in each production table; done only because the owner asked for it here. **release 2026-11-15, part 1, read-only, no test rows:** 3.12.0 is live (sw.js 3.12.0). The API gateway logs show every live request in the last 24 h arriving with `cf-connecting-ip` and `x-forwarded-for`. The database already reads request.headers (89 usage rows have app=club, which is set from the Origin header). No error report or feedback row exists yet, so no rate counter yet. Part 2: on the first real report, check whether the counter's ip_hash equals the hash of 'unknown' (no IP header reaches the database) or not (one does). The test calls are not needed while real traffic can answer this; this session cannot reach the API host anyway. **release 2026-11-16:** part 2 not run: the Supabase connector failed to connect this session (503). Retry at the next check-in. **release 2026-11-16 06:20:** retry failed: the Supabase connector answers "Failed to resolve project for permission check". Retry at the next check-in. **release 2026-11-16 06:58:** the connector still fails; retry at the next check-in. |
| Q-23 | release | blocked | – | scheduled-job-alert in haimunia-app-demo fails on every run since 2026-11-13 ("2 scheduled job(s) are failing", club admins notified in-app), but public.scheduled_job_health() where not healthy returns 0 rows now | – | Added by the advisor 2026-11-16. Find which 2 jobs job_health_state lists and why, whether the state is stale or the jobs really fail (cron.job_run_details, read only). If a job fails, write a fixes row with the fix. If the state is stale, fix the alert logic so it does not cry wolf, because club admins get an in-app notice each time. **release 2026-11-16:** analysis from the code (sibling 202609220001, 202609190001). The alert reads job_health_state, which job_health_check() writes every hour. That function flags a job if ANY run failed in the last 24 h, or if it has not run within cron_cadence_window() (2 days for a daily job, 3 h for an hourly one). scheduled_job_health() looks only at the LATEST run, within 8 days. So two jobs that fail now and then but succeed later show as failing in one and healthy in the other. Recorded as F-023 (low). Next step: name the two jobs. Blocked: the lead session's Supabase connector fails ("Failed to resolve project for permission check"). Either the connector comes back, or **Shahaf** runs the read-only SQL below in the SQL editor and pastes the result into this row's Notes: `select failing_jobs, last_checked_at from public.job_health_state; select j.jobname, d.status, d.start_time, left(d.return_message,160) from cron.job_run_details d join cron.job j using (jobid) where d.status='failed' and d.start_time > now() - interval '3 days' order by d.start_time desc limit 30;` |

## Owner decisions (from Shahaf)
- 2026-11-16: F-007 (CSP style-src 'unsafe-inline'): option (a), accept as low. release: mark it accepted in FINDINGS.md with the reason (no script injection path, styles only), so it is not a launch gate.
- 2026-11-16: F-005 (demo #172) merged at 06:23 UTC after a green backup-database run.
- 2026-11-15 (later): **Launch is postponed. No date.** Quality first, launch after. The 22.11 launch and the 20.11 freeze are cancelled. Every "before launch only if verified by 20.11" condition is dropped: everything planned ships when it passes verification.
  Launch happens only when all gates are green: C4-2 on a real iPhone, G4 approved, the Cursor final pass (or release's full real-Chromium pass), Q-12 clean, and no open critical, high or medium finding. release keeps this gate list current in FINDINGS.md.
  After 3.12.0 and 3.13.0, release plans the next quality work from FINDINGS.md and the post-launch list (monthly summary, weekly streak, % chart, F-019, F-005 renumbered, template repo) and adds the rows itself.
- 2026-11-15: **Run to the end without waiting for "continue".** After finishing a task, take the next available row at once. Do not end the turn while you own an available row.
  When every row you own is waiting on the other session, schedule one check-in to yourself with send_later in 30 minutes ("continue the queue"), then end the turn. On that check-in, pull coord and continue. No sleep loops or polling inside a turn.
  A row that needs Shahaf (merge, tag, iPhone check, decision) never stops you: list it once under "Waiting for Shahaf" at the top of QUEUE.md, then keep working on every other row you can act on, and keep scheduling the 30-minute check-in. Stop for good only when no row anywhere is actionable by you.
  Do not wait for merges to start the next task: branch the next work from the PR branch it depends on, and rebase after the merge. The advisor runs backup-database before migration merges and tells Shahaf when to merge.
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



## Q-12: CI/CD security sweep
```
1. haimuniya/haimunia-app (old app): the same checks the advisor ran on the other two repos. PRs or branches titled "docs: dependency audit notes" or containing "wfx", unknown PR authors, gaps in workflow run numbers, pull_request_target, unpinned actions, and which secrets exist. Read only.
2. haimunia-app-demo claude-review.yml: issue_comment and pull_request_review_comment have no author_association guard. On a public repo, anyone can comment "@claude" on an open same-repo PR, and the job then runs with CLAUDE_CODE_OAUTH_TOKEN and pull-requests: write. Confirm whether claude-code-action itself refuses actors without write access. Either way, add a job-level guard: github.event.comment.author_association in OWNER, MEMBER, COLLABORATOR. Write it as a todo row for fixes with the exact prompt.
3. List every repository secret in both repos and which workflows can read each one. Flag any secret readable by a workflow that untrusted input can trigger.
4. Record the result in FINDINGS.md: a row per real issue, or one line "CI sweep 2026-11-15: clean".
```

## Q-13: claude-review guard (F-021)
```
Lead here. haimunia-app-demo .github/workflows/claude-review.yml: the issue_comment and pull_request_review_comment paths have no author_association guard. On this public repository anyone can comment "@claude" on an open same-repo PR, and the job then reads CLAUDE_CODE_OAUTH_TOKEN with pull-requests: write and id-token: write. (F-021 in haimunia-club FINDINGS.md.)
- In the job-level if:, add to both comment branches:
  contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
  The pull_request: opened branch keeps its same-repo check; only accounts with write access can push a same-repo branch.
- Change nothing else in the workflow. Keep every action pinned by SHA.
- Add an assertion to the workflow tests (the file that reads .github/workflows) that both comment paths carry the guard.
- In the PR, say whether anthropics/claude-code-action at the pinned SHA also checks the actor's write permission (read its source at that SHA). Either way the guard stays.
Run that test file, then one full npm test in the foreground, and put the counts in Notes. Workflow-only: no migration, no backup needed. Do not merge.
```

## Q-14: F-005, ship the RLS initplan migration
```
Lead here. haimunia-app-demo PR #172 (F-005, RLS auth.uid() initplan) was held. The launch is postponed and F-005 is a medium finding, so it now ships. Start only after demo #178 (202611150003) is merged: one open migration branch at a time.
- Rebase #172 on main. Rename supabase/migrations/202611150001_rls_auth_uid_initplan.sql to the next free version after the newest migration on main (202611150004 if nothing else landed). It was never applied, so renaming is allowed. Update test/f005-rls-initplan.test.mjs to the new name.
- Re-read the pg_policies definitions it alters against main: a policy changed by any migration after 2026-11-15 (202611150002, 202611150003, or later) must keep that later definition, with only auth.uid() wrapped. Check the new tables from 202611150003 too: they have no policies, so they need nothing.
- Wait for CI green on the rebased head (migration-check runs pgTAP, including 0148 aal2 and the RLS boundary tests). Take the PR out of draft and drop [HOLD] from its title.
- In the PR text: "The advisor runs backup-database before merge."
Put the counts and the head SHA in Notes and set done. Do not merge.
```

## Q-15: F-014, a synthetic 3-year member log
```
Lead here. F-014: no audit ever imported a real long-time member's log; C4 used test/fixtures/old-app-backup-v1.json. Build a realistic heavy fixture instead (no real member data).
- scripts/make-heavy-fixture.mjs, deterministic (seeded): 3 years of a heavy member. 5 training days a week; 6 to 10 sets a day across about 40 movements, custom movements included; a WOD on 3 days a week from about 30 custom WODs; daily body weight; 4 measurement types monthly; a session note on about one day in three, in Hebrew, up to 300 characters. Write test/fixtures/heavy-3y-backup.json in the old app's backup format (the one old-app-backup-imports reads), plus the same data in this app's own format.
- test/heavy-log.test.mjs:
  (a) import the old-app file into a fresh app; every entity count and a hash of every record match;
  (b) export, then import into another fresh app: lossless (the same checks);
  (c) the import finishes in one transaction within a time bound you measure and state;
  (d) build the transfer-code payload (buildBackupPayload plus prefs, gzip) and report its size against MAX_CIPHERTEXT (1 MiB). If it is over the limit, the test asserts the member gets "היומן גדול מדי להעברה בקוד. אפשר להשתמש בקובץ גיבוי." and the backup-file path works. Put the measured size in Notes.
- One real-Chromium check, scripts/browser-check/heavy-log.mjs: open the app with the imported heavy log, then measure and state the time to first render of the log, history and calendar tabs at 390×844. Use no fixed threshold; release judges the numbers.
- If anything fails or is clearly slow, stop and write it in Notes for release; no app change in this row.
Run the related tests and the check, then one full npm test, and put the counts in Notes. Do not merge.
```

## Q-16: 3.14.0, small fixes
```
Lead here. After 3.13.0 merges. One release, 3.14.0, three small items:
1. F-019: the first-launch "יש לכם כבר נתונים?" sheet counts only lifts and WODs (totalLoggedEntries). Count body weight, measurements and custom WODs too, so a member who logs only those never sees it again. A jsdom test.
2. Feedback opened from the Settings row preselects "הגדרות" (data-feedback-open="settings"), not the tab under Settings.
3. Feedback queue: a 4xx answer from feedback_submit (the server refused the fields) is not queued for retry; tell the member "המשוב לא נשלח. נסו לקצר או לנסח אחרת." and keep the draft. Only a network failure or a 5xx is queued.
Version 3.14.0, a CHANGES.md entry and the rollback command in the PR. Related tests, then one full npm test; counts in Notes. Do not merge.
```

## Q-17: 3.15.0, percentage chart
```
Lead here. After 3.14.0 merges. On the exercise screen, a percentage chart from the lift's current estimated 1RM: 50%, 55% … 95%, each with the weight rounded to the nearest loadable weight (bar plus the plate set the app already uses) and the per-side plates.
- Calculated on the phone from existing entries. No new store, field or setting. RTL, tokens only, 44 px targets, no horizontal scroll at 360 px.
- No 1RM yet (fewer than one weighted set): say so in one line, with no chart.
- The 1RM uses the formula the app already uses, so the numbers match the existing 1RM line.
- A jsdom test (rounding, plates, no-1RM case) and one real-Chromium check at 390×844 and 360×780.
Version 3.15.0, a CHANGES.md entry and the rollback command. Related tests, then one full npm test; counts in Notes. Do not merge.
```

## Q-18: 3.16.0, weekly streak
```
Lead here. After 3.15.0 merges. A personal weekly streak: the number of consecutive weeks (Sunday to Saturday, Asia/Jerusalem) with at least one logged workout (a lift or a WOD), the current week counting once it has one.
- Shown on the progress (התקדמות) screen. Personal only: never sent to the club, no leaderboard, nothing in the share prompt.
- Calculated on the phone, with no stored field. Changing a past date recalculates it.
- jsdom tests: week edges on Saturday night and Sunday morning, DST weeks, an empty log, and a gap week.
Version 3.16.0, a CHANGES.md entry and the rollback command. Related tests, then one full npm test; counts in Notes. Do not merge.
```

## Q-19: 3.17.0, monthly summary card
```
Lead here. After 3.16.0 merges. A monthly personal summary card on the progress screen: for the last full month (and the current month so far), the number of workouts, PRs (the app's own PR detection), and the best lift (the highest estimated 1RM gain or heaviest set, the same rule as the PR card), plus the weekly streak from 3.16.0.
- Calculated on the phone, no data change, never sent anywhere. Hebrew month names and Israeli formats.
- An empty month says so in one line.
- jsdom tests, and one real-Chromium screenshot check at 390×844 in light and dark.
Version 3.17.0, a CHANGES.md entry and the rollback command. Related tests, then one full npm test; counts in Notes. Do not merge.
```

