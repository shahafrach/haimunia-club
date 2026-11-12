// Audit 2026-11, finding 2. Every write in src/db.js resolved on
// tx.oncomplete and rejected on tx.onerror only. A transaction that aborts
// at COMMIT time - QuotaExceededError when the disk fills is the real case -
// fires "abort" on the transaction and never "error", so the save promise
// never settled: no message, no retry, the member believed it was saved.
//
// fake-indexeddb has no quota, so the abort is forced the honest way: the
// put itself succeeds, and only then is the transaction aborted. That is the
// exact shape of a commit-time failure - no request ever errors.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

async function abortAfterEveryPut(window) {
  const db = await window.openDB();
  const proto = Object.getPrototypeOf(db.transaction("entries", "readonly").objectStore("entries"));
  const realPut = proto.put;
  proto.put = function (...args) {
    const req = realPut.apply(this, args);
    const tx = this.transaction;
    req.addEventListener("success", () => { try { tx.abort(); } catch (e) {} });
    return req;
  };
  return () => { proto.put = realPut; };
}

const settles = (p, ms = 1500) => Promise.race([
  p.then(() => "resolved", (e) => ({ rejected: e })),
  new Promise((r) => setTimeout(() => r("hung"), ms)),
]);

test("a write whose transaction aborts at commit rejects instead of hanging", async () => {
  const window = await bootApp();
  const restore = await abortAfterEveryPut(window);
  const out = await settles(window.dbPut({ id: "abort-1", exerciseId: "x", date: "2026-11-01", ts: 1 }));
  restore();
  assert.notEqual(out, "hung", "the promise must settle");
  assert.notEqual(out, "resolved", "an aborted write must not report success");
  assert.ok(out.rejected && out.rejected.name, "it rejects with a named error");
  assert.equal((await window.dbLoadAll()).length, 0, "and nothing was stored");
});

test("every write helper settles on abort, settings and bodyweight included", async () => {
  const window = await bootApp();
  const restore = await abortAfterEveryPut(window);
  const outs = await Promise.all([
    window.dbSetSetting("k", 1),
    window.dbPutBodyweight({ id: "bw-1", date: "2026-11-01", ts: 1, weight: 70 }),
    window.dbPutWodEntry({ id: "w-1", wodId: "fran", date: "2026-11-01", ts: 1 }),
    window.dbPutMeasurement({ id: "m-1", typeId: "t", date: "2026-11-01", ts: 1, value: 1 }),
  ].map((p) => settles(p)));
  for (const out of outs) {
    assert.ok(out && out.rejected, "rejected, not " + JSON.stringify(out));
  }
  restore();
});

test("a set saved into an aborting transaction shows the member a storage error", async () => {
  const window = await bootApp();
  await window.addMovement("Test Squat", "Squat");
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  window.console.error = () => {};
  const restore = await abortAfterEveryPut(window);
  const out = await settles(window.saveSet(), 2500);
  restore();
  assert.notEqual(out, "hung", "saveSet() finishes instead of waiting forever");
  window.openSettings();
  window.render();
  assert.match(window.document.getElementById("settingsBody").innerHTML, /השמירה במכשיר נכשלה/, "the failure is on screen");
});
