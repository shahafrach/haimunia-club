// Shared page interactions used across check scripts, factored out once
// each pattern proved necessary (mostly: things a naive selector gets wrong
// on this app's specific markup — see the comments on each one).

// Completes the blocking part of the first-run sequence for a fresh browser
// context.
//
// WHAT CHANGED (design spec §1.2). This used to have to clear TWO stacked
// full-screen gates, because saving the welcome form opened the five-screen
// explainer immediately after it. The explainer is no longer a gate - it is
// pulled from a card on the logging screen or from Settings - so on a fresh
// context the welcome sheet is now the only thing this has to get past. The
// onboarding branch below is kept and is still correct: it fires only if
// something did open the overlay, which is now only ever a deliberate tap,
// so this helper stays right for callers that open it themselves.
//
// It does NOT dismiss the first-log arrival card (§1.2 S4) - that appears
// after a save, not at boot. See dismissFirstLogArrival() below.
// THE FLAKINESS THIS FIXES (launch-readiness audit). This used to sample
// `welcomeOverlay.open` ONCE and return early if it was false:
//
//     const open = await page.evaluate(... .contains("open"));
//     if (!open) return;
//
// app.js opens that modal during boot when no local profile exists, and
// `page.goto(..., { waitUntil: "networkidle" })` does not guarantee it has
// opened yet. Lose that race and the helper returns having done nothing,
// the modal opens a moment later ON TOP of the app, and every subsequent
// click in the scenario lands on a full-page overlay instead of the control
// it was aiming at - which surfaces much later as an unrelated
// `waitForSelector` timeout, in whichever scenario happened to lose the
// race. That is the intermittent failure the suite has carried (recorded
// previously as "flaky under CPU contention"); it was a harness race, not
// contention, and not the app.
//
// Now: wait for the modal to actually appear before deciding it is not
// coming, and wait for each overlay to actually close rather than sleeping
// a fixed 150 ms and hoping.
const WELCOME_APPEAR_MS = 4000;

async function overlayOpen(page, id) {
  return page.evaluate((elId) => !!document.getElementById(elId)?.classList.contains("open"), id);
}

export async function dismissWelcomeModal(page, name = "בדיקה") {
  // Bounded wait for the modal to appear. A scenario that legitimately has
  // no welcome modal (a profile already in IndexedDB) simply times out here
  // and continues - that is the "not coming" answer, arrived at by waiting
  // rather than by sampling once.
  try {
    await page.waitForFunction(
      () => !!document.getElementById("welcomeOverlay")?.classList.contains("open"),
      { timeout: WELCOME_APPEAR_MS },
    );
  } catch {
    return;
  }

  await page.fill("#welcomeNameInput", name);
  await page.click("[data-action='save-user-name']");
  // Wait for it to be gone rather than sleeping: a slow render must not
  // leave the overlay swallowing the scenario's next click.
  await page.waitForFunction(
    () => !document.getElementById("welcomeOverlay")?.classList.contains("open"),
    { timeout: 10000 },
  );

  if (await overlayOpen(page, "onboardingOverlay")) {
    await page.click("[data-action='close-onboarding']");
    await page.waitForFunction(
      () => !document.getElementById("onboardingOverlay")?.classList.contains("open"),
      { timeout: 10000 },
    );
  }
}

// Design spec §1.2 S4. A member's FIRST-EVER saved entry - set or WOD - now
// gets one full-screen card, framed as arrival rather than as a record (no
// medal, and deliberately not the words שיא אישי, because with no history
// every set is trivially a personal best and saying so on day one is what
// teaches a member the phrase is noise).
//
// Any scenario that starts from a fresh browser context and saves something
// meets it, whether or not the scenario is about celebrations - it is a
// .modal-overlay and it will intercept the next click, which is exactly how
// it surfaced (as a tab-switch timeout in emom.mjs, nowhere near the save).
// Returns the card's text so a caller can assert on the framing rather than
// only clearing it out of the way.
export async function dismissFirstLogArrival(page, { timeout = 8000 } = {}) {
  try {
    await page.waitForFunction(
      () => document.getElementById("celebrationOverlay")?.classList.contains("open"),
      { timeout },
    );
  } catch {
    return null; // not this scenario's first entry - nothing to clear
  }
  const text = await page.evaluate(() =>
    document.getElementById("celebrationOverlay").innerText.replace(/\s+/g, " ").trim());
  await page.click("#celebrationOverlay button[data-action='close-celebration']");
  await page.waitForFunction(
    () => !document.getElementById("celebrationOverlay")?.classList.contains("open"),
    { timeout: 5000 },
  );
  return text;
}

