# Cursor checks

One step per check. Each check names the finding or triage item it covers in FINDINGS.md.

## C1: Deploy and browser QA

## C2: Database security (RLS, SECURITY DEFINER, grants)

- **C2-1 (F-002):** In `shahafrach/haimunia-app-demo`, open `supabase/migrations/202611120001_haimunia_club.sql` and check that `remove_member`, `club_announcement_delete` and `club_announcement_set_pinned` each write a row to an audit table (`admin_actions` or a club equivalent) with actor, target and time. Fail if any of them does not.

## C3: Site and hosting security (headers, CSP, exposed files, secrets, transfer code)

- **C3-1 (F-003):** On the `triage/grok` preview build, run `curl -s -o /dev/null -w '%{http_code} %{url}\n'` against `/docs/audit/CURSOR-CHECKS.md`, `/docs/`, `/FINDINGS.md`, `/STANDARD.md`, `/CLAUDE.md` and `/CHANGES.md`, and expect 404 for every one. Fail on any other code. Then mark F-003 fixed.

## C4: Data integrity (backup, import, transfer)

- **C4-1 (F-001):** In `index.html` (`#iosInstallBanner`) and `app.js` (`maybeShowIOSInstallBanner()` and first launch in standalone mode with an empty log), check two things. The banner must tell the member to back up or transfer before installing. The installed app must offer backup import and the transfer screen on first launch when the log is empty. Fail if the banner only says "כדי שהנתונים לא יימחקו" or if the first launch offers neither.
- **C4-2 (F-001):** On an iPhone, in Safari on `haimunia.pages.dev`, log a workout and create a transfer code. Add the app to the home screen, redeem the code in the installed app, and confirm that every record arrived (entries, WODs, body weight, measurements, notes, settings). Repeat once with an expired code (older than 24 hours) and once with a code that was already used. Both must fail cleanly: a clear Hebrew message, nothing imported, and the log left unchanged.
- **C4-3 (F-001):** Create a transfer code in the old app (`haimuniya.github.io`) and another in the new app's Safari tab (`haimunia.pages.dev`). Redeem each in the installed new app. Before and after each redeem, count the records per entity (entries, WODs, custom WODs, custom movements, body weight, measurement types, measurements, settings, session notes) and compare. Both must match 100%; fail on any difference.

## C5: Offline and service worker updates

- **C5-1 (U-1, U-2, U-3):** Fetch `https://bugs.webkit.org/show_bug.cgi?id=277615`, `https://bugs.webkit.org/show_bug.cgi?id=313800` and `https://openpwa.net/news/testing-home-screen-web-apps-on-ios-18-6-2`. For each, confirm or reject the claim in the FINDINGS.md triage log (status, dates, affected iOS versions). Then relabel the item there: U-1 becomes F-00x OFF-1 high if confirmed, U-2 becomes UX low, and U-3 confirms F-001.

## C6: Accessibility and RTL
