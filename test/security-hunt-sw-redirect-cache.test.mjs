// Security hunt, round 5 (2026-09-11), PWA/service-worker agent.
//
// THE FINDING. The stale-while-revalidate cache.put() in sw.js's fetch
// handler checked res.ok/res.type/isPrecached(url) but never res.redirected.
// A same-origin HTTP redirect still yields type:"basic"/ok:true per the
// Fetch spec, so a precached path that was ever redirected would have had
// the REDIRECTED body cached under the ORIGINAL trusted URL. Confirmed live
// (real Chromium, a real local HTTP server issuing a real same-origin
// redirect for a precached asset, a real installed service worker): the
// redirected content got written into the cache and was later served back
// fully offline. Not reachable on this app's real static-hosting origin
// today (checked: no server-side redirect mechanism exists there), so this
// is a defense-in-depth close, same as round 3's isPrecached() tightening -
// cheap to fix outright rather than leave as a latent gap.
//
// This test asserts the fix is present in the shipped source, the same
// source-slicing technique test/sw-precache.test.mjs already uses on this
// file (sw.js has no real ServiceWorkerGlobalScope this suite can boot).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("the stale-while-revalidate cache write refuses a redirected response, even one that is otherwise ok and same-origin", () => {
  const fetchHandler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
  assert.match(
    fetchHandler,
    /if \(res && res\.ok && !res\.redirected && res\.type === "basic" && isPrecached\(url\)\) \{/,
    "cache.put()'s guard must check !res.redirected alongside res.ok/res.type/isPrecached - a same-origin redirect still reports ok:true/type:\"basic\", so without this check a redirected precached URL would cache the redirected body under the original trusted key"
  );
});
