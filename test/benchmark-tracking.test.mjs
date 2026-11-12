// Benchmark tracking on the progress screen, behind club_features.benchmarks.
//
// WHAT THIS IS. Eight named workouts (Fran, Grace, Helen, Diane, Cindy, Murph,
// Isabel, Karen), each with every attempt, the best result, a chart, and a
// reminder once an attempt goes stale. It stores nothing: an attempt is the
// wod_entry the app has always written, which is what makes "it syncs like other records"
// true rather than something this branch had to build.
//
// THE THREE THINGS THIS FILE IS FOR:
//
//  1. THE BEST, PER SCORE TYPE. A benchmark's best is the LOWEST number for a
//     time and the HIGHEST for everything else, and an EMOM has no comparable
//     score at all. Get the direction wrong for one type and the app tells a
//     member their slowest Fran is their record - in a section whose entire
//     purpose is that number.
//  2. THE KEY OFF. Off is where every club starts (202609190002 seeds the row
//     disabled) and where every member who never signed into the community
//     layer stays. That state must be exactly the progress screen that
//     shipped before - not a half-rendered section, not an empty heading.
//  3. NO SECOND STORE. private_records' record_type is a check constraint
//     (202608260001) and this branch adds no migration, so an attempt that
//     did not go out as one of the existing types would not sync at all.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, answerWodRx, waitFor } from "./helpers/boot.mjs";

const FEATURE_KEY = "benchmarks";
const CACHE_KEY = "haimunia:clubFeatures";
// The eight, in the order the section renders them. Spelled out rather than
// read off app.js: this list is the product decision, and a test that derives
// it from the source cannot notice the source changing.
const THE_EIGHT = ["fran", "grace", "helen", "diane", "cindy", "murph", "isabel", "karen"];

function turnKeyOn(window) {
  // The shape cloud.js's loadClubFeatures() hands over - the { enabled, config }
  // row club_features selects, not a bare boolean.
  // Always on in the training-log edition: there is no club switch to flip.
  window.render();
}
function openProgress(window) {
  window.document.getElementById("tabHistoryBtn").click();
}
const area = (window) => window.document.getElementById("benchmarkArea");
const rows = (window) => [...window.document.querySelectorAll('[data-action="toggle-benchmark"]')];
const rowFor = (window, id) => rows(window).find((b) => b.dataset.id === id);
const attemptRows = (window) => [...window.document.querySelectorAll("[data-benchmark-attempt]")];
function daysAgo(window, n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return window.localISODate(d);
}
// Seeds an attempt the way a previous session would have left one: straight
// into the store the app reads, then back through reloadFromDb()'s real
// sanitizers. Going through saveWod() instead would tie every test below to
// today's date, and dates are half of what this feature is about.
async function seedWod(window, wodId, date, score, rx = true) {
  const w = window.wodById(wodId);
  const entry = {
    id: window.uid("wod"), wodId, date, scoreType: w.scoreType, rx,
    ts: new Date(`${date}T09:00:00`).getTime(),
  };
  if (w.scoreType === "time") entry.timeSeconds = score;
  else { entry.rounds = score.rounds; entry.reps = score.reps; }
  await window.dbPutWodEntry(entry);
  await window.reloadFromDb();
  return entry.id;
}
async function seedLift(window, name, date, weight, reps) {
  let movement = window.allMovements().find((m) => m.name === name);
  if (!movement) {
    await window.addMovement(name, "Squat");
    movement = window.allMovements().find((m) => m.name === name);
  }
  await window.dbPut({
    id: window.uid("set"), exerciseId: movement.id, date, type: "reps",
    weight, reps, sets: 1, ts: new Date(`${date}T09:00:00`).getTime(),
  });
  await window.reloadFromDb();
  return movement;
}

// ===========================================================================
// 1. The best result, per score type
// ===========================================================================

test("a time benchmark's best is the FASTEST attempt, not the biggest number", async () => {
  const window = await bootApp();
  const attempts = [
    { id: "a", date: "2026-01-01", value: 320 }, // 5:20
    { id: "b", date: "2026-03-01", value: 245 }, // 4:05
    { id: "c", date: "2026-06-01", value: 402 }, // 6:42
  ];
  const best = window.benchmarkBest(attempts, "time");
  assert.equal(best.id, "b", "4:05 is the Fran to be proud of; 6:42 is the one to beat");
  assert.equal(best.value, 245);
  // The same rule the WOD tab already applies, read off the one function both
  // use - so this can never become "lowest here, highest there".
  assert.equal(window.scoreLowerIsBetter("time"), true);
});

