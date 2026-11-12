// Audit 2026-11, findings 4 and 6.
//  4. A database that fails to load must never be read as a fresh install:
//     no welcome sheet, no first-run flags written, an error with a retry.
//  6. An exception during boot must replace the loading screen with an error
//     and a reload button instead of leaving it up forever.
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

function failingOpen(window) {
  window.indexedDB.open = () => {
    const req = { result: null, error: null };
    setTimeout(() => {
      req.error = new window.DOMException("simulated open failure", "UnknownError");
      if (typeof req.onerror === "function") req.onerror({ target: req });
    }, 0);
    return req;
  };
}

test("a database that will not open shows the storage error, not the welcome sheet", async () => {
  const window = await bootApp({ beforeScripts: (w) => { failingOpen(w); w.console.error = () => {}; w.console.warn = () => {}; } });
  const doc = window.document;
  const box = doc.getElementById("bootError");
  assert.ok(box, "an error screen is shown");
  assert.equal(box.style.display, "flex");
  assert.equal(box.getAttribute("role"), "alert");
  assert.match(doc.getElementById("bootErrorTitle").textContent, /לא הצלחנו לפתוח את היומן/);
  assert.match(doc.getElementById("bootErrorBody").textContent, /לא נמחקו/, "it tells the member the data is still there");
  assert.ok(doc.getElementById("bootErrorReload"), "with a way to retry");
  assert.ok(!doc.getElementById("welcomeOverlay")?.classList.contains("open"), "no welcome sheet asking for a name");
  assert.notEqual(doc.getElementById("app").style.display, "block", "the app shell is not shown over no data");
});

test("an exception thrown inside init() replaces the loading screen with an error and a reload button", async () => {
  const window = await bootApp({
    beforeScripts: (w) => {
      w.console.error = () => {};
      // init() subscribes to this media query's change event; a list with
      // no addEventListener makes that line throw, mid-boot.
      const real = w.matchMedia;
      w.matchMedia = (q) => (q === "(prefers-color-scheme: dark)" ? { matches: false, media: q } : real(q));
    },
  });
  const doc = window.document;
  const box = doc.getElementById("bootError");
  assert.ok(box && box.style.display === "flex", "the error screen replaced the loading screen");
  assert.equal(doc.getElementById("loading").style.display, "none");
  assert.match(doc.getElementById("bootErrorTitle").textContent, /משהו השתבש/);
  assert.match(doc.getElementById("bootErrorBody").textContent, /שמורים במכשיר/);
  const btn = doc.getElementById("bootErrorReload");
  assert.ok(btn, "a reload button");
  assert.equal(btn.textContent, "לטעון שוב");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(window.location.href, "https://example.test/", "nothing reloads by itself");
});

test("an error after boot finished never tears down a working screen", async () => {
  const window = await bootApp();
  window.showBootError("crash");
  window.dispatchEvent(new window.ErrorEvent("error", { message: "late" }));
  const box = window.document.getElementById("bootError");
  assert.ok(!box || box.style.display !== "flex", "no error screen over a working app");
  assert.equal(window.document.getElementById("app").style.display, "block");
});
