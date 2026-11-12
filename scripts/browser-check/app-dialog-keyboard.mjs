#!/usr/bin/env node
// The keyboard and focus contract for app.js's own dialogs, asserted
// against the new destructive-confirm sheet.
//
// WHY A BROWSER CHECK AND NOT A NODE TEST. cloud.js's dialogs have this
// contract pinned in test/community-dialog-focus.test.mjs, in jsdom,
// through the real render path. The same test cannot be written for
// app.js's half, and the reason is a single clause:
//
//   appDialogFocusables(): .filter((n) => !n.disabled && n.getClientRects().length > 0)
//
// jsdom has no layout engine, so getClientRects() returns an empty list for
// every element in it — including a plainly visible <button>. Under jsdom
// that filter therefore returns [], focusFirstAppDialogEl() focuses
// nothing, and the Tab handler returns early at `if (!focusables.length)`.
// A node test would be asserting on a trap that is switched off by the
// environment it runs in: it would pass on code that traps nothing, and it
// would keep passing if the trap were deleted. cloud.js's own filter has no
// visibility clause, which is why its version of this test works.
//
// So the only honest place for this contract is a real engine, and that is
// this file. The visibility clause is not a bug — it is what keeps a
// display:none control out of the tab order — it just means the assertions
// have to move.
//
// WHAT IS UNDER TEST. The confirm sheet (8afbc57) is the newest dialog on
// this branch and the one with the most at stake: it stands between an
// unlabelled 23x26px bin icon and the only data in the app that cannot be
// recreated. Two of the checks below are about that specifically — Escape
// and a backdrop click must DISMISS, never delete. A confirmation that
// could be answered "yes" by an accidental keypress would be worse than no
// confirmation at all, because it also teaches people to dismiss without
// reading.
//
// Usage:
//   node app-dialog-keyboard.mjs                 # local working tree
//   TARGET_URL=<url> node app-dialog-keyboard.mjs # a deployed site
import { chromium } from "playwright";
import { resolveTarget } from "./lib/target.mjs";
import { switchTab, dismissWelcomeModal, selectMovement, dismissCelebrationIfOpen, consoleErrorCollector, readAppConfirm } from "./lib/actions.mjs";
import { installMockCloud } from "./lib/mockCloud.mjs";

