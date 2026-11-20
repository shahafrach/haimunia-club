// Q-46 (owner, 2026-11-19): the bottom bar is the four screens the tour names, in its words; מועדון is a fifth
// tab only for a connected member. No toggle anywhere (it replaced Q-43b's merged אימון tab).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tourNames = () => {
  const o = html.slice(html.indexOf('id="onboardingOverlay"'), html.indexOf('data-action="close-onboarding"'));
  return [...o.matchAll(/font-weight:700; font-size:(?:14px|var\(--fs-2\));">([^<]+)<\/div>/g)].map((m) => m[1]);
};

test("the bar's tab names are the tour's, in the same order", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const bar = [...window.document.querySelectorAll("#bottomTabBar .tabbtn")].map((b) => b.textContent.trim());
  // Q-62: the tour adds a fifth line for מועדון; the owner's four come first, unchanged.
  assert.deepEqual(tourNames(), ["רישום", "התקדמות", "לוח שנה", "אימונים", "מועדון"]);
  // Q-49: מועדון is a fifth tab for everyone the club can serve (a guest opens the join code there).
  assert.deepEqual(bar.slice(0, 4), tourNames().slice(0, 4));
  assert.ok(bar.length === 4 || (bar.length === 5 && bar[4] === "מועדון"), bar.join("/"));
  assert.equal(window.document.getElementById("pageTitle-calendar"), null);
  window.document.getElementById("tabCalendarBtn").click();
  assert.equal(window.document.getElementById("pageTitle-calendar").textContent, "לוח שנה");
});

test("WOD is its own tab again, and no segmented control sits on a photo", async () => {
  const window = await bootApp();
  window.saveWelcomeForm("רונית");
  const doc = window.document;
  for (const id of ["tabAddBtn", "tabWodBtn"]) {
    doc.getElementById(id).click();
    assert.equal(doc.querySelector(".training-toggle"), null, "no toggle on " + id);
    assert.equal(doc.querySelector(".scene-page > .segmented, .scene-page__intro .segmented"), null);
  }
  assert.ok(doc.getElementById("pageTitle-wod"));
  assert.equal(doc.querySelector("#bottomTabBar .tabbtn.active").id, "tabWodBtn", "אימונים is the lit tab on WOD");
  assert.ok(doc.querySelector("#desktopSidebar [data-tab='wod']"), "and in the desktop sidebar");
});
