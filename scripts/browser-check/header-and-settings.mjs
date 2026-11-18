#!/usr/bin/env node
// Q-43a: the header (logo + gear, with the what's-new dot) and Settings (four blocks and the "מתקדם" fold,
// closed and open) on a 375px phone, at normal and at 200% text (CSS zoom 2). No sideways scroll, nothing
// cut, controls at least 44px. Local only.
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

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await dismissWelcomeModal(page);
  await page.evaluate(() => { if (window.haimuniaConnect) window.haimuniaConnect.close(); document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); });
  const head = await page.evaluate(() => {
    const h = document.querySelector("header.header"), g = document.getElementById("settingsGearBtn").getBoundingClientRect();
    return { buttons: h.querySelectorAll("button").length, gear: [Math.round(g.width), Math.round(g.height)], inside: g.left >= 0 && g.right <= document.documentElement.clientWidth + 1,
      page: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 };
  });
  check(`[${tag}] header: one button, the gear, at least 44px and on screen`, head.buttons === 1 && head.gear[0] >= 44 && head.gear[1] >= 44 && head.inside && head.page, JSON.stringify(head));
  if (scale === 1) await page.screenshot({ path: `${SHOTS}/q43a-header.png`, clip: { x: 0, y: 0, width: 375, height: 140 } }).catch(() => {});
  await page.click("#settingsGearBtn");
  await page.waitForSelector("#settingsAdvanced");
  for (const open of [false, true]) {
    if (open) await page.click("#settingsAdvanced > summary");
    const f = await page.evaluate(() => {
      const body = document.getElementById("settingsBody");
      const cut = [...body.querySelectorAll("button, summary, .settings-block-title")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20));
      const small = [...body.querySelectorAll("button, summary")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim().slice(0, 20));
      return { page: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, body: body.scrollWidth <= body.clientWidth + 1, cut, small };
    });
    check(`[${tag}] Settings (מתקדם ${open ? "open" : "closed"}): no sideways scroll, nothing cut, controls >= 44px`, f.page && f.body && !f.cut.length && !f.small.length, JSON.stringify(f));
    if (scale === 1) await page.screenshot({ path: `${SHOTS}/q43a-settings-${open ? "open" : "closed"}.png`, fullPage: true }).catch(() => {});
  }
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll header and Settings checks passed.");
