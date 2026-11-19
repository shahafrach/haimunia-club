// Q-48 (owner approved 2026-11-19): the רישום screen. Title רישום אימון; one row סטים × חזרות @ משקל; the
// primary button adds a set and the day's sets build up right under the controls with a running total; no
// empty card, no tour card (the tour is in Settings > עזרה); the date is one tappable chip; the picker shows the
// last five movements first, 48px rows, a Hebrew name where the catalog has one; כלים is a real button.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const $ = (w, s) => w.document.querySelector(s);

async function freshAdd() {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.document.getElementById("tabAddBtn").click();
  return window;
}

test("title, no empty card, no tour card; the day list is the empty state; the tour is in Settings", async () => {
  const window = await freshAdd();
  assert.match($(window, "#pageTitle-add").textContent, /רישום אימון/);
  assert.doesNotMatch($(window, "#pageTitle-add").textContent, /סיכום/);
  assert.equal($(window, "[data-empty-state='log-choose-exercise']"), null);
  assert.equal($(window, "#content [data-action='open-onboarding']"), null);
  assert.match($(window, ".day-empty").textContent, /עדיין לא נרשמו סטים היום/);
  window.openSettings();
  assert.ok($(window, "#settingsHelpBlock [data-action='open-onboarding']"), "the tour is in Settings > עזרה");
});

test("one row in the order סטים × חזרות @ משקל; the button says הוספת סט; sets build up with a running total", async () => {
  const window = await freshAdd();
  window.choosePickedMovement("back-squat");
  window.render();
  const fields = [...window.document.querySelectorAll(".log-controls .steppers--row input.stepper-val")].map((i) => i.dataset.field);
  assert.deepEqual(fields, ["sets", "reps", "weight"]);
  assert.equal($(window, "#saveBtnLabel").textContent, "הוספת סט");
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  if ($(window, "#celebrationOverlay").classList.contains("open")) window.closeCelebration();
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  if ($(window, "#celebrationOverlay").classList.contains("open")) window.closeCelebration();
  window.render();
  const total = $(window, "#dayLogTotal").textContent;
  assert.match(total, /2 סטים/);
  assert.match(total, /1,000/, "volume 2 × 100 × 5");
  const list = $(window, ".log-controls ~ .day-log-head, .day-log-head");
  assert.ok(list, "the day's list is on the screen while the exercise is chosen");
  assert.ok(window.document.querySelectorAll("#content .log-list [data-action='edit-entry']").length === 2, "each set editable");
  assert.ok(window.document.querySelectorAll("#content .log-list [data-action='delete-entry']").length === 2, "and deletable");
});

test("the date is one chip: 'היום ▾' over a real date input; a past date names itself and offers today", async () => {
  const window = await freshAdd();
  const chip = $(window, ".scene-summary-meta .date-chip");
  assert.ok(chip);
  assert.match(chip.textContent, /היום/);
  assert.equal(window.document.querySelectorAll("#logDateInput").length, 1, "one date input on the screen");
  const input = $(window, "#logDateInput");
  const d = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  input.value = d;
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.doesNotMatch($(window, ".date-chip-text").textContent, /היום/);
  $(window, "[data-action='reset-log-date']").click();
  assert.match($(window, ".date-chip-text").textContent, /היום/);
});

