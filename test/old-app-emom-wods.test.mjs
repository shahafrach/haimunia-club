// A CUSTOM EMOM WOD FROM THE OLD APP, AND THE ONE RESULT LOGGED AGAINST IT.
//
// The older app (haimuniya/haimunia-app, 2.28.0-2.34.0) gave each EMOM
// station a type - reps, a timed hold, or a rest minute - plus a target
// duration and a target weight, and stored a result's emomReps for the
// NON-REST stations only. This app had forked before that model existed, and
// its sanitizer rebuilt a custom WOD from emomMovements/emomTargetReps alone.
// For a member's WOD that meant: the rest minute became a station to log reps
// against, the hold lost its seconds, the weight vanished, and on edit every
// value after the rest slot moved one station to the left - permanently, on
// the first re-save or at once on file import. docs/audit/
// standalone-edition-plan.md §4.1.
//
// The fixture was not written by hand. It was produced by driving the old
// app's own builder, log form and buildBackupPayload() in jsdom at its HEAD
// (16d0cd8): a rotation of reps-at-a-weight, a 45-second hold, a rest minute
// and plain reps, with one result logged. Only the random ids and the dates
// were pinned afterwards. test/fixtures/old-app-backup-v1.json has no EMOM
// WOD at all, which is why nothing caught this.
//
// Both roads a member's data takes are covered: the file (export, import
// here) and in place (the same records already sitting in IndexedDB, which
// is what the standalone edition on the old origin reads on first open).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp, answerWodRx } from "./helpers/boot.mjs";

const raw = readFileSync(new URL("./fixtures/old-app-backup-emom.json", import.meta.url), "utf8");
const src = JSON.parse(raw);
const OLD_WOD = src.customWods[0];
const OLD_ENTRY = src.wodEntries[0];

const STRUCTURE = ["emomMovements", "emomMovementTypes", "emomTargetReps", "emomTargetDurations", "emomTargetWeights", "emomMinutes"];

async function viaFile() {
  const window = await bootApp();
  const file = new window.File([raw], "box-log-backup.json", { type: "application/json" });
  await window.importDataFromFile(file);
  await new Promise((r) => setTimeout(r, 400));
  await window.reloadFromDb();
  return window;
}

// The old app's records, written straight into the store exactly as it left
// them, then read the way a cold boot reads them.
async function inPlace() {
  const window = await bootApp();
  await window.dbAddCustomWod(OLD_WOD);
  await window.dbPutWodEntry(OLD_ENTRY);
  await window.reloadFromDb();
  return window;
}

function assertStructureKept(window, label) {
  const wod = window.allWods().find((w) => w.id === OLD_WOD.id);
  assert.ok(wod, `${label}: the custom EMOM came across`);
  for (const k of STRUCTURE) assert.deepEqual(wod[k], OLD_WOD[k], `${label}: ${k} is exactly what the old app stored`);
  const entry = window.wodEntriesFor(OLD_WOD.id)[0];
  assert.ok(entry, `${label}: the logged result came across`);
  assert.deepEqual(entry.emomReps, OLD_ENTRY.emomReps, `${label}: the result keeps its compacted, non-rest-only reps`);
}

test("the fixture is the old app's shape: a rest station, a timed station, a weight, and compacted reps", () => {
  assert.equal(src.app, "box-log");
  assert.deepEqual(OLD_WOD.emomMovementTypes, ["reps", "duration", "rest", "reps"]);
  assert.equal(OLD_ENTRY.emomReps.length, OLD_WOD.emomMovements.length - 1, "one value per non-rest station");
});

test("file import: the WOD's station types, hold time and weight all survive", async () => {
  assertStructureKept(await viaFile(), "file");
});

test("in place: the same records already on the device survive a cold boot", async () => {
  assertStructureKept(await inPlace(), "in place");
});

for (const [label, open] of [["file", viaFile], ["in place", inPlace]]) {
  test(`${label}: editing the old result puts each value back on its own station, and re-saving changes nothing`, async () => {
    const window = await open();
    await window.startEditWodEntry(OLD_ENTRY.id);
    const val = (i) => window.document.querySelector(`[data-field='${i}'][data-action='wod-emom-step'].stepper-val`)?.value;
    assert.equal(val(0), "11", "Wall Balls");
    assert.equal(val(1), "40", "the hold, in seconds - not shifted");
    assert.equal(val(2), undefined, "the rest minute has nothing to fill in");
    assert.equal(val(3), "7", "Box Jumps - the value after the rest slot, which used to land one station to the left");

    answerWodRx(window, OLD_ENTRY.rx);
    await window.saveWod();
    const rows = (await window.dbLoadWodEntries()).filter((e) => e.wodId === OLD_WOD.id);
    assert.equal(rows.length, 1, "edited in place");
    assert.deepEqual(rows[0].emomReps, OLD_ENTRY.emomReps, "the re-save wrote the same compacted reps back");
    const [storedWod] = (await window.dbLoadCustomWods()).filter((w) => w.id === OLD_WOD.id);
    for (const k of STRUCTURE) assert.deepEqual(storedWod[k], OLD_WOD[k], `the WOD on disk still has its ${k}`);
  });
}

