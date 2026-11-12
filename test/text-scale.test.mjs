// Accessibility: users can bump the whole app's text size up (רגיל / גדול),
// for members who can't read the smaller labels. A third, larger step
// (xlarge) shipped initially and was removed after direct feedback that it
// was too big — loadTextScalePref()'s validation naturally treats any
// leftover "xlarge" value in someone's localStorage as invalid and falls
// back to normal, so no migration code was needed for that.
// Same mechanism as the existing theme preference — localStorage (not
// IndexedDB) so theme-init.js can apply it synchronously before first
// paint, no flash of the default size. The actual visual scaling (CSS zoom
// on <html>, and that it doesn't break position:fixed modals) can't be
// verified in jsdom — see scripts/browser-check/text-scale.mjs for that half.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("text scale defaults to normal, with no data-text-scale attribute", async () => {
  const window = await bootApp();
  assert.equal(window.document.documentElement.hasAttribute("data-text-scale"), false);
});

test("setTextScalePref applies the attribute, persists to localStorage, and re-renders the footer row", async () => {
  const window = await bootApp();
  window.setTextScalePref("large");
  assert.equal(window.document.documentElement.getAttribute("data-text-scale"), "large");
  assert.equal(window.localStorage.getItem("haimunia:textScale"), "large");

  window.setTextScalePref("normal");
  assert.equal(window.document.documentElement.hasAttribute("data-text-scale"), false, "normal should remove the attribute, not set it to a no-op value");
});

test("setTextScalePref ignores an invalid value instead of applying garbage", async () => {
  const window = await bootApp();
  window.setTextScalePref("large");
  window.setTextScalePref("huge"); // not a real option
  assert.equal(window.document.documentElement.getAttribute("data-text-scale"), "large", "an invalid preference should be a no-op, not overwrite the valid one");
});

test("a leftover \"xlarge\" value from before it was removed falls back to normal, not crash or apply garbage", async () => {
  const window = await bootApp();
  window.localStorage.setItem("haimunia:textScale", "xlarge");
  window.loadTextScalePref();
  window.applyTextScalePref();
  assert.equal(window.document.documentElement.hasAttribute("data-text-scale"), false, "an unrecognized stored value should resolve to normal");
});

test("loadTextScalePref reads a previously-saved preference back from localStorage", async () => {
  const window = await bootApp();
  window.localStorage.setItem("haimunia:textScale", "large");
  window.loadTextScalePref();
  window.applyTextScalePref();
  assert.equal(window.document.documentElement.getAttribute("data-text-scale"), "large");
});

test("the footer's text-scale row reflects the current selection, and only offers רגיל/גדול", async () => {
  const window = await bootApp();
  assert.equal(window.document.querySelector("[data-action='set-text-scale'][data-pref='xlarge']"), null, "the removed xlarge option should not be offered in the UI");

  window.setTextScalePref("large");
  const active = window.document.querySelector("[data-action='set-text-scale'][data-pref='large']");
  assert.equal(active.getAttribute("aria-checked"), "true");
  const inactive = window.document.querySelector("[data-action='set-text-scale'][data-pref='normal']");
  assert.equal(inactive.getAttribute("aria-checked"), "false");
});
