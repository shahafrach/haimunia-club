# Cursor checks

One step per check. Each check names the finding it covers in FINDINGS.md. The C1-C6 task names are provisional.

## C1: Data and storage on the phone

- **C1-1 (F-001):** In `index.html` (`#iosInstallBanner`) and `app.js` `maybeShowIOSInstallBanner()`, check that the banner tells the member that entries logged in Safari do not move into the installed app, and points to backup export or transfer first. Fail if the banner only says "כדי שהנתונים לא יימחקו".

## C2: Offline, service worker and deploy

## C3: Security, headers and middleware

## C4: Privacy

## C5: Accessibility, RTL and UX

## C6: Backend (shahafrach/haimunia-app-demo, read-only)

- **C6-1 (F-002):** In the sibling repo, open `supabase/migrations/202611120001_haimunia_club.sql` and check that `remove_member`, `club_announcement_delete` and `club_announcement_set_pinned` each write a row to an audit table (`admin_actions` or a club equivalent) with actor, target and time. Fail if any of them does not.
