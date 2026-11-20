# 3.21.0 — מסכים צרים, ליטוש ויזואלי וניקוי קוד — 2026-11-20

- Q-63 (P0): on a 320px phone the −/+ steppers no longer sit under the save bar (a tap on + could tick
  "לשתף במועדון", a tap on the weight could save a set): the three fit in one row, the bar is opaque with its fade
  above it, and anything scrolled into view lands above the bars. The iOS install card fits under the header and
  scrolls inside, with הבנתי pinned (its top, with the backup step, was out of reach). Also: the update banner no
  longer covers the הגדרות gear; the picker searches no longer push the sheet sideways at large text; scene titles
  stay above the sheet at large text; club deletes are behind a "⋯" menu.
- Q-62: visual polish. One filled primary per screen (on רישום only בחירת תרגיל; the join and install buttons are
  secondary). Hero titles sit on a linear band instead of a grey blob; the photos fill the width (no side seams)
  and the club photo shows the wall's wordmark whole. Tab labels are never under the small text size and hide
  (still read aloud) when large text leaves no room. One chevron (an SVG in the text colour), one secondary button,
  one list row: Fran looks the same in התקדמות and in the catalog. A saved set's row tints once; a PR shows its
  value large - and the PR moment now actually stays on screen (the re-render after a save hid it). Settings keeps
  מתקדם open and its scroll on a re-render; each tab comes back where it was left. Sheets fade and slide in; the
  save button says "שומרים…" while it saves. The update banner says "הקישו כאן כדי לעדכן עכשיו". The tour has a
  fifth line for מועדון.
- Q-64: dead code removed, about 46 KB less to download (unused functions, icons and CSS, and comments about
  code that is not in this app). No behaviour change.
- No IndexedDB change.

# 3.20.1 — בחירת תאריך בתוך האפליקציה — 2026-11-19

- Q-60: the date on רישום and אימונים opens the app's own sheet instead of the native iOS popover, which
  vanished for a moment on a tap and did not look like the app. Seven one-tap days (היום, אתמול, שלשום, then
  the weekday names), and "תאריך אחר" for a month grid: Sunday first, today ringed, no future days, days with a
  workout dotted. One tap picks and closes. The chip says היום, אתמול, or the weekday and date. Every target is
  44px, with full Hebrew dates for VoiceOver. One component for both screens.
