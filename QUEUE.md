# QUEUE (slim)

Full history: QUEUE-archive.md on this branch. Do not read it unless a row points there.

## Waiting for Shahaf
- F-023: set-vault-secrets ran 2026-11-18 14:14 UTC (green, Vault cron secret 64 chars). Still broken, see Q-34.
- F-028: demo #182 merged 11:49 UTC, migration 202611180001 applied, main test and migration-status green. Closed.
- F-028: #181 is live and a backup-database ran after it (10:08, green), so demo #182 can go now: mark it ready, merge, wait for migration-status green. It does not depend on set-vault-secrets.
- 3.18.0 is live (club #33 merged, live sw.js 3.18.0, release 07:57 check). rollback-3.17.1 at dc02722 still to create from a computer.
- 3.18.1 is live (club #37 merged 4edb53a, live sw.js 3.18.1, release check 2026-11-18). F-025 and F-026 closed. rollback-3.18.0 at 9594a13 still to create from a computer.
- From a computer: Dependabot alerts on (F-030), rollback tags (list in archive), Turnstile check on box-log (F-008), empty template repo (Q-20).
- C4-2: iPhone Safari code -> installed app redeem passed (owner, 2026-11-18). Used-code retry still to confirm.
- G4: owner hands the launch message to the club manager, who writes it. Not a blocker for us (owner, 2026-11-18).

## Rules (owner, 2026-11-18, to save tokens)
1. Work only when Shahaf writes "continue". No send_later check-ins, no scheduled wake-ups.
2. Read only this file. Keep it short: when a row is verified, delete its prompt section and move the row to the archive.
3. haimunia-app-demo has CI: run only the related test files locally, and let CI run the full suites. haimunia-club has no CI: one full `npm test` at the end of a code task.
4. Browser checks only for UI changes, and only the related check. No re-run of a suite that passed.
5. Reports: at most 8 lines. No restating the diff.
6. Launch blockers: C4-2 used-code retry, Turnstile. F-028 closed, G4 with the club manager. F-023, F-029, F-007 are not blockers.

## Open rows
| ID | Owner | Status | After | Task | PR | Notes |
|----|-------|--------|-------|------|----|-------|
| Q-34 | fixes | done | – | F-023 regression: cron calls to notif_push_send get 401 UNAUTHORIZED_INVALID_JWT_FORMAT from the Supabase gateway (every 3 min since #181, still after set-vault-secrets 14:14). The cron now sends EDGE_CRON_SECRET, not a JWT, and supabase/config.toml has no verify_jwt = false for the two functions that call isScheduledCaller. | [demo #183](https://github.com/shahafrach/haimunia-app-demo/pull/183) | In haimunia-app-demo: add [functions.notif_push_send] and [functions.purge_abandoned_profiles] with verify_jwt = false (the function's own isScheduledCaller check stays the gate). Check deploy-edge-functions.yml honours config.toml (or passes --no-verify-jwt). Add a test that every function using isScheduledCaller has verify_jwt = false. Sibling twins: grep isScheduledCaller and cron_invoke_edge_function. No migration. After merge, release verifies net._http_response shows 200 for notif_push_send. **fixes 2026-11-18:** config.toml verify_jwt = false for both; deploy workflow reads config.toml (no flag needed); new test in edge-cron-secret fails without it. Related 34/0. Twin recap_weekly already unscheduled (strip_gym). |
| Q-08 | release | blocked | Q-21 | Dependabot in haimunia-app-demo after launch: #153 setup-cli, #155 supabase-js, #174 claude-code-action, #175 fake-indexeddb, #176 playwright 1.65 (browser-check), #177 jsdom 31 | – | Held until after launch (owner, 2026-11-15). #176 is a deliberate exact pin (scripts/browser-check/package.json: moving it means re-measuring). #177 is a jsdom major. Each one gets a full CI run on a branch updated from main. **release 2026-11-15:** launch postponed; take these after the gate pass (Q-21), one at a time. |
| Q-20 | release | blocked | Shahaf | Standard template repository from haimunia-club | – | Needs Shahaf to create an empty repository and add it to the session. release then writes the fixes row. |
