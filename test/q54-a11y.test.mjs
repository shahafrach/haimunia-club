// Q-54 (before launch): accessibility. The Tab trap skips controls inside a closed <details> (its summary stays);
// the page behind any open sheet is inert; the join sheet always has its close button; the update banner is a
// button inside a status region; calendar days have full Hebrew names; the PR flame says "שיא אישי"; a stepper
// change is announced; scroll-padding keeps focused controls clear of the fixed bars.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const $ = (w, s) => w.document.querySelector(s);
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function fresh() {
  const w = await bootApp(); w.saveWelcomeForm("רונית");
  await wait(); // the first-run join sheet opens after the welcome form; close it for a clean page
  if (w.haimuniaConnect) w.haimuniaConnect.close();
  // jsdom has no layout: every element reports no client rects. Give them one so the trap sees the controls.
  w.Element.prototype.getClientRects = function () { return [{}]; };
  return w;
}

test("the Tab trap skips what a closed <details> hides, and includes the <summary> that opens it", async () => {
  const w = await fresh();
  w.openSettings();
  const adv = $(w, "#settingsAdvanced");
  assert.equal(adv.open, false);
  const f = w.appDialogFocusables("settingsOverlay");
  assert.ok(f.includes(adv.querySelector("summary")), "the summary is in the trap");
  assert.ok(!f.some((n) => adv.contains(n) && n.tagName !== "SUMMARY"), "nothing under the closed fold");
});

test("while a sheet is open the page behind it is inert; closing it gives the page back", async () => {
  const w = await fresh();
  w.openSettings();
  await wait();
  assert.ok($(w, "#appShell").hasAttribute("inert"));
  assert.ok($(w, "#bottomNavWrap").hasAttribute("inert"));
  w.closeSettings();
  await wait();
  assert.ok(!$(w, "#appShell").hasAttribute("inert"));
});

test("a confirm dialog rendered inside #appShell stays tappable: its container is not made inert", async () => {
  const w = await fresh();
  w.askAppConfirm({ title: "מחיקת פוסט", message: "הפוסט יימחק לכל המועדון.", confirmLabel: "מחיקה", destructive: true, action: "club-action", payload: null, opener: null });
  await wait();
  const ov = $(w, "#appConfirmOverlay");
  assert.ok(ov && $(w, "#appShell").contains(ov), "the confirm sheet renders inside #appShell");
  assert.ok(!$(w, "#appShell").hasAttribute("inert"), "#appShell holds the open dialog, so it must not be inert");
  assert.ok($(w, "#bottomNavWrap").hasAttribute("inert"), "the bottom bar behind it still is");
});

test("the update banner is a button inside a status region, not a button with role=status", () => {
  assert.match(html, /<div id="updateBannerRegion" role="status" aria-live="polite">\s*<button id="updateBanner" data-action="reload-app" style=/);
  assert.doesNotMatch(html, /<button id="updateBanner"[^>]*role="status"/);
});

test("calendar days have full Hebrew names; the PR flame says שיא אישי", async () => {
  const w = await fresh();
  w.choosePickedMovement("back-squat");
  for (const kg of [60, 60, 60, 80]) { w.applyFieldValue("step", "weight", kg); await w.saveSet(); if ($(w, "#celebrationOverlay").classList.contains("open")) w.closeCelebration(); }
  w.document.getElementById("tabCalendarBtn").click();
  const today = $(w, ".cal-cell.today");
  assert.match(today.getAttribute("aria-label"), /^היום, יום [א-ת]+/);
  assert.match(today.getAttribute("aria-label"), /שיא אישי/);
  assert.ok([...w.document.querySelectorAll("#calDetail .pr-flame .sr-only")].some((n) => n.textContent === "שיא אישי"));
});

test("a −/+ tap is announced with the stepper's own label", async () => {
  const w = await fresh();
  w.choosePickedMovement("back-squat");
  w.render();
  $(w, ".log-controls [data-action='step'][data-field='reps'][data-dir='1']").click();
  assert.match($(w, "#stepperLive").textContent, /^חזרות \d+$/);
  assert.equal($(w, "#stepperLive").getAttribute("aria-live"), "polite");
});

test("the join sheet always shows its close button; scroll-padding clears the fixed bars", async () => {
  const w = await fresh();
  w.haimuniaConnect.open("choice", true);
  assert.equal($(w, "#connectCloseBtn").style.display, "");
  assert.match(html, /html:has\(:focus-visible\)\{ scroll-padding-block-start:calc\(env\(safe-area-inset-top,0px\) \+ 72px\); scroll-padding-block-end:calc\(env\(safe-area-inset-bottom,0px\) \+ var\(--bottom-nav-reserve\)\); \}/);
});
