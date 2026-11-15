// F-010 (WebKit bug 277615). iOS Safari can drop the IndexedDB connection mid-session, and every
// later transaction on the cached connection throws InvalidStateError until a full reload. src/db.js
// now forgets a dead connection, reopens it and retries the write once; only a second failure
// reaches the member, with an instruction to close and reopen the app.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

async function logASet(window, weight) {
  if (!window.__mov) { await window.addMovement("Test Squat", "Squat"); window.__mov = true; }
  window.applyFieldValue("step", "weight", weight);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();
}
const savedWeights = async (window) => (await window.dbLoadAll()).map((e) => e.weight).sort((a, b) => a - b);

test("the connection closes mid-session: the next save reopens it and succeeds", async () => {
  const window = await bootApp();
  await logASet(window, 40);
  assert.deepEqual(await savedWeights(window), [40]);

  // What Safari does under WebKit 277615: the connection the app cached is gone.
  (await window.openDB()).close();

  const errors = [];
  window.console.error = (...a) => errors.push(a.join(" "));
  await logASet(window, 45);
  assert.deepEqual(await savedWeights(window), [40, 45], "the save after the drop is on disk");
  assert.equal(errors.filter((m) => /storage write failed/.test(m)).length, 0, "no storage error was shown");
  window.openSettings(); window.render();
  assert.doesNotMatch(window.document.getElementById("settingsBody").innerHTML, /השמירה במכשיר נכשלה|החיבור לאחסון במכשיר נותק/);
});

test("the browser closes the connection itself (onclose): the next read opens a fresh one", async () => {
  const window = await bootApp();
  await logASet(window, 50);
  const db = await window.openDB();
  db.close();
  if (typeof db.onclose === "function") db.onclose(new window.Event("close"));
  assert.notStrictEqual(await window.openDB(), db, "a fresh connection, not the dead one");
  assert.deepEqual(await savedWeights(window), [50]);
});

test("reopening fails too: the member is told to close and reopen the app", async () => {
  const window = await bootApp();
  await window.addMovement("Test Squat", "Squat"); window.__mov = true;
  const proto = Object.getPrototypeOf(await window.openDB());
  const real = proto.transaction;
  proto.transaction = function () {
    throw new window.DOMException("The database connection is closing.", "InvalidStateError");
  };
  window.console.error = () => {};
  try {
    await assert.doesNotReject(logASet(window, 60));
  } finally {
    proto.transaction = real;
  }
  window.openSettings(); window.render();
  assert.match(window.document.getElementById("settingsBody").innerHTML, /החיבור לאחסון במכשיר נותק\. סגרו את האפליקציה לגמרי ופתחו אותה מחדש/);
});

test("an ordinary failure is not retried and keeps the generic message", async () => {
  const window = await bootApp();
  await window.addMovement("Test Squat", "Squat"); window.__mov = true;
  let calls = 0;
  const proto = Object.getPrototypeOf(await window.openDB());
  const real = proto.transaction;
  proto.transaction = function () { calls++; throw new window.DOMException("nope", "DataError"); };
  window.console.error = () => {};
  try { await logASet(window, 70); } finally { proto.transaction = real; }
  assert.equal(calls, 1, "one attempt only");
  window.openSettings(); window.render();
  assert.match(window.document.getElementById("settingsBody").innerHTML, /השמירה במכשיר נכשלה/);
});
