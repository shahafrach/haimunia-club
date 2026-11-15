# Launch day: haimunia.pages.dev (22.11.2026)

One ordered list. Each line is one step and who does it. **Owner** = Shahaf. **Lead** = the lead session.
**Fixes** = the haimunia-fixes session. **Coach** = the club's coach. Backend steps in detail:
`shahafrach/haimunia-app-demo` `docs/club/LAUNCH.md`.

## Before (by 21.11)
1. Owner: confirm the five launch gates are done (FINDINGS.md, "Launch gates"); stop if one is open.
2. Lead: final pass on the live version in real Chromium, with a fake backend: install banner, transfer code, log a set, share, delete account, update button, feedback box (gate 5 fallback if Cursor has not run).
3. Owner: create `rollback-<live version>` at main and the final tag `v<live version>` (command in CLAUDE.md, "Releases").
4. Owner: check the install steps in the app (G6) against a real iPhone on iOS 26 (Safari share menu → "הוספה למסך הבית") and a real Android phone (Chrome ⋮ menu → install or add to home screen). Report any wording that does not match what the phone shows.
5. Owner: run backup-database in haimunia-app-demo (Actions).
6. Owner: Actions → `set-auth-config` → `anon_limit = 300`. Members at the gym share one IP, and the default limit blocks sign-ups after about 30 an hour. `auth-launch-limit.yml` lowers it to 60 after seven days.

## Launch
7. Fixes (after the owner says go): in haimuniya/haimunia-app, `app-config.js` `newApp.enabled: true`, bump the version, add a CHANGES.md entry, release. The old app then shows the move banner and "create transfer code".
8. Owner: check the old app (haimuniya.github.io/haimunia-app/) shows the move banner, and that it links to haimunia.pages.dev.
9. Owner: send the approved G4 club message with the club link.
10. Coach: open the club tab and check the coach tools are there ("כלי מאמן", "חברי המועדון", posting an announcement).

## First 24 hours
11. Owner, evening: Supabase dashboard → Auth logs. Look for rate-limit (429) errors on sign-up; if there are many, run step 6 again with a higher limit.
12. Lead, next morning: read-only check of database size, connections, new memberships and posts, the job-health state, and the security advisors.
13. Lead, next morning: read the client error reports and the new feedback (the weekly feedback query, run for the last day). Triage them into FINDINGS.md.
14. Owner, next morning: `club-admin` → `usage_report` (devices per app).
15. Owner: read haimuniya@gmail.com for privacy requests and bug reports.

## If something breaks
16. Owner: tell lead what members see (a screenshot if possible). Lead says which path below applies.
17. Front-end bug, app still opens: Cloudflare dashboard → Pages → `haimunia` → Deployments → the previous good deployment → "Rollback to this deployment" (about a minute). Then fixes reverts on main, and lead verifies.
18. The app does not open because of the service worker: the kill switch, `docs/OPS-2-sw-kill.md` (drilled 2026-11-15; about 3 seconds per phone once it is deployed). Owner merges, fixes ships a fixed worker as soon as possible.
19. Backend problem (sign-up, join, feed): lead checks Supabase logs read-only and writes the fix prompt. Migrations go only forward and only by merge.
20. Members' logs are on their phones and are never at risk from a rollback. Tell them not to delete the app or clear site data, and to keep a backup ("ייצוא גיבוי").
