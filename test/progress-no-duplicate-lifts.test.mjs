// Every lift appears once on the progress screen.
//
// 3.0.0 listed each logged lift twice: once in the exercise list at the top
// (sets and estimated 1RM), and again as extra rows inside Benchmarks, below
// the eight named workouts, showing only the estimated 1RM. The exercise list
// is the one place a lift lives on this screen; Benchmarks is the named
// workouts only; body weight follows.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

async function seedLift(window, name, category, date, weight, reps) {
  let movement = window.allMovements().find((m) => m.name === name);
  if (!movement) {
    await window.addMovement(name, category);
    movement = window.allMovements().find((m) => m.name === name);
  }
  await window.dbPut({
    id: window.uid("set"), exerciseId: movement.id, date, type: "reps",
    weight, reps, sets: 1, ts: new Date(`${date}T09:00:00`).getTime(),
  });
  await window.reloadFromDb();
  return movement;
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("a logged lift appears exactly once on the progress screen", async () => {
  const window = await bootApp();
  const today = window.localISODate(new Date());
  const squat = await seedLift(window, "Dup Check Squat", "Squat", today, 100, 5);
  const press = await seedLift(window, "Dup Check Press", "Press", today, 50, 3);
  window.render();
  window.document.getElementById("tabHistoryBtn").click();

  const doc = window.document;
  const screen = doc.getElementById("pageTitle-history").closest("section");
  const list = doc.getElementById("historyListArea");
  const bench = doc.getElementById("benchmarkArea");
  const bodyweight = doc.getElementById("bodyweightArea");

  for (const mov of [squat, press]) {
    assert.equal(occurrences(screen.textContent, mov.name), 1,
      `${mov.name} is listed once on Progress, not once per section`);
    assert.equal(screen.querySelectorAll(`[data-id="${mov.id}"], [data-id="lift:${mov.id}"]`).length, 1,
      `${mov.name} has one row on Progress`);
    const row = list.querySelector(`[data-action="select-history"][data-id="${mov.id}"]`);
    assert.ok(row, `${mov.name} is in the exercise list`);
    const est = window.bestEst1RM(mov.id);
    assert.ok(est, "the lift has an estimated 1RM");
    assert.match(row.textContent, /1RM משוער/, "the exercise row still shows the estimated 1RM");
    assert.ok(row.textContent.includes(String(est)), "with its value");
  }

  assert.ok(bench.querySelector('[data-action="toggle-benchmark"]'), "Benchmarks still renders");
  assert.equal(bench.querySelectorAll('[data-id^="lift:"]').length, 0, "with no lift rows in it");
  assert.equal(/1RM/.test(bench.textContent), false, "and no estimated 1RM in it");

  const FOLLOWING = window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(list.compareDocumentPosition(bench) & FOLLOWING, "exercises come before Benchmarks");
  assert.ok(bench.compareDocumentPosition(bodyweight) & FOLLOWING, "and Benchmarks before body weight");
});