let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const target = await resolveTarget();
console.log(`Target: ${target.url}${target.local ? " (local static server)" : ""}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = await consoleErrorCollector(page);

await installMockCloud(page);
await page.goto(target.url, { waitUntil: "networkidle" });
await page.waitForSelector("#app", { state: "visible" });
await dismissWelcomeModal(page);

// One logged set is all this needs — the dialog is the subject, not the
// data. Two sets, so a delete that slips through is unmistakable.
await selectMovement(page, "Strict");
for (const w of [60, 65]) {
  await page.fill("[data-field='weight'].stepper-val", String(w));
  await page.dispatchEvent("[data-field='weight'].stepper-val", "change");
  await page.fill("[data-field='reps'].stepper-val", "5");
  await page.dispatchEvent("[data-field='reps'].stepper-val", "change");
  await page.click("[data-action='save-set']");
  await page.waitForTimeout(250);
  await dismissCelebrationIfOpen(page);
}
await switchTab(page, "tabCalendarBtn");
await page.waitForTimeout(250);

const binCount = () => page.locator("#calDetail button[data-action='delete-entry']").count();
const startCount = await binCount();
check("two logged sets are on the calendar day view to work with", startCount === 2, String(startCount));

// The focusable set the trap computes, read the same way it does, so
// "first" and "last" below mean what app.js means by them.
async function dialogFocusables() {
  return page.evaluate(() =>
    Array.from(
      document
        .getElementById("appConfirmOverlay")
        .querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    )
      .filter((n) => !n.disabled && n.getClientRects().length > 0)
      .map((n) => n.dataset.action || n.tagName.toLowerCase()),
  );
}
const activeAction = () => page.evaluate(() => document.activeElement?.dataset?.action || document.activeElement?.tagName?.toLowerCase() || "");

async function openConfirm() {
  await page.locator("#calDetail button[data-action='delete-entry']").last().click();
  await readAppConfirm(page);
}

// ---------- 1. Opens as a dialog, focus moves into it ----------
await openConfirm();
const semantics = await page.evaluate(() => {
  const o = document.getElementById("appConfirmOverlay");
  return {
    role: o.getAttribute("role"),
    modal: o.getAttribute("aria-modal"),
    labelledby: o.getAttribute("aria-labelledby"),
    labelResolves: !!document.getElementById(o.getAttribute("aria-labelledby") || ""),
  };
});
check("it opens as role=dialog aria-modal=true", semantics.role === "dialog" && semantics.modal === "true", JSON.stringify(semantics));
check("and its aria-labelledby actually resolves to a node", semantics.labelResolves, semantics.labelledby || "(none)");

const focusables = await dialogFocusables();
check("the trap sees at least two controls to cycle between", focusables.length >= 2, JSON.stringify(focusables));
check("focus moved to the FIRST control on open, not left on the page behind", (await activeAction()) === focusables[0], `${await activeAction()} vs first=${focusables[0]}`);
// Cancel first, confirm second: the safe answer is the one a blind Enter
// hits and the one a screen reader reaches first.
check("and the first control is the cancel, not the destructive confirm", focusables[0] === "app-confirm-no", focusables[0]);

// ---------- 2. Tab and Shift+Tab are trapped ----------
const last = focusables[focusables.length - 1];
await page.evaluate((sel) => document.querySelector(`#appConfirmOverlay [data-action='${sel}']`).focus(), last);
await page.keyboard.press("Tab");
check("Tab from the last control wraps to the first, it does not escape to the page", (await activeAction()) === focusables[0], await activeAction());

await page.evaluate((sel) => document.querySelector(`#appConfirmOverlay [data-action='${sel}']`).focus(), focusables[0]);
await page.keyboard.press("Shift+Tab");
check("Shift+Tab from the first control wraps to the last", (await activeAction()) === last, await activeAction());

// ---------- 3. Escape dismisses, and dismissing is not deleting ----------
await page.keyboard.press("Escape");
await page.waitForSelector("#appConfirmOverlay", { state: "detached", timeout: 5000 });
check("Escape closes the confirm sheet", true);
check("Escape DISMISSED — it did not answer yes", (await binCount()) === startCount, `${startCount} -> ${await binCount()}`);
// The opener is a bin icon inside #content, which render() rebuilds
// wholesale — app.js re-finds it by its data-action/data-id pair rather
// than holding a node that is stale by the time the dialog closes.
const restored = await page.evaluate(() => {
  const a = document.activeElement;
  return { action: a?.dataset?.action || "", inCalendar: !!document.getElementById("calDetail")?.contains(a) };
});
check("focus returns to the bin icon that opened it, not to <body>", restored.action === "delete-entry" && restored.inCalendar, JSON.stringify(restored));

// ---------- 4. A backdrop click dismisses, and is not deleting either ----------
await openConfirm();
// The overlay's own padding strip, well outside the sheet — the same place
// a thumb lands when someone means "not this".
const box = await page.evaluate(() => {
  const r = document.getElementById("appConfirmOverlay").getBoundingClientRect();
  return { x: Math.round(r.left + 6), y: Math.round(r.top + 6) };
});
await page.mouse.click(box.x, box.y);
await page.waitForSelector("#appConfirmOverlay", { state: "detached", timeout: 5000 });
check("a click on the dim backdrop closes the sheet", true);
check("the backdrop click DISMISSED — it did not answer yes", (await binCount()) === startCount, `${startCount} -> ${await binCount()}`);

// ---------- 5. Only the confirm button deletes ----------
await openConfirm();
await page.click("#appConfirmOverlay [data-action='app-confirm-yes']");
await page.waitForSelector("#appConfirmOverlay", { state: "detached", timeout: 5000 });
check("the confirm button is the only thing that actually deletes", (await binCount()) === startCount - 1, `${startCount} -> ${await binCount()}`);

check("no console errors", errors.length === 0, errors.join(" | "));

await browser.close();
await target.close();
console.log(failed ? "\napp-dialog-keyboard: FAILED" : "\napp-dialog-keyboard: all checks passed");
process.exit(failed ? 1 : 0);
