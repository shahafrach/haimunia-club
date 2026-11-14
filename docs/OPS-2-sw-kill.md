# OPS-2: service worker kill switch

Rollback plan for every service worker change. Rolling back the code does NOT remove an installed
worker; a member's phone keeps running the broken one until a newer sw.js replaces it. This does that.

Branch `emergency/sw-kill` (3.7.3). Never merged ahead of need. It touches only Cache Storage and the
worker's own registration. IndexedDB and localStorage are not read or written (test/sw-kill.test.mjs).

## Ship (about 4 minutes, then step 6)
1. Owner: create the rollback tag on main (CLAUDE.md Releases command), `<current version>` = main's version.
2. Rebase on main: `git fetch origin && git rebase origin/main emergency/sw-kill`. Conflicts are only
   `sw.js`, `app.js` (version line, `setUpServiceWorker`) and `CHANGES.md`: take this branch's sw.js and
   setUpServiceWorker. Set the version to the next free number (the owner or coordinator sets it);
   then `npm run sync-version`.
3. Open the PR to main, merge it. CI will show failures in tests that assert the NORMAL worker
   (sw-navigation, sw-precache, security-hunt-sw-redirect-cache, hunt-round5-pwa-multitab, and one test each
   in middleware and storage-compat). That is expected while the kill worker is live: merge anyway.
4. Wait for the Cloudflare Pages deploy, then check `curl -sI <site>/sw.js` shows the new bytes
   (`grep -c "KILL SWITCH"`).
5. Test on one phone: open the app. It reloads once (URL gets `?swk=1`), data intact.
6. Ship a fixed worker as soon as possible. While the kill switch is live the app has no offline mode:
   no service worker means no cache, so every start needs a network connection.

## How it reaches a stuck member
Browsers re-fetch sw.js on every navigation attempt, even when the old worker breaks the page. The new
worker installs, skipWaiting, activates, deletes all caches, unregisters, and reloads open windows once.
A member whose app never opens gets it on the next launch attempt.

## Afterwards
Revert the kill commit, bump to the next version so the normal worker installs again, and fix the cause.
`sw.js` is served `no-cache` (_headers), so no CDN delay.

## Caveat
It deletes ALL caches of the origin, not only the `haimunia-v` prefix. Safe on this app's own origin
(Cloudflare Pages). On a shared origin like haimuniya.github.io it would also clear other apps' caches.
