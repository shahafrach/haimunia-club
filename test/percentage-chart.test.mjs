// 3.15.0: THE PERCENTAGE CHART ON THE EXERCISE SCREEN.
//
// From the lift's estimated 1RM (bestEst1RM(), the same number as the "1RM משוער" card above it), 95% down
// to 50%. Each row is a weight the member can actually load: the bar plus whole 1.25 kg pairs, never under
// the empty bar, and the plates for one side from the app's own plate set (PLATE_DEFS, via calcPlates). A
// lift that is not on a barbell gets 2.5 kg rounding and no plates. No 1RM yet: one line, no chart.
// Nothing is stored: computed from logged sets at render time.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const content = (w) => w.document.getElementById("content");
const rows = (w) => [...content(w).querySelectorAll(".pct-chart-row")];
const toggle = (w) => content(w).querySelector('[data-action="toggle-pct-table"]');

async function withSet(window, name, weight, reps, category = "Squat") {
  await window.addMovement(name, category);
  window.applyFieldValue("step", "weight", weight);
  window.applyFieldValue("step", "reps", reps);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
  window.render();
  return window.allMovements().find((m) => m.name === name);
}
function openChart(window) {
  if (toggle(window).getAttribute("aria-expanded") !== "true") toggle(window).click();
}
const sum = (list) => list.reduce((a, b) => a + b, 0);

test("ten rows, 95% to 50%, each the nearest weight the bar and plates can make, with the plates for a side", async () => {
  const window = await bootApp();
  // 117.5 x 3: an estimate with a decimal tail (Epley 129.25), the input that catches naive rounding.
  const m = await withSet(window, "Chart Squat", 117.5, 3);
  const est = window.bestEst1RM(m.id);
  assert.match(content(window).textContent, new RegExp(`1RM משוער${est} ק״ג`), "the chart's basis is the 1RM card's number");
  openChart(window);
  const list = rows(window);
  assert.deepEqual(list.map((r) => Number(r.dataset.pct)), [95, 90, 85, 80, 75, 70, 65, 60, 55, 50]);
  for (const r of list) {
    const kg = Number(r.dataset.kg);
    const exact = est * Number(r.dataset.pct) / 100;
    assert.equal(Math.round((kg - 20) * 100) % 250, 0, `${r.dataset.pct}%: ${kg} is the 20 kg bar plus 2.5 kg steps`);
    assert.ok(Math.abs(kg - exact) <= 1.25 + 1e-9, `${r.dataset.pct}%: ${kg} is the nearest to ${exact}`);
    const plates = (r.querySelector(".pct-plates [dir='ltr']")?.textContent || "").split(" + ").filter(Boolean).map(Number);
    assert.equal(20 + 2 * sum(plates), kg, `${r.dataset.pct}%: bar + 2 × (${plates.join(" + ")}) = ${kg}`);
    assert.deepEqual(plates, [...plates].sort((a, b) => b - a), "heaviest plate first");
  }
  // One worked row: 95% of 129.25 is 122.79 → 122.5 = 20 + 2 × (25 + 25 + 1.25).
  const top = list[0];
  assert.equal(top.dataset.kg, "122.5");
  assert.match(top.querySelector(".pct-plates").textContent, /לכל צד: 25 \+ 25 \+ 1\.25/, "1.25 is printed as 1.25, not rounded to 1.3");
});

test("the bar the member chose is the bar the chart loads, and below it the row says the empty bar", async () => {
  const window = await bootApp();
  const m = await withSet(window, "Light Press", 30, 1, "Press");
  window.setBarWeight(15);
  window.render();
  openChart(window);
  const est = window.bestEst1RM(m.id);
  for (const r of rows(window)) {
    const kg = Number(r.dataset.kg);
    assert.equal(Math.round((kg - 15) * 100) % 250, 0, `${r.dataset.pct}%: 15 kg bar plus 2.5 kg steps (${kg})`);
    assert.ok(kg >= 15, "never under the bar");
  }
  // 50% of 31 is 15.5: the nearest loadable is the empty 15 kg bar.
  const fifty = rows(window).find((r) => r.dataset.pct === "50");
  assert.equal(fifty.dataset.kg, "15");
  assert.match(fifty.textContent, /מוט ריק/);
  assert.ok(est > 0);
  // An 8 kg bar: totals are 8 + 2.5k, which the plain 2.5 kg rounding would get wrong.
  window.setBarWeight(8);
  window.render();
  for (const r of rows(window)) assert.equal(Math.round((Number(r.dataset.kg) - 8) * 100) % 250, 0, `${r.dataset.kg} on an 8 kg bar`);
  assert.equal(window.loadableKg(20, true), 20.5, "20 kg on an 8 kg bar: 12 kg to load rounds to 12.5, so 8 + 2 × 6.25");
  assert.equal(window.loadableKg(18.9, true), 18, "and 18.9 rounds down to 8 + 2 × 5");
});

test("a lift that is not on a barbell is rounded to 2.5 kg and shows no plates", async () => {
  const window = await bootApp();
  const db = window.allMovements().find((x) => x.barbell === false);
  assert.ok(db, "the catalogue has non-barbell movements");
  assert.equal(window.loadableKg(37.3, false), 37.5);
  assert.equal(window.loadableKg(1, false), 0, "a non-barbell lift has no floor at the bar");
  assert.equal(window.pctChartRows(100, false).every((r) => r.plates === null), true);
});

test("no 1RM yet: one line, no chart; a bodyweight-only set does not count", async () => {
  const window = await bootApp();
  await window.addMovement("New Lift", "Squat");
  window.render();
  assert.equal(toggle(window), null, "no chart");
  assert.equal(rows(window).length, 0);
  assert.match(content(window).querySelector("#pctNoEst").textContent, /אין עדיין 1RM משוער לתרגיל הזה/);

  // A set at 0 kg has no estimate (est1RM 0): still the one line.
  window.applyFieldValue("step", "weight", 0);
  window.applyFieldValue("step", "reps", 10);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
  window.render();
  assert.equal(window.bestEst1RM(window.allMovements().find((x) => x.name === "New Lift").id), 0, "a 0 kg set gives no estimate");
  assert.ok(content(window).querySelector("#pctNoEst"));
  assert.equal(toggle(window), null);
});

test("nothing is stored: the chart is computed, and opening it writes nothing", async () => {
  const window = await bootApp();
  await withSet(window, "Store Check", 100, 5);
  const before = JSON.stringify(await window.buildBackupPayload().then((p) => ({ ...p, exportedAt: 0 })));
  openChart(window);
  window.setBarWeight(15); window.render(); window.setBarWeight(20); window.render();
  const after = JSON.stringify(await window.buildBackupPayload().then((p) => ({ ...p, exportedAt: 0 })));
  assert.equal(after, before);
});

test("the chips and the chart never disagree at the 2.5 kg increment on a 20 kg or 15 kg bar", async () => {
  const window = await bootApp();
  await withSet(window, "Agree Squat", 117.5, 3);
  window.document.querySelector('[data-action="set-pct-increment"][data-inc="2.5"]').click();
  for (const bar of [20, 15]) {
    window.setBarWeight(bar);
    window.render();
    openChart(window);
    const chips = Object.fromEntries([...content(window).querySelectorAll('[data-action="set-weight-from-pct"]')].map((b) => [b.dataset.pct, b.dataset.kg]));
    const chart = Object.fromEntries(rows(window).map((r) => [r.dataset.pct, r.dataset.kg]));
    assert.deepEqual(chart, chips, `bar ${bar} kg`);
  }
});