// Submit a form the way a member does - by clicking its submit button.
//
// THE RACE THIS REPLACES (launch-readiness audit). Several scenarios did:
//
//     await page.locator("#someForm").evaluate((form) => form.requestSubmit());
//
// Playwright resolves that locator to a node, then evaluates against it.
// This app re-renders by replacing #content's innerHTML wholesale, so any
// render landing between those two steps swaps the form for a fresh,
// identical-looking node - and requestSubmit() then fires on a DETACHED
// element, where the event bubbles to nothing and the app's delegated
// submit handler never runs. The scenario sees the form still on screen
// and times out somewhere later, with no error and no clue.
//
// Confirmed by instrumenting the mock client: on a failing run,
// redeem_invite_code was never called at all - the submit simply vanished.
// It reproduced on the FIRST page of a browser (the slowest render, where
// maybeAutoStartBackup()'s message triggers an extra rerender at exactly
// the wrong moment) and against pristine HEAD, so it is the harness racing
// the app, not a regression.
//
// page.click() re-resolves the selector and waits for actionability at
// click time, so it cannot hold a stale node. Prefer this everywhere a
// form is submitted.
export async function submitForm(page, formSelector, { timeout = 15000 } = {}) {
  await page.click(`${formSelector} button[type="submit"]`, { timeout });
}

// Picking a movement by an exact-name query hits the app's own "+ add as
// new" shortcut button, which also carries the movement-btn class and
// sorts first for an exact match — so this always searches by partial name
// and waits for the filtered list before clicking, not `nth=0` blindly.
export async function selectMovement(page, partialQuery) {
  await page.click("[data-action='open-picker']");
  await page.fill("#pickerSearch", partialQuery);
  await page.waitForFunction(
    (q) => {
      const btn = document.querySelector(".modal-list .movement-btn[data-id]");
      return btn && btn.textContent.includes(q);
    },
    partialQuery,
    { timeout: 5000 }
  );
  await page.click(".modal-list .movement-btn[data-id] >> nth=0");
  await page.waitForFunction(() => !document.getElementById("pickerOverlay").classList.contains("open"), { timeout: 5000 });
}

// COMM-360: selectedWodId now defaults to unset (was WOD_LIBRARY[0]/"Fran"),
// so a fresh visit to the WOD tab's log subtab shows a pick-a-WOD empty
// state - anything that needs a real WOD selected (an actual log/save) has
// to pick one first. That empty state has since been rewritten (8afbc57)
// and now carries its own open-wod-picker button and a builder link; this
// helper still goes the long way round, through the benchmarks subtab, the
// way a member picking a named benchmark would, and lands back on the log
// subtab with that WOD selected. benchmarks.mjs is what pins the empty
// state's own copy and its doors out.
export async function selectBenchmarkWod(page, id) {
  await page.click("button.subtabbtn[data-subtab='benchmarks']");
  await page.waitForTimeout(150);
  await page.click(`[data-action='select-benchmark'][data-id='${id}']`);
  await page.waitForTimeout(150);
}

// Destructive actions on the offline half of the app (deleting a logged
// set, deleting a logged WOD) now route through askAppConfirm() rather than
// firing on the click. The trigger is a 23x26px unlabelled bin icon flush
// against an identically sized edit pencil, and a logged set is the only
// data in the app that cannot be recreated - so before this, the least
// guarded action in the product destroyed the least recoverable data, while
// blocking a club member did confirm. That asymmetry was the launch
// blocker; the dialog is the fix, and every check that deletes has to drive
// it rather than route around it.
//
// Returns the dialog's own text so callers can assert it NAMES its subject
// (the second half of the same finding: no confirmation in the app said
// what it was about to delete).
export async function readAppConfirm(page, { timeout = 5000 } = {}) {
  await page.waitForSelector("#appConfirmOverlay", { state: "visible", timeout });
  // askAppConfirm() focuses the first control on a setTimeout(..., 50) after
  // the render, so sampling activeElement the instant the overlay appears
  // races it and reads <body>. Wait for focus to land instead of sampling
  // once - same lesson as dismissWelcomeModal above. A dialog that really
  // never focuses times out here and reports focused:"" for the caller to
  // fail on, rather than hanging the run.
  try {
    await page.waitForFunction(
      () => document.getElementById("appConfirmOverlay")?.contains(document.activeElement),
      { timeout: 2000 },
    );
  } catch { /* fall through: focused reads "" below and the caller fails on it */ }
  return page.evaluate(() => {
    const o = document.getElementById("appConfirmOverlay");
    return {
      title: (o.querySelector("#appConfirmTitle")?.textContent || "").trim(),
      message: (o.textContent || "").replace(/\s+/g, " ").trim(),
      // The confirm button must read as destructive, not as a bare "OK".
      destructive: !!o.querySelector("[data-action='app-confirm-yes'].danger"),
      focused: o.contains(document.activeElement) ? (document.activeElement.dataset.action || "(unnamed)") : "",
    };
  });
}

