// Rx+ — the third answer to "how did you do the workout?", in the same field.
//
// Rx+ is the standard CrossFit answer above Rx: as prescribed, and then
// heavier. The club asked for it because filing it as plain Rx flattens a real
// difference in effort - the same argument design spec §3.6 made when it
// removed the Rx default and gave Scaled a first-class answer of its own.
//
// It is stored in the SAME record field: rx is now true (Rx), false (Scaled)
// or "plus" (Rx+). That is the load-bearing decision in this change, and it is
// what most of this file is about, because a third value in a field that used
// to be a boolean fails in two silent ways:
//
//  - IT GETS ERASED. Every stored row is re-sanitized on every reload
//    (reloadFromDb, applyRemotePrivateRecord). sanitizeWodEntry's `e.rx !==
//    false` flattened anything that was not false into true, so an Rx+ entry
//    would have come back from disk as plain Rx with nothing to show it had
//    ever been anything else.
//  - IT GETS MIS-BUCKETED. bestWodScore() keeps a separate best per effort,
//    and the history chart keeps its own running best beside it. Those two
//    disagreeing is what the 2026-09-11 bug hunt fixed for Rx vs Scaled; a
//    third value re-opens exactly that seam.
//
// Rx+ is deliberately NOT behind club_features.strength_percentages (or any
// other key). It is how a member describes what they did - not a module.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

// The same route test/wod-rx-choice.test.mjs takes: אימונים › רישום with a
// real benchmark selected, the way a member picking a named workout does.
async function openWodLogForm(window) {
  const d = window.document;
  d.getElementById("tabWodBtn").click();
  d.querySelector('[data-action="switch-wod-subtab"][data-subtab="benchmarks"]').click();
  d.querySelector('[data-action="select-benchmark"]').click();
  return d;
}
const rxBtn = (d) => d.querySelector('[data-action="set-rx"][data-rx="1"]');
const scaledBtn = (d) => d.querySelector('[data-action="set-rx"][data-rx="0"]');
const plusBtn = (d) => d.querySelector('[data-action="set-rx"][data-rx="plus"]');
const saveBtn = (d) => d.getElementById("bottomBarBtn");

test("Rx+ sits beside Rx and Scaled, Hebrew-first and glossed like both of them", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  assert.ok(plusBtn(d), "the third option is in the toggle");
  assert.equal(d.querySelectorAll('[data-action="set-rx"]').length, 3, "three answers, one question");
  // Hebrew first with the English kept, because the member meets "Rx+" on the
  // whiteboard at the box and an app that hides it leaves her unable to read it.
  assert.match(plusBtn(d).textContent, /מוגבר/);
  assert.match(plusBtn(d).textContent, /Rx\+/);
  // Tier-1 permanent inline gloss, the same as its two siblings carry: the
  // answer to "which one was I?" on screen rather than behind a tap.
  assert.equal(plusBtn(d).querySelector(".term-sub").textContent.trim(), "כבד מהמוגדר");

  // Still unanswered with three options: adding one must not have quietly
  // reintroduced a default, which is the whole of design spec §3.6.
  assert.equal(plusBtn(d).getAttribute("aria-checked"), "false");
  assert.equal(rxBtn(d).getAttribute("aria-checked"), "false");
  assert.equal(scaledBtn(d).getAttribute("aria-checked"), "false");
  assert.ok(d.querySelector(".rx-toggle").classList.contains("unset"));
  assert.equal(saveBtn(d).disabled, true, "three ways to answer, and none of them chosen yet");
});

test("Rx+ is not behind a club key - it is how a member describes their own session", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  // No setClubFeatureFlags call, so every club module reads off in this file's
  // own terms - the state every member is in for strength_percentages today.
  const d = await openWodLogForm(window);
  assert.ok(plusBtn(d), "no module switch stands between a member and the truth about their workout");
});

test("choosing Rx+ selects only Rx+, enables the save CTA, and is remembered as the default", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  plusBtn(d).click();
  assert.equal(plusBtn(d).getAttribute("aria-checked"), "true");
  assert.equal(rxBtn(d).getAttribute("aria-checked"), "false",
    "the old handler compared dataset.rx to \"1\", which turned every non-Rx chip - Rx+ included - into Scaled");
  assert.equal(scaledBtn(d).getAttribute("aria-checked"), "false");
  assert.equal(plusBtn(d).className.includes("active-plus"), true, "and it looks chosen");
  assert.equal(saveBtn(d).disabled, false, "answering the question enables the save");
  assert.equal(d.querySelector(".rx-toggle").classList.contains("unset"), false);

  // §3.6's other half: the choice becomes THIS member's default next time.
  assert.equal(await window.dbGetSetting("haimunia:wodRxDefault"), "plus");

  // Scaled's weight field belongs to Scaled alone - Rx+ is at or above the
  // prescribed weights by definition, so it has no scaled weight to ask for.
  assert.equal(d.getElementById("wodContent").textContent.includes("משקל מותאם"), false);
});

