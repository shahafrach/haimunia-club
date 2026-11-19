// Q-43d (owner approved 2026-11-18): התקדמות shows one streak card, and מדדי גוף is a closed fold that
// remembers being opened.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("progress: one streak card; the member card and the monthly summary do not repeat it", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.document.getElementById("tabHistoryBtn").click();
  const content = window.document.getElementById("content");
  assert.ok(window.document.getElementById("weeklyStreak"), "the streak card");
  assert.equal((content.textContent.match(/רצף/g) || []).length, (window.document.getElementById("weeklyStreak").textContent.match(/רצף/g) || []).length,
    "every mention of the streak is on its card");
  assert.ok(content.querySelector("#progressWho .who[data-action='open-achievements']"), "medals stay one tap away");
});

test("progress: מדדי גוף is folded, opens on tap, and stays open across a re-render", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  window.document.getElementById("tabHistoryBtn").click();
  const fold = () => window.document.getElementById("measureFold");
  assert.equal(fold().tagName, "DETAILS");
  assert.equal(fold().open, false, "closed by default");
  assert.match(fold().querySelector("summary").textContent, /מדדי גוף/);
  fold().open = true;
  fold().dispatchEvent(new window.Event("toggle"));
  window.render();
  assert.equal(fold().open, true, "remembered");
});