test("an AMRAP's best is the most work, with rounds outranking reps", async () => {
  const window = await bootApp();
  // scoreValue()'s encoding: rounds * 1000 + reps. 4 rounds + 30 reps is a
  // bigger raw rep count than 5 rounds + 0, and still the smaller score.
  const attempts = [
    { id: "a", date: "2026-01-01", value: 4 * 1000 + 30 },
    { id: "b", date: "2026-02-01", value: 5 * 1000 + 0 },
    { id: "c", date: "2026-03-01", value: 4 * 1000 + 31 },
  ];
  assert.equal(window.benchmarkBest(attempts, "amrap").id, "b", "a completed round beats a part-finished one");
  assert.equal(window.scoreLowerIsBetter("amrap"), false);
  // And within the same round count, reps decide.
  assert.equal(window.benchmarkBest(attempts.filter((a) => a.id !== "b"), "amrap").id, "c");
});

test("a load benchmark's best is the heaviest", async () => {
  const window = await bootApp();
  const attempts = [
    { id: "a", date: "2026-01-01", value: 100 },
    { id: "b", date: "2026-02-01", value: 122.5 },
    { id: "c", date: "2026-03-01", value: 117.5 },
  ];
  assert.equal(window.benchmarkBest(attempts, "load").id, "b");
  assert.equal(window.scoreLowerIsBetter("load"), false);
});

test("an EMOM has no single comparable score, so it has no best at all", async () => {
  const window = await bootApp();
  // scoreValue() returns 0 for every EMOM entry by construction - "10 of A, 8
  // of B" does not reduce to one number. Returning 0 here instead of null
  // would put a fake record on the screen with a real date next to it.
  assert.equal(window.benchmarkBest([{ id: "a", date: "2026-01-01", value: 0 }], "emom"), null);
});

test("nothing to compare is null, not zero, and junk values never win", async () => {
  const window = await bootApp();
  assert.equal(window.benchmarkBest([], "time"), null, "no attempts is no best");
  assert.equal(window.benchmarkBest(undefined, "load"), null);
  // A row whose score did not survive sanitising must not become the record
  // by being NaN/undefined in a comparison that quietly answers false.
  const mixed = [{ id: "a", date: "2026-01-01", value: NaN }, { id: "b", date: "2026-02-01", value: 90 }];
  assert.equal(window.benchmarkBest(mixed, "load").id, "b");
});

test("a matched result is not a new best - the earlier attempt keeps it", async () => {
  const window = await bootApp();
  const attempts = [
    { id: "first", date: "2026-01-01", value: 300 },
    { id: "again", date: "2026-05-01", value: 300 },
  ];
  assert.equal(window.benchmarkBest(attempts, "time").id, "first",
    "equalling your Fran is not beating it, which is the same call saveWod() makes");
  assert.equal(window.benchmarkBest(attempts, "load").id, "first");
});

// ===========================================================================
// 2. The screen
// ===========================================================================

test("all eight named benchmarks are there from day one, before the member has done any", async () => {
  const window = await bootApp();
  turnKeyOn(window);
  openProgress(window);

  assert.deepEqual(rows(window).map((b) => b.dataset.id), THE_EIGHT.map((id) => `wod:${id}`),
    "the list is the club's, not the member's - a benchmark never attempted is the most useful row a newcomer has");
  for (const id of THE_EIGHT) {
    assert.ok(window.wodById(id), `${id} is a real WOD_LIBRARY entry, not a name this section invented`);
    assert.match(rowFor(window, `wod:${id}`).textContent, /טרם נוסה/, `${id} says it has never been attempted`);
  }
  assert.equal(area(window).querySelectorAll("[data-benchmark-retest]").length, 0,
    "and none of them is 'due for a retest' - there is nothing to re-test");
});

test("on Progress, benchmarks come after the member's own movements, not before them", async () => {
  const window = await bootApp();
  await seedLift(window, "Back Squat", daysAgo(window, 3), 100, 1);
  turnKeyOn(window);
  openProgress(window);
  const list = window.document.getElementById("historyListArea");
  const bench = area(window);
  assert.ok(list.textContent.includes("Back Squat"), "the member's movement is listed");
  assert.ok(rows(window).length > 0, "and the benchmarks are rendered");
  assert.ok(list.compareDocumentPosition(bench) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    "the benchmarks section follows the movements list");
  const search = window.document.getElementById("historySearch");
  assert.ok(search.compareDocumentPosition(bench) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    "and follows the movements' heading and search box too");
});

