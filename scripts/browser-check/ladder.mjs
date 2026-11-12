#!/usr/bin/env node
// Drives a real 5-round working-up ladder (6/5/4/3/3 reps, different weight
// each) through the actual UI: toggle on, save each round, confirm the PR
// celebration stays suppressed, confirm the calendar day view groups them
// into one card, edit one round in place, delete another, finish the
// ladder without switching tabs first.
//
// Usage:
//   node ladder.mjs                 # local working tree
//   TARGET_URL=<url> node ladder.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, selectMovement, dismissCelebrationIfOpen, consoleErrorCollector, readAppConfirm, resolveAppConfirm } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
const errors = await consoleErrorCollector(page);

// COMM-333: cloud.js boots unconditionally regardless of which tab a
// script visits, and cloud-config.js points at the real, live production
// Supabase project - without this, an offline-only check like this one
// still fires real network calls (session restore, anonymous sign-in via
// the auto-backup bootstrap, etc.) against production in the background,
// which is both a safety risk (see lib/mockCloud.mjs's own comment) and
// the source of intermittent 401/409 console errors this suite saw.
await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

await selectMovement(page, "Strict");
const exerciseName = (await page.textContent(".exercise-select span")).trim();
check("selected the intended exercise", exerciseName === "Strict Press", `got "${exerciseName}"`);

await page.click("[data-action='toggle-ladder-mode']");
await page.waitForFunction(() => document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("סולם פעיל"), { timeout: 5000 });

const rungs = [[60, 6], [70, 5], [80, 4], [85, 3], [90, 3]];
let celebrations = 0;
for (let i = 0; i < rungs.length; i++) {
  const [w, r] = rungs[i];
  const stillOn = await page.evaluate(() => document.querySelector("[data-action='toggle-ladder-mode']").textContent.includes("סולם פעיל"));
  if (!stillOn) { check(`ladder mode still on before rung ${i + 1}`, false); break; }

  await page.fill("[data-field='weight'].stepper-val", String(w));
  await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
  await page.fill("[data-field='reps'].stepper-val", String(r));
  await page.dispatchEvent("[data-field='reps'].stepper-val", "change");
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(300);
  if (await dismissCelebrationIfOpen(page)) celebrations++;
}
check("all 5 rungs saved with ladder mode staying on throughout", !failed);
check("PR celebration stayed suppressed for all 5 rungs", celebrations === 0, `fired ${celebrations}/5`);

await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(200);
const dayRows = await page.evaluate(() =>
  [...document.querySelectorAll("#calDetail .log-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim())
);
check("calendar groups the 5 rounds into one card", dayRows.length === 1 && dayRows[0].includes("5 סטים"), JSON.stringify(dayRows));
check("all 5 weight/rep pairs present in order", dayRows[0]?.includes("6×60") && dayRows[0]?.includes("3×90"));

const editButtons = page.locator("#calDetail button[data-action='edit-entry']");
await editButtons.nth(2).click();
await page.waitForTimeout(150);
await switchTab(page, "tabAddBtn");
await page.waitForTimeout(150);
await page.fill("[data-field='weight'].stepper-val", "82.5");
await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
await page.click("[data-action='save-set']");
await page.waitForTimeout(250);
await dismissCelebrationIfOpen(page);
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(200);
const afterEdit = await page.evaluate(() => document.querySelector("#calDetail .log-row")?.textContent || "");
check("editing one round updates it in place, still grouped", afterEdit.includes("4×82.5") && afterEdit.includes("5 סטים"));

// Deleting a logged round now asks first (8afbc57). Previously the bin
// icon deleted on mousedown with no dialog and no undo, while blocking a
// club member did confirm - the least guarded action in the app destroying
// the only data in it that cannot be recreated. The confirmation is the
// fix, so this drives it rather than routing around it, and covers both
// answers: cancel must destroy nothing, confirm must destroy exactly one.
const rounds = () => page.locator("#calDetail button[data-action='delete-entry']").count();
const delBefore = await rounds();

// --- cancel: the safety property the confirmation exists for ---
await page.locator("#calDetail button[data-action='delete-entry']").last().click();
const dialog = await readAppConfirm(page);
check(
  "deleting a round asks first, and the question names the set it will destroy",
  dialog.title.includes("מחיקת סט") && dialog.message.includes("Strict Press"),
  `${dialog.title} | ${dialog.message.slice(0, 90)}`,
);
check("the confirm button is styled as destructive, not a bare OK", dialog.destructive);
check("focus lands inside the dialog, not behind it", dialog.focused.startsWith("app-confirm"), dialog.focused);
const duringDialog = await rounds();
check("nothing is deleted while the dialog is still open", duringDialog === delBefore, `${duringDialog}`);

await resolveAppConfirm(page, false);
await page.waitForTimeout(200);
const afterCancel = await rounds();
check("cancelling the confirmation deletes nothing", afterCancel === delBefore, `${delBefore} -> ${afterCancel}`);
const undoAfterCancel = await page.locator("#appToastBar").count();
check("a cancelled delete offers no undo, because nothing was undone", undoAfterCancel === 0);

// --- confirm: still removes exactly one, and offers the undo ---
await page.locator("#calDetail button[data-action='delete-entry']").last().click();
await readAppConfirm(page);
await resolveAppConfirm(page, true);
await page.waitForTimeout(200);
const delAfter = await rounds();
check("confirming deletes exactly one round", delBefore === 5 && delAfter === 4, `${delBefore} -> ${delAfter}`);
// A confirmation stops the accident; the undo repairs the confirmed delete
// of the wrong row, which is the one a dialog cannot catch.
const undoOffered = await page.locator("#appToastBar [data-action='toast-action']").count();
check("a confirmed delete offers a short undo", undoOffered === 1);

await switchTab(page, "tabAddBtn");
await page.waitForTimeout(150);
await page.click("[data-action='toggle-ladder-mode']"); // finish, without switching tabs afterward
await page.waitForTimeout(150);
const toggleAfterFinish = (await page.textContent("[data-action='toggle-ladder-mode']")).trim();
check("finishing re-renders immediately (no stale toggle text)", !toggleAfterFinish.includes("סולם פעיל"), toggleAfterFinish);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\nladder: FAILED" : "\nladder: all checks passed");
process.exit(failed ? 1 : 0);
