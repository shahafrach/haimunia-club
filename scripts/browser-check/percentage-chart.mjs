#!/usr/bin/env node
// 3.15.0: the percentage chart on the exercise screen, in real Chromium at 390×844 and 360×780.
//
// Log a Back Squat set (117.5 × 3), open "עוד אפשרויות", open "טבלת אחוזים ופלטות", then check: ten rows,
// 95% to 50%; each weight is the bar plus whole 1.25 kg pairs and equals bar + 2 × the plates listed; the
// toggle is a ≥44 px target; nothing scrolls sideways and no row overflows the screen; the plate list reads
// left to right inside the RTL page. Then a lift with no set yet shows the one line and no chart.
//
// Usage: node scripts/browser-check/percentage-chart.mjs   (local working tree, mocked backend)
import { chromium } from "playwright";
import { resolveLocalOnlyTarget } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal, dismissFirstLogArrival, selectMovement, openLogOptions } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server, mocked backend)`);
const browser = await chromium.launch();

try {
  for (const [width, height] of [[390, 844], [360, 780]]) {
    const tag = `${width}×${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = await consoleErrorCollector(page);
    await installMockCloud(page);
    await page.addInitScript(() => { try { localStorage.setItem("haimunia:usageCountingOff", "1"); } catch (e) { /* ok */ } });
    await page.goto(target.url);
    await dismissWelcomeModal(page, "בדיקה");

    await selectMovement(page, "Back Squat");
    await page.evaluate(() => {
      window.applyFieldValue("step", "weight", 117.5);
      window.applyFieldValue("step", "reps", 3);
      window.applyFieldValue("step", "sets", 1);
    });
    await page.click('[data-action="save-set"]');
    await dismissFirstLogArrival(page);
    await openLogOptions(page);
    await page.waitForSelector('[data-action="toggle-pct-table"]');
    await page.click('[data-action="toggle-pct-table"]');
    await page.waitForSelector(".pct-chart-row");
    await page.locator(".pct-chart-row").last().scrollIntoViewIfNeeded();

    const r = await page.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const btn = document.querySelector('[data-action="toggle-pct-table"]').getBoundingClientRect();
      const rows = [...document.querySelectorAll(".pct-chart-row")].map((row) => {
        const box = row.getBoundingClientRect();
        const ltr = row.querySelector(".pct-plates [dir='ltr']");
        return {
          pct: Number(row.dataset.pct), kg: Number(row.dataset.kg),
          plates: (ltr ? ltr.textContent : "").split(" + ").filter(Boolean).map(Number),
          left: box.left, right: box.right,
          clipped: row.scrollWidth > row.clientWidth + 1,
          ltr: ltr ? getComputedStyle(ltr).direction : "",
        };
      });
      return {
        docW, scrollW: document.documentElement.scrollWidth,
        btn: { w: Math.round(btn.width), h: Math.round(btn.height) },
        rows, est: bestEst1RM(selectedId), bar: barWeight, // eslint-disable-line no-undef
      };
    });
    check(`[${tag}] ten rows, 95% to 50%`, r.rows.map((x) => x.pct).join(",") === "95,90,85,80,75,70,65,60,55,50", r.rows.map((x) => `${x.pct}:${x.kg}`).join(" "));
    check(`[${tag}] every row is the bar plus 2.5 kg steps, nearest to the percentage`,
      r.rows.every((x) => Math.round((x.kg - r.bar) * 100) % 250 === 0 && Math.abs(x.kg - r.est * x.pct / 100) <= 1.25 + 1e-9), `est ${r.est}, bar ${r.bar}`);
    check(`[${tag}] bar + 2 × the plates listed = the weight`,
      r.rows.every((x) => Math.abs(r.bar + 2 * x.plates.reduce((a, b) => a + b, 0) - x.kg) < 1e-9),
      r.rows.map((x) => `${x.kg}=${r.bar}+2×(${x.plates.join("+")})`).slice(0, 3).join(" "));
    check(`[${tag}] the plate list reads left to right`, r.rows.every((x) => x.ltr === "ltr"));
    check(`[${tag}] the toggle is a ≥44 px target`, r.btn.h >= 44 && r.btn.w >= 44, `${r.btn.w}×${r.btn.h}`);
    check(`[${tag}] no horizontal scroll`, r.scrollW <= r.docW, `scrollWidth ${r.scrollW}, clientWidth ${r.docW}`);
    check(`[${tag}] no row overflows the screen or clips`, r.rows.every((x) => x.left >= -1 && x.right <= r.docW + 1 && !x.clipped));

    // A lift with no set yet: the line, no chart.
    await selectMovement(page, "Front Squat");
    await openLogOptions(page);
    const empty = await page.evaluate(() => ({
      line: (document.getElementById("pctNoEst") || {}).textContent || "",
      chart: !!document.querySelector('[data-action="toggle-pct-table"]'),
    }));
    check(`[${tag}] no 1RM yet: one line, no chart`, /אין עדיין 1RM משוער/.test(empty.line) && !empty.chart, empty.line.trim());
    check(`[${tag}] no console errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
  }
} catch (e) {
  check("the check ran to the end", false, e && e.message);
} finally {
  await browser.close();
  await target.close();
}
process.exit(failed ? 1 : 0);
