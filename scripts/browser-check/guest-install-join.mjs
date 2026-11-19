#!/usr/bin/env node
// Q-49: for a guest in a browser tab on a 375px phone, at normal and at 200% text (CSS zoom 2): רישום shows the
// folded install card (opened: this browser's steps) and the join code field; the מועדון tab opens the same
// join field; the gear says הגדרות. No sideways scroll, nothing cut, controls >= 44px. Local only.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const SHOTS = "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();
const fit = (page, scope) => page.evaluate((s) => {
  const de = document.documentElement, r = document.querySelector(s);
  if (!r) return { missing: s };
  const vis = (e) => e.offsetParent && e.getClientRects().length;
  // The date chip's input is transparent and sits under the chip (a 44px label); the chip is the target.
  const c = [...r.querySelectorAll("button, summary, input:not([type=date])")].filter(vis);
  return { page: de.scrollWidth <= de.clientWidth + 1, small: c.filter((b) => b.getBoundingClientRect().height < 44).map((b) => (b.textContent || b.name).trim().slice(0, 20)),
    cut: [...r.querySelectorAll("button, summary, .join-card-label, .join-step")].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20)) };
}, scope);
const ok = (f) => !f.missing && f.page && !f.small.length && !f.cut.length;

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "he-IL",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Mobile Safari/537.36" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await dismissWelcomeModal(page);
  await page.evaluate(() => { if (window.haimuniaConnect) window.haimuniaConnect.close(); document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); });
  await page.waitForSelector("#installCard", { timeout: 8000 });
  let f = await fit(page, "#content");
  check(`[${tag}] רישום: install card and join field, fits, controls >= 44px, nothing cut`, ok(f) && (await page.$("#content form[data-join-inline='add']")) !== null, JSON.stringify(f));
  await page.click("#installCard > summary");
  f = await fit(page, "#installCard");
  check(`[${tag}] install card open: this browser's steps, fits`, ok(f) && (await page.$("#installCard ol.join-steps")) !== null, JSON.stringify(f));
  await page.screenshot({ path: `${SHOTS}/q49-add-${scale}.png`, fullPage: true }).catch(() => {});
  const gear = await page.evaluate(() => { const g = document.getElementById("settingsGearBtn"), r = g.getBoundingClientRect(); return { label: g.textContent.trim(), h: r.height, w: r.width, inside: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1 }; });
  check(`[${tag}] the gear says הגדרות, >= 44px, on screen`, /הגדרות/.test(gear.label) && gear.h >= 44 && gear.w >= 44 && gear.inside, JSON.stringify(gear));
  await page.click("#bottomTabBar [data-tab='club']");
  await page.waitForSelector("#content form[data-join-inline='club']", { timeout: 6000 });
  f = await fit(page, "#content");
  check(`[${tag}] מועדון for a guest: the same join field, fits`, ok(f), JSON.stringify(f));
  await page.screenshot({ path: `${SHOTS}/q49-club-${scale}.png` }).catch(() => {});
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll guest install and join checks passed.");
