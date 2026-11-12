// Live bug hunt, fresh round 5 (2026-09-15) — the PWA update handshake with
// more than one tab open.
//
// sw.js's activate handler calls self.clients.claim(), which reassigns the
// controller of EVERY open tab, not only the one that tapped the banner. The
// tab that did nothing therefore received a controllerchange with its own
// swapRequested still false.
//
// Returning there was right - reloading out from under an active session is
// the thing the banner exists to prevent - but incomplete: the swap had
// already happened and nothing recorded it. That tab's banner then became a
// control that could never work, because applyUpdate() posted SKIP_WAITING to
// an already-activated worker (a no-op) and waited for a second
// controllerchange that could not fire. The banner could be neither applied
// nor dismissed for the life of the tab, while that tab ran OLD app.js code
// against the NEW worker's cache.
//
// Reachable on Android, which allows several task-switcher instances of an
// installed PWA, and trivially by anyone with the app open in a browser tab
// alongside it.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const swJs = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("a controller swap is recorded even when this tab did not ask for it", () => {
  const at = appJs.indexOf('addEventListener("controllerchange"');
  assert.ok(at > -1, "the listener exists");
  const body = appJs.slice(at, appJs.indexOf("});", at));
  const flagAt = body.indexOf("if (hadControllerAtBoot) controllerAlreadySwapped = true;");
  const guardAt = body.indexOf("if (!swapRequested) return;");
  assert.ok(flagAt > -1, "the swap is recorded");
  assert.ok(guardAt > -1, "the do-not-reload-unasked guard is still there");
  assert.ok(flagAt < guardAt,
    "it must be recorded BEFORE the early return, or the unasked case - the whole bug - records nothing");
});

test("a banner in a tab whose controller already swapped reloads instead of hanging", () => {
  const at = appJs.indexOf("function applyUpdate()");
  const body = appJs.slice(at, appJs.indexOf("\n}", at));
  assert.match(body, /if \(controllerAlreadySwapped\) \{ location\.reload\(\); return; \}/,
    "there is nothing left to hand-shake with, so it reloads directly");
  const swapAt = body.indexOf("controllerAlreadySwapped");
  const postAt = body.indexOf('postMessage({ type: "SKIP_WAITING" })');
  assert.ok(swapAt > -1 && postAt > -1 && swapAt < postAt,
    "and checks that BEFORE posting SKIP_WAITING to a worker that has already activated");
});

test("the premise still holds: the service worker claims every client", () => {
  // If this ever stopped being true the bug above would not exist - and the
  // fix would be harmless but pointless. Pinned so the reasoning stays
  // checkable rather than becoming folklore.
  assert.match(swJs, /clients\.claim\(\)/,
    "sw.js claims all clients on activate, which is what swaps the other tab");
});

test("reloading out from under an active session is still refused", () => {
  // The guard this fix sits next to must not be weakened: a tab that did not
  // tap anything still does not reload itself. It only stops pretending it
  // can hand-shake later.
  const at = appJs.indexOf('addEventListener("controllerchange"');
  const body = appJs.slice(at, appJs.indexOf("});", at));
  assert.match(body, /if \(!swapRequested\) return;/,
    "an unrequested swap must never trigger a reload on its own");
});

test("the first-ever claim is not mistaken for a swap", () => {
  // A page with no prior controller gets one controllerchange the moment the
  // first worker claims it. Treating THAT as "already swapped" made
  // applyUpdate() reload without ever posting SKIP_WAITING, so the waiting
  // worker never activated and the reload served the old version again.
  //
  // My first version of this fix did exactly that, and update-flow.mjs's
  // "banner does NOT show while hidden" caught it within a minute - a good
  // argument for running the real browser scenario rather than trusting a
  // source-level test that only knows the shape I had in mind.
  const at = appJs.indexOf('addEventListener("controllerchange"');
  const before = appJs.slice(appJs.lastIndexOf("let reloading = false;", at), at);
  assert.match(before, /const hadControllerAtBoot = !!navigator\.serviceWorker\.controller;/,
    "whether this tab was already controlled is read once, before any event can fire");
  const body = appJs.slice(at, appJs.indexOf("});", at));
  assert.match(body, /if \(hadControllerAtBoot\) controllerAlreadySwapped = true;/,
    "and only a tab that was already controlled can have been SWAPPED");
});
