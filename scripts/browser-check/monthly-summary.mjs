#!/usr/bin/env node
// 3.17.0: the monthly summary card on the progress screen, in real Chromium at 390×844, light and dark.
//
// Seeds a log relative to today (three sessions a month before last, then PRs last month, one set this month),
// opens התקדמות, scrolls to "סיכום חודשי" and screenshots it in each scheme. Checks: both month blocks are
// there with Hebrew month names, the best lift line, the streak line; the card fits 390 px with no horizontal
// scroll; every text in the card meets 4.5:1 against the card's background; no console errors.
// Screenshots go to $TMPDIR/haimunia-monthly-summary/ (not into the repository).
//
// Usage: node scripts/browser-check/monthly-summary.mjs   (local working tree, mocked backend)
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal, switchTab, resolveAppConfirm } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}
const outDir = path.join(tmpdir(), "haimunia-monthly-summary");
mkdirSync(outDir, { recursive: true });

// Dates relative to today, so the "last full month" always has the PRs.
const today = new Date();
const ym = (offset) => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1)); return d.toISOString().slice(0, 7); };
const two = ym(-2), last = ym(-1), cur = ym(0);
let n = 0;
const epley = (w, r) => Math.round(w * (1 + r / 30) * 10) / 10;
const set = (date, exerciseId, weight, reps) => ({ id: `bc-${++n}`, ts: Date.parse(date + "T08:00:00Z") + n, exerciseId, type: "reps", weight, reps, sets: 1, date, isPR: false, est1RM: epley(weight, reps), durationSeconds: 0, groupId: null, blockLabel: null });
const LOG = {
  app: "box-log", version: 1,
  entries: [
    set(`${two}-03`, "back-squat", 90, 5), set(`${two}-10`, "back-squat", 95, 5), set(`${two}-17`, "back-squat", 100, 5),
    set(`${last}-05`, "back-squat", 110, 5), set(`${last}-12`, "back-squat", 112.5, 5), set(`${last}-19`, "deadlift", 140, 3),
    set(`${cur}-01`, "back-squat", 100, 3),
  ],
};

const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server, mocked backend)`);
const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const page = await context.newPage();
    const errors = await consoleErrorCollector(page);
    await installMockCloud(page);
    await page.addInitScript((sc) => { try { localStorage.setItem("haimunia:usageCountingOff", "1"); localStorage.setItem("haimunia:theme", sc); } catch (e) { /* ok */ } }, scheme);
    await page.goto(target.url);
    await dismissWelcomeModal(page, "בדיקה");
    await page.evaluate((data) => { window.__imp = importBackupData(data, {}); }, LOG); // eslint-disable-line no-undef
    await resolveAppConfirm(page, true);
    check(`[${scheme}] the log imports`, await page.evaluate(() => window.__imp) === true);
    await switchTab(page, "tabHistoryBtn");
    await page.waitForSelector("#monthlySummary");
    await page.locator("#monthlySummary").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const file = path.join(outDir, `monthly-summary-390x844-${scheme}.png`);
    await page.locator("#monthlySummary").screenshot({ path: file });
    console.log(`INFO  [${scheme}] screenshot: ${file}`);

    const r = await page.evaluate(() => {
      const card = document.getElementById("monthlySummary");
      const box = card.getBoundingClientRect();
      // Contrast: every text-bearing element against the nearest opaque background.
      const rgb = (c) => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : [0, 0, 0, 0]; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] === undefined || c[3] > 0.5) return c; } return [255, 255, 255]; };
      let worst = Infinity, worstText = "";
      for (const el of card.querySelectorAll("*")) {
        if (![...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue;
        const fg = rgb(getComputedStyle(el).color), bg = bgOf(el);
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const ratio = (a + 0.05) / (b + 0.05);
        if (ratio < worst) { worst = ratio; worstText = el.textContent.trim().slice(0, 30); }
      }
      return {
        text: card.textContent.replace(/\s+/g, " "),
        blocks: [...card.querySelectorAll("[data-month]")].map((b) => b.dataset.month),
        left: box.left, right: box.right, docW: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth,
        // The sign must paint left of the digits: "+10%", not "10%+".
        pctOrder: (() => { const el = card.querySelector(".month-best-pct"); if (!el) return "missing"; const t = el.firstChild; const range = document.createRange(); range.setStart(t, 0); range.setEnd(t, 1); const plus = range.getBoundingClientRect(); range.setStart(t, 1); range.setEnd(t, 2); const digit = range.getBoundingClientRect(); return plus.right <= digit.left + 0.5 ? "sign first" : "sign after"; })(),
        worst: Math.round(worst * 100) / 100, worstText, scheme: document.documentElement.dataset.scheme,
      };
    });
    check(`[${scheme}] the page is in the ${scheme} scheme`, r.scheme === scheme, r.scheme);
    check(`[${scheme}] both months, last full month first`, r.blocks.join(",") === `${last},${cur}`, r.blocks.join(","));
    check(`[${scheme}] Hebrew month names, the best lift and the streak`, /סיכום חודשי/.test(r.text) && /השיא הבולט: Back Squat/.test(r.text) && /רצף/.test(r.text) && /(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר) \d{4}/.test(r.text), r.text.slice(0, 160));
    check(`[${scheme}] the best lift's gain reads "+N%", sign first`, r.pctOrder === "sign first", r.pctOrder);
    check(`[${scheme}] fits 390 px, no horizontal scroll`, r.left >= -1 && r.right <= r.docW + 1 && r.scrollW <= r.docW, `card ${Math.round(r.left)}..${Math.round(r.right)}, scrollWidth ${r.scrollW}`);
    check(`[${scheme}] every text in the card is at least 4.5:1`, r.worst >= 4.5, `lowest ${r.worst} ("${r.worstText}")`);
    check(`[${scheme}] no console errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await context.close();
  }
} catch (e) {
  check("the check ran to the end", false, e && e.message);
} finally {
  await browser.close();
  await target.close();
}
process.exit(failed ? 1 : 0);
