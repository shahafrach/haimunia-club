#!/usr/bin/env node
// Q-48: the רישום screen on a 375px phone, at normal and at 200% text (CSS zoom 2). With an exercise chosen: one
// stepper row סטים × חזרות @ משקל, every control >= 44px, nothing cut, no sideways scroll, the date chip >= 44px;
// after two sets, the day's list with its running total; the picker with אחרונים first and rows >= 48px.
// Screenshots go to the scratchpad. Local only.
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`); if (!ok) failed = true; }
const SHOTS = "/tmp/claude-0/-home-user/2bd321ec-b56f-56fc-bbf9-9cf5d21706bb/scratchpad";
const NAME = process.env.SHOT_PREFIX || "q48";
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
  await page.screenshot({ path: `${SHOTS}/${NAME}-empty-${scale}.png` }).catch(() => {});
  await page.evaluate(() => { window.choosePickedMovement("back-squat"); window.applyFieldValue("step", "weight", 100); window.applyFieldValue("step", "reps", 5); window.render(); });
  for (let i = 0; i < 2; i++) {
    await page.click("#bottomBarBtn");
    await page.waitForTimeout(300);
    await page.evaluate(() => { const o = document.getElementById("celebrationOverlay"); if (o && o.classList.contains("open")) window.closeCelebration(); });
  }
  await page.waitForTimeout(200);
  const f = await page.evaluate(() => {
    const de = document.documentElement, c = document.getElementById("content");
    const vis = (e) => e.offsetParent && e.getClientRects().length;
    const ctrls = [...c.querySelectorAll(".log-controls button, .log-controls input, .date-chip, details.log-more > summary")].filter(vis);
    const row = [...c.querySelectorAll(".steppers--row input.stepper-val")].map((i) => i.dataset.field);
    return {
      row, page: de.scrollWidth <= de.clientWidth + 1,
      small: ctrls.filter((b) => b.getBoundingClientRect().height < 44).map((b) => (b.textContent || b.getAttribute("aria-label") || b.id).trim().slice(0, 20)),
      cut: [...c.querySelectorAll(".stepper-label, .date-chip, .tools-btn, .day-log-total")].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20)),
      total: (document.getElementById("dayLogTotal") || {}).textContent || "",
      cta: document.getElementById("saveBtnLabel").textContent,
    };
  });
  check(`[${tag}] סטים × חזרות @ משקל in one row, controls >= 44px, nothing cut, no sideways scroll`,
    f.row.join(",") === "sets,reps,weight" && !f.small.length && !f.cut.length && f.page, JSON.stringify(f));
  check(`[${tag}] 'הוספת סט', and the day's list with its running total`, f.cta === "הוספת סט" && /2 סטים/.test(f.total), JSON.stringify({ cta: f.cta, total: f.total }));
  await page.screenshot({ path: `${SHOTS}/${NAME}-chosen-${scale}.png` }).catch(() => {});
  await page.click("[data-action='open-picker']");
  await page.waitForSelector("#pickerOverlay.open");
  const p = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#pickerList .movement-btn")].filter((b) => b.offsetParent);
    return { recent: [...document.querySelectorAll("#pickerRecent [data-action='pick-movement']")].map((b) => b.dataset.id), small: rows.filter((b) => b.getBoundingClientRect().height < 48).length };
  });
  check(`[${tag}] picker: אחרונים first, every row >= 48px`, p.recent[0] === "back-squat" && !p.small, JSON.stringify(p));
  await page.screenshot({ path: `${SHOTS}/${NAME}-picker-${scale}.png` }).catch(() => {});
  check(`[${tag}] no console errors, nothing left the origin`, errors.length === 0 && page.__foreignRequests.length === 0, errors.concat(page.__foreignRequests).join(" | "));
  await context.close();
}
await browser.close();
await target.close();
if (failed) { console.log("\nFAILED"); process.exit(1); }
console.log("\nAll log-screen checks passed.");