// accept=true presses the destructive confirm, accept=false presses cancel.
// Waits for the overlay to actually leave the DOM either way: it is a
// full-screen .modal-overlay at z-index 50 and will intercept the caller's
// next click if we return while it is still up.
export async function resolveAppConfirm(page, accept, { timeout = 5000 } = {}) {
  await page.click(`#appConfirmOverlay [data-action='app-confirm-${accept ? "yes" : "no"}']`, { timeout });
  await page.waitForSelector("#appConfirmOverlay", { state: "detached", timeout });
}

// The PR-celebration popup blocks every click behind it until dismissed.
// Returns whether it was actually open, so callers can assert on that too.
export async function dismissCelebrationIfOpen(page) {
  const open = await page.evaluate(() => document.getElementById("celebrationOverlay")?.classList.contains("open"));
  if (open) {
    await page.click("#celebrationOverlay button[data-action='close-celebration']");
    await page.waitForTimeout(150);
  }
  return open;
}

// COMM-327 put the 4 main (offline training-log) tabs into a fixed bottom
// tab bar (#tabAddBtn/#tabHistoryBtn/#tabCalendarBtn/#tabWodBtn, reachable
// directly, no menu) and left Community (#tabCommunityBtn) as the one item
// still inside the hamburger's full-page nav menu. That's since been
// revisited: Community is `main: true` too now (see app.js's getNavItems()
// comment for why - it already has its own on-screen subtabbar, the same
// thing WOD already proved works fine from the bottom bar), so all 5 ids
// are reachable directly. This helper used to branch on which set a given
// id belonged to; now every id takes the same path - close the nav menu
// overlay first if a caller left it open (it would otherwise sit on top
// of, and intercept clicks on, the bottom bar underneath), then click the
// bottom-bar button directly. No id opens the menu to be reached any more.
export async function switchTab(page, tabId) {
  const menuOpen = await page.evaluate(() => document.getElementById("navMenuOverlay")?.classList.contains("open"));
  if (menuOpen) {
    // The explicit close (X) button, not the bare [data-action='close-
    // nav-menu'] selector - that also matches the overlay div itself
    // (backdrop-click-to-close), whose bounding-box center sits under
    // the full-height modal-sheet it contains, which would intercept
    // the click the same way this fix is for.
    await page.click("#navMenuOverlay button[data-action='close-nav-menu']");
    await page.waitForFunction(() => !document.getElementById("navMenuOverlay")?.classList.contains("open"), { timeout: 5000 });
  }
  // Library and staff tools retain their IDs in the secondary navigation.
  // Follow the visible menu route when a destination is not in the four-tab bar.
  if (!await page.locator(`#${tabId}`).isVisible()) {
    await page.click("#navMenuBtn");
    await page.waitForSelector("#navMenuOverlay.open");
  }
  await page.click(`#${tabId}`);
}

// Settings (theme, text scale, backup, delete-all-data) moved off the
// bottom of every tab into their own screen, reached through the nav
// menu. Opens the menu if needed, taps its settings row, and waits for
// the settings overlay to actually be open before returning.
export async function openSettings(page) {
  const menuOpen = await page.evaluate(() => document.getElementById("navMenuOverlay")?.classList.contains("open"));
  if (!menuOpen) await page.click("[data-action='open-nav-menu']");
  // Scoped to the nav-menu overlay specifically: the desktop sidebar (Phase
  // 4) renders its own "open-settings" row from the same markup, always in
  // the DOM (just CSS-hidden below the 900px breakpoint) - a bare
  // [data-action='open-settings'] selector resolves in DOM order and can
  // silently grab that hidden copy instead of the visible mobile one.
  await page.click("#navMenuOverlay [data-action='open-settings']");
  await page.waitForFunction(() => document.getElementById("settingsOverlay")?.classList.contains("open"), { timeout: 5000 });
}

