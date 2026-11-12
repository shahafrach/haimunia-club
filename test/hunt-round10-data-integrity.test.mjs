// Round 10 of the live bug hunt, data-integrity pass. Three findings, all
// reproduced in real Chromium first, all of the same family: a rule that was
// written down in one place and quietly not honored in another.
//
// The through-line worth remembering: every one of these lost or corrupted a
// member's own training data SILENTLY. Nothing threw, nothing warned, and the
// app kept rendering a confident number that was no longer what the member
// typed. A training log's whole value is that last week's entry still says
// what last week said.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp, answerWodRx } from "./helpers/boot.mjs";

const appJs = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("a WOD note survives a reload when the entry is Rx", async () => {
  // THE BUG: sanitizeWodEntry assigned out.notes only inside `if (!out.rx)`,
  // but saveWod() writes entry.notes unconditionally and nothing clears the
  // notes field when a member switches Scaled -> Rx. So the note was stored
  // correctly and rendered in the session it was typed in, then vanished on
  // the next reload, because reloadFromDb re-sanitizes every stored row.
  const window = await bootApp();
  const rx = window.sanitizeWodEntry({
    id: "e1", wodId: "w1", date: "2024-01-01", scoreType: "load", weight: 60,
    rx: true, notes: "כתפיים כואבות — ירדתי במשקל הפעם",
  });
  assert.equal(rx.notes, "כתפיים כואבות — ירדתי במשקל הפעם",
    "an Rx entry's note must survive sanitization, not be dropped on the floor");

  const scaled = window.sanitizeWodEntry({
    id: "e2", wodId: "w1", date: "2024-01-01", scoreType: "load", weight: 40,
    rx: false, notes: "ירדתי ל-40",
  });
  assert.equal(scaled.notes, "ירדתי ל-40", "and a Scaled entry's note still survives");

  // scaledWeight stays gated on purpose — an Rx entry has no scaled weight.
  // The point is that notes and scaledWeight are different questions; they
  // were wrong precisely because they shared one `if`.
  assert.equal(rx.scaledWeight, undefined, "Rx still carries no scaledWeight");
});

test("an Rx WOD note typed through the real UI is still there after reloadFromDb", async () => {
  // The real path a member walks, and the reason this was easy to miss: the
  // notes input only RENDERS inside the Scaled block, so the only way to end up
  // with an Rx entry that has a note is to type it as Scaled and then switch to
  // Rx — which setWodRx does not clear. Both renderers (the calendar day view
  // and the WOD log) already print e.notes without checking rx, and saveWod
  // already writes it without checking rx. The sanitizer was the lone outlier
  // of four, which is why the note survived the session it was typed in and
  // then disappeared.
  const window = await bootApp();
  await window.addCustomWod("Test Notes WOD", "load", "");
  const wod = window.allWods().find((w) => w.name === "Test Notes WOD");
  window.applyFieldValue("wod-step", "wodWeight", 60);
  window.document.getElementById("tabWodBtn").click();

  window.document.querySelector("[data-action='set-rx'][data-rx='0']").click();
  const notesInput = window.document.getElementById("wodNotesInput");
  assert.ok(notesInput, "the notes input appears once Scaled is chosen");
  notesInput.value = "הכתף הימנית תקעה";
  notesInput.dispatchEvent(new window.Event("input", { bubbles: true }));

  // Switch back to Rx — the note stays in state, and the member's typed
  // sentence is about to be saved on an Rx entry.
  window.document.querySelector("[data-action='set-rx'][data-rx='1']").click();
  await window.saveWod();

  await window.reloadFromDb();
  const after = window.wodEntriesFor(wod.id)[0];
  assert.ok(after, "the entry is still there");
  assert.equal(after.rx, true, "and it is the Rx entry this test is about");
  assert.equal(after.notes, "הכתף הימנית תקעה",
    "the note survives the reload that re-sanitizes every stored row");
});

test("editing an entry advances updatedAt but never ts, so History keeps its order", async () => {
  // ts is the History sort key (entries.sort by ts descending). Bumping it on
  // an edit would jump a 2019 workout to the top of the list, so the recency
  // signal the conflict rule needs has to be a SEPARATE field.
  for (const site of ["saveSet", "saveWod"]) {
    const at = appJs.indexOf(`function ${site}`);
    assert.ok(at > -1, `${site} exists`);
  }
  const frozen = appJs.match(/ts: existing \? existing\.ts : Date\.now\(\),/g) || [];
  assert.equal(frozen.length, 3, "all three save sites still freeze ts at creation");
  const advanced = appJs.match(/updatedAt: Date\.now\(\),/g) || [];
  assert.equal(advanced.length, 3,
    "and each of those three sites stamps a fresh updatedAt on every save");
});

test("sanitizers carry updatedAt when it exists and never invent one when it does not", async () => {
  const window = await bootApp();
  const base = { id: "s1", exerciseId: "x1", date: "2024-01-01", type: "weight", weight: 50, reps: 5, sets: 1 };
  const edited = window.sanitizeEntry({ ...base, ts: 1000, updatedAt: 9999 });
  assert.equal(edited.updatedAt, 9999, "a real modification stamp round-trips");
  assert.equal(edited.ts, 1000, "and creation time is untouched");

  // Absence must stay absence. cleanTs() falls back to the date or the clock,
  // and a FABRICATED modification time is worse than none: it would make an
  // untouched 2019 row look freshly edited and win every conflict it entered.
  const untouched = window.sanitizeEntry({ ...base, ts: 1000 });
  assert.ok(!isFinite(untouched.updatedAt),
    "a row that was never edited carries no modification stamp");
  assert.equal(untouched.ts, 1000);

  const wod = window.sanitizeWodEntry({ id: "e9", wodId: "w1", date: "2024-01-01", scoreType: "load", weight: 60, ts: 500 });
  assert.ok(!isFinite(wod.updatedAt), "same rule for WOD entries");
});
