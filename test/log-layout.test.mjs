// Log screen layout A (3.13.0, owner's choice on PR #21): what a set needs comes first. Picking an exercise
// fills the steppers from its last session and shows that session; "עוד סט זהה" logs today's last set again
// through saveSet(); the save confirmation sits inline instead of a toast over the steppers; everything else
// is under "עוד אפשרויות". Geometry (no scroll at 390x844 and 360x780) is measured in real Chromium by
// scripts/browser-check/log-layout-fits.mjs; jsdom has no layout.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, waitFor } from "./helpers/boot.mjs";

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const $ = (w, s) => w.document.querySelector(s);
const dayBefore = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

function row(id, date, weight, reps, sets = 1, extra = {}) {
  return { id, exerciseId: "back-squat", date, type: "reps", weight, reps, sets, durationSeconds: 0, ts: Date.parse(date + "T08:00:00Z") + Number(id.replace(/\D/g, "") || 0), isPR: false, groupId: null, blockLabel: null, est1RM: weight * (1 + reps / 30), ...extra };
}
async function bootWithHistory(rows) {
  const window = await bootApp({ beforeScripts: (w) => { w.scrollTo = () => {}; } });
  const welcome = window.document.getElementById("welcomeOverlay");
  if (welcome.classList.contains("open")) {
    window.document.getElementById("welcomeNameInput").value = "דנה";
    $(window, "[data-action='save-user-name']").click();
    await waitFor(() => !welcome.classList.contains("open"));
  }
  if (rows.length) {
    const backup = await window.buildBackupPayload();
    backup.entries = rows;
    assert.equal(await window.importBackupData(backup), true, "history imported");
  }
  return window;
}
async function pick(window, id = "back-squat") {
  $(window, "[data-action='open-picker']").click();
  await waitFor(() => $(window, `[data-action='pick-movement'][data-id='${id}']`));
  $(window, `[data-action='pick-movement'][data-id='${id}']`).click();
  await wait();
}
// Read by field, in the order the assertions name them (weight, reps, sets); Q-48 shows them as סטים × חזרות @ משקל.
const stepperValues = (w) => ["weight", "reps", "sets"].map((f) => w.document.querySelector(`.log-controls input.stepper-val[data-field="${f}"]`)).filter(Boolean).map((i) => i.value);
const savedRows = async (w) => (await w.dbLoadAll()).filter((e) => e.date === dayBefore(0));

test("picking an exercise fills weight, reps and sets from its last session, and shows that session", async () => {
  const window = await bootWithHistory([row("s1", dayBefore(1), 100, 5), row("s2", dayBefore(1), 100, 5), row("s3", dayBefore(1), 100, 5), row("s4", dayBefore(8), 90, 5)]);
  await pick(window);
  assert.deepEqual(stepperValues(window), ["100", "5", "1"], "the last row of the last session");
  const last = $(window, ".log-controls .log-last");
  assert.ok(last, "the last session line is in the controls");
  assert.match(last.textContent, /פעם קודמת/);
  assert.match(last.textContent, /3 סטים של\s*100×5/, "three sets of 100x5, grouped");
  assert.equal(last.getAttribute("role"), "status");
});

test("no history: the steppers keep their defaults and the line says there is no earlier session", async () => {
  const window = await bootWithHistory([]);
  await pick(window);
  assert.deepEqual(stepperValues(window), ["20", "5", "1"]);
  assert.match($(window, ".log-controls .log-last").textContent, /אין עדיין אימון קודם/);
  assert.equal($(window, "[data-action='repeat-last-set']"), null, "nothing to repeat yet");
});

test("re-picking the same exercise keeps what the member changed", async () => {
  const window = await bootWithHistory([row("s1", dayBefore(1), 100, 5)]);
  await pick(window);
  window.applyFieldValue("step", "weight", 105);
  window.render();
  await pick(window);
  assert.equal(stepperValues(window)[0], "105");
});