test("an Rx+ result is stored as Rx+ in the rx field, and survives a reload", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  plusBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 4);
  window.applyFieldValue("wod-step", "wodSeconds", 30);
  await window.saveWod();

  const [entry] = window.wodEntriesFor(window.allWods().find((w) => w.scoreType === "time").id);
  assert.equal(entry.rx, "plus", "the same field, a third value - not a second column");

  const stored = (await window.dbLoadWodEntries()).find((e) => e.id === entry.id);
  assert.equal(stored.rx, "plus", "and that is what reached the disk");

  // THE ERASURE CASE. reloadFromDb() re-sanitizes every row it reads, and
  // sanitizeWodEntry's old `e.rx !== false` collapsed "plus" to true - the
  // member's Rx+ session coming back as plain Rx, permanently, with nothing
  // to show it had changed.
  await window.reloadFromDb();
  const afterReload = window.wodEntriesFor(entry.wodId).find((e) => e.id === entry.id);
  assert.equal(afterReload.rx, "plus", "re-sanitizing a stored row must not flatten it");

  // A row that never carried the field at all still reads as Rx, which is the
  // pre-existing default and must not have moved.
  assert.equal(window.sanitizeWodEntry({ id: entry.id, wodId: entry.wodId, date: entry.date, scoreType: "time" }).rx, true);
  assert.equal(window.sanitizeWodEntry({ ...entry, rx: "nonsense" }).rx, true, "and anything else collapses to Rx, not to a stored lie");
  assert.equal(window.sanitizeWodEntry({ ...entry, rx: false }).rx, false);
});

test("Rx+ gets its own personal best, and does not overwrite the Rx one", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  const wodId = window.allWods().find((w) => w.scoreType === "time").id;

  // A fast Rx time first.
  rxBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 4);
  window.applyFieldValue("wod-step", "wodSeconds", 0);
  await window.saveWod();
  // Then a SLOWER Rx+ time. It is a first Rx+ attempt, so it is a PR against
  // the Rx+ best (there isn't one) and must not be measured against the Rx 4:00.
  plusBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 5);
  window.applyFieldValue("wod-step", "wodSeconds", 30);
  await window.saveWod();

  assert.equal(window.bestWodScore(wodId, null, true), 240, "the Rx best is still the Rx best");
  assert.equal(window.bestWodScore(wodId, null, "plus"), 330, "and Rx+ keeps its own");
  assert.equal(window.bestWodScore(wodId, null, false), null, "nothing has been scaled");

  // NOTHING TO BEAT IS NOT A RECORD (the 2026-09-15 fix): a first attempt in
  // a bucket has no previous best, so it is not a PR - and crucially it was
  // not measured against the Rx 4:00 either, which would have made this
  // slower Rx+ time a non-PR for the wrong reason and, worse, would have let
  // a FASTER Rx+ time overwrite the Rx record.
  const plusEntry = window.wodEntriesFor(wodId).find((e) => e.rx === "plus");
  assert.equal(plusEntry.isPR, false, "a first Rx+ attempt has nothing to beat");

  // A second, faster Rx+ time IS a record - against Rx+, on its own ladder.
  plusBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 5);
  window.applyFieldValue("wod-step", "wodSeconds", 0);
  await window.saveWod();
  const faster = window.wodEntriesFor(wodId).find((e) => e.rx === "plus" && e.timeSeconds === 300);
  assert.equal(faster.isPR, true, "5:00 beats the 5:30 Rx+ best");
  assert.equal(window.bestWodScore(wodId, null, "plus"), 300);
  assert.equal(window.bestWodScore(wodId, null, true), 240, "and the Rx best is still untouched by any of it");
});

test("a member whose only attempts are Rx+ sees their result, not a dash", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  const wod = window.allWods().find((w) => w.scoreType === "time");

  plusBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 6);
  window.applyFieldValue("wod-step", "wodSeconds", 15);
  await window.saveWod();

  // formatWodBest() used to try Rx, then Scaled, and stop. With Rx+ in its own
  // bucket that is null, null - and the headline read "—" beside results the
  // member had actually logged.
  assert.equal(window.formatWodBest(wod.id), "6:15");
});

test("every surface that names the effort names Rx+, not \"Scaled\" and not silence", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  plusBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 5);
  window.applyFieldValue("wod-step", "wodSeconds", 0);
  await window.saveWod();
  window.render();

  // The label and tag helpers are the single definition the five old copies of
  // this ternary collapsed into - the fifth copy going unchanged is precisely
  // how this codebase's characteristic defect reaches a member.
  assert.equal(window.wodEffortLabel("plus"), "מוגבר (Rx+)");
  assert.equal(window.wodEffortLabel(true), "מלא (Rx)");
  assert.equal(window.wodEffortLabel(false), "מותאם (Scaled)");
  assert.equal(window.wodEffortTag("plus"), " · Rx+");
  assert.equal(window.wodEffortTag(true), "", "Rx is the unmarked case");
  assert.equal(window.wodEffortTag(false), " · מותאם");

  // And on screen: the WOD log surface describes the saved session as Rx+.
  const wodText = d.getElementById("wodContent").textContent;
  assert.match(wodText, /Rx\+/, "the session just saved is not described as plain Rx anywhere on this screen");
  assert.equal(/מותאם \(Scaled\)/.test(wodText.replace(/במשקלים שמתאימים לי/g, "")) && !/Rx\+/.test(wodText), false,
    "and certainly not as Scaled");
});

test("an Rx+ result earns the WOD's Rx achievement - Rx+ is Rx, and more", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);
  const wodId = window.allWods().find((w) => w.scoreType === "time").id;
  plusBtn(d).click();
  window.applyFieldValue("wod-step", "wodMinutes", 3);
  window.applyFieldValue("wod-step", "wodSeconds", 30);
  await window.saveWod();

  assert.ok(window.earnedRxWodIds().has(wodId),
    "everything that asks `e.rx ?` reads plus as Rx, which is what Rx+ is");
});

test("setWodRx refuses a value the loader would later reject", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const d = await openWodLogForm(window);

  plusBtn(d).click();
  window.setWodRx("PLUS");
  window.render();
  // Storing an unrecognised value would write a default to disk that
  // loadWodRxDefault() drops on the next boot: a silently forgotten preference.
  assert.equal(await window.dbGetSetting("haimunia:wodRxDefault"), "plus",
    "the last real answer stands");
});
