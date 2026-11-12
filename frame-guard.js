// Security hunt round 8: defense-in-depth against a live-confirmed
// clickjacking chain. index.html's meta CSP `frame-ancestors 'none'` is
// spec-ignored inside a <meta> tag - only a real HTTP response header is
// honoured, and GitHub Pages - the host when this was written - had no way
// to send one (see the long comment above the CSP meta tag). Cloudflare
// Pages now sends it from _headers; this stays as defense-in-depth. A live proof-of-concept
// confirmed that gap is exploitable, not just theoretical: an invisible
// iframe positioned over pre-measured real coordinates ("leave challenge",
// confirm-yes) silently executed the action on a signed-in member who only
// ever saw a decoy page - the same technique reaches every
// askConfirm(destructive:true) action in cloud.js and app.js's own
// appConfirm (delete-account, block, admin actions, ...).
//
// This is the one mitigation that IS available on any host, framework-free:
// a legitimate installed PWA or an ordinary browser tab always has
// window.top === window.self, so this can never affect real usage - only an
// attempt to load the app inside another page's frame, which has no
// legitimate reason to happen. Runs synchronously, before first paint
// (loaded first in <head>, ahead of theme-init.js), so there is no window
// where framed content is visible/hit-testable before this fires.
//
// The display:none is the load-bearing part, verified live: a hidden
// element is not rendered, not painted, and not hit-testable, so there is
// nothing left inside the frame for an invisible-overlay attack to
// position a fake button over - the actual mechanism the live PoC used.
// The top.location reassignment is attempted too, best-effort: modern
// Chromium blocks a cross-origin child frame from navigating its
// top-level window without a user gesture (confirmed live - it logs
// "Unsafe attempt to initiate navigation ... neither same-origin ... nor
// has it received a user gesture" and silently no-ops, not a thrown
// exception), so it will not always succeed, but costs nothing to attempt
// and still helps for a same-origin parent or a future relaxation of that
// restriction.
//
// Kept as its own tiny file, not folded into theme-init.js, because the
// CSP's script-src 'self' has no 'unsafe-inline' and this is a distinct
// concern (security, not theming) - same reasoning theme-init.js's own
// comment gives for being separate from an inline <script>.
(function () {
  if (window.top === window.self) return;
  try {
    document.documentElement.style.display = "none";
  } catch (e) {}
  try {
    window.top.location = window.self.location.href;
  } catch (e) {}
})();
