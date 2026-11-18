# QUEUE (slim)

Full history: QUEUE-archive.md on this branch. Do not read it unless a row points there.

## Waiting for Shahaf
- F-023: #181 is live (migration 202611160001 applied, migration-status and deploy-edge-functions green 07:42). **Only step left: run set-vault-secrets** in haimunia-app-demo Actions. Release check 11:10 UTC (read only): the Vault cron secret is still the placeholder, notif_push_send answered 401 to all 60 calls in the last 3 h (last 11:09), job_health_state failing = [edge: notif_push_send]. Write "continue" after the run.
- F-028: #181 is live and a backup-database ran after it (10:08, green), so demo #182 can go now: mark it ready, merge, wait for migration-status green. It does not depend on set-vault-secrets.
- 3.18.0 is live (club #33 merged, live sw.js 3.18.0, release 07:57 check). rollback-3.17.1 at dc02722 still to create from a computer.
- Ship 3.18.1: merge club #37 (Q-33 verified on a8cb22d). Then rollback-3.18.0 from a computer.
- From a computer: Dependabot alerts on (F-030), rollback tags (list in archive), Turnstile check on box-log (F-008), empty template repo (Q-20).
- From the phone: C4-2 on a real iPhone, G4 club message.

## Rules (owner, 2026-11-18, to save tokens)
1. Work only when Shahaf writes "continue". No send_later check-ins, no scheduled wake-ups.
2. Read only this file. Keep it short: when a row is verified, delete its prompt section and move the row to the archive.
3. haimunia-app-demo has CI: run only the related test files locally, and let CI run the full suites. haimunia-club has no CI: one full `npm test` at the end of a code task.
4. Browser checks only for UI changes, and only the related check. No re-run of a suite that passed.
5. Reports: at most 8 lines. No restating the diff.
6. Launch blockers: F-028, F-025, F-026, C4-2, G4, Turnstile. F-023, F-029, F-007 are not blockers.

## Open rows
| ID | Owner | Status | After | Task | PR | Notes |
|----|-------|--------|-------|------|----|-------|
| Q-08 | release | blocked | Q-21 | Dependabot in haimunia-app-demo after launch: #153 setup-cli, #155 supabase-js, #174 claude-code-action, #175 fake-indexeddb, #176 playwright 1.65 (browser-check), #177 jsdom 31 | – | Held until after launch (owner, 2026-11-15). #176 is a deliberate exact pin (scripts/browser-check/package.json: moving it means re-measuring). #177 is a jsdom major. Each one gets a full CI run on a branch updated from main. **release 2026-11-15:** launch postponed; take these after the gate pass (Q-21), one at a time. |
| Q-20 | release | blocked | Shahaf | Standard template repository from haimunia-club | – | Needs Shahaf to create an empty repository and add it to the session. release then writes the fixes row. |