test("one tap repeats today's last set through saveSet(), and the confirmation is inline, not a toast", async () => {
  const window = await bootWithHistory([row("s1", dayBefore(1), 100, 5)]);
  await pick(window);
  $(window, "#bottomBarBtn").click();
  await waitFor(() => window.document.querySelector("[data-action='repeat-last-set']"), 3000);
  // The first save of the day may open the first-entry card; close it like a member would.
  const cel = window.document.getElementById("celebrationOverlay");
  if (cel && cel.classList.contains("open")) { window.closeCelebration(); await wait(); }
  const repeat = $(window, "[data-action='repeat-last-set']");
  assert.match(repeat.textContent, /עוד סט זהה/);
  assert.match(repeat.textContent, /100×5/);
  window.applyFieldValue("step", "weight", 60); // a stray change; the repeat still logs the same set
  repeat.click();
  await waitFor(async () => (await savedRows(window)).length === 2, 3000);
  $(window, "[data-action='repeat-last-set']").click();
  await waitFor(async () => (await savedRows(window)).length === 3, 3000);
  const rows = await savedRows(window);
  assert.deepEqual(rows.map((e) => `${e.weight}x${e.reps}x${e.sets}`), ["100x5x1", "100x5x1", "100x5x1"]);
  const line = $(window, ".log-controls .log-last");
  assert.match(line.textContent, /נשמר/, "the save is confirmed in the last-session line");
  assert.doesNotMatch(($(window, "#appToastDock") || { textContent: "" }).textContent, /נשמר/, "no toast over the controls");
});

test("the repeat is saveSet() itself, so the sanity confirm, PR detection and share question all apply", async () => {
  const window = await bootWithHistory([row("s1", dayBefore(1), 100, 5)]);
  await pick(window);
  $(window, "#bottomBarBtn").click();
  await waitFor(() => window.document.querySelector("[data-action='repeat-last-set']"), 3000);
  const cel = window.document.getElementById("celebrationOverlay");
  if (cel && cel.classList.contains("open")) { window.closeCelebration(); await wait(); }
  const calls = [];
  const real = window.saveSet;
  window.saveSet = (...a) => { calls.push(a); return real(...a); };
  $(window, "[data-action='repeat-last-set']").click();
  await waitFor(async () => (await savedRows(window)).length === 2, 3000);
  assert.equal(calls.length, 1, "one saveSet() call per repeat");
  assert.deepEqual(calls[0], [], "with no 'already confirmed' flag: the sanity check runs as for the button");
});

test("everything else is under 'כלים' (Q-43: the plates too), which stays open across re-renders", async () => {
  const window = await bootWithHistory([row("s1", dayBefore(1), 100, 5)]);
  await pick(window);
  const more = $(window, "details.log-more");
  assert.ok(more, "the options fold");
  for (const sel of ["[data-action='set-log-entry-type']", "[data-action='prefill-last']", "[data-action='toggle-ladder-mode']"]) {
    assert.ok(more.querySelector(sel), sel + " is under כלים");
  }
  // Q-48: the date is one chip at the top of the sheet ("היום ▾"), not in the controls or the fold.
  assert.ok($(window, ".scene-summary-meta .date-chip #logDateInput"), "the date chip holds the date input");
  assert.equal($(window, ".date-chip-text").textContent.trim(), "היום");
  assert.ok(more.querySelector("#barbellVisual"), "the plate visualizer is under כלים");
  assert.ok(!$(window, ".log-controls #barbellVisual"), "not in the controls");
  more.open = true;
  more.dispatchEvent(new window.Event("toggle"));
  window.render();
  assert.equal($(window, "details.log-more").open, true);
});

test("a past date shows on the date chip, with a way back to today", async () => {
  const window = await bootWithHistory([row("s1", dayBefore(1), 100, 5)]);
  await pick(window);
  const input = window.document.getElementById("logDateInput");
  input.value = dayBefore(2);
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait();
  assert.notEqual($(window, ".date-chip-text").textContent.trim(), "היום", "the chip names the chosen date");
  assert.ok($(window, ".scene-summary-meta [data-action='reset-log-date']"), "and offers the way back");
  assert.equal($(window, "[data-action='repeat-last-set']"), null, "no repeat for another day");
});
