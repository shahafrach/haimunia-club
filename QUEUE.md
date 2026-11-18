# QUEUE (slim)

Full history: QUEUE-archive.md on this branch. Do not read it unless a row points there.

## Waiting for Shahaf
- F-023: advisor ran backup-database (green). Merge demo #181, then migration-status and deploy-edge-functions green, then run set-vault-secrets.
- F-028: after #181 is live, advisor runs backup-database again, then merge demo #182 (mark ready first), migration-status green.
- Ship 3.18.0: merge club #33 (rollback-3.17.1 at dc02722 when at a computer).
- Ship 3.18.1 after fixes does Q-33: merge club #37.
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
| Q-33 | fixes | todo | Q-32 merged | Release club #37 (F-025, F-026) as 3.18.1 | [club #37](https://github.com/shahafrach/haimunia-club/pull/37) | Verified in Q-30. Prompt below. |
| Q-08 | release | blocked | Q-21 | Dependabot in haimunia-app-demo after launch: #153 setup-cli, #155 supabase-js, #174 claude-code-action, #175 fake-indexeddb, #176 playwright 1.65 (browser-check), #177 jsdom 31 | – | Held until after launch (owner, 2026-11-15). #176 is a deliberate exact pin (scripts/browser-check/package.json: moving it means re-measuring). #177 is a jsdom major. Each one gets a full CI run on a branch updated from main. **release 2026-11-15:** launch postponed; take these after the gate pass (Q-21), one at a time. |
| Q-20 | release | blocked | Shahaf | Standard template repository from haimunia-club | – | Needs Shahaf to create an empty repository and add it to the session. release then writes the fixes row. |

## Q-32 prompt (fixes)

On club #33's branch, after rebasing on main (3.17.1, 37e1920 or later): set APP_VERSION to 3.18.0 and run `npm run sync-version`; add the CHANGES.md entry at the top `# 3.18.0 — תמיכה ודיווח על תקלה דרך תיבת המשוב — <date>` (what changed: the menu row opens the feedback box; the WhatsApp/email support sheet and the duplicate Settings row are gone; privacy §8 updated); bump the privacy policy's "last updated" date to the release date, since §8 changed. Put in the PR body for Shahaf the rollback command for `rollback-3.17.1` at main (CLAUDE.md, "Releases"). Run the related tests and one full `npm test`; paste the numbers. Mark Q-32 done.

## Q-33 prompt (fixes)

After club #33 (3.18.0) is merged to main: rebase #37 on main, set APP_VERSION to 3.18.1 and run `npm run sync-version`, add the CHANGES.md entry `# 3.18.1 — כפתור העדכון בביקור ראשון, ושם נגיש לכפתור תצוגת היומן — <date>` (F-025: in a first visit the update banner tap reloads; F-026: the calendar view button's accessible name starts with the visible word). Put the rollback-3.18.0 command in the PR body for Shahaf. Related tests and one full `npm test`; paste the numbers. Mark Q-33 done.

