// Coverage gap closed (full-codebase audit): import.test.mjs already drives
// importDataFromFile() directly with synthetic backup files — that's the
// sanitizer/merge logic. What was never exercised is the real UI path: the
// footer's "ייצוא גיבוי"/"ייבוא גיבוי" buttons through the click dispatcher,
// exportData()'s actual Blob/anchor-download plumbing, and triggerImport()'s
// dynamically-created <input type="file">.
//
// triggerImport() creates its file input on the fly and never exposes a
// reference to it, so there's no selector to grab — the standard way to
// still test this without changing app.js is to intercept
// HTMLInputElement.prototype.click(), capture `this` the one time it's a
// file input, then drive it exactly like a real file picker would: set
// .files and fire a change event.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, waitFor } from "./helpers/boot.mjs";
import { readFileSync } from "node:fs";

// Live bug hunt, round 9 (2026-09-11): exportData() is now async
// (buildBackupPayload() reads session notes off IndexedDB before
// downloading), so a bare click no longer completes synchronously. Polling
// for the actual expected outcome is robust to however many ticks that
// chain now takes, the same fix bodyweight-measurements.test.mjs's own
// save-button tests needed for the same underlying reason.
async function pollUntil(checkAsync, timeoutMs = 2000, intervalMs = 5) {
  const start = Date.now();
  for (;;) {
    if (await checkAsync()) return;
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test("clicking ייצוא גיבוי in the footer exports without throwing and records the export time", async () => {
  const window = await bootApp();
  assert.equal(window.document.querySelector("[data-action='export-data']").textContent, "ייצוא גיבוי");

  assert.doesNotThrow(() => window.document.querySelector("[data-action='export-data']").click());

  await pollUntil(async () => {
    const stored = await window.dbGetSetting("boxlog:lastExportAt");
    return typeof stored === "number" && stored > 0;
  });
  const stored = await window.dbGetSetting("boxlog:lastExportAt");
  assert.ok(typeof stored === "number" && stored > 0, "exporting should record when the last export happened");
});

test("clicking ייבוא גיבוי opens a real file picker, and selecting a backup file imports it", async () => {
  const window = await bootApp();

  let capturedInput = null;
  const origClick = window.HTMLInputElement.prototype.click;
  window.HTMLInputElement.prototype.click = function () {
    if (this.type === "file") { capturedInput = this; return; }
    return origClick.call(this);
  };
  try {
    window.document.querySelector("[data-action='import-data']").click();
    assert.ok(capturedInput, "the import button should create and click a real file input");
    assert.ok(capturedInput.accept.includes("json"), "the file input should be scoped to JSON backups");

    const payload = JSON.stringify({
      app: "box-log", version: 1, exportedAt: new Date().toISOString(),
      customMovements: [{ id: "ui-import-m1", name: "UI Imported Curl", category: "Pull" }],
      entries: [], customWods: [], wodEntries: [], bodyweightEntries: [], measureTypes: [], measureEntries: [],
    });
    const file = { size: payload.length, text: async () => payload };
    Object.defineProperty(capturedInput, "files", { value: [file], configurable: true });
    capturedInput.dispatchEvent(new window.Event("change"));
    await new Promise((r) => setTimeout(r, 0)); // importDataFromFile() is async

    const movements = await window.dbLoadMovements();
    assert.ok(movements.some((m) => m.id === "ui-import-m1"), "picking a file through the real input should import it, end to end");
  } finally {
    window.HTMLInputElement.prototype.click = origClick;
  }
});

test("the footer's no-backup-yet warning clears once a real export happens", async () => {
  const window = await bootApp();
  // The warning only shows once there's actually something worth backing
  // up — log a set first so hasData is true.
  await window.addMovement("Test Export Reminder Squat", "Squat");
  window.applyFieldValue("step", "weight", 40);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();

  assert.ok(window.document.body.textContent.includes("עדיין לא ביצעתם גיבוי"), "with real data and no export yet, the reminder should show");

  window.document.querySelector("[data-action='export-data']").click();
  await pollUntil(async () => {
    const stored = await window.dbGetSetting("boxlog:lastExportAt");
    return typeof stored === "number" && stored > 0;
  });
  window.render();

  assert.ok(!window.document.body.textContent.includes("עדיין לא ביצעתם גיבוי"), "exporting should clear the no-backup-yet reminder");
});

// N9 / SEC-L8. The export note already said the file is plain JSON and to keep
// it somewhere safe. What it did not say is where the file actually goes and
// who else can reach it: a browser download lands in the device's Downloads
// folder and stays there, so on a shared phone - the case this warning exists
// for - anyone who uses the device afterwards can open a full training log,
// bodyweight and measurements. "Keep it somewhere safe" is advice about where
// to PUT it; this is about where it already is.
test("N9: the export note warns about a shared device and says to clear the download", () => {
  const appJs = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const note = /קובץ הגיבוי הוא טקסט פשוט \(JSON\)[^<]*/.exec(appJs);
  assert.ok(note, "the export note is still rendered next to the button");
  const text = note[0];
  assert.match(text, /תיקיית ההורדות/, "it says where the file lands");
  assert.match(text, /במכשיר משותף/, "it names the shared-device case explicitly");
  assert.match(text, /מחקו אותו מההורדות/, "and tells the member what to do about it");
  // The existing facts must survive: this is an addition, not a rewrite.
  assert.match(text, /טקסט פשוט \(JSON\)/, "still says the file is plain text");
  assert.match(text, /בלי השם שלכם/, "still says the name is not in it");
});
