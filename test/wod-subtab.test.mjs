// Bug fix: the WOD tab's רישום/היסטוריה pill buttons live in renderWodTab(),
// which only runs on a full top-level tab switch. switch-wod-subtab's
// handler used to only call renderWodContent() (swaps #wodContent's
// innerHTML), leaving the highlighted pill stuck on whichever subtab was
// active when the WOD tab was first opened — the content switched
// correctly, but the highlight didn't follow. Reported by the user with a
// screenshot: היסטוריה highlighted while the רישום (log) form was showing.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("switching WOD subtabs moves the pill highlight, not just the content", async () => {
  const window = await bootApp();
  window.document.getElementById("tabWodBtn").click();
  // COMM-360: selectedWodId defaults to unset, so the log subtab's own
  // content starts as the pick-a-WOD empty state (no form) - pick a real
  // WOD first so the log-form assertion below (unrelated to this test's
  // own subject, the pill highlight) has something to find.
  window.document.querySelector('[data-action="switch-wod-subtab"][data-subtab="benchmarks"]').click();
  window.document.querySelector('[data-action="select-benchmark"]').click();
  const isActive = (subtab) => window.document.querySelector(`.subtabbtn[data-subtab='${subtab}']`).classList.contains("active");

  assert.equal(isActive("log"), true, "log (רישום) is the default subtab and should start highlighted");
  assert.equal(isActive("history"), false);

  window.document.querySelector(".subtabbtn[data-subtab='history']").click();
  assert.equal(isActive("history"), true, "clicking היסטוריה should highlight it");
  assert.equal(isActive("log"), false, "רישום should no longer be highlighted");
  assert.ok(window.document.getElementById("wodHistoryListArea"), "content underneath should have switched to history too");

  window.document.querySelector(".subtabbtn[data-subtab='log']").click();
  assert.equal(isActive("log"), true, "clicking רישום again should move the highlight back");
  assert.equal(isActive("history"), false);
  assert.ok(window.document.getElementById("wodPartnerTagInput"), "content underneath should have switched back to the log form");
});