test("an attempt shows up with its best, its history and a chart", async () => {
  const window = await bootApp();
  await seedWod(window, "fran", daysAgo(window, 30), 320);
  await seedWod(window, "fran", daysAgo(window, 10), 245);
  turnKeyOn(window);
  openProgress(window);

  const row = rowFor(window, "wod:fran");
  assert.match(row.textContent, /4:05/, "the headline is the fastest attempt, formatted as a clock");
  assert.equal(row.getAttribute("aria-expanded"), "false");

  row.click();
  const card = area(window).querySelector(".chart-card");
  assert.ok(card, "tapping opens the detail card");
  assert.equal(rowFor(window, "wod:fran").getAttribute("aria-expanded"), "true");
  // [role='img'], not svg[role='img'], since the compact state landed: this
  // benchmark has two attempts, and renderChart() no longer draws a 174px
  // plot for fewer than three points - it draws the same points as a compact
  // readout instead (a real-phone report, see renderCompactChart in app.js).
  // What this line is actually about is unchanged and is what it still
  // asserts: this screen renders THE shared chart component, with the
  // accessible summary that component owns, rather than a second one of its
  // own. scripts/browser-check/training-log-polish.mjs measures the heights
  // on both sides of the threshold; test/chart-accessible-name.test.mjs pins
  // which markup each side emits.
  const chart = card.querySelector("[role='img']");
  assert.ok(chart, "the existing chart component, not a new one");
  assert.match(chart.getAttribute("aria-label"), /גרף התקדמות/,
    "including the summary it exposes to assistive tech");
  // Every attempt, not just the record.
  assert.equal(attemptRows(window).length, 2, "every attempt over time, not only the record");
  assert.match(card.textContent, /5:20/, "the slower attempt is still the member's own history");
  assert.match(card.textContent, /4:05/);
  assert.match(card.textContent, /שיא/, "and the record row is marked as such");
});

test("Rx and scaled are not one line - the chart and the best come from one bucket, the list shows both", async () => {
  const window = await bootApp();
  await seedWod(window, "fran", daysAgo(window, 200), 380, true);        // 6:20 Rx
  await seedWod(window, "fran", daysAgo(window, 20), 305, false);        // 5:05 scaled
  turnKeyOn(window);
  openProgress(window);

  const row = rowFor(window, "wod:fran");
  assert.match(row.textContent, /6:20/, "the prescribed version is the comparable one, exactly as formatWodBest() headlines it");
  assert.ok(!/5:05/.test(row.textContent),
    "a scaled 5:05 is not a faster Fran - letting it win here is the defect the 2026-09-11 hunt fixed in bestWodScore()");

  row.click();
  const card = area(window).querySelector(".chart-card");
  assert.equal(attemptRows(window).length, 2, "both attempts are still the member's own history");
  assert.match(card.textContent, /מותאם/, "with the scaled one tagged as such");
  assert.match(card.textContent, /הגרף והשיא מציגים את הניסיונות במלא \(Rx\) בלבד/,
    "and the card says which bucket the picture is of, rather than leaving a member to count dots");
});

// ===========================================================================
// 3. The retest reminder
// ===========================================================================

test("a benchmark goes stale after 90 days, and says so in the app", async () => {
  const window = await bootApp();
  await seedWod(window, "grace", daysAgo(window, 91), 180);
  turnKeyOn(window);
  openProgress(window);

  const row = rowFor(window, "wod:grace");
  assert.ok(row.querySelector("[data-benchmark-retest]"), "91 days is past the quarter");
  assert.match(area(window).textContent, /לא נבדק/, "and the section says so at the top, not only on the row");
  assert.match(area(window).textContent, /Grace/, "naming which one");
  row.click();
  assert.match(area(window).querySelector(".chart-card").textContent, /עברו 91 יום/,
    "the card says how long it has been, not just that it is long");
});

test("exactly 90 days is not yet stale - the reminder is 'older than', not 'at'", async () => {
  const window = await bootApp();
  await seedWod(window, "helen", daysAgo(window, 90), 600);
  turnKeyOn(window);
  openProgress(window);
  assert.equal(rowFor(window, "wod:helen").querySelector("[data-benchmark-retest]"), null);
  assert.equal(area(window).querySelectorAll("[data-benchmark-retest]").length, 0);
});

test("a retest resets the clock even when it is slower than the record", async () => {
  const window = await bootApp();
  await seedWod(window, "isabel", daysAgo(window, 200), 150);
  await seedWod(window, "isabel", daysAgo(window, 4), 190);
  turnKeyOn(window);
  openProgress(window);

  const row = rowFor(window, "wod:isabel");
  assert.equal(row.querySelector("[data-benchmark-retest]"), null,
    "the question is when you last tested it, not when you last beat it");
  assert.match(row.textContent, /2:30/, "and the record is still the 2:30, not the recent 3:10");
});

test("the reminder is in the app and nowhere else - it never becomes a push", async () => {
  const window = await bootApp();
  await seedWod(window, "karen", daysAgo(window, 400), 540);
  turnKeyOn(window);
  openProgress(window);
  assert.ok(area(window).querySelector("[data-benchmark-retest]"), "the reminder is on the screen");
  // The push path is the community layer's (notif_push_pending, gated on
  // club_features.push_notifications). app.js must not reach into it, and a
  // later change that wants to has to change this line to do it.
  const source = [window.renderBenchmarkArea, window.benchmarkSectionHtml, window.renderBenchmarkRow, window.renderBenchmarkCard]
    .map((f) => f.toString()).join("\n");
  assert.equal(/showNotification|pushManager|notif_push|queueNotification/.test(source), false,
    "nothing in this section talks to the notification or push surface");
});
