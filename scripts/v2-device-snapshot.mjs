// Drives the REAL 2.34.0 app (git tag rollback-2.34.0) through a member's
// history, then dumps what it left on the "phone": every IndexedDB store and
// every localStorage key. Output: a JSON snapshot on stdout, committed as
// test/fixtures/v2.34.0-device.json and read by test/upgrade-in-place.test.mjs.
//
// It runs against the OLD tree, not this one - the point is that the data is
// produced by the code members actually have:
//
//   mkdir /tmp/v2 && git archive rollback-2.34.0 | tar -x -C /tmp/v2
//   ln -s "$PWD/node_modules" /tmp/v2/node_modules
//   cp scripts/v2-device-snapshot.mjs /tmp/v2/ && (cd /tmp/v2 && node v2-device-snapshot.mjs) > test/fixtures/v2.34.0-device.json
import { bootApp } from "./test/helpers/boot.mjs";
const w = await bootApp();
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
w.scrollTo = () => {};
const q = (s) => w.document.querySelector(s);
// Profile + settings
w.saveWelcomeForm("דנה");
w.closeOnboarding();
w.saveBoxStartDate("2025-03-01");
w.setBarWeight(15);
w.setThemePref("light");
w.setTextScalePref("large");
// Strength: a built-in lift with PRs, a ladder, a superset, a duration hold
w.choosePickedMovement("back-squat");
for (const [kg, reps] of [[60, 5], [70, 5], [80, 3], [90, 1]]) {
  w.applyFieldValue("step", "weight", kg); w.applyFieldValue("step", "reps", reps); w.applyFieldValue("step", "sets", 1);
  await w.saveSet(); await tick();
}
w.choosePickedMovement("deadlift");
w.toggleLadderMode();
for (const kg of [100, 110]) { w.applyFieldValue("step", "weight", kg); w.applyFieldValue("step", "reps", 3); await w.saveSet(); await tick(); }
w.toggleLadderMode();
w.choosePickedMovement("strict-press");
w.toggleLadderMode();
w.setLadderPartner("weighted-pullup");
w.applyFieldValue("step", "weight", 40); w.applyFieldValue("step", "reps", 5); await w.saveSet(); await tick();
w.switchLadderExercise("weighted-pullup");
w.applyFieldValue("step", "weight", 10); w.applyFieldValue("step", "reps", 6); await w.saveSet(); await tick();
w.toggleLadderMode();
await w.addMovement("Ring Hold", "Gymnastics"); await tick();
w.setLogEntryType("duration");
w.applyFieldValue("step", "durationSeconds", 30); w.applyFieldValue("step", "sets", 3); await w.saveSet(); await tick();
w.setLogEntryType("reps");
// WODs: a benchmark for time, an AMRAP, a load WOD, a custom EMOM with rest+duration
w.document.getElementById("tabWodBtn").click(); await tick();
for (const [id, fill] of [["fran", () => { w.applyFieldValue("wod-step", "wodMinutes", 4); w.applyFieldValue("wod-step", "wodSeconds", 35); }],
                          ["cindy", () => { w.applyFieldValue("wod-step", "wodRounds", 18); w.applyFieldValue("wod-step", "wodReps", 7); }]]) {
  { const b = w.document.createElement("button"); b.dataset.action = "pick-wod"; b.dataset.id = id; w.document.body.appendChild(b); b.click(); b.remove(); } w.document.getElementById("tabWodBtn").click(); await tick(); fill(); await w.saveWod(); await tick();
}
w.openWodBuilder();
w.document.getElementById("wodBuilderName").value = "EMOM שלישי";
q("[data-action='builder-set-format'][data-format='emom']").click();
w.toggleBuilderMovement("Wall Balls"); w.applyFieldValue("builder-movement-reps", "Wall Balls", 12); w.applyFieldValue("builder-movement-weight", "Wall Balls", 9);
w.toggleBuilderMovement("Plank Hold"); q("[data-action='toggle-builder-movement-type'][data-name='Plank Hold'][data-type='duration']").click(); w.applyFieldValue("builder-movement-duration", "Plank Hold", 45);
w.toggleBuilderMovement("Burpees"); q("[data-action='toggle-builder-movement-rest'][data-name='Burpees']").click();
w.toggleBuilderMovement("Box Jumps"); w.applyFieldValue("builder-movement-reps", "Box Jumps", 8);
w.createWodFromBuilder(); await tick(100);
w.document.getElementById("tabWodBtn").click(); await tick();
w.applyFieldValue("wod-emom-step", "0", 11); w.applyFieldValue("wod-emom-step", "1", 40); w.applyFieldValue("wod-emom-step", "3", 7);
await w.saveWod(); await tick();
// Bodyweight + a custom measurement
w.applyFieldValue("bw-step", "bwWeight", 72.5); await w.saveBodyweight(); await tick();
await w.addMeasureType("מותניים"); await tick();
const mt = (await w.dbLoadMeasureTypes())[0];
w.applyFieldValue("measure-step", mt.id, 81); await w.saveMeasurement(mt.id); await tick();
// A per-day training note, an export marker, a dismissed install banner
await w.saveSessionNote(w.todayISO(), "הרגשתי חזק היום"); await tick();
w.markExported(); w.dismissInstallBanner(); await tick(100);

// ---- dump ----
const db = await new Promise((res, rej) => { const r = w.indexedDB.open("box-log-db"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const stores = {};
for (const name of db.objectStoreNames) {
  stores[name] = await new Promise((res) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); });
}
const keyPaths = {}; for (const name of db.objectStoreNames) keyPaths[name] = db.transaction(name).objectStore(name).keyPath;
const ls = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); ls[k] = w.localStorage.getItem(k); }
console.log(JSON.stringify({ generatedBy: "haimunia-app 2.34.0 (tag rollback-2.34.0) driven in jsdom", appVersion: (await import("node:fs")).readFileSync("app.js","utf8").match(/APP_VERSION = "([^"]+)"/)[1], dbName: db.name, dbVersion: db.version, keyPaths, stores, localStorage: ls }, null, 1));
process.exit(0);
