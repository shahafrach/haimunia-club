#!/usr/bin/env node
// Q-43b: the four-tab bar and the אימון toggle (הרמה | WOD) on a 375px phone, at normal and at 200% text (CSS
// zoom 2). The bar fits with no sideways scroll and every tab is at least 44px; the toggle's two options are at
// least 44px and nothing is cut; WOD keeps אימון lit. Local only.
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
  const measure = () => page.evaluate(() => {
    const de = document.documentElement;
    const tabs = [...document.querySelectorAll("#bottomTabBar .tabbtn")].filter((b) => b.offsetParent);
    const opts = [...document.querySelectorAll("#content .training-toggle .segmented-opt")];
    const cut = [...tabs, ...opts].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim());
    return {
      labels: tabs.map((b) => b.textContent.trim()), active: (document.querySelector("#bottomTabBar .tabbtn.active") || {}).id,
      smallTabs: tabs.filter((b) => b.getBoundingClientRect().height < 44).length,
      smallOpts: opts.filter((b) => b.getBoundingClientRect().height < 44).length, opts: opts.length, cut,
      page: de.scrollWidth <= de.clientWidth + 1,
      // The toggle sits on the photo: it must not cover the page title, and a tap on it must reach it.
      clear: opts.every((o) => {
        const r = o.getBoundingClientRect(), t = document.querySelector(".scene-page__title").getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return (r.bottom <= t.top || r.top >= t.bottom) && hit && (hit === o || o.contains(hit));
      }),
    };
  });
  for (const which of ["add", "wod"]) {
    if (which === "wod") await page.click("#content .training-toggle [data-tab='wod']");
    await page.waitForSelector(`#pageTitle-${which}`);
    const f = await measure();
    check(`[${tag}] ${which}: bar = אימון/התקדמות/יומן, אימון lit, tabs and toggle >= 44px, nothing cut, toggle clear of the title and tappable, no sideways scroll`,
      f.labels.join("/") === "אימון/התקדמות/יומן" && f.active === "tabAddBtn" && !f.smallTabs && f.opts === 2 && !f.smallOpts && !f.cut.length && f.page && f.clear, JSON.stringify(f));
    await page.screenshot({ path: `${SHOTS}/q43b-${which}-${scale}.png` }).catch(() => {});
  }
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll four-tab checks passed.");