test("the log form for the old WOD: weight in the label, seconds for the hold, a label and no stepper for rest", async () => {
  const window = await inPlace();
  window.choosePickedWod(OLD_WOD.id);
  window.document.getElementById("tabWodBtn").click();
  const stepper = (i) => window.document.querySelector(`[data-action='wod-emom-step'][data-field='${i}'].stepper-val`);
  assert.equal(stepper(0).value, "12", "prefilled from the reps target");
  assert.equal(stepper(1).value, "45", "prefilled from the DURATION target, not the meaningless reps target");
  assert.equal(stepper(2), null);
  assert.equal(stepper(3).value, "8");
  const labels = [...window.document.querySelectorAll(".stepper-label")].map((l) => l.textContent);
  assert.ok(labels.some((t) => t.includes("Wall Balls") && t.includes("9")), `the target weight shows: ${labels.join(" | ")}`);
  assert.ok(labels.some((t) => t.includes("מנוחה")), "the rest minute is still shown, as a row");
});

test("a new result on the old WOD is saved compacted, the same way the old app wrote it", async () => {
  const window = await inPlace();
  window.choosePickedWod(OLD_WOD.id);
  window.document.getElementById("tabWodBtn").click();
  window.applyFieldValue("wod-emom-step", "0", 12);
  window.applyFieldValue("wod-emom-step", "1", 45);
  window.applyFieldValue("wod-emom-step", "3", 8);
  answerWodRx(window);
  await window.saveWod();
  const fresh = window.wodEntriesFor(OLD_WOD.id).find((e) => e.id !== OLD_ENTRY.id);
  assert.deepEqual(fresh.emomReps, [12, 45, 8], "no stray value for the rest station");
  assert.equal(window.formatWodEntry(fresh), "12 · 45 · 8");
});

// The builder side of the same model, so a member can build what they
// already have: the old app's own builder tests, ported.
test("builder (EMOM): a station can be a timed hold, at a weight, or a rest minute", async () => {
  const window = await bootApp();
  const q = (s) => window.document.querySelector(s);
  window.openWodBuilder();
  window.document.getElementById("wodBuilderName").value = "Rebuilt";
  q("[data-action='builder-set-format'][data-format='emom']").click();
  window.toggleBuilderMovement("Wall Balls");
  assert.ok(q("[data-action='builder-movement-weight'][data-field='Wall Balls']"), "a weight-bearing EMOM station offers a weight");
  window.applyFieldValue("builder-movement-reps", "Wall Balls", 12);
  window.applyFieldValue("builder-movement-weight", "Wall Balls", 9);
  window.toggleBuilderMovement("Plank Hold");
  q("[data-action='toggle-builder-movement-type'][data-name='Plank Hold'][data-type='duration']").click();
  window.applyFieldValue("builder-movement-duration", "Plank Hold", 45);
  window.toggleBuilderMovement("Burpees");
  q("[data-action='toggle-builder-movement-rest'][data-name='Burpees']").click();
  assert.equal(q("[data-action='builder-movement-reps'][data-field='Burpees']"), null, "a rest station hides its reps");
  window.toggleBuilderMovement("Box Jumps");
  window.applyFieldValue("builder-movement-reps", "Box Jumps", 8);
  window.applyFieldValue("builder-emom-minutes", "emomMinutes", 16);
  window.createWodFromBuilder();

  const wod = window.allWods().find((w) => w.name === "Rebuilt");
  for (const k of STRUCTURE) assert.deepEqual(wod[k], OLD_WOD[k], `the rebuilt ${k} matches what the old app built`);
  assert.equal(wod.desc, OLD_WOD.desc, "and so does the description");
});

test("builder: leaving EMOM clears the rest flag, so a rest station is not published as a normal line", async () => {
  const window = await bootApp();
  const q = (s) => window.document.querySelector(s);
  window.openWodBuilder();
  window.document.getElementById("wodBuilderName").value = "Switched";
  q("[data-action='builder-set-format'][data-format='emom']").click();
  window.toggleBuilderMovement("Burpees");
  q("[data-action='toggle-builder-movement-rest'][data-name='Burpees']").click();
  q("[data-action='builder-set-format'][data-format='time']").click();
  q("[data-action='builder-set-format'][data-format='emom']").click();
  assert.equal(q("[data-action='toggle-builder-movement-rest'][data-name='Burpees']").getAttribute("aria-checked"), "false");
});