test("the picker: אחרונים (last five used) first, 48px rows, a Hebrew name under the English one", async () => {
  const window = await freshAdd();
  for (const id of ["deadlift", "back-squat"]) {
    window.choosePickedMovement(id);
    window.applyFieldValue("step", "weight", 60);
    await window.saveSet();
    if ($(window, "#celebrationOverlay").classList.contains("open")) window.closeCelebration();
  }
  window.renderPickerList("");
  const recent = [...window.document.querySelectorAll("#pickerRecent [data-action='pick-movement']")].map((b) => b.dataset.id);
  assert.deepEqual(recent, ["back-squat", "deadlift"], "newest first");
  const squat = $(window, "#pickerList .cat-group:not(#pickerRecent) [data-id='back-squat']");
  assert.match(squat.textContent, /סקוואט אחורי/, "Hebrew name under the English one");
  assert.match(html, /#pickerList \.movement-btn\{ min-height:48px; \}/);
  window.renderPickerList("דדליפט");
  assert.ok($(window, "#pickerList [data-id='deadlift']"), "a Hebrew search finds it");
  assert.equal($(window, "#pickerRecent"), null, "no recents while searching");
});

test("כלים is a real secondary button; the 1RM estimate is a quiet line", async () => {
  const window = await freshAdd();
  window.choosePickedMovement("back-squat");
  window.render();
  const summary = $(window, "details.log-more > summary");
  assert.ok(summary.classList.contains("tools-btn"));
  assert.ok(!summary.classList.contains("link-btn"), "not an underlined link");
  assert.match(html, /\.tools-btn\{[^}]*min-height:var\(--tap-min\)/);
  assert.match($(window, ".est-line").textContent, /^1RM משוער לסט הזה/);
});

// Q-57 (folded into Q-48): WOD score pre-fills from the last attempt; a new one starts blank and a blank score is
// refused; recents first in both pickers; "add new" after the list.
async function openWod(window, id) {
  window.document.getElementById("tabWodBtn").click();
  window.choosePickedWod(id);
  window.renderWodContent();
}
const val = (w, f) => w.document.querySelector(`input.stepper-val[data-field="${f}"]`).value;

test("Q-57: a WOD with no attempt starts blank, a blank score is refused, the next attempt pre-fills from the last", async () => {
  const window = await freshAdd();
  await openWod(window, "fran");
  assert.equal(val(window, "wodMinutes"), "0");
  assert.equal(val(window, "wodSeconds"), "0");
  window.setWodRx ? window.setWodRx(true) : window.document.querySelector('[data-action="set-rx"][data-rx="1"]').click();
  await window.saveWod();
  assert.equal((await window.dbLoadWodEntries()).length, 0, "a blank time is not saved");
  window.applyFieldValue("wod-step", "wodMinutes", 4);
  window.applyFieldValue("wod-step", "wodSeconds", 30);
  await window.saveWod();
  if (window.document.getElementById("celebrationOverlay").classList.contains("open")) window.closeCelebration();
  assert.equal((await window.dbLoadWodEntries()).length, 1);
  window.choosePickedWod("grace");
  window.choosePickedWod("fran");
  window.renderWodContent();
  assert.equal(val(window, "wodMinutes"), "4", "pre-filled from the last attempt");
  assert.equal(val(window, "wodSeconds"), "30");
});

test("Q-57: both pickers put the recent ones first and 'add new' after the list", async () => {
  const window = await freshAdd();
  window.choosePickedMovement("deadlift");
  window.applyFieldValue("step", "weight", 60);
  await window.saveSet();
  if (window.document.getElementById("celebrationOverlay").classList.contains("open")) window.closeCelebration();
  window.renderPickerList("");
  const list = window.document.getElementById("pickerList");
  assert.equal(list.firstElementChild.id, "pickerRecent", "recents first");
  assert.ok(list.lastElementChild.classList.contains("picker-add"), "add-new last");
  await openWod(window, "fran");
  window.applyFieldValue("wod-step", "wodMinutes", 5);
  window.document.querySelector('[data-action="set-rx"][data-rx="1"]').click();
  await window.saveWod();
  if (window.document.getElementById("celebrationOverlay").classList.contains("open")) window.closeCelebration();
  window.renderWodPickerList("");
  const wl = window.document.getElementById("wodPickerList");
  assert.equal(wl.firstElementChild.id, "wodPickerRecent");
  assert.ok(wl.querySelector("#wodPickerRecent [data-id='fran']"));
  assert.ok(wl.lastElementChild.classList.contains("picker-add"));
});
