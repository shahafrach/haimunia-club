// Coverage gap closed (full-codebase audit): calendar month navigation had
// zero automated coverage. Drives the real cal-prev/cal-next dispatcher
// actions and checks the rendered month label and day grid, including the
// December -> January year-wrap edge case.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("cal-prev and cal-next move the rendered month label", async () => {
  const window = await bootApp();
  window.document.getElementById("tabCalendarBtn").click();
  const label = () => window.document.getElementById("calMonthLabel").textContent;

  const startLabel = label();
  window.document.querySelector("[data-action='cal-prev']").click();
  const prevLabel = label();
  assert.notEqual(prevLabel, startLabel, "clicking the previous-month arrow should change the label");

  window.document.querySelector("[data-action='cal-next']").click();
  assert.equal(label(), startLabel, "clicking next should return to the original month");
});

test("cal-prev wraps from January into December of the previous year", async () => {
  const window = await bootApp();
  window.document.getElementById("tabCalendarBtn").click();
  const label = () => window.document.getElementById("calMonthLabel").textContent;

  // calYear/calMonth are module-scope `let` bindings, not window properties
  // (top-level `let` never attaches to the global object) — walk back with
  // real cal-prev clicks instead of reaching into internal state directly.
  const prevBtn = () => window.document.querySelector("[data-action='cal-prev']");
  let sawDecember = false;
  for (let i = 0; i < 12; i++) {
    prevBtn().click();
    if (label().includes(String(new Date().getFullYear() - 1))) { sawDecember = true; break; }
  }
  assert.ok(sawDecember, "walking back 12 months should cross into the previous year");
});

test("selecting a day shows that day's detail, and a day with a logged entry is marked with a dot", async () => {
  const window = await bootApp();
  await window.addMovement("Test Calendar Squat", "Squat");
  window.applyFieldValue("step", "weight", 50);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();

  window.document.getElementById("tabCalendarBtn").click();
  const today = window.todayISO();
  const todayCell = window.document.querySelector(`[data-action='cal-select-day'][data-date='${today}']`);
  assert.ok(todayCell, "today's cell should be in the grid");
  assert.ok(todayCell.querySelector(".cal-dot"), "a day with a logged entry should show the dot marker");

  todayCell.click();
  const detailText = window.document.getElementById("calDetail").textContent;
  assert.ok(detailText.includes("Test Calendar Squat"), "selecting the day should show the entry logged on it");
});

test("a day with no entries shows no dot and an empty detail state", async () => {
  const window = await bootApp();
  window.document.getElementById("tabCalendarBtn").click();
  // The 1st of the current month is very unlikely to collide with "today"
  // in a way that has data, and stays within the currently-rendered month.
  const cells = [...window.document.querySelectorAll("[data-action='cal-select-day']")];
  const emptyCell = cells.find((c) => !c.querySelector(".cal-dot") && c.dataset.date !== window.todayISO());
  assert.ok(emptyCell, "a fresh install should have plenty of empty days");
  emptyCell.click();
  const detailText = window.document.getElementById("calDetail").textContent.replace(/\s+/g, " ").trim();
  assert.ok(detailText.length > 0, "an empty day should still render some placeholder detail, not a blank panel");
});
