// COMM-358: role="tablist" groups (bottom tab bar, WOD Rx/Scaled-style
// subtabbar, the Community and Manage sub-tab bars) pair role="tab" with
// aria-selected, which sets an assistive-tech user's expectation of
// Arrow/Home/End navigation and a roving tabindex (only the selected tab is
// a Tab stop). Covers the shared handler against the two in-app groups; the
// community and manage sub-tab bars reuse the exact same handler and are
// not re-tested here.
//
// THE COMMUNITY FEED-SCOPE FILTER IS NO LONGER ONE OF THESE GROUPS. It was
// four role="tab" chips on a rail of its own - the third stacked navigation
// layer on the Community tab - and is now a native <select>, which gets
// Arrow/Home/End and a single Tab stop from the platform rather than from
// this handler.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

function arrow(window, el, key) {
  el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

test("roving tabindex: only the selected tab is a Tab stop, on the bottom tab bar and the WOD subtabbar", async () => {
  const window = await bootApp();
  const tabs = () => Array.from(window.document.querySelectorAll("#bottomTabBar .tabbtn"));
  assert.deepEqual(tabs().map((t) => t.getAttribute("tabindex")), tabs().map((t) => (t.classList.contains("active") ? "0" : "-1")));

  window.document.getElementById("tabWodBtn").click();
  const subtabs = () => Array.from(window.document.querySelectorAll(".subtabbar .subtabbtn"));
  assert.deepEqual(subtabs().map((t) => t.getAttribute("tabindex")), subtabs().map((t) => (t.classList.contains("active") ? "0" : "-1")));
});

test("ArrowRight/ArrowLeft move focus and switch the bottom tab bar under RTL (visual right/left, not DOM order)", async () => {
  const window = await bootApp();
  // renderBottomTabBar() fully regenerates #bottomTabBar's markup on every
  // switch (a "full-tree innerHTML rerender", see COMM-366's own framing of
  // this app's pattern) - re-query by id after every action rather than
  // holding a node reference, the same way real code has to.
  assert.equal(window.document.getElementById("tabAddBtn").classList.contains("active"), true, "Add is the default tab");

  // dir="rtl": ArrowLeft moves to the next tab in DOM order (visually left).
  arrow(window, window.document.getElementById("tabAddBtn"), "ArrowLeft");
  const historyBtn = window.document.getElementById("tabHistoryBtn");
  assert.equal(historyBtn.getAttribute("aria-selected"), "true", "ArrowLeft should have switched to the next tab (History)");
  assert.equal(window.document.activeElement, historyBtn, "focus should follow the newly-selected tab");
  assert.equal(window.document.getElementById("tabAddBtn").getAttribute("tabindex"), "-1");
  assert.equal(historyBtn.getAttribute("tabindex"), "0");

  // ArrowRight now goes back (visually right, previous in DOM order).
  arrow(window, historyBtn, "ArrowRight");
  assert.equal(window.document.getElementById("tabAddBtn").getAttribute("aria-selected"), "true", "ArrowRight should move back to Add");
});

test("Home/End jump to the first/last tab of a tablist", async () => {
  const window = await bootApp();
  const addBtn = window.document.getElementById("tabAddBtn");
  arrow(window, addBtn, "End");
  const lastTab = window.document.querySelectorAll("#bottomTabBar .tabbtn")[window.document.querySelectorAll("#bottomTabBar .tabbtn").length - 1];
  assert.equal(lastTab.getAttribute("aria-selected"), "true");
  assert.equal(window.document.activeElement, lastTab);

  arrow(window, lastTab, "Home");
  assert.equal(window.document.getElementById("tabAddBtn").getAttribute("aria-selected"), "true");
});

test("Arrow keys move the WOD subtabbar's selection and focus too, in DOM order (Up/Down are direction-agnostic)", async () => {
  const window = await bootApp();
  window.document.getElementById("tabWodBtn").click();
  const logBtn = window.document.querySelector(".subtabbtn[data-subtab='log']");
  const historyBtn = window.document.querySelector(".subtabbtn[data-subtab='history']");

  arrow(window, logBtn, "ArrowDown");
  assert.equal(historyBtn.getAttribute("aria-selected"), "true");
  assert.equal(window.document.activeElement, historyBtn);
});