// Clicks the dim backdrop of a modal-overlay - a point genuinely outside
// the .modal-sheet, not the sheet itself - the same click a thumb makes
// when it lands where the sheet obviously is not. Works for any overlay,
// app.js's or cloud.js's, since both share the .modal-overlay/.modal-sheet
// shape and the overlay element itself is what carries the close handler (a
// direct click on it, not on anything it contains).
//
// Clicks just above the sheet's own top edge (derived from the SHEET's
// rect, not the overlay's corner) rather than a fixed corner of the overlay.
// dialog-back-button.mjs found a real, separate bug using a fixed
// top-left-of-overlay point on a scene-page tab (Community):
// `body[data-scene] main{position:relative;z-index:1}` (index.html) puts
// <main> - the ancestor #content and every dialog appended after it live
// inside - into its own stacking context, and that whole context (z-index:1)
// paints BENEATH the persistent header (`body[data-scene]
// .header{position:absolute;z-index:20}`) regardless of the dialog's own
// z-index:50; a plain bottom-left corner has the mirror problem against
// `#bottomNavWrap` (z-index:30, a sibling of #app per app.js's own render()
// comment). The practical effect: on a scene-page tab, the TOP ~64px and
// BOTTOM ~70-90px strips of the full-screen overlay are not real click
// targets - they hit the header/tab bar underneath instead. That is a real,
// reported, NOT-fixed-here bug (see the browser-check report). Deriving the
// point from the sheet's own edge instead of the overlay's corners sidesteps
// both chrome bars for every centered/bottom-anchored dialog this suite
// actually tests, without needing to special-case each call site.
export async function clickOverlayBackdrop(page, overlaySelector) {
  const box = await page.evaluate((sel) => {
    const overlay = document.querySelector(sel);
    const sheet = overlay.querySelector(".modal-sheet");
    const r = (sheet || overlay).getBoundingClientRect();
    const x = Math.round(r.left + 6);
    // 10px above the sheet's own top edge - inside the overlay (which always
    // spans the full viewport, inset:0), outside the sheet, and clear of the
    // header/tab-bar chrome for every sheet this suite opens (none starts
    // within ~70px of the viewport top).
    const y = Math.max(2, Math.round(r.top - 10));
    return { x, y };
  }, overlaySelector);
  await page.mouse.click(box.x, box.y);
}

export async function consoleErrorCollector(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Known, expected, harmless — frame-ancestors can't be set via <meta>,
    // documented inline in index.html's own CSP comment.
    if (msg.text().includes("frame-ancestors")) return;
    errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  return errors;
}

// Opens one of the two management panels and gets through its gate.
//
// Both panels sit behind a login for a SEPARATE management account
// (2026-09-15) - not a re-check of the member who is signed in, who
// deliberately holds no powers at all. So a scenario that wants the roster,
// the moderation queue or the invite form has to supply management
// credentials, exactly as a person would.
//
//   rowId  "tabClubManageBtn" for club work - the roster, invites,
//          moderation, the club's numbers, onboarding content.
//          "tabManageBtn" for app work - bug reports, the audit log, roles,
//          password resets, module toggles.
//
// account/password must belong to a seeded account holding the right role for
// that panel (coach rank or above for the club, admin for the app), or the
// gate refuses it and this throws on the wait below. `account` may be an
// email or a bare username - the gate accepts both, because the head coach
// account has no real mailbox.
export async function openManagementPanel(page, rowId, account, password, { timeout = 8000 } = {}) {
  await switchTab(page, rowId);
  await submitManagementGate(page, account, password, { timeout });
}

// Submits the gate that is ALREADY on screen, without navigating to it.
//
// Split out from openManagementPanel (2026-09-15) because that one reaches the
// panel through switchTab(), which drives the hamburger - and on a desktop
// viewport the hamburger row is not visible at all, the sidebar is. A desktop
// scenario clicks its own sidebar row and then needs only the credentials
// half, so that half has to be callable on its own.
//
// Returns quietly when no gate is present: a caller that is already inside an
// unlocked panel (a previous call in the same scenario, within the window)
// needs no branch of its own.
export async function submitManagementGate(page, account, password, { timeout = 8000 } = {}) {
  const gate = await page.$("#panelUnlock");
  if (!gate) return;
  await page.fill("#panelUnlock input[name=email]", account);
  await page.fill("#panelUnlock input[name=password]", password);
  await page.click("#panelUnlock button[type=submit]");
  await page.waitForFunction(() => !document.getElementById("panelUnlock"), { timeout });
}