- Hotfix (#62): Settings showed the update check twice; once now.
- Q-61: Settings cleaned up. Every segmented control (theme, text size, usage counting, the WOD library tabs, the
  lift entry type) shows the selected option filled with white text, no gold outline, and wraps at large text
  instead of breaking a word. "מתקדם" is a card row with its sections inside. Usage counting, deleting data and
  the backup note are one short line each with "פרטים". פרטיות is a row like מה חדש. The version and the update
  check are one small card at the very bottom. The profile name no longer breaks letter by letter at 200%.
- No IndexedDB change.

# 3.20.0 — רישום חדש, שיתוף בדיעבד, נגישות, עברית אחידה ופתיחה מהירה — 2026-11-19

- Q-47 (#50): a workout already in לוח שנה, and a PR from its card, can be shared to the club later; not only
  with the checkbox at save time.
- Q-48 + Q-57 (#51): the רישום screen redesigned. A WOD starts from its template or blank, an empty score is
  not saved, recent movements come first in both pickers and "add new" is the last row.
- Q-51 (#52): data safety. Backups read fresh from the database; two open tabs tell each other about writes;
  deletes reach the disk first; the date follows today until a day is chosen; weeks start on the chosen day;
  "delete all" clears every key.
- Q-52 (#53): mobile and PWA. One install component; Face ID sign-in offered by the keyboard (conditional
  passkeys); a focused field stays above the keyboard; pinch-zoom allowed; the manifest opens at the root in
  any orientation; a sign-in note after the first import on iOS.
- Q-53 part 1 (#54): every font size in rem, so iOS text size moves it; titles on photos get a scrim; AA
  contrast for chips, placeholders and field borders; unused Rubik 900 and ~180 dead CSS rules removed. Sheets
  sized in px no longer run past the screen at large text.
- Q-49 (#55): install and join stay visible for guests (מועדון tab with a join card, an install card); the
  gear says הגדרות.
- Q-54 (#56): accessibility. The page behind a sheet is hidden from screen readers and the keyboard; Tab
  reaches a closed fold's summary but not what it hides; calendar days and PR marks are read in full Hebrew;
  −/+ changes are announced; the update banner is a button in a status region; the join sheet can always be
  closed; a keyboard focus is never left under the header or the bottom bar.
- Q-53 part 2 (#57): one solid primary button everywhere (הוספת סט no longer looks disabled); בחירת תרגיל is
  the big button on an empty רישום, with a shorter photo; one empty-state look; radius and spacing tokens.
- Q-55 (#58): one name per thing (מועדון, שיא אישי, מדליות); ק״ג, בנצ׳מרק and אימוג׳י spelled right; the
  transfer path matches Settings (הגדרות ← מתקדם ← הזנת קוד העברה).
- Q-56 (#60): the app opens on the רישום photo and title at once (Lighthouse mobile 80 → 99, LCP 5.2 s →
  2.0 s); photos in WebP; pictures, fonts and icons are kept across updates instead of downloaded again
  (a second, long-lived service-worker cache; immutable headers); boot reads settings once.
- No IndexedDB change. The service worker adds the `haimunia-static` cache; the first update downloads the
  pictures once into it.

# 3.19.0 — הצטרפות בקוד קצר, שחזור בלי אדם, מבנה חדש: ארבע לשוניות והגדרות — 2026-11-19

- Q-35 (#38): home-screen icons are full-bleed with no white rim; a 180x180 apple-touch-icon is linked and
  precached. Members re-add the icon once (iOS caches it).
- Q-37 (#39): join the club with a short link (`#j=<code>`), a QR, or an 8-character code typed in any case.
  Opened in Safari, the link shows the code in large type and the install steps. Staff get a link card with
  the QR, the code and a print sheet. Sign-up went from 7 screens to 5.
- Q-38c/d/e (#40): sign in with Face ID / Touch ID (Supabase passkeys, relying party haimunia.pages.dev);
  forgot password = Face ID or the recovery code; "פתיחת חשבון חדש" as the last resort, with the training log
  kept on the phone. No coach or owner path.
- Q-38g (#41): sign-up rules shown as text, password 10+ characters only, a show-password button on every
  password field, the recovery code shared as an image and viewable again ("קוד השחזור שלי").
- Q-42 (#42): a guided first run: the transfer code from the old app, then the join code, then the account.
  Each code is named with its length and routed if pasted in the wrong field. The first screen has one primary
  action, the rest under "אפשרויות נוספות". Install steps per browser (WhatsApp/Instagram, iOS 26, Samsung, one
  התקנה button where the browser offers it). A restore offer on the first sign-in on an empty install.
- Q-43a (#43): the header is the logo and a gear (a dot and one toast for what's new); the ☰ menu and the
  medals icon are gone. Settings: פרופיל, מועדון, תצוגה, עזרה, and a "מתקדם" fold for backup, transfer
  codes, usage counting, what's new, privacy, version and deleting data.
- Q-46 (#49): the tabs are the tour's: רישום, התקדמות, לוח שנה, אימונים, and מועדון when connected. Q-43b (#44)
  had merged lifts and WODs into one tab with a toggle; the owner reversed it before this release. Labels fit
  at 200% text.
- Q-43c (#45): sharing to the club is a "לשתף במועדון" checkbox on the save bar, its default in Settings; no
  question after saving. The lift tools (plates, ladder, % table, 1RM) are under "כלים".
- Q-43d (#46): the club tab is pinned announcements, the feed, members, and for staff one "ניהול המועדון"
  fold. Progress has one streak card; body measurements are folded.
- Q-44a (#47): one type, space, button and tap scale in the token block; iOS text size follows the system
  setting; every link is a 44px target; the dark accent text passes AA everywhere.
- No IndexedDB change. An old link to the ☰ menu opens Settings.

# 3.18.1 — כפתור העדכון בביקור ראשון, ושם נגיש לכפתור תצוגת היומן — 2026-11-18

- F-025: on a first visit (no service worker in control when the page opened), tapping the update banner now
  reloads. A new worker activates on install (sw.js skipWaiting) and claims the page before the tap; the page
  now records that swap by comparing with the controller just before each change, not only with the one at
  boot. The first-ever claim still is not a swap, and the reload still waits for running saves (F-020).
- F-026: the calendar view button's accessible name starts with its visible word ("רשימה" / "לוח", then a
  hidden description); aria-label and aria-pressed are gone. The axe scan now runs label-content-name-mismatch.

# 3.18.0 — תמיכה ודיווח על תקלה דרך תיבת המשוב — 2026-11-18

- The menu row "תמיכה ודיווח על תקלה" opens the in-app feedback box (feedback_submit), the one feedback
  screen: "מה לא עובד טוב, או מה היה עוזר לכם?", the text box, "איפה זה קרה? (לא חובה)" with the screen the
  member came from preselected, and send. Same offline queue (5 at most) and the same thank-you text.
- The old support sheet that copied a report or sent it by WhatsApp or e-mail is gone, with its device-details
  block and the supportWhatsApp/supportEmail settings in app-config.js. The duplicate support row in Settings is
  gone; Settings keeps "שליחת משוב", which opens the same box.
- privacy.html §8 "דיווח על תקלה": the report goes through the feedback box and is kept like feedback (§7).
  "עודכן לאחרונה" is 18 בנובמבר 2026.
- The automatic error reports are unchanged.

# 3.17.1 — The iOS install banner never covers the log controls — 2026-11-16

- F-024: in an iPhone Safari tab (390×664) the two-step install banner covered the log controls (the
  steppers, the plate picture, and before a pick the pick button). On the log screen it is now one line
  ("מתקינים במסך הבית? קודם מגבים.", "איך מתקינים?", close). Once an exercise is picked it steps aside,
  and a link under the controls opens the full card. Other tabs show the full card, and it still shows on
  the first visit (F-001). Display only; nothing stored.

# 3.17.0 — A monthly personal summary on the progress screen — 2026-11-16

- "סיכום חודשי" on התקדמות: the last full month and the current month so far (months by the date in
  Asia/Jerusalem, Hebrew month names). For each: workouts (days with a lift or a WOD), PRs (the app's own
  count, as in "שיאים החודש"), and the best lift: the month's PR with the largest gain by the PR card's rule
  ("השיא הבולט: Back Squat +10% (110 ק״ג × 5)"), or the heaviest set when the month has no PR. Plus the
  weekly streak from 3.16.0.
- An empty month says so in one line. Computed on the phone at render; nothing stored, nothing sent.

# 3.16.0 — A personal weekly streak on the progress screen — 2026-11-16

- "רצף שבועי אישי" on התקדמות: the number of consecutive weeks (Sunday to Saturday, by the date in
  Asia/Jerusalem) with at least one logged lift or WOD. The current week counts once it has one; until then
  the run up to last week still stands ("אימון אחד השבוע ימשיך את הרצף."). An empty log: "אין עדיין רצף".
- Personal only: computed on the phone at every render from the stored dates, so editing a past date
  recalculates it. Nothing stored, nothing sent, not in the share prompt or the club, no leaderboard.
- Weeks are counted on calendar dates, so DST changes never split or merge a week.

# 3.15.0 — Percentage chart with plates on the exercise screen — 2026-11-16

- Under the percentage chips, "טבלת אחוזים ופלטות" (collapsed): 95% down to 50% of the lift's estimated
  1RM (bestEst1RM, the number on the "1RM משוער" card). Each row is the nearest weight the member's bar
  plus whole 1.25 kg pairs can make, never under the empty bar, with the plates for one side ("לכל צד:
  25 + 25 + 1.25", or "מוט ריק"). A non-barbell lift gets 2.5 kg rounding and no plates.
- No 1RM yet (no set with weight): one line, "אין עדיין 1RM משוער לתרגיל הזה. טבלת האחוזים תופיע אחרי
  הסט הראשון עם משקל.", and no chart.
- Computed on the phone from logged sets; no new store, field or setting. At the 2.5 kg increment on a
  20 or 15 kg bar the chart and the chips give the same weights.

# 3.14.0 — Small fixes: first-launch import, feedback screen and refusals — 2026-11-16

- F-019: the first-launch "יש לכם כבר נתונים?" sheet no longer shows on a device that has only body weight,
  measurements, custom WODs or custom movements. `hasAnyMemberData()` in app.js; the transfer code's "nothing
  to move" check uses the same rule.
- Feedback opened from the Settings row is about "הגדרות", not the tab under Settings.
- Feedback: a 4xx from feedback_submit (other than 408/429) is not queued. The member sees "המשוב לא נשלח. נסו
  לקצר או לנסח אחרת." and the draft stays in the box. A network failure, a 5xx, 408 or 429 still waits in the
  queue. A refused message already in the queue is dropped on the next flush instead of retried at every start.

# 3.13.0 — The log screen: controls first, one tap for the same set — 2026-11-15

Layout A, the owner's choice from PR #21 step 1.

- Once an exercise is chosen, the photo is a short band and the controls come first: the last session
  ("פעם קודמת · 3 סטים של 100×5"), "עוד סט זהה", the plate visualizer and the steppers (56 px). The type,
  the date, the 1RM card, the percentages, the bar choice and the ladder are under "עוד אפשרויות"; a past
  date and an active ladder stay with the controls. Measured: no scroll at 390×844 and 360×780.
- Picking an exercise fills weight, reps and sets from its last session.
- "עוד סט זהה" logs the same set again in one tap, through the same save as the button (the sanity
  confirm, PR detection and the club share question apply). Three identical sets: 5 taps, no scroll
  (was 6 taps and a swipe, or about 37 taps from the defaults).
- On the log screen the save is confirmed in the last-session line instead of a toast over the steppers.
- No change to stored data.

# 3.12.0 — Anonymous error reports and the feedback box — 2026-11-15

Needs haimunia-app-demo #178 (`client_error_report()`, `feedback_submit()`, 202611150003) deployed first.

- Error reports (`src/errors.js`): an uncaught error, an unhandled rejection or a failed save sends its kind,
  a short technical message with anything a member could have typed taken out, the screen, the version and the
  file/line. No id, no name, no log data. At most 5 a page load, one per kind of error a day, 8 waiting offline.
  They follow the usage-counting switch: off means none.
- The feedback box (`src/feedback.js`): "שליחת משוב" in Settings, and a small link under the storage error and
  the club share-failure toasts, opens "מה לא עובד טוב?". It sends the typed text, the screen, the version and
  the device type; no name and no username. Offline, it waits (5 at most) and goes when the app is online.
- privacy.html: sections 6 (דיווח שגיאות אוטומטי) and 7 (משוב); the sections after them are renumbered.

# 3.11.0 — בדיקת עדכון: a new version on demand, never during a save — 2026-11-15

- Settings, by the version line: a "בדיקת עדכון" button. It answers up to date (with the installed version), a
  new version (named, then "מעדכנים…" and one reload through the existing SKIP_WAITING handshake), offline, or a
  short error. The training log is never touched.
- No reload while a save runs (F-020): every update path reloads through one `reloadOnce()`, which waits until no
  save or IndexedDB call is running; after the limit it does not reload and the update applies on the next start.
- During the update, saves and deletes are held with "רגע, האפליקציה מתעדכנת", and the member's draft stays.

# 3.10.0 — Delete the account from the app — 2026-11-15

Needs haimunia-app-demo #173 (`delete_my_account()`, 202611150002) deployed first.

- Connected mode, Settings → the club row: a "מחיקת החשבון" button for a signed-in member. The confirm says
  what the server deletes (the account and username, the name and emoji in the club, club membership, every
  shared workout, reactions given, notifications and the push subscription), that the training log on this
  phone stays, and that it cannot be undone. It opens on "ביטול".
- "מחיקה לצמיתות" calls `delete_my_account`, drops the session on this phone and leaves the device offline.
  The log is not touched; no IndexedDB change.
- A refused call (rate limit) changes nothing and says why. After a network error the app asks the server
  who it is before saying anything: a user that no longer exists counts as deleted, one that still exists
  gets "החשבון לא נמחק", and an unreachable server gets a message that it is not known yet.

# 3.9.0 — Each workout asks whether to share it to the club — 2026-11-15

Owner decision (2026-11-14): the member chooses per workout, not once for all.

- After every new lift or WOD, connected members get one question: "לשתף במועדון?" with "לשתף" and
  "לא הפעם". Only the workouts answered yes go into the day's post, and a PR card goes out only for a
  shared workout. Escape or a tap outside counts as "not this time".
- A PR or first-entry card shows first; the question waits until it closes.
- An edit keeps the answer the workout already had and asks nothing.
- The club tab's all-or-nothing switch ("לשתף את האימונים שלי" / "להפסיק לשתף") is gone. The card now
  explains the per-workout question. The answers are kept on the phone only.
- Workouts logged before this version have no answer, so they count as not shared. A day already posted
  under the old switch keeps its post until that day changes; then only answered-yes workouts remain.

# 3.8.1 — A lost IndexedDB connection is reopened (F-010) — 2026-11-15

iOS Safari (WebKit bug 277615) can drop the IndexedDB connection in the middle of a session; saves then
failed until the app was closed and reopened. No change to the database (box-log-db stays at v7) or to
the stored record format.

- A connection the browser closed forgets itself (`onclose` in `src/db.js`), so the next call opens a new one.
- Every db* call that fails with a lost-connection error opens a fresh connection and tries once more.
  A second failure tells the member, in Hebrew, to close the app completely and reopen it.
- Dev dependencies: `npm audit fix` (lockfile only, F-009). Nothing from `package.json` ships.

# 3.8.0 — Safari to home screen without losing the log (F-001) — 2026-11-14

- Transfer codes can be created in this app (Settings, "יצירת קוד העברה", and
  the iOS install banner). Ported as is from the old app: same code, HKDF,
  AES-GCM, gzip payload with `prefs`, and `transfer-put`. A code from either
  app redeems in the installed app. Needs haimunia-app-demo `fix/f-001`
  (`transfer-put` accepts `https://haimunia.pages.dev`) deployed first.
- iOS install banner: shows on the first visit, before the first entry. Two
  steps: back up first (transfer code or backup file), then add to the home
  screen. It says the installed app opens empty until the import. The old
  line "כדי שהנתונים לא יימחקו" is gone.
- Installed app, first launch with an empty log: a sheet offers "יש לי קוד
  העברה" and "יש לי קובץ גיבוי" before the welcome sheet. "מתחילים מאפס"
  opens the welcome sheet and is remembered (`haimunia:firstImportAnswered`).
- Each code sent from here carries a random device id
  (`haimunia:transferDeviceId`, apart from the usage-count id). The server
  keeps only an HMAC of it and allows 3 codes per device and 30 per IP a day
  (haimunia-app-demo 202611140002).
- The transfer screen for entering a code is now "הזנת קוד העברה". No
  IndexedDB change.

# 3.7.2 — The installed app opens again — 2026-11-14

Hotfix. Cloudflare Pages answers /index.html with a 308 to /. The 3.7.0 worker precached that answer
with cache.add(), which keeps its "redirected" flag, and Safari refuses a navigation answered by a
redirected response from a service worker ("Response served by service worker has redirections").
The app would not open after 3.7.1 went live.

- Every precached response is stored as a plain copy (fetch, then a new Response when it was redirected).
- A navigation served from the cache is unwrapped the same way.
- This worker calls skipWaiting() on install: a broken 3.7.x worker leaves no page to press the update
  banner, so the fixed one takes over by itself.

# 3.7.1 — Club tab visual fixes — 2026-11-14

- The club tab is registered as a scene (`PAGE_SCENES.club`, only while the
  member is in the club), so it gets the same chrome as the other tabs:
  header over the photo, dark nav, no `#app` bottom padding. That padding
  was the lighter navy band between the last card and the nav.
- On every scene tab, html, body and the status-bar scrim take the colour
  the sheet paints at its bottom edge instead of `--bg`, so rubber-band
  overscroll, Safari's collapsing toolbar and content scrolled under the
  status bar show no seam. The club keeps its opaque `--club-paper` sheet.
- Members accordion: the app's chevron icon (rotated like the other
  accordions) instead of ▲/▼.
- "הודעות", "הפיד" and "כלי מאמן" use the app's `.section-label`.
- Publish button: `--on-energy` ink (5.49:1) and `.chip-btn.primary`'s glow.

# 3.7.0 — Quality fixes from the old app's 3.3.0 — 2026-11-12

Ported from haimuniya/haimunia-app 3.3.0 (f4fa272), adapted to this app.

- Data safety: every IndexedDB write rejects when its transaction aborts
  (commit-time quota) instead of never settling. Backup import (file or
  transfer code) is one all-or-nothing transaction, confirmed in the app's own
  sheet, and a backup holding only session notes is accepted.
- Boot: a database that fails to load shows an error with a retry button
  instead of the fresh-install welcome; any boot exception, or a boot that
  hangs 15 s, shows a message with a reload button (`src/boot-guard.js`).
- Service worker: navigations and assets come from this release's own
  precache, so a weak signal never delays start and shell and scripts never
  mix versions. Navigation preload is switched off.
- Calendar month "sets" sums each line's sets. Backup export/import/transfer
  are real buttons. Header "version updates" opens every release note, new
  ones tagged. The tour closes with Escape. The Rx/Scaled hint shows only after
  a save attempt. The header date refreshes on return to the foreground.
- Welcome: a scrim behind the title, an opaque backdrop on desktop, and one
  line on usage counting that links to the setting.
- Contrast: `--on-energy` (ink on coral fills) and `--danger-text` (dark
  delete-all) tokens; 44 px targets for profile edit, privacy and 404 links.
- `frame-ancestors` leaves the meta CSP (ignored there, logged an error); the
  `_headers` CSP still sends it.
- Usage rows carry `app: "club"`.
- Header logo and mark at 2x their largest display size (smaller downloads).

# 3.6.0 — One token source for every color — 2026-11-12

No visible change. Every color the app draws is now defined once, in
`<style id="tokens">`: 142 primitives named by value, plus the semantic tokens
for light and dark. The 139 CSS lines and 26 JS lines that named a color
themselves now use the tokens. Dark is written once, keyed on a resolved
`data-scheme` that theme-init.js stamps before first paint. Before this, dark
was written twice (auto and explicit), and a contrast fix once reached only one
copy. `test/design-tokens.test.mjs` fails on any new color outside the block,
and checks 4.5:1 text contrast in both schemes. Screenshots of four screens,
in four theme and system combinations, are byte-identical before and after.

# 3.5.0 — The club feed is back, and workouts reach it — 2026-11-12

Owner decision (2026-11-11): connected mode has a feed and reactions. This
restores what 3.4.1 took out (the feed, the three reactions, "delete post" for
the owner and the coach) and adds what the feed was missing: workouts.

- After a lift or a WOD is saved, the day is posted to the club: one post per
  member per day, updated by later entries that day. It carries the movement or
  WOD names and the results without kilograms. Body weight is never read.
- The club tab has the member's own switch, "share my workouts", on by
  default. Turning it off is saved on the server (set_share_defaults) and
  nothing more is posted. The feed and reactions stay visible either way.
- A failed share never touches the log: the entry is saved on the phone first,
  and a short note says the club did not get it this time.
- Deleting a day's last lift or WOD removes that day's post. Undo, or a new
  entry that day, posts it again. If the post was removed earlier, by the member
  or the coach, it comes back under a new key.
- A personal record also goes to the club as a percent improvement, for example
  "שיא אישי בסקוואט: +5%", never kilograms. It is computed on the phone from the
  log there, follows the same switch, and is removed if its entry is deleted.
  Undoing that delete brings the PR card back.
- The membership query now looks for the club only, so an account that is also
  in BOX-LOG circles still finds its club.

# 3.4.1 — The club tab without a feed — 2026-11-12

No workout is ever posted from this app, so the club tab no longer has a feed,
reactions or "delete post". It shows announcements (pinned first, read-only
for members), the member list and, for the owner and the coach, the announcement,
remove-member and new-link tools. This replaces the feed and reactions described
under 3.3.0.

# 3.4.0 — Transfer code from the old app — 2026-11-12

Settings > "קוד העברה מהאפליקציה הישנה". In the installed app, the member pastes
the one-time code made by the old app. The encrypted backup is fetched once
(`transfer-take`), decrypted on this phone (HKDF + AES-GCM, the key exists only
in the code) and merged through the same import as a backup file: records, body
weight and session notes. The name and box-start date only fill empty ones; bar
weight, % increment, Rx default, theme and text size apply only on a device
with no training data yet. In a browser tab the dialog says to install first.
If the import is declined or fails after the code is spent, the data stays in
memory so the member can retry or save it as a backup file; closing the dialog
drops it. The backup import is now one function, `importBackupData`, shared by
the file and the code. `src/transfer.js`, `test/transfer.test.mjs`.

# 3.3.0 — The club tab — 2026-11-12

A connected member of the club gets a fifth tab, מועדון: the club's feed
(30 posts a page), reactions (אגרוף, אש, מחיאות כפיים; a member may hold all
three), and announcements, with the pinned one first, read-only for members.
The owner and the coach also post, pin and delete announcements, delete any
post, remove members (never the owner) and create a new join link, each
destructive step behind the app's own confirm sheet. The server decides what
each role may do; the buttons are only drawn where the action can work.
Nothing from the private log is involved. `src/club.js`, `test/club.test.mjs`.

# 3.2.0 — Connect with a username, join the club — 2026-11-12

First run now asks once: connect with a username, or stay offline. Staying
offline changes nothing: the app opens without touching the network, and the
choice is reversible from Settings (מועדון). Connecting creates an account
(username and password, no email or phone), shows a recovery code once, and
joins the club through the one fixed link (`#join=<token>`, or pasted), then
asks for the name and emoji the club sees. Sign-in, sign-out and joining later
are in the same dialog. The private log stays on the phone.
New: `src/connect.js`, `vendor/supabase.js` (loaded only on demand). The CSP
adds Turnstile (script and frame) for the sign-up challenge.
`test/connect.test.mjs`.

# 3.1.1 — Progress lists each lift once — 2026-09-24

The Progress screen showed every logged lift twice: in the exercise list
(sets and estimated 1RM), and again at the end of Benchmarks, after the
eight named workouts, with only the estimated 1RM. Those extra rows came
from `benchmarkLiftItems()`, added in 3.0.0. Benchmarks is now the named
workouts only; the estimated 1RM stays on the exercise cards, and the order
is unchanged: exercises, Benchmarks, body weight.
`test/progress-no-duplicate-lifts.test.mjs` fails if a lift appears twice.

# 3.1.0 — usage counting, with a switch to turn it off — 2026-09-23

The club wants to know how many people use the app and how many log
workouts. `src/usage.js` sends exactly three facts — the app opened, a
workout was logged (a new one, never an edit), a screen was opened — each at
most once a day, with a random id made on the phone and nothing else: no
name, no workout content, no time. The id is pseudonymous, not anonymous: it
links one phone's counts across days, and the privacy page and the Settings
line both say so, along with the IP in the server's short-lived request logs
and the 180-day retention. They go to one endpoint in the club's
Supabase project (`training_log_usage`, added in haimuniya/haimunia-app-demo
with a totals-only staff report, a 1,000-row daily cap and a nightly
180-day purge); the CSP opens that one host for connections and
nothing else. The publishable key in `app-config.js` can only insert a count.

Settings has a "ספירת שימוש" row with one plain sentence saying what is
counted, and an on/off switch; off stops every request and deletes the id.
Every failure — offline, blocked, server down — is silent, and a count that
could not be sent is tried once more with the next one, never in a loop. The
privacy page has a new section on it, and the summary no longer says "no
tracking". The browser checks now answer the counting endpoint themselves
and abort everything else, so no check can ever write a real count.

# 3.0.0 — the new design and features, without the community, in place over 2.34.0 — 2026-09-23

This release replaces 2.34.0 at the same address with the training log from
the community edition (haimuniya/haimunia-app-demo), with the community taken
out: no feed, posts, profiles, directory, challenges, events, coach tools,
notifications, sign-in or accounts. Everything else comes across — the
design and its assets (colours and tokens, typography, icons, logo and
wordmark, both themes, large text, Hebrew RTL throughout, the gym's scene
photographs), supersets and ladders, Rx/scaled/Rx+, the plate visualiser, WOD
logging and the builder, the workout library, benchmarks with retest
reminders, strength percentages from 1RM, bodyweight and custom measurements,
charts, the calendar, streaks, achievements and levels, install prompts, and
export/import.

**Members' data stays where it is.** The edition opens the 2.x database by its
own name and version (`box-log-db` v7), adds no store, and reads every
setting and localStorage key under the name 2.x wrote it (`haimunia:*`,
`boxlog:lastExportAt`, `sessionNote:<date>`). Nothing is copied or
migrated. Rolling back to 2.34.0 (tagged `rollback-2.34.0`) still opens the
data, because the version never moved. The service worker keeps the
`haimunia-v` cache prefix but now deletes only its own older caches, not every
cache on the shared github.io origin.

Kept from 2.x rather than lost in the move: the custom EMOM model (rest
minutes, timed stations, weights, compacted results — ported into the
community edition first, then carried here); the calendar's "log for this
date" button; the "clear search" button on an empty History/WOD search; PR
medals 2.x already awarded (the new bronze threshold is three PRs, but a medal
a member has already seen stays earned); and the re-baseline of seen medals
after an import, which the community edition had dropped (now a union, so it
can never un-see a medal).

New for upgraded members only: a one-time card on the log screen offering a
backup file before anything else happens, and a `haimunia:schemaEdition`
marker written once it is answered, so a future migration starts from a known
edition. A fresh install gets the marker straight away. `isFreshInstall` now
counts measurements and custom WODs too.

The Content-Security-Policy allows no origin but the app's own. The privacy
page is new and describes this edition only. `test/upgrade-in-place.test.mjs`
boots the edition on a device snapshot produced by driving the real 2.34.0
app (`scripts/v2-device-snapshot.mjs`), and
`scripts/browser-check/upgrade-rehearsal.mjs` does the whole upgrade — and the
rollback — in real Chromium, through 2.34.0's own update banner.

# Redesign the log/WOD/history/calendar/achievements screens, add a support link, fix keyboard-covers-input and minutes-only time cap — 2026-09-02

Requested as a redesign of the log-a-set ("רישום") screen to match a reference
look, plus a support contact and a fix for the screen always defaulting to
Back Squat before the user chose anything. The Back-Squat default turned out
to be `selectedId` initializing to `MOVEMENTS[0]` with no way to tell "the id
a save would use" from "what the user actually told us" — fixed with a
`movementExplicitlyChosen` flag; the screen now prompts "מה עשינו היום?"
until a real choice is made, and the same pattern was checked for (and found
in one place) across the rest of the app.

Once that screen looked right, the same visual language (the brand's orange
stripe motif used twice per screen as punctuation, Anton for read-only
numbers/names with a Rubik fallback, consolidating floating cards into fewer
bordered blocks) was extended to every other real screen — History (incl.
bodyweight/measurements), Calendar (incl. volume report), and the whole WOD
tab (browse/benchmarks, the shared exercise/WOD pickers, the log form, WOD
history, the custom WOD builder), Achievements/celebrations, and Settings/app
chrome — nine areas total, each done as a QA pass + code review + redesign,
in parallel isolated git worktrees, then rebased onto the log-screen commit
and merged one at a time with the full suite re-run after each merge (166 to
195 tests over the course of the merges; every merge conflict was two
agents' independently-scoped CSS blocks landing next to each other, never
overlapping logic).

Real bugs fixed along the way (see individual worktree reports for the
complete list per area): a literal "null kg" rendered for hold-only
movements in History; strength-only weekly/monthly stats disagreeing with
the streak flame on WOD-only weeks; a stale search surviving a full data
wipe; bodyweight accepting 0 kg with no way to delete a bad entry; month
navigation wiping an unsaved session note; a dead "Custom" row in the volume
report that could only ever read 0/0; a WOD's PR flash never appearing
(fired before the DOM it targeted was replaced); "For Time" trend charts
plotting improvement as an upward line; a scaling note leaking from one WOD
to the next; a false achievement-celebration replay after restoring a
backup; an update banner permanently suppressing the install prompt for the
session; and a stray delete-everything confirmation surviving closing the
settings sheet.

Two more bugs came in live from the user's phone after this landed locally
(nothing had been deployed yet, so these are pre-existing production bugs,
not regressions): the fixed-position bottom nav floating up on top of a
focused input when the on-screen keyboard opens on Android Chrome — fixed by
adding `interactive-widget=resizes-content` to the viewport meta so Chrome
actually resizes the layout instead of leaving fixed elements floating over
it; and the WOD builder's time cap only accepting whole minutes — added a
matching seconds stepper next to it, mirroring the minutes+seconds pattern
already used for WOD "For Time" scores elsewhere in the app.

Also added: a `mailto:haimuniya@gmail.com` support link in Settings for bug
reports/questions.

195/195 tests pass (166 baseline + 29 new, across history-tab.test.mjs,
bodyweight-measurements.test.mjs, wod-history-list.test.mjs,
wod-log-form.test.mjs, achievements.test.mjs, app-chrome.test.mjs).

# Fix the bottom nav floating above the true screen edge, add a "what's new" reveal — 2026-09-02

Two changes, reported/requested back to back in the same session as the nav
restructure above.

**Bug, caught on a real device (not by headless testing)**: the user sent a
screenshot from an actual phone showing the bottom nav bar floating with a
visible strip of ordinary page content underneath it, not flush against
the true bottom edge. Root cause: `.tabbar` and `.bottom-bar` (the save
button) were two INDEPENDENTLY `position:fixed` elements, each computing
its own `bottom` offset from `env(safe-area-inset-bottom)`. On a device
reporting a large inset (confirmed by emulating one via Chrome's
`Emulation.setSafeAreaInsetsOverride` — 48px reproduces it exactly), that
offset pushed the bar up and left a gap of real page content exposed below
it instead of the bar's own background. Fixed by nesting both inside one
`#bottomNavWrap` fixed container and applying the safe-area inset exactly
once, as the tab bar's own bottom PADDING (so its `--surface` background is
what fills that strip, not empty space) rather than as an offset that
creates a gap — the tab bar is now flush to the true edge regardless of
how large the inset is on a given device. Re-verified against the exact
48px-inset condition before shipping, not just re-tested at the default
(zero-inset) headless viewport that let this through the first time.

**"What's New" reveal**: added a one-time celebratory screen
(`whatsNewOverlay`, `showWhatsNewIfDue()` in app.js) for a RETURNING user
whose last-seen version predates this redesign — reuses the PR-celebration
overlay's star-field/pop-in look instead of the plain bullet-point
notifications list every routine release gets. A first-time user never
sees it (nothing to compare the new look to); a user already caught up
never sees it again. Three highlight rows: one-tap bottom nav, settings
consolidated under the header's gear button, and the visual refresh itself.

166/166 tests pass (added 4 tests for the reveal's gating logic, in
test/whats-new.test.mjs, plus strengthened an existing fresh-install test
to assert the reveal explicitly).

# Nav back to one tap, plus overlay accessibility and a perf fix — 2026-09-02

A research audit of the whole app (requested directly: "what else will we
improve? full end-to-end research") flagged the previous session's
hamburger-only nav as a real regression: switching tabs went from one tap
(the old always-visible top bar) to two (open the menu, then pick a
destination), closing itself every time. For a gym app used mid-workout,
often one-handed, that's a cost on the single most frequent interaction in
the app — worth fixing rather than defending because it matched a reference
screenshot.

**Navigation**: the hidden `.tabbar` compatibility shim from the previous
session is un-hidden and restyled as a fixed bottom nav (icon + label,
one tap to any of the four screens, always visible — reuses the same
`switch-tab` action and render() sync loop that already existed, so no new
dispatcher logic was needed). The header's icon-button (previously "open the
hamburger menu") now opens Settings directly — `#menuOverlay`, the
full-screen menu, is deleted outright, not just bypassed: its only
remaining job (after primary nav moved to the bottom bar) was a redundant
hop to Settings, and it was also the one overlay that ever needed a
z-index override (61, to clear the install/update banners — see the
previous entry). Removing it removes that whole bug class along with it.
The settings modal gained the profile card (avatar, name, "edit profile")
that used to live in the menu.

**Accessibility** (a second research finding: every modal in the app, old
and new, let keyboard/screen-reader focus tab straight out into the page
behind an "open" dialog, with no Escape shortcut and no focus restore on
close): added one shared helper (`OVERLAY_A11Y`, `trapFocusOnOpen()`,
`restoreFocusOnClose()` in app.js) wired into all 9 modal-overlay open/close
pairs. Escape closes whatever's already dismissable by clicking its
backdrop (onboarding and the first-run welcome modal deliberately aren't,
so Escape doesn't dismiss those either — matches their existing
click-backdrop behavior). Tab cycles within the topmost open overlay only.
One real bug caught while writing the tests for this (not by inspection):
the focusable-element selector's bare `[href]` clause matched the
achievements modal's medal SVGs (`<use href="#glyphN">`), which aren't
real interactive elements — narrowed to `a[href]`.

**Performance**: `renderHistoryListArea()` was calling `bestEst1RM()` —
itself an O(entries) scan — once per active exercise, on every keystroke in
the History search box, i.e. O(exercises × entries). Fine today; would
start to lag for a long-time user with years of logged data. Replaced with
`bestEst1RMByExercise()`, one O(entries) pass building a lookup map.

**Test coverage**: `computeCurrentStreak()` — the header flame counter —
had zero coverage before this; added 7 tests including its two real
boundary cases (a gap day breaking the streak, a same-day double log not
inflating it).

162/162 tests pass (149 before this round: +7 streak tests, +5 overlay-
accessibility tests, +2 history-performance-equivalence tests, and the old
8-test hamburger-menu file replaced by a 7-test nav/settings one since the
menu itself no longer exists to test).

# Redesign: hamburger menu, settings modal, visual polish pass — 2026-09-02

Full-app visual refresh built directly to a reference design the user
provided (screenshots of the target direction), same brand palette (dark
navy/energy-orange, unchanged tokens) but "more beautiful": bumped card
radii, added a `--shadow-card`/`--shadow-sm` token pair (per theme) applied
across `.card`, `.exercise-select`, `.stat-card`, `.chart-card`,
`.bar-wrap`, `.movement-btn`, `.exercise-row`, `.log-row`, `.report-row`.

Primary navigation moved off the always-visible top tab bar and into a new
hamburger menu (☰ button added to the header, next to the notification
bell): a full-screen slide-in sheet with a profile card, the four tab
destinations as colored icon-chip rows (active tab highlighted), and a
settings row. The old `.tabbar` pill row stays in the DOM (display:none)
purely so `render()`'s existing tab-button sync loop has real elements to
write into — no JS there needed to change. A new `#pageTitle` heading shows
the current tab's name where the pill row used to be.

Settings (theme, text size, profile edit, box start date via profile edit,
export/import backup, delete-everything) moved out of the footer — which
was the original complaint, everything buried at the bottom of every
screen — into a dedicated settings modal reached from the menu. The footer
now only carries the two safety-relevant notices (storage errors, stale
backup reminder) that need to stay visible without an extra tap.

Two real bugs turned up from actually verifying this instead of trusting
the diff, both the same root cause — jsdom's test suite can't see
paint/z-index issues, so neither was caught by `npm test` alone:

- Caught by a real browser walkthrough: the new full-screen menu sheet
  reaches the top of the viewport, unlike every other bottom-sheet modal in
  the app, so it rendered *underneath* the install/update banners (z-index
  59/60) — the menu's own title and close button were invisible whenever a
  banner was showing. Fixed by giving `#menuOverlay` z-index 61.
- Caught by an independent `/code-review` pass over the same diff: raising
  `#menuOverlay` to 61 created a second instance of the exact same bug one
  level down — tapping "עריכת פרופיל" on the menu's own profile card opened
  `#welcomeOverlay` (no z-index override, base 50) *underneath* the still-open
  menu, with no visible way to edit the name. Fixed by closing the menu
  before opening the profile modal from that entry point.

Verified with a real headless-Chrome walkthrough (Chrome DevTools Protocol,
no extra installs — Node's native WebSocket client driving the existing
Chrome install) through the full user journey: welcome → onboarding → log
a set → PR celebration → hamburger menu → settings → history → calendar →
WOD → theme toggle. Zero console errors/exceptions. Added
`test/hamburger-menu.test.mjs` (8 new tests: open/close, backdrop-click
guard, active-tab highlighting, tab switching, settings routing, the
delete-confirm flow re-rendering correctly inside the still-open modal,
profile-edit access) and updated the three existing tests that queried the
now-moved footer controls (`import-export-ui`, `text-scale`, `theme`) to
open the settings modal first.

149/149 tests pass.

# Fix the medal frame rendering as an oval, and offline medal images — 2026-08-27

Found by an independent code review of the previous square-glow fix, not
by a user report. Two real bugs from the same commit:

The "circular" plate frame was actually a 72x64 oval in both the
achievements modal and the celebration popup. `.medal-shape-plate`'s own
`width:100%;height:100%` tied in CSS specificity with the plain
`.medal-shape{width:64px}` rule, so source order — not intent — decided
the winner, while a separate higher-specificity rule pinned only the
height to 64px. Width and height are now pinned together in that same
rule, so neither can independently fall through. New test checks the
source text directly, since jsdom doesn't compute layout percentages.

The three medal PNGs were never added to the service worker's precache
list — every tiered medal broke offline (broken image) even though every
other app asset kept working. Added to `ASSETS`, with a regression test.

Also tightened the plate's rim color to match the SVG shield's rim
opacity exactly, instead of two independent near-identical values.

141/141 tests pass.

# Fix the square glow around earned weight-plate medals — 2026-08-26

Reported with a screenshot right after the gloss/rim polish shipped:
"the square can be seen... it looks like a kid drew it." The earned
glow (`filter:drop-shadow(...)`) and the circular clip
(`border-radius:50%; overflow:hidden;`) were on the same element — a
known cross-browser inconsistency where `drop-shadow()` doesn't
reliably respect its own element's overflow clip, so the glow traced
the plate's square bounding box instead of its circular clipped shape.

Split them onto two nested elements: `.medal-shape.medal-shape-plate`
(outer, gets the locked/earned filter) wraps `.medal-plate` (inner,
does the circular clip + rim + gloss sweep). The outer element has no
clipping of its own, so `drop-shadow` traces the actual rendered
(already-circular) content instead of a bounding box. Same technique
already proven for the `capstone-badge` glow, which never had this bug
because it was never combined with a clip on the same node.

1 new test locks in the two-element split specifically (not just the
visual result) so this can't silently regress back onto one element.
Full suite: 139/139 jsdom tests, all 10 browser-check scripts, green.
Verified visually — the earned bronze glow is now a clean circular
halo.

# Polish the weight-plate medals: gloss, rim, and a visible locked state — 2026-08-26

Reported with a screenshot right after the previous entry shipped: the
plates "looked uncomplete" — flat, and the locked (not-yet-earned)
ones were nearly invisible against the app's dark background.

Root cause of the locked-state issue: `.medal-badge.locked
.medal-shape{ filter:grayscale(1) brightness(.55); opacity:.4; }` was
tuned for the SVG shield (a mostly light face with a colored rim) —
applied to a full-bleed solid-color plate photo, it crushed almost to
nothing. Added a more specific override
(`.medal-badge.locked .medal-plate.medal-shape`, two classes beats one
on specificity) with gentler values, scoped to the plates only — the
shield's own locked treatment is untouched.

For the "flat" complaint: the `<img>` is now wrapped in a
`.medal-plate` frame — a circular clip with a subtle rim
(`box-shadow`, dark outer / light inner) and a `.medal-plate-shine`
diagonal gloss overlay that twinkles on the earned state, echoing the
shield medals' own `medal-shine`/`medal-rim` treatment so a flat
product photo reads as a "medal," not a sticker.

4 tests in `test/medals.test.mjs` updated for the new wrapped markup.
Full suite: 138/138 jsdom tests, all 10 browser-check scripts, green.
Verified visually with real-browser screenshots before and after.

# Bronze/silver/gold medals render as real weight-plate photos — 2026-08-26

Requested directly: three provided photos (a green "10 KG" plate, a blue
"20 KG" plate, a gray "5 KG" plate) replace the SVG shield glyph for
every tiered achievement (the pr and streak groups — the only ones with
a bronze/silver/gold tier). Final mapping, after one correction:
bronze = gray/5kg, silver = green/10kg, gold = blue/20kg.

Processed with a throwaway Playwright/canvas script (same approach as
the app icon generation earlier this session — no image-editing tool
available): auto-detected each plate's bounding box, trimmed the
padding, and re-exported as a clean 320x320 PNG (`assets/medal-bronze
.png`/`-silver.png`/`-gold.png`, ~28KB each).

`renderMedal()` now renders `<img class="medal-shape" src="./assets/
medal-${tier}.png">` for any tiered achievement instead of the `<svg>`
shield — same class, so the existing locked (grayscale) and earned
(colored glow) CSS filters apply unchanged, no new rules needed beyond
one `img.medal-shape` override forcing the box back to square (the
shield's box was taller than wide; these plates are square photos).
Non-tiered medals (milestone, rx, capstone) are untouched.

4 new tests in `test/medals.test.mjs`. Full suite: 138/138 jsdom
tests, all 10 browser-check scripts, green. Verified visually via a
real-browser screenshot of an earned bronze badge before and after the
mapping correction.

# Replace "בוקס" with "מועדון" everywhere in the app — 2026-08-26

Requested with a screenshot circling it in the profile edit screen.
Six occurrences total, all in the tenure-achievement labels/rules and
the welcome modal's box-start-date question: "חודש בבוקס" / "חצי שנה
בבוקס" / "שנה בבוקס" (TENURE_MILESTONES labels), the matching achievement
rule text, the achievements screen's "add a start date" prompt, and the
welcome modal's own question. All six updated to the grammatically
correct "במועדון" form. Internal identifiers (`boxStartDate`,
`welcomeBoxStartInput`, etc.) are untouched — English internal names,
Hebrew UI text, same split this app already keeps throughout.

# Close out the WOD-section deep-dive: EMOM duration/rest, unit labels, custom-WOD deletion — 2026-08-26

Follow-up to the EMOM weight fix (previous entry below): "it is not only
on emom" turned out to be right. Deep-dived the whole אימונים section —
the builder's per-movement fields, the score-type logic (`scoreValue`/
`bestWodScore`/`formatWodEntry`), and every WOD list (history, picker,
benchmarks) — and shipped everything that came out of it except one
item flagged as a design decision, not a bug (see below).

**EMOM movements can now be duration/hold-based**, same reps↔duration
toggle every other format already had. A new `emomTargetDurations`
array parallels `emomTargetReps`; `emomMovementTypes` (`"reps"` /
`"duration"` / `"rest"`, see next item) says which one a given station
actually means. The log form switches to a seconds stepper for those
stations, labeled with the movement name — no separate structural
change needed since `wodEmomReps` already stores raw numbers
type-agnostically.

**EMOM movements can now be marked as a rest station** — a
`toggle-builder-movement-rest` chip in the builder that hides the
reps/duration/weight fields entirely once toggled. The log form skips
rendering a stepper for a rest station and shows a plain "מנוחה" label
instead. `saveWod()` and `startEditWodEntry()` both correctly exclude
rest stations from the saved `emomReps` array (keeping only the real,
loggable stations) and correctly re-expand a saved compact array back
to the WOD's full rotation shape when re-editing, so field indices stay
aligned with the right movement even when a rest station sits between
two logged ones.

**Calorie/meter movements get a real unit label.** Ten Monostructural
movements (Run, Row, Bike, Ski Erg, Swim...) and — where logged as reps
rather than the existing duration toggle — the seven distance-based Odd
Object carries were all labeled "חזרות" (reps) in the builder and the
EMOM log form's per-round header, regardless of what they actually
measure. New `repsFieldLabel()` detects the unit straight from the
movement's own name suffix ("(Calories)"/"(Meters)") and swaps the
label to "קלוריות"/"מטרים" accordingly. No data model change — same
number underneath, just labeled correctly.

**Custom WODs can finally be deleted.** There was no delete or rename
path for a custom WOD definition at all — every typo or test WOD (this
session's own "Test EMOM ..." WODs among them) would have stuck around
in the picker forever. Added a delete button in the picker, custom
WODs only, and only when `wodEntriesFor(id).length === 0` — deleting a
WOD *definition* must never be how someone's logged training history
disappears. `deleteCustomWod()` itself is the authoritative guard, not
just the UI: it refuses non-custom WODs and anything with entries even
if called directly.

**Left alone, flagged as a decision not a bug:** `"load"`-scored WODs
log weight only, no reps — reads as an intentional 1RM/heaviest-lift
design (every other format keeps weight as a WOD-level prescription
baked into the description; this is the one format where weight *is*
the score). Not touching it without an explicit call that it should do
more.

**Also found and fixed along the way:** a pre-existing Playwright/test
race, not an app bug — filling two stepper fields on the same builder
row back to back (e.g. reps then weight) could race the synchronous
re-render a field's own commit triggers, landing keystrokes on an
already-detached DOM node. A real user's tap-then-type naturally lands
on the post-render element, so this never affected real use; the new
shared `fillStepper()` helper in `scripts/browser-check/lib/actions.mjs`
blurs and waits between fields so future check scripts don't hit the
same race.

29 new tests across `test/emom.test.mjs` (extended) and the new
`test/wod-management.test.mjs`, plus 6 new browser-check assertions in
`emom.mjs`. Full suite: 134/134 jsdom tests, all 10 browser-check
scripts, green.

# EMOM movements can carry a prescribed weight — 2026-08-26

Reported with a screenshot: the WOD builder's EMOM screen let you set
reps per rotation movement (e.g. "10 Wall Balls") but had no way to
attach a weight, even for movements that are always loaded — Wall
Balls, D-Ball Cleans, any Dumbbell/Kettlebell/Weightlifting station.

Root cause: `hasWeight` in `renderWodBuilderMovements()` was
unconditionally forced to `false` whenever `builderFormat === "emom"`,
regardless of the movement's own category — every other format already
checked `WOD_MOVE_CATEGORIES_WITH_WEIGHT` (Weightlifting / Dumbbell /
Kettlebell / Odd Object) correctly. Removed the EMOM-only override so
it uses the same category check as everything else.

Weight is a fixed prescription per movement, the same way it already
worked for every non-EMOM format — baked into the generated free-text
description (`emomWodDesc()`, now `"10 Wall Balls @ 9kg"`) and into a
new structured `emomTargetWeights` array on the WOD record (parallel to
`emomTargetReps`, same clamp/pad-to-length handling in
`sanitizeCustomWod`) so the log form can show it as a label next to
each movement's reps stepper. Not logged per attempt — same as every
other format, the load itself doesn't change round to round or entry
to entry, only the reps you complete against it do.

5 new tests in `test/emom.test.mjs`, verified against the pre-fix code
via `git stash` before confirming the fix. Full suite: 122/122 jsdom
tests, all 10 browser-check scripts, green.

# Full-codebase audit: close out the remaining findings — 2026-08-26

Last round of the audit (previous two entries below): the remaining
low-severity finding, plus all eight test-coverage gaps the regression
pass flagged as having zero automated coverage.

**Fixed:** `clearAllData()` reset 21 pieces of state but not the five
`ladderMode`/`ladderGroupId`/`ladderPrimaryId`/`ladderPartnerId`/
`ladderBlockLabel` variables — clearing all data while a ladder was
active left the toggle showing "active" against a groupId pointing at
nothing. Now calls the existing `endLadder()`. Cosmetic only, never data
corruption (`currentLadderRounds()` just rendered "0 rounds").

**New test coverage** (32 new tests across 8 files, driving the real app
through its own exposed functions and dispatcher actions, same as the
rest of this suite — nothing reimplemented):
- `test/achievements.test.mjs` — the achievements modal and the
  post-save celebration popup (badge unlocks, plain PRs, locked-vs-earned
  rendering).
- `test/calendar.test.mjs` — month navigation (`cal-prev`/`cal-next`,
  including the January→December year wrap), day selection, and the
  logged-entry dot marker.
- `test/bodyweight-measurements.test.mjs` — the History tab's bodyweight
  and custom-measurement sections: same-day overwrite, case-insensitive
  duplicate type names, and cleanup on delete.
- `test/theme.test.mjs` — mirrors the existing text-scale tests for the
  sibling theme mechanism, including "auto" mode and the
  `meta[theme-color]` sync.
- `test/wod-history-chart.test.mjs` — confirms `renderWodDetailCard()`
  actually skips the PR-trend chart for EMOM (no single comparable
  score) while every other score type still gets one.
- `test/import-export-ui.test.mjs` — drives the real footer buttons
  through the click dispatcher, not `importDataFromFile()` directly as
  the existing `import.test.mjs` does. Required three small,
  test-only jsdom stubs in `test/helpers/boot.mjs` (documented there):
  `URL.createObjectURL`/`revokeObjectURL` (unimplemented in jsdom), a
  no-navigate shim for `<a download>` clicks (jsdom tries to "navigate"
  to the blob: URL otherwise), and clamping the rare 10s+ `setTimeout`
  down to near-zero (`exportData()`'s cleanup timer is a real 30s
  Node timer that would otherwise keep every test run waiting on it).
- `test/install-prompt.test.mjs` — the `beforeinstallprompt`/install
  banner handshake: showing the banner, replaying the deferred native
  prompt, the session-scoped dismiss, and `appinstalled` clearing state.
- `test/roadmap-features.test.mjs` — one new test asserting the
  onboarding overlay's actual content (all four tab walkthroughs), not
  just its open/dismiss timing as before.

Full suite: 118/118 jsdom tests (up from 86), all 10 browser-check
scripts, and `roadmap.mjs`, green.

# Full-codebase audit: fix the high-severity edit-then-navigate corruption bug — 2026-08-26

The logic/state-consistency pass of the same audit (previous entry below)
found the highest-severity issue: editing a strength or WOD entry, then
picking a different exercise/WOD *without* cancelling the edit first, then
saving, silently overwrote the original entry's identity in place —
`saveSet()`/`saveWod()` keep the edited entry's `id`/timestamp but write
the newly-picked exercise/WOD's data onto it. No warning, no duplicate,
just corrupted history.

Root cause: `editingEntryId`/`editingWodEntryId` weren't cleared by any of
the paths that change `selectedId`/`selectedWodId` mid-edit —
`choosePickedMovement()` (and `addMovement()`, which routes through it),
`select-benchmark`, `pick-wod`, the WOD picker's Enter-to-exact-match
shortcut, and `addCustomWod()`'s both branches (creating a new WOD or
reusing one that already exists by name). Fixed with two small guards —
`endEntryEditIfActive()` and `endWodEditIfActive()` — called at every one
of those sites: picking something else mid-edit now cancels the edit and
starts a fresh entry, instead of corrupting the one being edited.

Also fixed the accompanying moderate-severity finding: the EMOM
reps-resync at `renderWodLogSection()` only checked array *length*
against the newly-selected WOD, so swapping between two different EMOM
WODs with the same movement count left the previous WOD's reps on screen
against the new WOD's labels. Now keyed off the WOD's own id
(`wodEmomRepsForWodId`), not just length — also reset on "clear all
data" for the same reason.

New test file `test/edit-navigation-guard.test.mjs` (3 tests) reproduces
all three scenarios against the pre-fix code (verified via `git stash`)
before confirming the fix. Full suite: 86/86 jsdom tests, all 10
browser-check scripts, green.

# Full-codebase audit: wiring fixes — 2026-08-26

Ran a full audit (wiring/dead-code, security, logic/state-consistency,
regression + coverage) across the whole app. Security came back clean.
Three wiring issues found and fixed here; the higher-severity
logic/state findings (an edit-then-navigate-then-save path that can
silently overwrite the wrong entry's identity, on both the strength and
WOD sides) are tracked separately, pending sign-off before touching
`saveSet()`/`saveWod()`.

- The WOD tab's new empty state (previous entry below) accidentally
  orphaned the full "כל האימונים שלי" picker — the only way to browse
  and reselect an existing *custom* WOD with search — since it only
  rendered after something was already selected. Added a direct link to
  it from the empty state, wired to the existing `open-wod-picker`
  action.
- Removed a dead click-dispatcher branch (`view-today-calendar` — no
  markup anywhere ever set that action).
- Removed an orphaned CSS class (`.flex-1`, zero usages).

# The WOD tab no longer defaults to a random benchmark — 2026-08-26

Reported with a screenshot: opening רישום showed "Fran" already loaded and
ready to log, which read as "this is already my workout" rather than
something deliberately chosen. Root cause: `selectedWodId` initialized to
`WOD_LIBRARY[0].id` — always Fran, since it's simply the first entry in
that array — and reset to it on every fresh page load (never persisted,
so this happened on literally every visit, not just first install).

`selectedWodId` now starts `null` and stays that way until the user
actually picks or builds something. `renderWodLogSection()` gained an
empty-state branch for that case: "בחרו אימון להתחלה" with two buttons —
יצירת אימון (straight into the builder) and בנצ'מרק (the בנצ'מרקים
sub-tab). Both of the old picker-then-builder detours in the browser-check
scripts got simplified to the new direct button now that it exists.

The "clear all data" reset was also still setting the same
`WOD_LIBRARY[0]` default — changed to `null` there too for consistency.
`saveWod()` picked up a defensive `if (!w) return;` guard, even though the
empty state has no save button to reach it through.

# Remove the גדול מאוד (xlarge) text-size option — 2026-08-26

Direct feedback the same day it shipped: 1.45x was too big. Dropped it
from `loadTextScalePref`/`setTextScalePref`'s valid values, the footer's
options list, and the `--text-scale` CSS rule — just רגיל/גדול (1x/1.2x)
now. No migration needed: the validation already treats any unrecognized
stored value as invalid and falls back to normal, so a device that had
already picked xlarge just quietly reverts on next load rather than
erroring.

Also worth noting for anyone reading this after an "icon didn't update"
report: confirmed the deployed `icon-192.png` is correct on the server
(fetched it directly, byte count matches the new file) — a stale icon on
an already-installed iOS home screen is a platform limitation, not a
deploy issue. iOS snapshots the icon at "Add to Home Screen" time and
never re-checks it; the only fix is removing and re-adding the shortcut.

# Text-size preference, new app icon — 2026-08-26

Two pieces of direct user feedback.

- **Text size preference** ("older members can't see the small letters").
  A new רגיל / גדול / גדול מאוד control in the footer, next to the existing
  theme toggle — same mechanism (localStorage, applied by theme-init.js
  before first paint, no flash of the wrong size). Implemented as CSS
  `zoom` on `<html>` rather than converting fonts to `rem`: this app's
  typography is almost entirely literal `px` values baked into inline
  styles generated by app.js, not a stylesheet using relative units, so a
  `font-size`-based scale would only have touched a small fraction of the
  UI. `zoom` scales everything uniformly with a two-line CSS change.
  The one real risk was `position:fixed` modals (the picker, WOD builder,
  onboarding, etc.) — `zoom` doesn't establish a new containing block the
  way `transform` would, so verified explicitly in a real browser: a fixed
  overlay's `inset:0` still resolves against the true viewport (covers the
  screen correctly) while everything rendered inside it still scales with
  the rest of the page. One real interaction surfaced during that testing:
  `getBoundingClientRect()` on an element with an explicit pixel height
  (the WOD builder modal's own iOS-viewport-height workaround) reports in
  the zoomed tree's local coordinate space, not real device pixels — looks
  like a mismatch when compared naively against the real viewport size,
  but isn't one; the modal renders and behaves correctly on screen. The
  browser-check script verifies the underlying JS-computed height and
  actual on-screen visibility of the modal's controls instead of that
  raw (and misleading) rect comparison.
- **New app icon and logo**, replacing the placeholder set. Source was a
  single square composition (rounded tile, full wordmark, tagline) with a
  white margin around it — processed via a small Playwright/canvas script
  (no image-editing tooling available in this environment) into the four
  required PWA sizes: `icon-192`/`icon-512` (rounded, transparent corners,
  cropped tight to the source's own tile) and `icon-192-maskable`/
  `icon-512-maskable` (full-bleed navy background sampled from the source,
  content scaled to ~78% and cropped past the source's own inner
  highlight/bevel stroke, which read as a stray ring once shrunk onto a
  flat maskable background — not visible in the "any" icons, where it
  sits flush with their own edge).

# Fix: tapping a stepper's number reset it instead of letting you type — 2026-08-26

Reported with two screenshots of the EMOM builder's per-movement reps
field, but the root cause was in the one shared click dispatcher every
numeric stepper in the app goes through, so it affected all of them —
weight/reps/sets in the Log tab, WOD score fields, bodyweight,
measurements, everything.

The stepper's `<input>` carries the same `data-action` as its own +/-
buttons (that's how `getFieldValue`/`setFieldState` work for both). The
click dispatcher's "step" branch matched on `data-action` alone, with no
check for *which* element was actually clicked — so a tap on the number
itself fell into the same `dir * step` arithmetic as a real +/- press,
except the input has no `data-dir`, so `dir` was `NaN`, `clampField()`
floored that to the field's min, and the resulting re-render tore the
input out from under the tap before a keystroke could land. One tap
reset the field to 0 and stole focus — indistinguishable from "you can't
type a number in here" from the outside.

Fixed with a one-line guard: only an element carrying the `stepper-btn`
class (the +/- buttons, never the input) reaches the arithmetic. Typing
now works everywhere a number can be entered.

# Add a Benchmarks sub-tab to the WOD tab — 2026-08-25

A third sub-tab under אימונים, alongside רישום/היסטוריה: בנצ'מרקים lists the
built-in Girls/Heroes WODs (`WOD_LIBRARY`) grouped by category, with a
search box, deliberately excluding custom WODs — this is specifically for
browsing the fixed named benchmarks, not everything a box has ever logged.
Picking one selects it and switches straight to the log subtab
(`switchWodSubtab`, extracted from the previous round's subtab-highlight
fix so both the manual pill click and this new picker path stay in sync).
Reused the exact category-grouped list markup from the WOD picker
(`.cat-group`/`.cat-head`/`.movement-btn`) rather than inventing a new
pattern.

# Remove the partner tag; notifications now clear once seen — 2026-08-25

Two pieces of direct user feedback:

- **Removed the partner-tag field.** Not relevant to how this app is used —
  a session note per day (already shipped) covers "how did it feel"
  without a redundant per-WOD field. Pulled `partnerTag` out of
  `sanitizeWodEntry`, `saveWod`/`startEditWodEntry`, the log form, and both
  display sites (calendar day view, History tab's recent-attempts list).
  Old entries that already have a stored `partnerTag` from the brief window
  it was live just quietly stop surfacing it on the next load — sanitizers
  rebuild every record field-by-field, so nothing crashes or needs a
  migration. Time cap is untouched (kept, wasn't part of the complaint).
- **Notifications now disappear once seen.** They used to accumulate into
  a permanent history (the bell listed every past release, unseen ones
  marked "חדש"). Now `renderNotificationsList()` only ever renders what's
  currently unseen — once you've opened the bell (or gotten the auto-popup
  on a version bump), that entry is just gone, not archived. Same single
  list still backs both the auto-popup and the manual bell tap.

# Fix: WOD tab's רישום/היסטוריה pill highlight not following the subtab — 2026-08-25

Reported by the user with a screenshot: after switching WOD subtabs,
היסטוריה stayed highlighted while the רישום (log) form was actually
showing underneath. Root cause: the pill buttons are rendered once in
renderWodTab(), which only runs on a full top-level tab switch —
switch-wod-subtab's handler only ever called renderWodContent() (swaps
#wodContent's innerHTML), so the content switched correctly but the
highlight never followed it. Fixed by having the handler also update the
two buttons' active/aria-selected state directly, same pattern already
used for the WOD builder's format chips.

# Workout format support, sub-tasks A (WOD builder half) + B + D + extras — 2026-08-25

Finishes the workout-format-support spec: the WOD builder's own duration
toggle (the other half of sub-task A), blocks/supersets (B), EMOM (D), and
the two lower-priority extras (time cap, partner tag). Sub-task C was
already covered by the existing ladder feature (confirmed in the previous
round). Plain single-exercise logging, and every previously-shipped
feature, is unaffected — re-verified via the full test suite and browser
checks after each addition below.

- **WOD builder duration toggle.** A movement checked in the builder can be
  marked "reps" or "duration" (a reps/duration chip pair per movement,
  reusing the toggle from the Log tab). Only changes the free-text
  description the builder generates (`builderMovementsToDesc`) — WOD
  entries themselves have never stored structured per-movement data for any
  format except EMOM (see below).
- **Supersets and A/B/C/D block labels.** Extends the existing ladder
  mechanism rather than replacing it: a ladder can now optionally take a
  second exercise (`setLadderPartner`), turning it into a superset —
  alternating rounds between exactly two exercises under one `groupId`,
  switched between via two pills (`switchLadderExercise`) instead of the
  normal exercise picker (which still ends it, same as before). An
  optional `blockLabel` chip (A/B/C/D) tags the whole group, carried by
  every round. The calendar day view and Log tab's running list both
  derive "is this a superset" from the group's own data (more than one
  distinct exerciseId), not from in-progress session state, so a finished
  superset displays correctly regardless of how it was built.
- **EMOM.** A fourth WOD scoreType, built through the same
  reusable/named WOD builder as Fran or Grace — not a one-off freeform
  entry. Unlike every other format, an EMOM's movement rotation
  (`emomMovements`/`emomTargetReps`/`emomMinutes`) is structured data on the
  WOD record itself, because the log form needs it to render one reps
  field per movement, prefilled from that WOD's own targets and resized
  automatically when switching between differently-shaped EMOM WODs.
  Explicitly out of scope per the confirmed spec: no cross-attempt scoring
  — `bestWodScore`/the History tab's PR chart both skip EMOM entirely
  rather than fabricate a comparison that doesn't mean anything for it.
- **Time cap and partner tag.** Two small, independent additions: an
  optional reference-only time cap on a WOD (shown in the log header,
  never enforced or scored), and a free-text partner tag per WOD entry
  ("with Dana") shown next to Rx/Scaled in history and the calendar.

Also fixed along the way: the strength Log tab's est-1RM/barbell-visual
live-update on raw keystroke input wasn't duration-mode-aware (a latent gap
from the previous round, caught while wiring the same live-update path for
the new duration stepper), and picking an exact-name search match in the
exercise picker via Enter didn't end an active ladder the way clicking the
same movement's button already did — both now consistent.

# Workout format support, sub-task A: duration/hold entries — 2026-08-25

A structured spec came in covering four workout-logging gaps that BTWB/
SugarWOD-style apps handle poorly: timed holds, multi-part A/B/C blocks
with supersets, pyramid rep schemes, and EMOMs with rotating movements.
Pyramid schemes turned out to already be covered by the existing ladder
feature (confirmed, not assumed — skipped as its own sub-task). This round
covers sub-task A only; blocks/supersets and EMOM are separate, larger
changes staged for their own rounds.

- **Duration/hold entries in the strength Log tab.** A new reps/duration
  toggle next to the exercise picker switches the whole entry form: reps
  mode is exactly what existed before (unchanged), duration mode swaps the
  reps stepper for a duration-in-seconds one and skips the barbell-plate
  visual and bar-weight row (neither applies to a timed hold). Weight stays
  available in duration mode for weighted carries/holds, defaulting to 0
  for a bodyweight hold. `sanitizeEntry` gained a `type` ("reps" |
  "duration") discriminator and a `durationSeconds` field — every entry
  from before this change has no `type`, which sanitizes to "reps"
  automatically, so existing data and the plain reps flow are unaffected.
- Selecting an exercise now defaults the toggle to whatever it was last
  logged as (a hold-only movement like a plank stays in duration mode),
  and editing an existing entry restores its own type regardless of
  whatever the toggle currently shows.
- PR tracking, the History tab's per-exercise chart, and the achievement
  system's per-category PR counter all now correctly separate duration
  entries from reps entries — a hold-only movement reports "no 1RM" (not a
  phantom 0kg one), and its History chart plots hold time instead of
  est1RM. Recent-history, the calendar day view, and ladder-round display
  all format each entry by its own type, so a mixed history (an exercise
  logged both ways over time) renders correctly everywhere.
- Ladders and duration entries compose: a ladder can be a sequence of
  progressively longer holds, same as it can be a sequence of different
  weight/rep rungs. Switching the reps/duration toggle mid-ladder ends it,
  same as switching exercise or date already did.

# Roadmap round: notifications, onboarding, streaks, recent history, session notes — 2026-08-25

A 10-phase roadmap came in for "look at every tab." Two phases turned out
to already be substantially satisfied by existing code (found during
research, not assumed): the WOD tab's custom + Girls/Heroes-benchmark entry
paths, and the Log tab's last-session reference (which the immediately
preceding round had already turned into a tap-to-prefill button). Phase 9
depended on a "Goals" feature that doesn't exist anywhere in the codebase —
asked directly, skipped for this round. Phase 8 (build-then-commit a whole
session before saving anything) is a real redesign of the save flow the
user themselves flagged as needing its own planning pass — deferred to a
dedicated follow-up rather than bundled in with seven other features.

This round: expanded `WOD_LIBRARY` with 7 more evergreen benchmarks (Kelly,
Eva, Barbara, Filthy Fifty, Michael, Danny, Badger). Everything below is new.

- **Update notifications.** A small `RELEASE_NOTES` list (separate from
  this file — short, Hebrew, user-facing) backs both a one-time "מה חדש"
  popup shown to returning users after a real update, and a persistent bell
  icon in the header with an unread badge. A genuinely fresh install sees
  neither — nothing to catch up on; existing devices from before this
  shipped get silently backfilled so they're never shown a changelog
  retroactively.
- **First-time onboarding.** A short one-screen walkthrough (what each tab
  is for) shown once, immediately after the very first welcome/name modal —
  never for a device that already has data or a name.
- **Recent history at the point of entry.** Picking an exercise or WOD now
  shows up to 5 real logged attempts from the last 14 days, not just the
  single most-recent one. No warm-up logic anywhere in it — every row is an
  actual saved set.
- **Streak indicator.** Consecutive days (strength set or WOD, either
  counts) with at least one entry, shown next to the header's date. Reuses
  the exact same day-has-an-entry check the calendar's dots already used
  (extracted into one shared `hasAnyEntryOn`), so the two can never disagree
  about what counts as a trained day. Today not being logged yet doesn't
  break it — just isn't counted until it is.
- **Per-day session note.** One free-text field per calendar date ("how did
  the session feel"), distinct from the existing per-WOD-entry scaling
  notes. Surfaced from the Calendar day view.

Files changed: `app.js`, `index.html`. New `test/roadmap-features.test.mjs`
(7 tests: version comparison, fresh-install vs. existing-device bootstrap
paths, streak counting across gaps, the 14-day/5-item recent-history cap,
session-note round-trip). New `scripts/browser-check/roadmap.mjs` — real
Chromium session driving all five features end to end, including the
session note surviving a navigate-away-and-back round trip. `boot-smoke.mjs`
and `ladder.mjs` re-verified for regressions; their shared `dismissWelcomeModal`
helper updated to also close the new onboarding modal, since every
fresh-context check now hits it.

---

# Prefill from last session — 2026-08-25

Reframed what this app actually is: filled in after a workout (from memory
or a whiteboard scribble), not used live during one — which rules out
things like a rest timer, but means entry *speed* for reconstructing a
session is what matters. Progressive overload means today's numbers are
usually close to last time's, not random, yet the "אימון אחרון" (last
session) card was informational only — you still dragged the steppers from
scratch every time.

It's now a button: tapping it copies that exercise's last weight, reps,
and sets straight into the steppers (and the barbell visual updates with
them). A small repeat icon signals it's interactive, distinct from the
adjacent 1RM card which stays informational.

Files changed: `app.js`. Two new tests in `test/app-flow.test.mjs` (prefill
pulls the right exercise's history, not whatever was left over from a
different one; no-op when there's no history yet). Verified visually in a
real Chromium session — steppers and barbell both update from one tap.

---

# Committed browser-check scripts — 2026-08-25

Three real bugs this session (self-reload on first install, PR celebration
firing on every ladder rung, editing mid-ladder not ending it) only
surfaced through real-Chromium testing — jsdom doesn't implement Service
Worker lifecycle or real DOM event timing, so the committed `npm test`
suite structurally can't catch this class of bug. Those checks previously
lived as scratch scripts, rebuilt from scratch each time.

`scripts/browser-check/` — a separate package (own `package.json`, own
`playwright` dependency, own lockfile) so the main app's dependency tree
stays untouched:

- `npm run setup` once (installs Playwright + downloads Chromium)
- `npm run check:boot` — fresh load, fonts actually loaded, no self-reload,
  all 4 tabs switch, no console errors
- `npm run check:ladder` — a real 5-round working-up ladder end to end:
  toggle, save, celebration suppression, calendar grouping, edit, delete,
  finish
- `npm run check:update` — the Service Worker update lifecycle (first
  install doesn't self-reload; an update hidden from view auto-applies
  silently; one landing mid-session shows the banner and applies on the
  next visibility regain). Local-only — it edits `sw.js` on disk to
  simulate a new deploy landing, reverted when it's done.
- `npm run check:all` runs all three, stopping at the first failure

Each defaults to a throwaway local static server over the working tree
(uncommitted changes included); `TARGET_URL=<url>` points any of them at a
deployed site instead, e.g. to verify a push actually landed.

Not part of the main test suite or any CI — on-demand only, the same way
this session ran them by hand throughout.

---

# Gap-hunting pass — 2026-08-25

Went back through the app looking for rough edges, focused on the ladder
feature since it's newest. Found and fixed one real interaction bug, plus
an accessibility gap.

- **Bug: editing an unrelated entry mid-ladder didn't end it.**
  `startEditEntry()` (the pencil icon on any set in history/calendar)
  switches the selected exercise and log date, exactly like picking a new
  movement or changing the date already did — but unlike those two, it
  never called `endLadder()`. Editing an old set from a different exercise
  while a ladder was running left the toggle still advertising an active
  ladder for the wrong context. Fixed — with one deliberate exception:
  editing one of the *active ladder's own* rounds (fixing a typo in set 3)
  does **not** end it, so correcting a mistake mid-session doesn't strand
  you from adding set 6 afterward.
- **Accessibility:** the ladder progress text ("5 סטים נרשמו · הבא: 6")
  now carries `aria-live="polite"`, matching the pattern already used for
  the storage-error and import-result messages.

Files changed: `app.js`. Two new regression tests in `test/app-flow.test.mjs`
cover both the "unrelated edit ends it" and "own-round edit doesn't" cases;
the fix was verified in a real Chromium session too — my own test script
had exercised this exact path without realizing the tested behavior was
wrong until this pass looked closer.

---

# Ladder UX pass — 2026-08-25

The ladder toggle worked but was easy to miss (a small text link) and gave
no feedback on what it actually did — no indication of which set you were
on, the save button never changed to reflect it, and finishing without
switching tabs first left stale state on screen (a real bug: `endLadder()`
via the explicit toggle never called `render()`, so the UI kept showing
"finish ladder" and the old round list until something else happened to
re-render).

- Toggle is now a full-width bordered button (matching the app's existing
  "+ add new" prompt pattern) with a ladder icon and a plain-language
  subtitle when off. While active, it shows live progress inline — "5 סטים
  נרשמו · הבא: 6" — instead of requiring a scroll down to the chip list to
  know where you are.
- The Save button's own label now changes too: "הוספת סט 6 לסולם — Strict
  Press" instead of the generic "רישום סט", so it's explicit that tapping
  it adds another rung rather than finishing anything.
- Fixed: tapping "סיום" now re-renders immediately (previously required
  switching tabs to see the toggle/list actually clear) and shows a brief
  confirmation ("הסולם נשמר — 5 סטים") reusing the existing footer message
  mechanism.
- Fixed a copy bug: the empty-ladder hint referenced "the blue button" —
  the save button is actually the brand's orange/energy color, never blue.

Files changed: `app.js`. Verified with the full test suite plus a real
Chromium session driving the exact flow (toggle on, 5 different-weight
rounds, finish without switching tabs, confirm the render and message).

---

# Service worker: stop self-reloading on first install, apply updates without reopening — 2026-08-25

Two bugs in the update-delivery path, found while chasing a report that the
new ladder feature "wasn't showing up."

**Critical: every fresh visit was reloading itself ~1-2s after opening.**
`self.clients.claim()` in the service worker's `activate` handler fires
`controllerchange` even on a page's very first-ever install — not just on a
real update swap. The app's `controllerchange` listener reloaded
unconditionally, so any in-progress input (the welcome-modal name field, a
weight being adjusted, a ladder mid-session) could get silently wiped a
second or two into every single visit. `applyUpdate()` now sets a
`swapRequested` flag right before asking a waiting worker to take over, and
the listener only reloads when that flag is set — ignoring the incidental
first-claim event. Confirmed via a real Chromium session: before the fix, a
fresh load always fired a second navigation within ~2s; after, zero.

**Updates now apply without a manual reopen, in the common case.** Previously
every update needed an explicit tap on the "עדכון חדש זמין" banner. Since the
phone screen locking between sets already fires `visibilitychange`, updates
now apply automatically the moment the page regains visibility after being
backgrounded — no banner, no reopening needed. The banner still appears as a
fallback only when an update lands while the page has stayed continuously
visible (reloading then could drop unsaved input), and applies automatically
on the next visibility regain even if the banner is never tapped.

Files changed: `app.js`. No test suite coverage for either fix — both are
real Service Worker lifecycle behavior that jsdom doesn't implement, so they
were verified with a real Chromium session (Playwright) against a local
static server instead; see the session's own scratch scripts for the pattern
if this code changes again.

---

# Ladder logging — 2026-08-25

Working-up ladders (e.g. Press: 6 reps @ 60, 5 @ 70, 4 @ 80, 3 @ 85, 3 @ 90 —
each rung a different weight *and* rep count) didn't fit the "Sets" field,
which only means "N identical sets at one weight/reps." Saving each rung
separately already worked, but showed up as unrelated rows.

- Entries gained an optional `groupId` (`sanitizeEntry`) tying together the
  rows saved in one ladder session. Existing records get `groupId: null` —
  no behavior change for anyone who never uses this.
- New toggle in the log tab: "רישום סולם" turns it on (generates a session
  id), every Save while it's on joins that session, a running list of the
  rounds so far shows underneath with a per-round remove. "סיום סולם" turns
  it off. Switching exercise or changing the log date auto-ends it, so a set
  can't silently misjoin the wrong session.
- The calendar day view groups a ladder's rows into one card (exercise name
  + PR flame shown once) — but every rung keeps its own edit/delete, so a
  specific set stays individually correctable.
- The full-screen "PR!" celebration popup is suppressed while a ladder is
  active — an ascending ladder routinely beats the previous best est1RM on
  every rung, which meant one popup per rung. The inline barbell flash still
  shows a PR immediately; the popup resumes normally once the ladder ends.
- Nothing else changed: PR detection, `bestEst1RM`/`repRecordFor`, the
  progress chart, and export/import all still treat every round as its own
  entry, same as before — a ladder's rungs just happen to share a tag.

Files changed: `app.js`. Tests: `test/sanitizers.test.mjs` (groupId
round-trip), `test/app-flow.test.mjs` (a real 5-round ladder end to end,
including surviving a simulated reload, and exercise-switch auto-ending it).

---

# "Next level" pass — 2026-08-25

Follow-up to the review below: closed out the "left for you" items from the
2.8.0 pass, plus an accessibility sweep, an install prompt, and the first
committed automated test suite.

Files changed: `app.js`, `index.html`, `sw.js`. New: `assets/fonts/*` (13
files), `package.json`, `package-lock.json`, `scripts/sync-version.mjs`,
`test/*`, `.gitignore`. `manifest.json` unchanged.

Verified with `npm test` (Node's built-in test runner, jsdom + fake-indexeddb,
dev-only — nothing here ships to the deployed site): **19 assertions**, all
passing, covering sanitizers/XSS-escaping, the add-movement → log-a-set →
simulated-reload round trip, and the import path (valid backup, `__proto__`
category neutralization, wrong-app-id rejection, oversized-file rejection).

## Self-hosted fonts, tightened CSP

- Downloaded the exact Rubik (400/600/700/800/900, latin+hebrew subsets),
  JetBrains Mono (500/700), and Anton (400) `.woff2` files Google's own CSS2
  API serves for this app, into `./assets/fonts/`. Verified woff2 magic bytes
  on all 13 files.
- Replaced the Google Fonts `<link>` in `index.html` with local `@font-face`
  rules using the same `unicode-range` values, so subsetting behavior is
  unchanged.
- CSP's `style-src`/`font-src` no longer allow any external origin — the app
  now makes zero third-party network requests, full stop.
- `sw.js` precaches all 13 font files, so typography no longer degrades
  offline.

## Accessibility pass

Previously: 2 `aria-*`/`role` attributes in the whole app. Now: 120 across
`index.html` + `app.js`. Added:
- `role="tablist"`/`"tab"`/`aria-selected` on the main tab bar and the WOD
  sub-tab bar, kept in sync on every tab switch.
- `role="dialog"` `aria-modal` `aria-labelledby` on all 6 modals (picker, WOD
  picker, WOD builder, achievements, celebration, welcome), `aria-label` on
  every icon-only close button.
- `aria-label` on every search input, date input, and icon-only edit/delete
  button; `aria-label` on the stepper +/− buttons and value fields.
- `role="radiogroup"`/`"radio"` + `aria-checked` on the WOD format picker, bar
  weight picker, Rx/Scaled toggle, and theme picker; `role="checkbox"`
  `aria-checked` on the WOD-builder movement checklist rows.
- `role="status"`/`aria-live` on the update banner, install banner, loading
  screen, storage-error footer note, and import-result message.

## Version sync automated

`APP_VERSION` (app.js) and `SW_VERSION` (sw.js) were kept in sync by hand.
`scripts/sync-version.mjs` now does it — `npm run sync-version` after bumping
`APP_VERSION`, `npm run check-version` (or `npm test`) fails loudly if they
ever drift.

## Install prompt

Custom "Add to Home Screen" banner (`app.js`: `beforeinstallprompt` handling;
`index.html`: `#installBanner`), styled like the update banner but with the
brand stripe instead of solid energy color so the two are visually distinct.
Shows once per session, steps aside if an update banner is showing, never
shows if already installed. iOS Safari doesn't fire `beforeinstallprompt`, so
the banner simply never appears there — no regression, just no improvement
for that platform.

## Export privacy notice

One line under the export/import buttons: the backup file is plaintext JSON
and includes name, bodyweight history, and full training log.

## Left undone (by design, not oversight)

- **Server response headers** (HSTS, `X-Content-Type-Options`,
  `Permissions-Policy`, real `frame-ancestors`) — GitHub Pages can't set
  custom headers; would need Cloudflare or another host in front. Decided
  against for now: no backend, no data leaves the device, so this was already
  low real-world risk.

---

# Security & hardening pass — v2.7.0 → v2.8.0

Files changed: `app.js`, `index.html`, `sw.js`. `manifest.json` unchanged.

Verified with two suites run against the real app booted in a DOM
(jsdom + fake-indexeddb): **58 security assertions** and **59 functional
regression assertions**, all passing.

---

## Critical

### 1. XSS via unescaped HTML attributes
`esc()` was applied to text nodes but skipped on several attribute values.

- `renderStepper()` — `data-field`, `data-action`, `data-step`, `data-min`,
  `value`, and the label are now all escaped. `field` is a user-authored
  movement name from the WOD builder.
- `data-id` on `pick-movement`, `pick-wod`, `select-history`,
  `select-wod-history`, `delete-entry`, `delete-wod-entry`; `data-date` on
  `cal-select-day`.
- `CATEGORY_LABELS[cat] || cat` and `style="background:${CATEGORY_COLORS[cat]}"`
  — replaced with `catLabel()` / `catColor()`, which use `hasOwnProperty` and
  fall back to safe defaults, then escaped.
- The `render()` catch-block printed `err.message` raw into `innerHTML`.

The `id` and `category` sinks were reachable from an imported backup file,
which is the vector that mattered.

### 2. Import accepted arbitrary data
`importDataFromFile()` checked only that `record.id` was truthy.

- Added `sanitizeMovement` / `sanitizeCustomWod` / `sanitizeEntry` /
  `sanitizeWodEntry` / `sanitizeBodyweight`. Each rebuilds the record field by
  field from a whitelist: `cleanId` (charset `A-Za-z0-9._:-`), `cleanStr`
  (control chars stripped, length capped), `cleanNum` (clamped both ends),
  `cleanISODate`, `cleanTs`. Nothing from the file is ever stored as-is.
- `data.app` and `data.version` are now verified (they were written on export
  and ignored on import).
- 25 MB file cap, 20,000-record-per-list cap.
- Confirmation prompt before merging, and a `box-log-rollback-<date>.json`
  auto-backup is downloaded first, since the merge can't be undone in-app.
- Result message reports imported / rejected / failed-to-save counts.
- New `reloadFromDb()` re-sanitizes on every load, so records written by an
  older build of the app can't poison the render path either.

### 3. Prototype pollution → persistent DoS
`byCategory[m.category]` with `category: "__proto__"` resolved to
`Object.prototype`, and `.push` threw a `TypeError`. Because the record was
persisted, the picker crashed on every load until "clear all data".

- `byCategory` and `builderMovements` now use `Object.create(null)` via `bag()`.
- `catColor` / `catLabel` guard lookups with `hasOwnProperty`.
- The category whitelist in the sanitizer closes the entry point.

---

## Hardening

- **CSP added** to `index.html` — `script-src 'self'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'none'`, `connect-src 'self'`.
  `'unsafe-inline'` is in `style-src` only (inline `style=` attributes; there is
  no inline `<script>` anywhere). `frame-ancestors` is in the meta tag but is
  ignored there — **set it as a real response header on the host.**
- `<meta name="referrer" content="no-referrer">`.
- Google Fonts left in place but documented inline with the exact steps to
  self-host; `preconnect` to `fonts.gstatic.com` was missing and is now added.
  Self-hosting is the one item I couldn't do for you — it needs the woff2 files.

---

## Service worker (rewritten)

- **Origin-gated.** It previously cached every successful GET from any origin,
  forever. Now same-origin only, and only app-shell paths are written back.
- **`Promise.allSettled` over individual `cache.add()`** instead of `addAll()`,
  which failed the entire install on one missing file.
- **Added the maskable icons** to `ASSETS` (referenced in the manifest, absent
  from the precache list).
- **Navigation handling with `ignoreSearch: true`** — this is what makes the
  manifest shortcuts (`./index.html?tab=add`) work offline; exact-URL matching
  missed on the query string.
- **`skipWaiting()` removed from install.** A new worker parks in `waiting`; the
  update banner posts `SKIP_WAITING` and the page reloads on `controllerchange`.
  Previously the new worker took over while the old `app.js` was still running.
- Navigation preload enabled; `SW_VERSION` bumped to 2.8.0 alongside
  `APP_VERSION`.

---

## Smaller fixes

- **Pinch-zoom restored.** `user-scalable=no` / `maximum-scale=1` removed from
  the viewport meta, and the `touchmove` / `gesture*` blockers removed from
  `app.js` (WCAG 1.4.4). The double-tap-zoom suppression is kept, since that one
  fires by accident on the steppers.
- **Numeric inputs bounded at both ends** via `clampField()` — previously only a
  floor. `1e12` in a weight box no longer propagates into app state.
- **`maxlength` on every text input**, plus `cleanStr()` caps in JS (names 80,
  notes 300).
- **IDs now use `crypto.randomUUID()`.** The old slug scheme stripped every
  non-`[a-z0-9]` character, so all Hebrew movement names collapsed to
  `custom--<timestamp>`.
- **`userName` moved from localStorage to IndexedDB** (with one-time migration).
  It's the only PII in the app and "clear all data" never touched it — it does
  now, and the welcome modal reappears. Same for the last-export marker.
- **Storage failures surfaced.** `noteStorageError()` distinguishes
  `QuotaExceededError` and shows it in red in the footer instead of silently
  swallowing it.
- `CSS.escape` via `cssSel()` on the two `querySelector` calls that interpolate
  a field name — these threw on any name containing a quote.
- `openDB()` now memoises its promise instead of reopening the DB per call.
- `URL.revokeObjectURL` deferred 30s so the download reliably starts.
- `mobile-web-app-capable` added next to the deprecated Apple variant.

---

## Left for you

1. **Self-host the fonts** and tighten the CSP to `font-src 'self'` /
   `style-src 'self' 'unsafe-inline'`.
2. **Server response headers**: HSTS, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: no-referrer`, `Permissions-Policy` denying
   camera/microphone/geolocation/usb, and `frame-ancestors 'none'` as a real
   header.
3. **Automate the version bump** — `APP_VERSION` in `app.js` and `SW_VERSION` in
   `sw.js` are still synced by hand. A missed bump means users stay on stale
   code, which is now a security concern and not just a UX one.
4. Exports are still plaintext JSON containing the name, bodyweight history, and
   full training log. Normal for a backup, but worth a line of UI text next to
   the export button.
