// THE DEPLOY PUBLISHES THE REPOSITORY, SO THE REPOSITORY IS THE WEBSITE.
//
// There is no build step: Cloudflare Pages serves the repo root as the site root. That keeps a buildless
// app simple, and it also means test/*.mjs, scripts/, package.json, CLAUDE.md and CHANGES.md are live URLs.
// This middleware answers 404 for them. (_redirects cannot do it: Pages matches a static asset before it
// consults _redirects, so a rule can never shadow a file that exists. Middleware runs before asset
// resolution.)
//
// WHAT THIS IS AND IS NOT. Disclosure control, not a secret store: nothing damaging to publish belongs in
// this repository at all. A prefix list, not an allow-list of app files: an allow-list is safer in principle
// and far more dangerous here, because missing one asset breaks the app for everyone with no build step to
// catch it. test/middleware.test.mjs checks that every file the app loads or precaches is still served.
const BLOCKED_PREFIXES = [
  "/test/",
  "/scripts/",
  "/.github/",
  "/.githooks/",
  "/.claude/",
  "/node_modules/",
  "/functions/",
];

// Exact top-level files: tooling for the test suites that the app never fetches. Exact paths, not a suffix
// rule: a .json suffix would take /manifest.json with it.
const BLOCKED_PATHS = new Set(["/package.json", "/package-lock.json"]);

// Top-level notes and runbooks (CLAUDE.md, CHANGES.md), matched by extension so a new one needs no
// remembering. Only at the top level: /src/*.mjs would be app code and must keep serving.
const BLOCKED_SUFFIXES = [".md", ".sql", ".mjs"];

// The pathname as the asset server will resolve it. The WHATWG URL keeps "%74est" encoded but the static
// server decodes it to "test", so matching the raw string would let /%74est/... past the list. Decode until
// stable (a double-encoded %2574 too), fold backslashes and repeated slashes. A malformed escape is null,
// and the caller blocks it.
function normalizePath(pathname) {
  let p = String(pathname);
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(p); i++) {
    try { p = decodeURIComponent(p); } catch (err) { return null; }
  }
  if (/%/.test(p) && /%(?![0-9a-f]{2})/i.test(p)) return null;
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
}

export function isBlocked(pathname) {
  const p = normalizePath(pathname);
  if (p === null) return true;
  if (BLOCKED_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  if (BLOCKED_PATHS.has(p)) return true;
  if (p.lastIndexOf("/") === 0 && BLOCKED_SUFFIXES.some((s) => p.endsWith(s))) return true;
  return false;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (isBlocked(url.pathname)) {
    // _headers does not apply to a Functions response, so the 404 carries its own.
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // A boundary cached at the edge keeps answering after it changes.
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
      },
    });
  }
  return context.next();
}
