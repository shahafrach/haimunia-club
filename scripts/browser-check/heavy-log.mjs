#!/usr/bin/env node
// F-014: how the app feels with a three-year log in it. Imports test/fixtures/heavy-3y-backup.club.json (a
// synthetic heavy member: about 8,000 records and 260 session notes, scripts/make-heavy-fixture.mjs), reloads
// so the log comes off IndexedDB the way it does on a member's phone, and measures at 390×844:
//
//   - cold open: navigation start to the log tab painted, with the heavy log in IndexedDB
//   - each of the log, history and calendar tabs: the tap to the next painted frame (two rAFs)
//   - all of it twice: at this machine's speed, then with the CPU throttled 4x (closer to a mid-range phone)
//
// Each tab is measured three times (first visit, then twice more) and all numbers are printed. There is no
// threshold: the numbers are for a person to judge. The check fails only if the import fails, a tab renders
// empty, or the page logs a console error.
//
// Usage: node scripts/browser-check/heavy-log.mjs   (local working tree; never a deployed site, since it
// writes a log into the browser profile)
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { resolveLocalOnlyTarget, projectRoot } from "./lib/target.mjs";
import { consoleErrorCollector, dismissWelcomeModal, resolveAppConfirm } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const fixture = JSON.parse(readFileSync(path.join(projectRoot, "test/fixtures/heavy-3y-backup.club.json"), "utf8"));
const target = await resolveLocalOnlyTarget();
console.log(`Target: ${target.url} (local static server)`);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = await consoleErrorCollector(page);
await installMockCloud(page);
// Tests and checks never send a real count.
await page.addInitScript(() => { try { localStorage.setItem("haimunia:usageCountingOff", "1"); } catch (e) { /* ok */ } });

try {
  await page.goto(target.url, { waitUntil: "load" });
  await page.waitForSelector("#app", { state: "visible", timeout: 10000 });
  await dismissWelcomeModal(page);

  await page.evaluate((data) => {
    const t0 = performance.now();
    const done = importBackupData(data, {}); // eslint-disable-line no-undef
    window.__importDone = done.then((ok) => ({ ok, ms: performance.now() - t0 }));
  }, fixture);
  await resolveAppConfirm(page, true);
  const imp = await page.evaluate(() => window.__importDone);
  check("the 3-year log imports", imp.ok === true, `${Math.round(imp.ms)} ms in Chromium, confirm tap included`);

  const names = { tabAddBtn: "log (רישום)", tabHistoryBtn: "history (התקדמות)", tabCalendarBtn: "calendar (לוח שנה)" };
  async function timeTab(id) {
    return page.evaluate((btnId) => new Promise((resolve) => {
      const t0 = performance.now();
      document.getElementById(btnId).click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        ms: performance.now() - t0,
        children: document.getElementById("content").children.length,
        text: document.getElementById("content").textContent.length,
      })));
    }), id);
  }
  // Pass 1 at this machine's speed; pass 2 with Chromium's CPU throttled 4x, closer to a mid-range phone.
  const cdp = await context.newCDPSession(page);
  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const tag = rate === 1 ? "unthrottled" : `CPU ${rate}x slower`;
    // Cold open with the heavy log on disk.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("loading")?.style.display === "none" && document.getElementById("content")?.children.length > 0, null, { timeout: 60000, polling: "raf" });
    const cold = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
    console.log(`INFO  [${tag}] cold open to the log tab painted: ${Math.round(cold)} ms from navigation start`);
    const counts = await page.evaluate(() => ({ entries: entries.length, wods: wodEntries.length })); // eslint-disable-line no-undef
    check(`[${tag}] the log is all there after the reload`, counts.entries === fixture.entries.length && counts.wods === fixture.wodEntries.length, JSON.stringify(counts));
    const results = {};
    for (let round = 0; round < 3; round++) {
      for (const id of ["tabHistoryBtn", "tabCalendarBtn", "tabAddBtn"]) {
        (results[id] ||= []).push(await timeTab(id));
        await page.waitForTimeout(300);
      }
    }
    for (const id of ["tabAddBtn", "tabHistoryBtn", "tabCalendarBtn"]) {
      const list = results[id];
      console.log(`INFO  [${tag}] ${names[id]}: tap to painted ${list.map((r) => Math.round(r.ms) + " ms").join(", ")} (first visit, then two more)`);
      check(`[${tag}] ${names[id]} renders content`, list.every((r) => r.children > 0 && r.text > 0));
    }
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("the check ran to the end", false, e && e.message);
} finally {
  await browser.close();
  await target.close();
}
process.exit(failed ? 1 : 0);
