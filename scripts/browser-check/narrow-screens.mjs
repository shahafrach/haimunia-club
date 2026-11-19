#!/usr/bin/env node
// Q-63: narrow phones and large text. At 320x568 (iPhone SE) every −/+ stepper on רישום is tapped with a real
// touch: each tap changes its own value and never saves a set or toggles "לשתף במועדון". At 320, 360 and 375px,
// text 100% and 200% (the root font size, as iOS Dynamic Type and the app's own text size scale it):
// the iOS install card fits under the header and scrolls inside; the update banner leaves the הגדרות gear free;
// the exercise and WOD pickers never scroll sideways; לוח שנה shows all seven columns; no scene title runs under
// the sheet. Local only: lib/mockCloud.mjs aborts anything that leaves the origin.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function open({ width, height, text = 1, ua }) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: "he-IL", ...(ua ? { userAgent: ua } : {}) });
  const page = await context.newPage();
  const errors = await consoleErrorCollector(page);
  await installMockCloud(page);
  if (text !== 1) await page.addInitScript((f) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = f * 100 + "%"; }); }, text);
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app", { state: "visible", timeout: 15000 });
  await dismissWelcomeModal(page);
  await page.evaluate(() => { if (window.haimuniaConnect) window.haimuniaConnect.close(); document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open")); });
  return { context, page, errors };
}

// ---- P0 (1): every stepper at 320x568, tapped for real ----
{
  const { context, page, errors } = await open({ width: 320, height: 568 });
  await page.evaluate(async () => { await window.dbSetSetting("haimunia:clubShareDefault", false).catch(() => {}); window.choosePickedMovement("back-squat"); window.render(); });
  const covered = await page.evaluate(() => {
    const top = Math.min(...["bottomNavWrap", "bottomBar"].map((id) => document.getElementById(id)).filter((e) => e && e.getClientRects().length).map((e) => e.getBoundingClientRect().top));
    return [...document.querySelectorAll(".log-controls .stepper-btn")].filter((b) => b.getBoundingClientRect().bottom > top).map((b) => b.dataset.field + b.dataset.dir);
  });
  check("320x568: on arrival no stepper sits under the save bar or the tabs", covered.length === 0, covered.join(","));
  for (const field of ["sets", "reps", "weight"]) for (const dir of ["1", "-1"]) {
    const sel = `.log-controls .stepper-btn[data-field='${field}'][data-dir='${dir}']`;
    const before = await page.evaluate((f) => ({ v: document.querySelector(`.stepper-val[data-field='${f}']`).value, saved: (window.entries || []).length, share: (document.querySelector(".club-share-check input") || {}).checked }), field);
    await page.waitForTimeout(350); // a person's taps are further apart than the emulator's double-tap window
    await page.tap(sel);
    const after = await page.evaluate((f) => ({ v: document.querySelector(`.stepper-val[data-field='${f}']`).value, saved: (window.entries || []).length, share: (document.querySelector(".club-share-check input") || {}).checked }), field);
    check(`320x568: tap ${field} ${dir === "1" ? "+" : "−"} changes ${field} only`, after.v !== before.v && after.saved === before.saved && after.share === before.share, `${before.v} -> ${after.v}`);
  }
  check("320x568: no console errors, nothing left the origin", errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}

for (const width of [320, 360, 375]) for (const text of [1, 2]) {
  const tag = `${width}px ${text * 100}%`;
  // ---- P0 (2): the iOS install card on a tab other than רישום ----
  {
    const { context, page } = await open({ width, height: 667, text, ua: IPHONE });
    await page.evaluate(() => document.getElementById("tabHistoryBtn").click());
    await page.waitForTimeout(300);
    const d = await page.evaluate(() => {
      const dock = document.getElementById("iosInstallBanner");
      if (!dock || getComputedStyle(dock).display === "none") return { shown: false };
      const card = dock.querySelector(".install-dock-card"), r = card.getBoundingClientRect();
      const btn = dock.querySelector("[data-action='dismiss-ios-install-hint']:not(.icon-btn)"), b = btn && btn.getBoundingClientRect();
      return { shown: true, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, dismissVisible: !!b && b.top >= r.top && b.bottom <= r.bottom + 1 };
    });
    check(`[${tag}] the iOS install card fits on screen, scrolls inside, הבנתי in reach`, !d.shown || (d.top >= 0 && d.bottom <= d.vh && d.dismissVisible), JSON.stringify(d));
    await context.close();
  }
  const { context, page, errors } = await open({ width, height: 640, text });
  // ---- P1: the update banner leaves the gear free ----
  const gear = await page.evaluate(() => {
    const b = document.getElementById("updateBanner"); b.style.display = "block";
    const g = [...document.querySelectorAll("[data-action='open-settings']")].find((e) => e.getClientRects().length);
    const r = g.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    b.style.display = "none";
    return { free: g.contains(hit) };
  });
  check(`[${tag}] the update banner does not cover the הגדרות gear`, gear.free, JSON.stringify(gear));
  // ---- P1: scene titles stay above the sheet ----
  const titles = [];
  for (const tab of ["add", "history", "calendar", "wod"]) {
    await page.evaluate((t) => document.querySelector(`#bottomTabBar [data-tab="${t}"]`).click(), tab);
    await page.waitForTimeout(200);
    titles.push(await page.evaluate((t) => { const h = document.querySelector("#content .scene-page__title"), s = document.querySelector("#content .scene-sheet");
      if (!h || !s) return null; const over = Math.round(h.getBoundingClientRect().bottom - s.getBoundingClientRect().top); return over > 0 ? `${t}:${over}px` : null; }, tab));
  }
  check(`[${tag}] no scene title runs under the sheet`, titles.every((t) => !t), titles.filter(Boolean).join(" "));
  // ---- P1: לוח שנה shows all seven columns ----
  await page.evaluate(() => document.getElementById("tabCalendarBtn").click());
  await page.waitForTimeout(250);
  const cal = await page.evaluate(() => { const g = document.querySelector(".cal-grid"); const r = g.getBoundingClientRect(); const de = document.documentElement;
    return { inside: r.left >= -1 && r.right <= de.clientWidth + 1, ownScroll: g.scrollWidth > g.clientWidth + 1, page: de.scrollWidth <= de.clientWidth + 1 }; });
  check(`[${tag}] לוח שנה: seven columns on screen, no sideways scroll`, cal.inside && !cal.ownScroll && cal.page, JSON.stringify(cal));
  // ---- P1: pickers never scroll sideways ----
  for (const [openFn, overlay, input, q] of [["openPicker", "pickerOverlay", "pickerSearch", "סקוואט אחורי ארוך מאוד"], ["openWodPicker", "wodPickerOverlay", "wodPickerSearch", "Murph Fran Grace ארוך"]]) {
    await page.evaluate((f) => { document.getElementById("tabAddBtn").click(); window[f](); }, openFn);
    await page.fill(`#${input}`, q);
    await page.waitForTimeout(150);
    const pk = await page.evaluate((o) => { const s = document.querySelector(`#${o} .modal-sheet`); const de = document.documentElement; return { sheet: s.scrollWidth <= s.clientWidth + 1, page: de.scrollWidth <= de.clientWidth + 1 }; }, overlay);
    check(`[${tag}] ${overlay}: search does not push the sheet sideways`, pk.sheet && pk.page, JSON.stringify(pk));
    await page.keyboard.press("Escape");
  }
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll narrow-screen checks passed.");
