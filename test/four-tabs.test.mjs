// Q-43b (owner approved 2026-11-18): four tabs. אימון holds the lift screen and the WOD screen behind one toggle;
// יומן is the calendar (lifts and WODs together). #tabWodBtn and data-tab="wod" links keep working.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

const barLabels = (doc) => [...doc.querySelectorAll("#bottomTabBar .tabbtn")].map((b) => b.textContent.trim());

test("the bottom bar: אימון, התקדמות, יומן (מועדון only when connected); no WOD tab", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  assert.deepEqual(barLabels(window.document), ["אימון", "התקדמות", "יומן"]);
  assert.equal(window.document.querySelector("#bottomTabBar [data-tab='wod']"), null);
  assert.equal(window.document.querySelector("#desktopSidebar [data-tab='wod']"), null, "nor in the desktop sidebar");
});

test("the toggle switches lift and WOD, and אימון stays lit for both", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const doc = window.document;
  const pressed = () => doc.querySelector("#content .training-toggle [aria-pressed='true']").dataset.tab;
  assert.equal(pressed(), "add");
  doc.querySelector("#content .training-toggle [data-tab='wod']").click();
  assert.ok(doc.getElementById("pageTitle-wod"), "the WOD screen");
  assert.equal(pressed(), "wod");
  const active = doc.querySelector("#bottomTabBar .tabbtn.active");
  assert.equal(active.id, "tabAddBtn", "אימון is the active tab on WOD");
  assert.equal(active.getAttribute("aria-selected"), "true");
  assert.equal(doc.getElementById("content").getAttribute("aria-labelledby"), "tabAddBtn");
  doc.querySelector("#content .training-toggle [data-tab='add']").click();
  assert.ok(doc.getElementById("pageTitle-add"));
});

test("old ways in: #tabWodBtn and any data-tab='wod' link still open WOD; יומן shows WODs", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const doc = window.document;
  doc.getElementById("tabHistoryBtn").click();
  doc.getElementById("tabWodBtn").click();
  assert.ok(doc.getElementById("pageTitle-wod"));
  doc.getElementById("tabCalendarBtn").click();
  const b = doc.createElement("button");
  b.dataset.action = "switch-tab"; b.dataset.tab = "wod";
  doc.body.appendChild(b); b.click();
  assert.ok(doc.getElementById("pageTitle-wod"));
  assert.equal(doc.getElementById("tabCalendarBtn").textContent.trim(), "יומן");
});
