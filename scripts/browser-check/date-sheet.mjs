#!/usr/bin/env node
// Q-60: the app's own date sheet on רישום and אימונים, on a 375px phone at normal and at 200% text (CSS zoom 2).
// The chip opens it; seven quick days and the month grid fit with no sideways scroll; every control is at least
// 44px; the page behind is inert; one tap picks, closes the sheet and the chip names the day. Local only:
// lib/mockCloud.mjs aborts anything that leaves the origin.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const SHOTS = process.env.SHOTS || "";
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();

const measure = (page) => page.evaluate(() => {
  const de = document.documentElement, sheet = document.querySelector("#dateSheetOverlay .modal-sheet");
  const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
  const ctrls = [...sheet.querySelectorAll("button")].filter(vis);
  const r = sheet.getBoundingClientRect();
  return {
    page: de.scrollWidth <= de.clientWidth + 1,
    sheetInside: r.left >= -1 && r.right <= de.clientWidth + 1,
    small: ctrls.filter((b) => { const q = b.getBoundingClientRect(); return q.height < 44 || q.width < 40; }).map((b) => (b.getAttribute("aria-label") || b.textContent).trim().slice(0, 18)),
    cut: ctrls.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim().slice(0, 18)),
  };
});

for (const scale of [1, 2]) {
  const tag = scale === 1 ? "100%" : "200%";
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "he-IL" });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  // Two taps closer than ~300ms read as a double-tap in the emulator and the second gives no click; a person's
  // taps are further apart.
  const tap = async (sel) => { await page.waitForTimeout(350); await page.tap(sel); };
  if (scale !== 1) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = String(z); }); }, scale);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await dismissWelcomeModal(page);
  await page.evaluate(() => { if (window.haimuniaConnect) window.haimuniaConnect.close(); document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); window.choosePickedMovement("back-squat"); window.render(); });

  await tap(".scene-summary-meta [data-action='open-date-sheet'][data-target='log']");
  await page.waitForSelector("#dateSheetOverlay.open");
  await page.waitForTimeout(350); // the sheet slides in; a person taps after it has landed
  let f = await measure(page);
  check(`[${tag}] רישום: quick days fit, every control >= 44px, nothing cut`, f.page && f.sheetInside && !f.small.length && !f.cut.length, JSON.stringify(f));
  check(`[${tag}] the page behind the sheet is inert`, await page.evaluate(() => document.getElementById("appShell").inert));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/q60-sheet-${tag}.png` });
  await tap("#dateSheetBody [data-action='date-sheet-month']");
  await page.waitForSelector("#dateSheetBody .date-grid");
  f = await measure(page);
  check(`[${tag}] month grid fits, every day >= 44px, nothing cut`, f.page && f.sheetInside && !f.small.length && !f.cut.length, JSON.stringify(f));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/q60-month-${tag}.png` });
  await tap("#dateSheetBody .date-quick:nth-child(2)");
  const after = await page.evaluate(() => ({ open: document.getElementById("dateSheetOverlay").classList.contains("open"), chip: document.querySelector(".date-chip-text").textContent.trim(), inert: document.getElementById("appShell").inert }));
  check(`[${tag}] one tap on אתמול: the sheet is closed, the chip says אתמול, the page is back`, !after.open && after.chip === "אתמול" && !after.inert, JSON.stringify(after));
  if (SHOTS && scale === 1) await page.screenshot({ path: `${SHOTS}/q60-chip-after.png` });

  await page.evaluate(() => { document.getElementById("tabWodBtn").click(); window.choosePickedWod("fran"); window.renderWodContent(); });
  await tap("[data-action='open-date-sheet'][data-target='wod']");
  await page.waitForSelector("#dateSheetOverlay.open");
  await page.waitForTimeout(350);
  f = await measure(page);
  check(`[${tag}] אימונים: the same sheet, fits, >= 44px`, f.page && f.sheetInside && !f.small.length && !f.cut.length, JSON.stringify(f));
  await tap("#dateSheetBody .date-quick:nth-child(3)");
  const wod = await page.evaluate(() => ({ open: document.getElementById("dateSheetOverlay").classList.contains("open"), chip: document.querySelector("[data-target='wod'] .date-chip-text").textContent.trim() }));
  check(`[${tag}] אימונים: one tap on שלשום picks and closes`, !wod.open && /^יום /.test(wod.chip), JSON.stringify(wod));
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll date sheet checks passed.");
