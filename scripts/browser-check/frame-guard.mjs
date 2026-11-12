#!/usr/bin/env node
// Security hunt round 8: frame-guard.js (loaded first in index.html's
// <head>) is a client-side framebuster added after a live proof-of-concept
// showed an invisible iframe over pre-measured real coordinates could
// trigger a real destructive action (leave-challenge) on a signed-in
// member who only ever saw a decoy page - the meta-tag CSP's
// frame-ancestors is inert on this host (see the comment above it in
// index.html), so this is the mitigation that IS available.
//
// Two checks: a normal, un-framed load renders exactly as before (this
// must never regress - it would break every real user), and a page that
// embeds the app in a same-origin iframe gets its top-level frame busted
// out to the app's own URL, which also proves the guard never leaves a
// framed victim looking at a normal-seeming, silently-clickable page - the
// window itself stops being the decoy.
//
// Usage:
//   node frame-guard.mjs                 # local working tree
//   TARGET_URL=<url> node frame-guard.mjs # a deployed site
import http from "node:http";
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

// A decoy page on its OWN origin (different port = different origin under
// same-origin policy, same as a real attacker's unrelated domain), the
// same shape as the live PoC's decoy. A data: URL was tried first and
// rejected: Chromium disables storage for any document whose top frame is
// data:, which breaks theme-init.js's own localStorage read regardless of
// this fix, so it cannot stand in for a real attacker page.
function startDecoyServer(appUrl) {
  const html = `<!doctype html><html><body style="margin:0">
    <iframe src="${appUrl}" style="width:100%;height:100%;border:0;position:absolute;inset:0;opacity:0;"></iframe>
  </body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();

// --- 1. A normal, top-level, un-framed load must render exactly as before ---
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installMockCloud(page);
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForSelector("#app", { state: "visible", timeout: 10000 });
  const display = await page.evaluate(() => getComputedStyle(document.documentElement).display);
  check("an ordinary, un-framed load is never hidden by frame-guard.js", display !== "none", `<html> display=${display}`);
  await page.close();
}

// --- 2. Embedded in a cross-origin decoy page's invisible iframe (the
// exact live-PoC shape): the framed document must end up hidden and
// non-interactive, so there is nothing left inside it for the decoy to
// position a fake button over. This is the load-bearing property - the
// PoC's attack needed a real, clickable button positioned exactly under a
// decoy button, and display:none removes it from the render/hit-test tree
// entirely, regardless of the overlay's opacity or positioning.
//
// Not asserted here: window.top navigating away from the decoy. Confirmed
// live that modern Chromium blocks a cross-origin child frame from
// navigating its top-level window with no user gesture ("Unsafe attempt
// to initiate navigation ... neither same-origin ... nor has it received
// a user gesture") - frame-guard.js still attempts it (best-effort, costs
// nothing), but a check asserting it would fail on the very browser this
// suite runs against and prove nothing about the actual defense.
{
  const decoy = await startDecoyServer(target.url);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installMockCloud(page);
  await page.goto(decoy.url, { waitUntil: "load" });
  await page.waitForTimeout(500);

  const appFrame = page.frames().find((f) => f.url().startsWith(target.url.replace(/\/$/, "")));
  check("the app's iframe is actually present in the decoy page (sanity check)", !!appFrame);

  if (appFrame) {
    const display = await appFrame.evaluate(() => getComputedStyle(document.documentElement).display);
    check("frame-guard.js hides the framed document (display:none)", display === "none", `display=${display}`);

    // Real proof it's not just visually hidden but genuinely un-hit-testable:
    // elementFromPoint at the framed document's own center must not resolve
    // to real app content once hidden.
    const hitTest = await appFrame.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return el ? el.tagName : null;
    });
    check(
      "the hidden framed document has nothing left for elementFromPoint to hit - no real button to overlay a decoy on",
      hitTest === null,
      `elementFromPoint returned ${hitTest}`,
    );
  }

  await page.close();
  await decoy.close();
}

await browser.close();
await target.close();
console.log(failed ? "\nframe-guard: FAILED" : "\nframe-guard: all checks passed");
process.exit(failed ? 1 : 0);
