// Audit 2026-11, phase 3: correctness and UX findings that have a DOM-level
// assertion. Layout and contrast findings (9, 10, 14, 15, 16) are measured in
// Chromium instead - jsdom has no layout - and recorded in the PR.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp, waitFor } from "./helpers/boot.mjs";

const isoToday = (window) => {
  const d = new window.Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("7: the calendar month's set count sums each line's sets instead of counting lines", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const date = isoToday(window);
  await window.dbPut({ id: "s1", exerciseId: "back-squat", date, type: "reps", weight: 60, reps: 5, sets: 3, ts: 1 });
  await window.dbPut({ id: "s2", exerciseId: "deadlift", date, type: "reps", weight: 80, reps: 3, sets: 2, ts: 2 });
  await window.reloadFromDb();
  window.document.getElementById("tabCalendarBtn").click();
  const stats = [...window.document.querySelectorAll(".cal-month-stat")];
  const sets = stats.find((el) => el.querySelector(".cal-month-stat-label").textContent === "סטים");
  assert.ok(sets, "the sets stat is on screen");
  assert.equal(sets.querySelector(".cal-month-stat-value").textContent, "5", "3 + 2 sets, not 2 lines");
});

test("8: backup export and import are full buttons, export first", async () => {
  const window = await bootApp();
  window.openSettings();
  window.render();
  const body = window.document.getElementById("settingsBody");
  const exp = body.querySelector("[data-action='export-data']");
  const imp = body.querySelector("[data-action='import-data']");
  assert.ok(exp.classList.contains("backup-btn-primary"));
  assert.ok(imp.classList.contains("backup-btn-secondary"));
  assert.ok(!exp.classList.contains("link-btn") && !imp.classList.contains("link-btn"));
  assert.ok(exp.compareDocumentPosition(imp) & window.Node.DOCUMENT_POSITION_FOLLOWING, "export comes first");
});

test("11: the version-updates button opens the release notes even when nothing is new", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  // A fresh install has already seen every note.
  window.document.querySelector("[data-action='open-notifications']").click();
  const overlay = window.document.getElementById("notificationsOverlay");
  assert.ok(overlay.classList.contains("open"), "the sheet opens");
  const list = window.document.getElementById("notificationsList").textContent;
  assert.doesNotMatch(list, /אין עדכונים חדשים/);
  assert.match(list, /3\.0\.0/, "older notes are listed");
  assert.doesNotMatch(window.document.body.textContent, /אין התראות חדשות/, "no toast naming a thing the button is not");
});

test("12: the welcome sheet says usage is counted and links to the setting", async () => {
  const window = await bootApp();
  const doc = window.document;
  assert.ok(doc.getElementById("welcomeOverlay").classList.contains("open"));
  const note = doc.getElementById("welcomeUsageNote");
  assert.match(note.textContent, /סופרת שימוש בלי שם ובלי פרטים מהאימונים/);
  note.querySelector("[data-action='open-usage-setting']").click();
  const settings = doc.getElementById("settingsOverlay");
  assert.ok(settings.classList.contains("open"), "settings open over the welcome sheet");
  assert.ok(settings.classList.contains("above-welcome"));
  assert.ok(doc.getElementById("usageSettingsBlock").querySelector("#usageCountingRow"), "the block holds the on/off switch");
  window.closeSettings();
  assert.ok(!settings.classList.contains("above-welcome"));
  assert.ok(doc.getElementById("welcomeOverlay").classList.contains("open"), "the welcome sheet is still there to finish");
});

test("17: Escape closes the optional tour", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.openOnboarding();
  const ov = window.document.getElementById("onboardingOverlay");
  assert.ok(ov.classList.contains("open"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!ov.classList.contains("open"), "Escape closed it");
});

test("17: the welcome sheet still cannot be dismissed with Escape", async () => {
  const window = await bootApp();
  const ov = window.document.getElementById("welcomeOverlay");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(ov.classList.contains("open"));
});

test("20: the header date is rewritten when the app comes back to the foreground", async () => {
  const window = await bootApp();
  const label = window.document.getElementById("dateLabel");
  const fresh = label.textContent;
  assert.ok(fresh.length > 0);
  label.textContent = "אתמול";
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  assert.equal(label.textContent, fresh);
});
