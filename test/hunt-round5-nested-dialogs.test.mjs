// Live bug hunt, fresh round 5 (2026-09-15) — a dialog opened from inside
// another dialog, in app.js.
//
// Round 4 found this shape in the community layer: a nested close that only
// handled the "everything is closed now" case, so focus went to the wrong
// place. That fix was scoped to CLOUD_DIALOGS and focus. Round 5 found the
// same shape twice more in the app layer, in two DIFFERENT shared resources -
// paint order and the background scroll lock - neither of which was revisited
// when the focus one was fixed.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const appJs = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the confirm sheet paints above every other overlay, not merely inside one", () => {
  // renderAppConfirmSheet() injects into #content, which is inside #app, while
  // every other overlay is declared AFTER #app closes. At a shared z-index:50,
  // DOM order decides - so the nested one lost the tie to every later sibling
  // and was visible but not clickable: elementFromPoint at its own button
  // resolved to a WOD row behind it.
  const appAt = indexHtml.indexOf('<div id="app"');
  const firstOverlayAt = indexHtml.indexOf('class="modal-overlay" id="');
  assert.ok(appAt > -1 && firstOverlayAt > appAt,
    "the premise still holds: the standalone overlays come after #app in the document");

  const at = indexHtml.indexOf("#appConfirmOverlay{");
  assert.ok(at > -1, "the confirm sheet has its own stacking rule");
  const rule = indexHtml.slice(at, indexHtml.indexOf("}", at));
  assert.match(rule, /z-index:55/, "above the z-index:50 every .modal-overlay shares");

  // Still below page-level chrome, which is not a dialog and should not be
  // buried by a confirm.
  assert.match(indexHtml, /id="updateBanner"[^>]*z-index:60/, "the update banner stays above it");
});

test("closing a nested dialog does not unlock the page its parent still covers", () => {
  // Support opens from a row INSIDE the still-open Settings sheet. Clearing
  // body.style.overflow unconditionally on close let the background scroll
  // behind a sheet that was still on screen.
  const at = appJs.indexOf("function releaseScrollLockIfLastDialog()");
  assert.ok(at > -1, "the release is conditional now");
  const body = appJs.slice(at, appJs.indexOf("\n}", at));
  assert.match(body, /if \(currentAppDialog\(\)\) return;/,
    "anything still open keeps the lock");
  assert.match(body, /document\.body\.style\.overflow = "";/, "otherwise it is released");
});

test("every nested-close path asks, rather than clearing the lock outright", () => {
  for (const fn of ["closeSupport", "closeAppConfirm", "runAppConfirm"]) {
    const at = appJs.indexOf(`function ${fn}(`);
    assert.ok(at > -1, `${fn} exists`);
    const body = appJs.slice(at, appJs.indexOf("\n}", at));
    assert.match(body, /releaseScrollLockIfLastDialog\(\);/, `${fn} must ask before unlocking`);
    assert.ok(!/document\.body\.style\.overflow = "";/.test(body),
      `${fn} must not clear the lock unconditionally`);
  }
});

test("the release is asked AFTER the closing dialog stops counting as open", () => {
  // Order matters: ask too early and the dialog being closed is still open, so
  // the lock is never released at all - trading a scroll bug for a stuck page.
  const at = appJs.indexOf("function closeSupport(");
  const body = appJs.slice(at, appJs.indexOf("\n}", at));
  const removeAt = body.indexOf('classList.remove("open")');
  const askAt = body.indexOf("releaseScrollLockIfLastDialog()");
  assert.ok(removeAt > -1 && askAt > removeAt,
    "the overlay is closed first, then the question is asked");

  const cac = appJs.slice(appJs.indexOf("function closeAppConfirm("), appJs.indexOf("function runAppConfirm("));
  assert.ok(cac.indexOf("appConfirmDialog = null;") < cac.indexOf("releaseScrollLockIfLastDialog()"),
    "same ordering for the confirm sheet");
});
