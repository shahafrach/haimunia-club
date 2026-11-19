// Q-60 (owner 2026-11-19): the date on רישום and אימונים is the app's own sheet, not the native iOS popover.
// Seven one-tap days (היום, אתמול, שלשום, then weekday names), "תאריך אחר" for a month grid (Sunday first, today
// ringed, no future days, workout days dotted). One tap picks and closes; the sheet closes before the screen
// re-renders. The chip names היום / אתמול / weekday + date. One component for both screens.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function fresh() {
  const w = await bootApp();
  w.saveWelcomeForm("רונית");
  await new Promise((r) => setTimeout(r, 30));
  if (w.haimuniaConnect) w.haimuniaConnect.close();
  return w;
}
async function onLog() {
  const w = await fresh();
  w.choosePickedMovement("back-squat");
  w.render();
  return w;
}

test("the chip opens the app's sheet: seven quick days, Hebrew names, today first and chosen", async () => {
  const w = await onLog();
  const chip = $(w, ".scene-summary-meta [data-action='open-date-sheet'][data-target='log']");
  assert.equal(chip.tagName, "BUTTON");
  assert.match(chip.getAttribute("aria-label"), /^תאריך הרישום: היום, יום /);
  chip.click();
  assert.ok($(w, "#dateSheetOverlay").classList.contains("open"));
  const quick = $$(w, "#dateSheetBody .date-quick");
  assert.equal(quick.length, 7);
  assert.deepEqual(quick.slice(0, 3).map((b) => b.querySelector(".date-quick-name").textContent), ["היום", "אתמול", "שלשום"]);
  assert.match(quick[3].querySelector(".date-quick-name").textContent, /^יום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/);
  assert.equal(quick[0].dataset.date, iso(0));
  assert.equal(quick[0].getAttribute("aria-pressed"), "true");
  assert.equal(quick[0].getAttribute("aria-current"), "date");
});

test("one tap on אתמול picks, closes the sheet, and the chip says אתמול; היום again follows the day", async () => {
  const w = await onLog();
  $(w, "[data-action='open-date-sheet'][data-target='log']").click();
  $(w, `#dateSheetBody .date-quick[data-date='${iso(1)}']`).click();
  assert.ok(!$(w, "#dateSheetOverlay").classList.contains("open"), "closed");
  assert.equal($(w, ".date-chip-text").textContent.trim(), "אתמול");
  assert.equal($(w, "#logDateInput").value, iso(1), "the form's date field follows");
  assert.ok($(w, "[data-action='reset-log-date']"), "the way back to today");
  $(w, "[data-action='open-date-sheet']").click();
  $(w, `#dateSheetBody .date-quick[data-date='${iso(3)}']`).click();
  assert.match($(w, ".date-chip-text").textContent.trim(), /^יום [א-ת]׳ \d{1,2}\.\d{1,2}(\.\d{4})?$/);
  $(w, "[data-action='open-date-sheet']").click();
  $(w, `#dateSheetBody .date-quick[data-date='${iso(0)}']`).click();
  assert.equal($(w, ".date-chip-text").textContent.trim(), "היום");
  assert.equal($(w, "[data-action='reset-log-date']"), null);
});

test("תאריך אחר: a month grid, Sunday first, no future days, no month past this one, workout days dotted", async () => {
  const w = await onLog();
  w.applyFieldValue("step", "weight", 60);
  await w.saveSet();
  if ($(w, "#celebrationOverlay").classList.contains("open")) w.closeCelebration();
  $(w, "[data-action='open-date-sheet']").click();
  $(w, "#dateSheetBody [data-action='date-sheet-month']").click();
  assert.equal($(w, "#dateSheetBody [data-action='date-sheet-month']").getAttribute("aria-expanded"), "true");
  assert.deepEqual($$(w, ".date-weekdays span").map((s) => s.textContent), ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]);
  const now = new Date();
  assert.equal($$(w, ".date-grid .date-cell--blank").length, new Date(now.getFullYear(), now.getMonth(), 1).getDay(), "the 1st sits under its weekday, Sunday first");
  const todayCell = $(w, `.date-grid [data-date='${iso(0)}']`);
  assert.ok(todayCell.classList.contains("is-today") && todayCell.classList.contains("has-workout"), "today ringed and dotted");
  assert.match(todayCell.getAttribute("aria-label"), /^היום, .*, יש אימון, נבחר$/);
  for (const b of $$(w, ".date-grid button.date-cell:not([data-date])")) assert.ok(b.disabled, "a future day cannot be picked");
  assert.ok($(w, "[data-action='date-sheet-next']").disabled, "no month after this one");
  $(w, "[data-action='date-sheet-prev']").click();
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const pickIso = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}-15`;
  assert.equal($$(w, ".date-grid button.date-cell[disabled]").length, 0, "last month has no future days");
  $(w, `.date-grid [data-date='${pickIso}']`).click();
  assert.ok(!$(w, "#dateSheetOverlay").classList.contains("open"));
  assert.equal($(w, "#logDateInput").value, pickIso);
});

test("the same component on אימונים", async () => {
  const w = await fresh();
  w.document.getElementById("tabWodBtn").click();
  w.choosePickedWod("fran");
  w.renderWodContent();
  const chip = $(w, "[data-action='open-date-sheet'][data-target='wod']");
  assert.ok(chip, "the WOD form has the same chip");
  assert.match(chip.getAttribute("aria-label"), /^תאריך רישום האימון: היום/);
  chip.click();
  $(w, `#dateSheetBody .date-quick[data-date='${iso(2)}']`).click();
  assert.equal($(w, "#wodLogDateInput").value, iso(2));
  assert.match($(w, "[data-target='wod'] .date-chip-text").textContent, /^יום /);
});

test("Escape closes the sheet and gives focus back to the chip", async () => {
  const w = await onLog();
  $(w, "[data-action='open-date-sheet']").click();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!$(w, "#dateSheetOverlay").classList.contains("open"));
  assert.equal(w.document.activeElement, $(w, "[data-action='open-date-sheet']"));
});
