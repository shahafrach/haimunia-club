// UX finding, deferred from the earlier audit-fixes batch: the WOD log
// form's Save button was an inline button at the end of scrolling
// content, unlike the main Log tab, which has always had a fixed
// bottom-bar Save button reachable without scrolling. Reused the same
// #bottomBar element for both instead of adding a second one - it now
// switches its action/label based on which tab (and, for WOD, whether a
// WOD is actually selected) is active.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("the fixed bottom bar shows the Log tab's save-set action once a movement is chosen, hidden until then (COMM-360)", async () => {
  const window = await bootApp();
  // COMM-360: nothing is pre-selected on a fresh load, so the save action
  // has nothing to name yet - was previously "by default" here, back when
  // selectedId defaulted to a real movement (Back Squat).
  assert.equal(window.document.getElementById("bottomBar").style.display, "none");
  window.document.querySelector('[data-action="open-picker"]').click();
  window.document.querySelector('[data-action="pick-movement"]').click();
  const btn = window.document.getElementById("bottomBarBtn");
  assert.equal(btn.dataset.action, "save-set");
  assert.equal(window.document.getElementById("bottomBar").style.display, "flex");
});

test("switching to the WOD tab with a WOD selected pins the save-wod action to the same bottom bar", async () => {
  const window = await bootApp();
  window.document.getElementById("tabWodBtn").click();
  window.document.querySelector('[data-action="switch-wod-subtab"][data-subtab="benchmarks"]').click();
  window.document.querySelector('[data-action="select-benchmark"]').click();
  const btn = window.document.getElementById("bottomBarBtn");
  assert.equal(btn.dataset.action, "save-wod");
  assert.equal(window.document.getElementById("bottomBar").style.display, "flex");
  assert.match(window.document.getElementById("saveBtnLabel").textContent, /^רישום אימון — /);
  // No inline save button duplicated inside the scrolling content itself.
  assert.equal(window.document.querySelector("#wodContent [data-action='save-wod']"), null);
});

test("the bottom bar hides again on the WOD tab once no WOD is selected (history/benchmarks sub-tabs)", async () => {
  const window = await bootApp();
  window.document.getElementById("tabWodBtn").click();
  window.document.querySelector('[data-action="switch-wod-subtab"][data-subtab="benchmarks"]').click();
  window.document.querySelector('[data-action="select-benchmark"]').click();
  window.document.querySelector('[data-action="switch-wod-subtab"][data-subtab="history"]').click();
  assert.equal(window.document.getElementById("bottomBar").style.display, "none");
});
