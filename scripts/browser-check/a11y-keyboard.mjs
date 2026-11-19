#!/usr/bin/env node
// Q-54: keyboard and screen-reader basics on a 375px phone, at normal and at 200% text (CSS zoom 2).
// The first-run join sheet has a close button; while Settings is open the page behind is inert; Tab reaches the
// closed "מתקדם" fold's summary and nothing inside it; a control reached by Tab on the main screen is not left
// under the bottom bar. Local only: lib/mockCloud.mjs aborts anything that leaves the origin.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const SHOTS = process.env.SHOTS || "";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await page.evaluate(() => window.saveWelcomeForm("בדיקה"));
  await page.waitForSelector("#connectOverlay.open", { timeout: 10000 });
  const x = await page.evaluate(() => { const b = document.getElementById("connectCloseBtn"); const r = b.getBoundingClientRect(); return { shown: !!b.offsetParent, h: Math.round(r.height), name: b.getAttribute("aria-label") || b.textContent.trim() }; });
  check(`[${tag}] first-run join sheet has a named close button >= 44px`, x.shown && x.h >= 44 && !!x.name, JSON.stringify(x));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/q54-first-run-${tag}.png` });
  check(`[${tag}] page behind the join sheet is inert`, await page.evaluate(() => document.getElementById("appShell").inert));
  await page.click("#connectCloseBtn");
  await page.waitForFunction(() => !document.getElementById("appShell").inert);

  // Open Settings from the keyboard, as a keyboard user does: focus the gear, press Enter.
  await page.locator("[data-action='open-settings']:visible").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#settingsOverlay.open");
  await page.waitForTimeout(400); // the sheet's own focus move runs after its open animation frame
  const seen = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => { const a = document.activeElement; return { sum: a.tagName === "SUMMARY" && a.parentElement.id === "settingsAdvanced", inFold: !!a.closest("#settingsAdvanced") && a.tagName !== "SUMMARY", inSheet: !!a.closest("#settingsOverlay"), what: a.tagName + "#" + a.id + " " + (a.textContent || "").trim().slice(0, 16) }; }));
  }
  check(`[${tag}] Settings: Tab reaches the מתקדם summary, never a hidden row, never leaves the sheet`,
    seen.some((s) => s.sum) && !seen.some((s) => s.inFold) && seen.every((s) => s.inSheet), JSON.stringify({ sum: seen.filter((s) => s.sum).length, inFold: seen.filter((s) => s.inFold).length, out: seen.map((s, i) => s.inSheet ? null : i + ":" + s.what).filter(Boolean) }));
  check(`[${tag}] Settings: page behind is inert`, await page.evaluate(() => document.getElementById("appShell").inert && document.getElementById("bottomNavWrap").inert));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("appShell").inert);

  // Tab through the main screen; whatever gets focus must not sit under the bottom bar.
  const hidden = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const a = document.activeElement; if (!a || a === document.body || a.closest("#bottomNavWrap") || a.closest(".modal-overlay")) return null;
      const nav = document.getElementById("bottomNavWrap").getBoundingClientRect(), b = a.getBoundingClientRect();
      return { t: (a.textContent || a.getAttribute("aria-label") || a.id).trim().slice(0, 20), under: b.bottom > nav.top + 1 && b.top < nav.bottom };
    });
    if (r && r.under) hidden.push(r.t);
  }
  check(`[${tag}] main screen: no Tab stop left under the bottom bar`, hidden.length === 0, hidden.join(" | "));
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll keyboard checks passed.");
