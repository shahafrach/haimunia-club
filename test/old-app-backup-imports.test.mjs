// THE MIGRATION PATH FOR EVERY MEMBER OF THE OLD APP.
//
// There is an earlier deployment of this app with real members and real
// training history, all of it in IndexedDB on their own phones. The only route
// from there to here is export-to-file, import-here - and once the new app
// moved to its own origin (Cloudflare Pages, 2026-09-16) it became the ONLY
// route, because a different origin cannot read the old one's IndexedDB.
//
// So this test is not about file parsing. It is about whether a member who has
// logged eighteen months of lifts keeps them.
//
// The fixture is the exact SHAPE of a real export taken from the old app on
// 2026-09-16 (verified against it), with invented numbers - there is no reason
// for one person's bodyweight to live in a repository whose every file is served.
//
// What makes the old format interesting is what it LACKS: no `sessionNotes`
// key and no `customWodMovementTags`, both of which the current export writes.
// An import that assumed either was present would throw on every member's file.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const raw = readFileSync(new URL("./fixtures/old-app-backup-v1.json", import.meta.url), "utf8");
const src = JSON.parse(raw);

async function importFixture() {
  const window = await bootApp();
  const file = new window.File([raw], "box-log-backup.json", { type: "application/json" });
  await window.importDataFromFile(file);
  await new Promise((r) => setTimeout(r, 400));
  await window.reloadFromDb();
  return window;
}

test("a backup from the old app is accepted at all", () => {
  // The two gates a file has to clear. If the old app's identifiers ever drift
  // from these, every member's migration breaks at once and silently.
  assert.equal(src.app, "box-log", "BACKUP_APP_ID");
  assert.ok(Number(src.version) <= 1, "not newer than this app understands");
  // The shape that actually distinguishes an OLD export from a current one.
  assert.ok(!("sessionNotes" in src), "the old format has no session notes");
  assert.ok(!("customWodMovementTags" in src), "nor WOD movement tags");
});

test("every strength entry survives, with the details that are easy to lose", async () => {
  const window = await importFixture();
  const entries = window.allMovements().flatMap((m) => window.entriesFor(m.id));
  assert.equal(entries.length, src.entries.length, "no entry is dropped");

  // A PR is a claim about a member's history. Losing the flag turns their best
  // lift into an ordinary one.
  const dl = entries.find((e) => e.exerciseId === "deadlift");
  assert.ok(dl, "the deadlift came across");
  assert.equal(dl.weight, 100);
  assert.equal(dl.date, "2026-09-07");
  assert.equal(dl.isPR, true, "the PR flag survives");
  assert.equal(dl.est1RM, 100);

  // A ladder is several rows tied together by groupId. Lose that and the
  // calendar shows five unrelated sets instead of one piece of work.
  const ladder = entries.filter((e) => e.groupId === "ladder-old-1");
  assert.equal(ladder.length, 2, "both ladder rungs kept their group");
  assert.deepEqual(ladder.map((e) => e.blockLabel).sort(), ["C", "D"]);

  // A duration entry has no weight or reps at all - a rebuild that assumed
  // reps would quietly zero it.
  const hold = entries.find((e) => e.type === "duration");
  assert.ok(hold, "the duration entry came across");
  assert.equal(hold.durationSeconds, 20);
  assert.equal(hold.sets, 4);
});

test("custom movements, custom WODs and bodyweight all come across", async () => {
  const window = await importFixture();

  const customs = window.allMovements().filter((m) => String(m.id).startsWith("custom-"));
  assert.equal(customs.length, src.customMovements.length);
  assert.ok(customs.some((m) => m.name === "Ring Hold"),
    "and the one an entry POINTS AT - an orphaned entry has no movement to render under");

  const wod = window.allWods().find((w) => String(w.id).startsWith("customwod-"));
  assert.ok(wod, "the custom WOD came across");
  assert.equal(wod.name, "01/09");
  assert.equal(wod.timeCapSeconds, 900, "including its time cap");
  assert.equal(wod.desc, src.customWods[0].desc, "and the whole description, unclipped");

  const bw = await window.dbLoadBodyweight();
  assert.equal(bw.length, src.bodyweightEntries.length);
  assert.equal(bw[0].weight, 80);
});

test("the empty collections in the old format do not break anything", async () => {
  // wodEntries, measureTypes and measureEntries are all [] in a typical old
  // export. Empty is not the same as absent, and neither may throw.
  const window = await importFixture();
  assert.deepEqual(await window.dbLoadWodEntries(), []);
  assert.deepEqual(await window.dbLoadMeasureTypes(), []);
  assert.deepEqual(await window.dbLoadMeasurements(), []);
});
