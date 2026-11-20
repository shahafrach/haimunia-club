// Q-62 (Grok visual review of 3.20.0, verified by Claude): one filled primary per screen, a linear title scrim and
// whole photos, tab labels never under --fs-1, one chevron / list row / secondary button, reward moments, Settings
// and tabs keep their place, sheets arrive with motion, the save button shows it is busy, the update banner says
// what a tap does, and the tour names מועדון.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
async function fresh() {
  const w = await bootApp();
  w.saveWelcomeForm("רונית");
  await new Promise((r) => setTimeout(r, 30));
  if (w.haimuniaConnect) w.haimuniaConnect.close();
  return w;
}

test("(1) on רישום only בחירת תרגיל is filled; the join and install buttons are secondary", async () => {
  const w = await fresh();
  w.render();
  const add = $(w, "#content");
  assert.ok(add.querySelector(".pick-hero-cta"), "the one primary");
  const join = add.querySelector(".join-card-btn");
  if (join) assert.ok(join.classList.contains("btn-secondary") && !join.classList.contains("save-btn"));
  const inst = add.querySelector("[data-action='install-app']");
  if (inst) assert.ok(inst.classList.contains("btn-secondary"));
  assert.equal([...add.querySelectorAll(".save-btn")].length, 0, "no other filled primary in the screen body");
});

test("(2) the title scrim is a linear band; the photo layer covers its own box (no seams)", () => {
  assert.match(html, /--hero-title-scrim:linear-gradient\(to top,/);
  assert.doesNotMatch(html, /--hero-title-scrim:radial-gradient/);
  assert.match(html, /\.scene-page__media::after\{ content:""; position:absolute; inset:0 0 auto 0; height:max\(450px, 54svh\); background:inherit; background-size:cover;/);
});

test("(3) tab labels are --fs-1, never the old 10px clamp", () => {
  assert.match(html, /\.tabbtn > span:last-child\{ font-size:var\(--fs-1\); \}/);
  assert.doesNotMatch(html, /span:last-child\{ font-size:(clamp\(10px|\.5\d*rem)/, "no smaller label size left");
});

test("(4) one SVG chevron in the text colour; one list row for a benchmark in both places", async () => {
  const w = await fresh();
  const src = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const chev = src.match(/^  chevronsLeft: '(.*)',$/m)[1];
  assert.doesNotMatch(chev, /<img/);
  assert.match(chev, /stroke="currentColor"/);
  assert.ok(!fs.existsSync(new URL("../assets/icon-chevrons.png", import.meta.url)), "the PNG is gone");
  w.document.getElementById("tabHistoryBtn").click();
  const prog = $(w, "[data-action='toggle-benchmark'][data-id='wod:fran']");
  w.document.getElementById("tabWodBtn").click();
  w.wodSubTab = "benchmarks";
  const sub = $(w, "[data-action='switch-wod-subtab'][data-subtab='benchmarks']");
  if (sub) sub.click();
  const cat = $(w, "[data-action='select-benchmark'][data-id='fran']");
  for (const row of [prog, cat]) {
    assert.ok(row && row.classList.contains("list-row"), "a list row");
    assert.equal(row.querySelector(".list-row-title").textContent.trim(), "Fran");
    assert.ok(row.querySelector(".list-row-chev svg"), "the SVG chevron at the end");
  }
});

test("(5) a saved set's row tints once; a PR names its value", async () => {
  const w = await fresh();
  w.choosePickedMovement("back-squat");
  for (const kg of [60, 60, 60, 80]) { w.applyFieldValue("step", "weight", kg); await w.saveSet(); if ($(w, "#celebrationOverlay").classList.contains("open")) w.closeCelebration(); }
  assert.ok($(w, ".log-row.log-row--saved"), "the row just saved");
  assert.equal($(w, "#prFlash").style.display, "flex", "the PR moment survives the re-render after the save");
  assert.match($(w, "#prFlashValue").textContent, /80/, "the PR badge names the value");
  assert.match(html, /\.pr-flash-value\{ font-size:var\(--fs-display\);/);
});

test("(6) a re-render keeps Settings' מתקדם open", async () => {
  const w = await fresh();
  w.openSettings();
  $(w, "#settingsAdvanced").open = true;
  w.render();
  assert.equal($(w, "#settingsAdvanced").open, true);
  w.closeSettings();
  w.openSettings();
  assert.equal($(w, "#settingsAdvanced").open, false, "a fresh open starts folded");
});

test("(7) each tab comes back where it was left", async () => {
  const w = await fresh();
  const calls = [];
  w.scrollTo = (x, y) => { calls.push(y); };
  Object.defineProperty(w, "scrollY", { configurable: true, get: () => 420 });
  w.document.getElementById("tabHistoryBtn").click(); // leaves רישום at 420
  Object.defineProperty(w, "scrollY", { configurable: true, get: () => 0 });
  w.document.getElementById("tabAddBtn").click();
  assert.equal(calls.at(-1), 420, "רישום restored");
});

test("(8) sheets fade and slide in; the save button is busy while it saves", async () => {
  assert.match(html, /\.modal-overlay\.open > \.modal-sheet\{ animation:sheetUp/);
  const w = await fresh();
  w.choosePickedMovement("back-squat");
  w.render();
  const btn = w.document.getElementById("bottomBarBtn");
  let seen = null;
  const orig = w.dbPut;
  w.dbPut = async (...a) => { seen = { busy: btn.getAttribute("aria-busy"), disabled: btn.disabled, label: w.document.getElementById("saveBtnLabel").textContent }; return orig(...a); };
  btn.click();
  await new Promise((r) => setTimeout(r, 50));
  w.dbPut = orig;
  assert.deepEqual(seen, { busy: "true", disabled: true, label: "שומרים…" });
  assert.equal(btn.getAttribute("aria-busy"), null, "released after");
});

test("(9) the update banner says what a tap does; (10) the tour names מועדון", () => {
  assert.match(html, /הקישו כאן כדי לעדכן עכשיו/);
  assert.doesNotMatch(html, /סגרו את האפליקציה ופתחו אותה מחדש כדי לעדכן/);
  assert.match(html, /חמישה מסכים, כל אחד למטרה שלו/);
  assert.match(html, /<div style="font-weight:700; font-size:var\(--fs-2\);">מועדון<\/div>/);
});
