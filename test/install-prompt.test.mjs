// Coverage gap closed (full-codebase audit): the beforeinstallprompt/
// install-banner flow had zero automated coverage. Chrome/Android fire
// beforeinstallprompt once, early, and expect the page to call
// e.preventDefault() and stash it to replay later via evt.prompt() — this
// drives that whole handshake with a synthetic event carrying a fake
// prompt()/userChoice, the same shape a real browser's event has.
// iOS Safari never fires this event at all — there's nothing to test for
// that path beyond "the banner simply never appears," which is already
// true by construction (showInstallBanner() is never called).
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers/boot.mjs";

function fireBeforeInstallPrompt(window, { promptCalls, outcome = "accepted" } = {}) {
  const evt = new window.Event("beforeinstallprompt", { cancelable: true });
  evt.prompt = () => { if (promptCalls) promptCalls.count++; };
  evt.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(evt);
  return evt;
}

// Design spec §1.2 S6. The handshake below is unchanged, but the browser
// offering an install is no longer sufficient to put the banner on screen:
// the member must also have something saved and have come back on a later
// calendar day. Every handshake test therefore has to stand on the far side
// of that gate, or it would be asserting the handshake against a banner that
// is being withheld for an entirely different and correct reason.
//
// The gate itself is pinned in test/first-run-sequence.test.mjs, which is
// where it belongs — it is a claim about a member's first day, not about
// beforeinstallprompt. What this file pins is that opening the gate is the
// ONLY thing standing in the way, so a future change to the gate cannot
// quietly disable the prompt altogether.
async function openInstallGate(window) {
  await window.addMovement("Install Gate Squat", "Squat");
  window.applyFieldValue("step", "weight", 60);
  window.applyFieldValue("step", "reps", 5);
  window.applyFieldValue("step", "sets", 1);
  await window.saveSet();               // condition: >=1 saved entry
  window.closeCelebration();            // §1.2 S4's arrival card
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await window.dbSetSetting("haimunia:firstOpenDate", yesterday);
  await window.loadFirstOpenDate();     // condition: a later calendar day
}

test("beforeinstallprompt alone does not show the banner — the prompt is held, not obeyed", async () => {
  const window = await bootApp();
  const banner = window.document.getElementById("installBanner");
  assert.notEqual(banner.style.display, "block");

  fireBeforeInstallPrompt(window);
  // Chrome fires this once, early, during the first load. Obeying it there
  // put the largest block in the app on an empty first-run screen, as an
  // advertisement for itself, before the app had done anything for the
  // member. preventDefault() exists precisely so the page can choose when.
  assert.notEqual(banner.style.display, "block",
    "the event must be stashed for later, not turned straight into a banner");
});

test("beforeinstallprompt shows the install banner, deferring the browser's own prompt", async () => {
  const window = await bootApp();
  const banner = window.document.getElementById("installBanner");
  assert.notEqual(banner.style.display, "block", "the banner should be hidden until the event fires");

  await openInstallGate(window);
  assert.notEqual(banner.style.display, "block", "...and until the browser has actually offered an install");

  fireBeforeInstallPrompt(window);
  assert.equal(banner.style.display, "block", "beforeinstallprompt should reveal the install banner");
});

test("tapping install replays the deferred native prompt and hides the banner", async () => {
  const window = await bootApp();
  const promptCalls = { count: 0 };
  await openInstallGate(window);
  fireBeforeInstallPrompt(window, { promptCalls });

  window.document.querySelector("[data-action='install-app']").click();
  await new Promise((r) => setTimeout(r, 0)); // installApp() awaits evt.userChoice

  assert.equal(promptCalls.count, 1, "tapping install should call the deferred event's own prompt()");
  assert.equal(window.document.getElementById("installBanner").style.display, "none", "the banner should hide once install is triggered");
});

test("dismissing the banner hides it, and the refusal outlives the session", async () => {
  const window = await bootApp();
  await openInstallGate(window);
  fireBeforeInstallPrompt(window);
  assert.equal(window.document.getElementById("installBanner").style.display, "block");

  window.document.querySelector("[data-action='dismiss-install-hint']").click();
  assert.equal(window.document.getElementById("installBanner").style.display, "none");

  // Persona finding B10. The dismissal used to be recorded in
  // sessionStorage, so a banner the member had explicitly declined was back
  // on the very next cold open, and every one after that — a "no" the app
  // asked again forever. The gate now reads a durable answer.
  assert.equal(window.sessionStorage.getItem("haimunia:installDismissed"), null,
    "a session-scoped refusal is not a refusal");
  assert.equal(window.localStorage.getItem("haimunia:installDismissed"), "1");
  assert.equal(window.installGateOpen(), false,
    "every later render must keep honouring the refusal, not just this session's");

  // A second beforeinstallprompt-shaped event (unlikely in a real browser,
  // which fires it once, but it exercises the same guard) must not reopen it.
  fireBeforeInstallPrompt(window);
  assert.equal(window.document.getElementById("installBanner").style.display, "none", "a dismissed banner stays dismissed");
});

test("the appinstalled event hides the banner and clears the deferred prompt so a stray tap does nothing", async () => {
  const window = await bootApp();
  const promptCalls = { count: 0 };
  await openInstallGate(window);
  fireBeforeInstallPrompt(window, { promptCalls });
  assert.equal(window.document.getElementById("installBanner").style.display, "block");

  window.dispatchEvent(new window.Event("appinstalled"));
  assert.equal(window.document.getElementById("installBanner").style.display, "none", "appinstalled should hide the banner");

  // installApp() no-ops when there's no deferred prompt left.
  window.document.querySelector("[data-action='install-app']").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(promptCalls.count, 0, "a tap after appinstalled must not replay a stale prompt");
});
