#!/usr/bin/env node
// Q-46: the bar is the tour's four screens (רישום, התקדמות, לוח שנה, אימונים) on a 375px phone, at normal and at
// 200% text (CSS zoom 2). Each tab opens its screen and lights itself; no segmented control on a hero photo; the
// bar fits with no sideways scroll, every tab >= 44px, no label cut. Local only.
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
const TABS = [["tabAddBtn", "add", "רישום"], ["tabHistoryBtn", "history", "התקדמות"], ["tabCalendarBtn", "calendar", "לוח שנה"], ["tabWodBtn", "wod", "אימונים"]];

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
  for (const [id, screen, label] of TABS) {
    await page.click(`#${id}`);
    await page.waitForSelector(`#pageTitle-${screen}`);
    const f = await page.evaluate((id) => {
      const de = document.documentElement;
      const tabs = [...document.querySelectorAll("#bottomTabBar .tabbtn")].filter((b) => b.offsetParent);
      return {
        labels: tabs.map((b) => b.textContent.trim()), active: (document.querySelector("#bottomTabBar .tabbtn.active") || {}).id === id,
        small: tabs.filter((b) => b.getBoundingClientRect().height < 44).length, cut: tabs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()),
        onPhoto: document.querySelectorAll(".scene-page > .segmented, .scene-page__intro .segmented, .training-toggle").length,
        page: de.scrollWidth <= de.clientWidth + 1,
      };
    }, id);
    check(`[${tag}] ${label}: bar = רישום/התקדמות/לוח שנה/אימונים, lit, tabs >= 44px, nothing cut, no control on the photo, no sideways scroll`,
      f.labels.join("/") === "רישום/התקדמות/לוח שנה/אימונים" && f.active && !f.small && !f.cut.length && !f.onPhoto && f.page, JSON.stringify(f));
    if (screen === "add" || screen === "wod") await page.screenshot({ path: `${SHOTS}/q46-${screen}-${scale}.png` }).catch(() => {});
  }
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll tour-tab checks passed.");
