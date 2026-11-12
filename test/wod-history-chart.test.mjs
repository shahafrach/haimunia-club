// Coverage gap closed (full-codebase audit): renderWodDetailCard()'s EMOM
// skip-branch had zero automated coverage. EMOM has no single comparable
// score across attempts (see scoreValue()/bestWodScore), so the PR-trend
// chart is deliberately skipped for it — this proves that branch actually
// fires (no chart, no "שיא:" best line) while every other score type still
// gets its chart, guarding against the skip condition silently swallowing
// a score type it shouldn't.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

// THREE ATTEMPTS, NOT ONE, on both sides of the EMOM branch. renderChart()
// draws the plot only once a movement has enough points to have a trend (see
// renderCompactChart in app.js - one or two points used to fill a 174px
// empty plot area, reported from a real phone). With one attempt, "no
// viewBox" would be true of an EMOM WOD and of every other score type alike,
// so the EMOM skip-branch this file exists to pin would pass vacuously.
// Seeded straight into IndexedDB rather than through three save flows: the
// save path is covered elsewhere, and what this file is about is what the
// detail card renders.
async function seedWodEntries(window, wod, scores) {
  let day = 30;
  for (const score of scores) {
    const date = new Date(Date.now() - day * 86400000).toISOString().slice(0, 10);
    const entry = { id: window.uid("wod"), wodId: wod.id, date, scoreType: wod.scoreType, rx: true, ts: new Date(`${date}T09:00:00`).getTime() };
    if (wod.scoreType === "load") entry.weight = score;
    else if (wod.scoreType === "time") entry.timeSeconds = score;
    else if (wod.scoreType === "emom") entry.emomReps = score;
    await window.dbPutWodEntry(entry);
    day -= 10;
  }
  await window.reloadFromDb();
}

test("an EMOM WOD's history card skips the chart and the best-score line", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Chart EMOM", "emom", "", {
    emomMinutes: 10, emomMovements: ["Burpees", "Sit-ups"], emomTargetReps: [5, 5],
  });
  const wod = window.allWods().find((w) => w.name === "Test Chart EMOM");

  await seedWodEntries(window, wod, [[8, 9], [9, 9], [10, 10]]);

  const html = window.renderWodDetailCard(wod);
  assert.ok(!html.includes("viewBox"), "EMOM should not render the SVG trend chart");
  assert.ok(!html.includes("שיא:"), "EMOM should not show a best-score line — there's no single comparable score");
  assert.ok(html.includes(wod.name), "the card should still render, just without the chart");
});

test("a non-EMOM WOD's history card still gets the chart and best-score line", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Chart Load", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Chart Load");

  await seedWodEntries(window, wod, [60, 65, 70]);

  const html = window.renderWodDetailCard(wod);
  assert.ok(html.includes("viewBox"), "a non-EMOM WOD should still get the SVG trend chart");
  assert.ok(html.includes("שיא:"), "a non-EMOM WOD should still show its best score");
});

test("below the trend threshold a non-EMOM WOD gets the compact readout, not the EMOM branch's nothing", async () => {
  // The other half of the pair above, and the reason it has to exist: with
  // one attempt there is no viewBox either, so without this the EMOM
  // assertions would no longer be evidence of the EMOM branch at all.
  const window = await bootApp();
  await window.addCustomWod("Test Chart Load Single", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Chart Load Single");
  await seedWodEntries(window, wod, [60]);

  const html = window.renderWodDetailCard(wod);
  assert.ok(!html.includes("viewBox"), "one point does not draw a plot");
  assert.ok(html.includes("chart-compact"), "it draws the compact readout instead");
  assert.ok(html.includes("שיא:"), "and the best-score line is still there - that is the EMOM branch, not this one");
});

test("an EMOM WOD with no logged attempts renders nothing, same as any other WOD", async () => {
  const window = await bootApp();
  await window.addCustomWod("Test Chart EMOM Unused", "emom", "", {
    emomMinutes: 5, emomMovements: ["Push-ups"], emomTargetReps: [10],
  });
  const wod = window.allWods().find((w) => w.name === "Test Chart EMOM Unused");
  assert.equal(window.renderWodDetailCard(wod), "", "a WOD with zero logged entries should render an empty card, EMOM or not");
});
