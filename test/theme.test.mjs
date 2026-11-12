// Coverage gap closed (full-codebase audit): theme switching had zero
// automated coverage, despite text-scale.test.mjs already covering the
// near-identical sibling mechanism (same localStorage-before-first-paint
// pattern, same footer-row re-render on change). The actual visual
// re-theming (CSS custom properties under [data-theme]) can't be verified
// in jsdom — this covers the state machine: persistence, the footer radio
// group, and the "auto" mode's meta[theme-color] sync.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

test("theme defaults to dark, with data-theme=\"dark\" set on first load", async () => {
  const window = await bootApp();
  assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark");
});

test("setThemePref applies the attribute, persists to localStorage, and re-renders the footer row", async () => {
  const window = await bootApp();
  window.setThemePref("light");
  assert.equal(window.document.documentElement.getAttribute("data-theme"), "light");
  assert.equal(window.localStorage.getItem("haimunia:theme"), "light");

  window.setThemePref("dark");
  assert.equal(window.document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(window.localStorage.getItem("haimunia:theme"), "dark");
});

test("\"auto\" mode removes the explicit attribute and follows matchMedia instead", async () => {
  const window = await bootApp();
  window.setThemePref("auto");
  assert.equal(window.document.documentElement.hasAttribute("data-theme"), false, "auto should defer to the OS/browser, not stamp an explicit value");
  assert.equal(window.localStorage.getItem("haimunia:theme"), "auto");
});

test("setThemePref ignores an invalid value instead of applying garbage", async () => {
  const window = await bootApp();
  window.setThemePref("light");
  window.setThemePref("neon"); // not a real option
  assert.equal(window.document.documentElement.getAttribute("data-theme"), "light", "an invalid preference should be a no-op, not overwrite the valid one");
});

test("loadThemePref reads a previously-saved preference back from localStorage", async () => {
  const window = await bootApp();
  window.localStorage.setItem("haimunia:theme", "light");
  window.loadThemePref();
  window.applyThemePref();
  assert.equal(window.document.documentElement.getAttribute("data-theme"), "light");
});

test("the footer's theme row reflects the current selection across all three options", async () => {
  const window = await bootApp();
  window.setThemePref("light");
  const active = window.document.querySelector("[data-action='set-theme'][data-pref='light']");
  assert.equal(active.getAttribute("aria-checked"), "true");
  const inactiveDark = window.document.querySelector("[data-action='set-theme'][data-pref='dark']");
  assert.equal(inactiveDark.getAttribute("aria-checked"), "false");
  const inactiveAuto = window.document.querySelector("[data-action='set-theme'][data-pref='auto']");
  assert.equal(inactiveAuto.getAttribute("aria-checked"), "false");
});

test("theme-color meta tag follows the resolved theme, including in auto mode", async () => {
  const window = await bootApp();
  const meta = () => window.document.querySelector('meta[name="theme-color"]').getAttribute("content");

  window.setThemePref("light");
  assert.equal(meta(), "#F2F5FA");
  window.setThemePref("dark");
  assert.equal(meta(), "#152342");

  // matchMedia is stubbed to matches:false in boot.mjs, so "auto" should
  // resolve the same as an explicit light preference here.
  window.setThemePref("auto");
  assert.equal(meta(), "#F2F5FA");
});
