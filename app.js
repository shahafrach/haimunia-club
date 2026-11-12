// ---------- Suppress accidental double-tap zoom ----------
// Deliberate pinch-zoom is left working: blocking it (the previous
// touchmove/gesturestart handlers plus user-scalable=no) is a WCAG 1.4.4
// failure and makes the app unusable for low-vision users. Only the
// double-tap-to-zoom gesture is suppressed, since it fires by accident when
// tapping the +/- steppers quickly.
let lastTouchEndTime = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEndTime <= 300) e.preventDefault();
  lastTouchEndTime = now;
}, false);

let barWeight = 20;
// Single source of truth for the app version. After bumping this, run
// `npm run sync-version` to copy it into SW_VERSION in sw.js — `npm test`
// fails if the two drift apart.
const APP_VERSION = "3.1.1";

// A movement typed into the WOD builder that isn't in the built-in list
// above - persisted (see WODTAGSTORE), same "custom X" pattern as
// customMovements/customWods, unlike the in-memory-only version this
// used to be.
let customWodMovementTags = [];
function allWodMovementTags() { return WOD_MOVEMENT_TAGS.concat(customWodMovementTags); }

function calcPlates(total) {
  let perSide = Math.max(0, (total - barWeight) / 2);
  const out = [];
  for (const p of PLATE_DEFS) {
    while (perSide + 1e-9 >= p.kg) { out.push(p); perSide -= p.kg; }
  }
  return out;
}


// Defined below (see FIELD_ACTIONS, near getFieldValue/setFieldState/
// applyFieldValue) - declared here only so it's callable this early in
// the file; a function declaration's body doesn't run until it's
// actually called, well after the whole script (including
// FIELD_ACTIONS) has executed, so the forward reference is safe.
function fieldMax(action, field) {
  const cfg = FIELD_ACTIONS[action];
  if (cfg) return cfg.max(field);
  return Object.prototype.hasOwnProperty.call(FIELD_MAX, field) ? FIELD_MAX[field] : LIMITS.weight;
}
let customMovements = [];
function allMovements() { return MOVEMENTS.concat(customMovements); }
function movementById(id) { return allMovements().find((m) => m.id === id); }
// Defaults to true (custom movements and most of MOVEMENTS are barbell
// lifts) - only entries explicitly marked barbell:false (weighted
// bodyweight accessories, dumbbell/machine/cable movements) are exempt.
// Without this, the weight stepper's floor was tied to barWeight (the
// empty-bar weight) for every movement in "reps" mode, silently clamping
// a real light added-weight input up to 8/15/20kg for things like
// weighted pull-ups - the wrong number then landing in PR history.
function isBarbellMovement(id) {
  const m = movementById(id);
  return !!m && m.barbell !== false;
}

// ---------- Bidi isolation ----------
// A BINDING, not a definition. bidiText/bidiHtml live in
// src/shared/safe-helpers.js, and its header carries the whole rationale:
// what the two halves of the defect are, where the run boundaries fall, why
// the run-level isolation is gated on a line resolving RTL, and the rules
// about where these may and may not be used (never in an attribute, inside
// <textarea>, inside <option>, or inside SVG <text> - those keep bare esc();
// .mono runs keep bare esc() too).
//
// It was promoted there the moment the run-level half landed. Two copies of a
// one-line <bdi> wrapper were a manageable duplication; two copies of a
// run-detection algorithm are not, and the drift failure mode is silent - one
// copy quietly stops isolating and nobody sees a broken string, only a
// plausible wrong workout.
//
// SAFE is src/constants.js's `const SAFE = window.BoxLogSafe`, and
// src/constants.js loads immediately before this file (index.html:1592-1596).
var bidiText = SAFE.bidiText;
// The measurement-shaped sibling: a number, its Hebrew unit and whatever
// multiplies them, with the base direction STATED as RTL instead of inferred
// from the first strong character. Bound here, not re-declared, for exactly
// the reason the paragraph above gives for bidiText. Every `.mono` readout in
// this file goes through it - that class declares `direction:ltr` in
// index.html, which is right for a bare number and wrong the moment a Hebrew
// unit joins it. See the "CONTAINER level" section in safe-helpers.js.
// Two statements, not one `var a = …, b = …`: test/community-module-split.js
// scans for top-level declarations one per line and would only ever see the
// first name on a comma list - i.e. the second binding would silently miss
// the cross-file redeclaration check that exists precisely for these.
var bidiUnit = SAFE.bidiUnit;
var bidiUnitHtml = SAFE.bidiUnitHtml;
// ---------- State ----------
let entries = [];
// The training-log edition has exactly these four screens. A ?tab= link
// written for the community edition (community, manage, staffhome) is not
// one of them and lands on the log.
const VALID_TABS = ["add", "history", "calendar", "wod"];
const urlTab = new URLSearchParams(location.search).get("tab");
let tab = VALID_TABS.includes(urlTab) ? urlTab : "add";

// Single source of truth for the app's primary navigation, consumed by
// renderNavMenuList() below (the mobile nav-menu overlay) and, later, a
// desktop sidebar - nothing about which tabs exist or what they're called
// is hardcoded a second time anywhere else. A function, not a top-level
// const array, for the same reason fieldMax() below is one: it references
// ICONS, which isn't defined until much later in this file - a function
// body doesn't run until called, well after the whole script has loaded,
// so the forward reference is safe the same way fieldMax's is.
// COMM-327 originally kept `main: true` to the 4 offline training-log tabs
// only, leaving Community as the hamburger-only 5th item - reasoned as
// "Community needs a full-page sub-nav of its own once signed in, not a
// single tap target." Revisited: that reasoning doesn't actually hold once
// you notice the WOD tab already carries its own sub-nav (Log/History/
// Benchmarks) while living in the bottom bar - "has sub-screens" was never
// really disqualifying. Community is now `main: true` too, exactly the
// same footing as WOD: one tap from anywhere, its own on-screen subtabbar
// (cloud.js's `.subtabbar`, `setCommunityTab`) handles Feed/Boards/Coach/
// Account navigation once you're on the tab, same as WOD's own subtabbar
// handles Log/History/Benchmarks. `.tabbtn{flex:1}` (index.html) has no
// hardcoded child count, so a 5th icon costs each ~20% width, nothing more.
// The mobile hamburger's Community row and its `.subnav` preview
// (renderNavRows' onlyOther branch below) naturally stop appearing there
// once this flips - onlyOther now returns nothing to show, and the on-
// screen subtabbar is real Community navigation now, not a fallback for a
// preview that's gone. The desktop sidebar (onlyOther=false) is unaffected,
// since it already showed every item including the preview regardless.
// Immersive club redesign (2026-09-08 handoff, IMPLEMENTATION_SPEC.md §3).
// One source of truth for which real `tab` value gets the full-bleed scene
// treatment and which photo/sheet-tone it takes - render() reads this to
// stamp #app[data-scene], and every scene modifier class + photo URL lives
// only in CSS (index.html), never here, so this object never grows past a
// lookup table. Keyed by this app's REAL tab ids (confirmed against
// getNavItems() below), not the spec sample's illustrative names:
// "calendar" is the reference's "History" screen (month grid + day list),
// "history" is the reference's "Progress" screen (already labelled
// "התקדמות" and already the PR/chart tab) - see CHANGES.md for the mapping
// reasoning. "wod" (Library) and Settings are intentionally absent: Library
// gets its own scene once implemented, Settings stays a solid surface per
// IMPLEMENTATION_SPEC.md §8's own instruction not to immerse it.
// ONLY list a tab here once its render function actually returns the
// .scene-page/.scene-sheet markup. body[data-scene]'s CSS (header goes
// transparent/absolute, brand-stripe hides, bottom bar goes dark) applies
// unconditionally the moment a tab's key is a member of this object -
// registering a tab before its content is restructured breaks that tab's
// EXISTING layout instead of leaving it untouched (found live: registering
// "community" here before Community had scene markup floated its header
// over ordinary dialog content and blocked a real button underneath it -
// community-recap-classmates.mjs's browser-check scenario caught this
// exact failure). Add tabs here in the same commit as their render-function
// restructure, never ahead of it.
const PAGE_SCENES = Object.freeze({
  add: { className: "scene-page--add" },
  calendar: { className: "scene-page--history" },
  history: { className: "scene-page--progress" },
  wod: { className: "scene-page--library" },
});
// A plain top-level `const` does NOT become a window property the way a
// `var`/function declaration does - cloud.js (its own IIFE) reaches this
// through window, per its own established convention for every other
// cross-file reference, so it has to be assigned explicitly.
window.PAGE_SCENES = PAGE_SCENES;
function getNavItems() {
  // `group` is read by ONE surface: the desktop staff sidebar, which shows
  // these same destinations under three headings instead of as one list of
  // eight. Additive on purpose - the bottom bar and the hamburger never look
  // at it, so grouping the registry cannot change either of them. One
  // registry, three renderings.
  const items = [
    { id: "add", tab: "add", rowId: "tabAddBtn", label: "רישום", tint: "energy", icon: ICONS.logIcon, main: true, group: "mine" },
    { id: "history", tab: "history", rowId: "tabHistoryBtn", label: "התקדמות", tint: "blue", icon: ICONS.chartIcon, main: true, group: "mine" },
    { id: "calendar", tab: "calendar", rowId: "tabCalendarBtn", label: "לוח שנה", tint: "yellow", icon: ICONS.calendarIcon, main: true, group: "mine" },
    { id: "wod", tab: "wod", rowId: "tabWodBtn", label: "אימונים", tint: "purple", icon: ICONS.stopwatchIcon, main: true, group: "mine" },
  ];
  return items;
}
// The fixed bottom tab bar (#bottomTabBar, index.html) - one tap to any of
// the 5 main tabs. Bare icon + label, matching Noam's .tabbtn treatment,
// not the icon-chip/list-row look renderNavRows below uses for the
// hamburger menu and desktop sidebar. Regenerated on every render() call,
// same "always regenerated, just glued into a fixed container" treatment
// renderNavMenuList/renderSettingsBody already rely on.
function renderBottomTabBar() {
  return getNavItems().filter((item) => item.main).map((item) => {
    const isActive = tab === item.tab;
    return `
      <button class="tabbtn${isActive ? " active" : ""}" id="${item.rowId}" data-action="switch-tab" data-tab="${item.tab}" role="tab" aria-selected="${isActive}" aria-controls="content" tabindex="${isActive ? "0" : "-1"}"${item.badge ? ` aria-label="${esc(item.label)}, ${item.badge} דיווחים ממתינים"` : ""}>
        <span style="position:relative;display:inline-flex;">${item.icon}${item.badge ? `<span class="tab-badge" aria-hidden="true" style="position:absolute;top:-4px;left:-8px;margin:0;min-width:14px;height:14px;font-size:9px;">${item.badge}</span>` : ""}</span>
        <span>${esc(item.label)}</span>
      </button>`;
  }).join("");
}
// Renders the nav menu's user-info card + the 5 primary rows (+ Community's
// own sub-tab preview, when signed in). Called unconditionally from
// render() on every render, the same "always regenerated, just glued into
// a normally-hidden container" treatment renderSettingsBody() already relies on
// - so the tabAddBtn/tabHistoryBtn/etc. ids these rows carry stay resolvable
// at all times, exactly like the old static tabbar's buttons always were.
function renderNavWho() {
  const initial = userName ? userName.trim().charAt(0) : "";
  const streak = computeCurrentStreak();
  // data-action="open-achievements" added here (2026-09-08, immersive
  // redesign): the ONLY two existing triggers for this
  // (#userGreeting/the "לכל המדליות..." link) both live inside the main
  // .header's second child, which the new scene-header grid hides
  // entirely on scene pages (Add/History/Progress/WOD/Community) to stop
  // it colliding with the new menu/logo/bell row - found live, not
  // assumed, when a browser-check script clicking #userGreeting timed out
  // with "element is not visible". Both original ids/triggers are left
  // exactly as they were (present, just hidden on scene pages, same as
  // every other "moved to secondary" control this pass) - this is an
  // ADDED always-available route to the same real action, reachable from
  // the nav menu on every screen regardless of scene state, not a
  // replacement for them.
  // <button>, not a div with role="button": this app's global button reset
  // (index.html: background/border/padding:none, color:inherit) already
  // makes a real <button> visually identical to the plain div .who used to
  // be, and gets Enter/Space activation for free - a div needs its own
  // keydown handler to be keyboard-operable, which "preserve keyboard
  // behavior" means doing correctly, not adding a second bespoke handler
  // for one control when the native element already does it.
  // Real-user report: the only visible content on this card was the
  // member's own avatar/name/streak - nothing on it looks like a button
  // that leads anywhere, let alone to medals specifically, so the only
  // signal it opens anything at all was a hidden aria-label nobody can see
  // before tapping. Given the same visible language every other navigable
  // row in this app already uses (icon-chip + label + chevron - see
  // renderNavSettingsRow() immediately below this file's own copy of that
  // pattern), so "this card goes somewhere, and here's where" reads the
  // same way here as it does for Settings.
  return `
    <button class="who" data-action="open-achievements" aria-label="פתיחת מדליות והישגים" style="width:100%; text-align:inherit;">
      <div class="who-avatar">${esc(initial)}</div>
      <div style="flex:1; min-width:0;">
        <div class="who-name">${userName ? bidiText(userName) : "אורח/ת"}</div>
        <!-- Design spec Appendix A.9: the zero-streak branch here used to
             read "בואו נתחיל להתאמן" - the THIRD instance of "בואו נתחיל" in
             the app, after the welcome sheet's primary button and the
             onboarding explainer's (both index.html, both genuine calls to
             action). This one is not a button. It is the sub-line of the
             .who card, i.e. a STATUS line about the member, sitting directly
             under their name - so a member with no current streak had their
             state reported to them as an imperative, and the same words meant
             three different things in three places.
             The replacement is a fact, in the same shape as the streak > 0
             branch it alternates with: that branch says what the streak IS,
             so this one says where it starts. It is also true for both people
             who land here - someone who has never trained and someone whose
             streak lapsed - which "בואו נתחיל להתאמן" was not, and it leaves
             "בואו נתחיל" to the two buttons that actually ask for a tap. -->
        <div class="who-sub">${streak > 0 ? `${streak} ${streak === 1 ? "יום" : "ימים"} ברצף` : "הרצף מתחיל באימון הבא"}</div>
      </div>
      <div class="flex items-center gap-6" style="flex-shrink:0; color:var(--steel); font-size:12px; font-weight:700;" aria-hidden="true">
        <span>מדליות</span>
        <span style="transform:scaleX(-1); display:inline-flex;">${ICONS.chevron}</span>
      </div>
    </button>`;
}
// The drill-in marker every row in the nav menu and the desktop sidebar ends
// with. One function, because it was already typed out twice in
// renderNavSettingsRow() below and is now on renderNavRows' rows too - three
// copies of the same eight attributes is how the fourth one ends up subtly
// different. scaleX(-1) because ICONS.chevron points right and "forward" is
// leftward in an RTL document; see the note above renderWodBenchmarksSection
// for the same rule stated for the literal "›".
function navChevronHtml() {
  return `<span style="transform:scaleX(-1); display:inline-flex; color:var(--steel); flex-shrink:0;" aria-hidden="true">${ICONS.chevron}</span>`;
}
// Shared by the mobile nav menu and the desktop sidebar (renderNavMenuList/
// renderDesktopSidebar below) - one pass over getNavItems(), one place that
// knows about Community's sub-nav preview. withIds carries the real
// tabAddBtn/tabHistoryBtn/etc ids (and, riding along with them, the
// "tabbtn" class cloud.js's Community-tab-left detector needs - see the
// comment inline below); the desktop copy renders withIds=false so the two
// surfaces never produce duplicate DOM ids, using data-tab alone for the
// click delegator, which already reads it independent of id. onlyOther
// restricts the list to the non-main items - the mobile hamburger menu
// uses this now that all 5 tabs live in the fixed bottom tab bar instead
// (renderBottomTabBar), so their ids aren't duplicated between the two;
// now that Community is `main: true` too, onlyOther's list on mobile is
// empty and the Community `.subnav` preview branch below never fires
// there - it's real dead weight on that path, kept only because the
// desktop sidebar still passes onlyOther=false and shows every item
// (including the preview) regardless, since it has no bottom bar to split
// against.
// `pick` (optional) narrows the registry further, after onlyOther. It exists
// for the staff sidebar, which renders these same rows under three headings;
// a caller that passes nothing gets exactly what this function always gave.
function renderNavRows(withIds, onlyOther, pick) {
  let items = onlyOther ? getNavItems().filter((item) => !item.main) : getNavItems();
  if (typeof pick === "function") items = items.filter(pick);
  return items.map((item) => {
    const isActive = tab === item.tab;
    // The "tabbtn" class here is load-bearing, not styling (its visual
    // rules are neutralized for .navrow.tabbtn in index.html's CSS):
    // cloud.js has its own capture-phase click listener that detects
    // "left the Community tab" by e.target.closest(".tabbtn") - not by
    // id or data-action - to know when to reset the club_tab_viewed
    // dedupe. Drop this class and re-entering Community stops counting
    // as a new view. Only the withIds (mobile) copy carries it - only one
    // of the two copies is ever visible/clickable at a given viewport
    // width, so there's no ambiguity about which one a real click means.
    const idAttr = withIds ? ` id="${item.rowId}"` : "";
    const tabbtnClass = withIds ? " tabbtn" : "";
    return `
      <button class="navrow${tabbtnClass}${isActive ? " active" : ""}"${idAttr} data-action="switch-tab" data-tab="${item.tab}" role="tab" aria-selected="${isActive}" aria-controls="content">
        <span class="icon-chip icon-chip-${item.tint}">${item.icon}</span>
        <span class="nav-label">${esc(item.label)}</span>
        ${navChevronHtml()}
      </button>`;
  }).join("");
}
// Phase 6: a small page-title at the top of each of the 4 solo tabs' own
// content, reading its label straight from the same getNavItems() registry
// the nav menu/sidebar use - one name for a tab, defined once. Additive
// above whatever the tab already rendered; nothing existing is replaced.
function renderTabHeader(navId) {
  const item = getNavItems().find((i) => i.id === navId);
  if (!item) return "";
  return `<h1 class="page-title">${esc(item.label)}</h1>`;
}
// Direction 06 "Club Balance" handoff (README1.md/CLAUDE_CODE_PROMPT.md).
// One shared real-photo header - the crop/overlay/lazy-load rules live here
// exactly once rather than being re-decided per screen; each render function
// only picks which asset per README1's photo-mapping table. assetPath is
// root-relative (e.g. "assets/photos/club-rig-wide.jpeg"), sized 960x260 to
// match the .photo-header aspect-ratio exactly (index.html) - explicit
// width/height reserves the box before the file loads, avoiding layout
// shift. opts.eager skips loading="lazy" for the one screen that is already
// on screen at first paint (the Add tab); every other screen is reached by
// navigating there, so lazy-loading them costs nothing a member would
// notice and keeps first paint from waiting on decorative photography.
// A plain top-level function (not IIFE-scoped), so it becomes a window
// property like every other cross-file shared helper here - cloud.js reaches
// it as window.photoHeaderHtml(), the same way it reaches every other
// platform module, per that file's own documented convention.
function photoHeaderHtml(assetPath, altText, opts) {
  opts = opts || {};
  const loading = opts.eager ? "eager" : "lazy";
  return `<div class="photo-header"><img src="${esc(assetPath)}" alt="${esc(altText)}" width="960" height="260" loading="${loading}"></div>`;
}
function renderNavSettingsRow() {
  // Fresh-eyes audit: on the desktop sidebar (renderDesktopSidebar below)
  // this section header renders in the same persistent column as
  // Community's own "חשבון" subtab (cloud.js, the member's profile/privacy
  // tab) once Community is open - two rows reading "חשבון" a few pixels
  // apart, naming two different things. This one is a single link to
  // app-level Settings, not an account, so the label changes rather than
  // Community's - that one is a normal, unambiguous name for itself on
  // every OTHER screen it appears on.
  return `
    <div class="divider-label">כללי</div>
    <button class="navrow" data-action="open-settings">
      <span class="icon-chip icon-chip-steel">${ICONS.settingsIcon}</span>
      <span class="nav-label">הגדרות</span>
      ${navChevronHtml()}
    </button>
    <!-- Owner's call, 2026-09-17: "should be in the hamburger, so people will
         have easy access to report". It was one row inside Settings, under
         עזרה - three taps and a scroll from anywhere, which is three taps too
         many for the one thing a member does when the app is misbehaving. The
         moment you most need to report a fault is the moment you are least
         inclined to go looking for where to do it.
         It STAYS in Settings as well. This is not a move: the two places
         answer different questions - "something is broken right now" belongs
         on the menu you already have open, and "where do I get help" belongs
         under עזרה with the rest of it. Both routes call the same openSupport().
         In renderNavSettingsRow rather than renderNavMenuList so the desktop
         sidebar gets it too - they share this function, and a desktop user
         reporting a fault should not have to find a hamburger that is not
         there.
         No dispatcher change was needed: openSupport() closes the nav menu on
         its first line already. I added a closeNavMenu() here anyway and wrote
         a comment about the stacked overlays it prevented, then reverted it to
         confirm the test caught it - and nothing failed, because there was
         nothing to catch. -->
    <button class="navrow" data-action="open-support">
      <span class="icon-chip icon-chip-steel">${ICONS.helpIcon}</span>
      <span class="nav-label">תמיכה ודיווח על תקלה</span>
      ${navChevronHtml()}
    </button>`;
}
function renderNavMenuList() {
  // Fresh-eyes audit: for a regular member every main destination already
  // lives in the bottom tab bar (renderNavRows' onlyOther=true correctly
  // renders nothing extra), so this sheet was profile row + one settings
  // link + a full screen of empty navy below it - not a bug, but not a
  // finished screen either. A footer line gives the space a reason to be
  // there without inventing a duplicate action Settings already owns.
  return renderNavWho() + `<div class="nav-destinations" role="tablist" aria-label="מסכים נוספים">${renderNavRows(true, true)}</div>` + renderNavSettingsRow()
    + `<div class="footer-note" style="text-align:center; margin-top:auto; padding-top:24px;">${esc(brandName())} · v${APP_VERSION}</div>`;
}
// Desktop / wide-viewport sidebar (Phase 4) - same registry, same rows,
// same settings entry, just without the mobile-only ids (see renderNavRows
// above) and mounted into #desktopSidebar instead of the overlay. Shows
// every item (onlyOther=false) - there's no separate bottom bar at this
// width for the main tabs to split against (COMM-327).
function renderDesktopSidebar() {
  return renderNavWho() + `<div class="nav-destinations" role="tablist" aria-label="מסכי האפליקציה" aria-orientation="vertical">${renderNavRows(false, false)}</div>` + renderNavSettingsRow();
}
// Live report: "when I move my finger from the left side it opens another
// app or something." manifest.json ships display:standalone - an installed
// PWA's WKWebView still recognizes iOS's own edge-swipe-back gesture even
// though it shows no browser chrome for it. Before this, the ONLY history
// entries this app ever pushed were the dialog-open reservations further
// below (registerAppDialog/syncAppDialogHistoryState), consumed back to
// zero the instant a dialog closed - so on any ordinary screen with nothing
// open, history had nowhere to go, and the edge-swipe gesture fell straight
// through the page to the OS (backgrounding the installed app / the app
// switcher - "opens another app"). Establishing one un-consumable anchor
// entry here, at boot, and re-planting it on any pop that isn't the dialog
// system's own reserved one (see the popstate listener far below, and this
// one), keeps every edge-swipe attempt landing back inside the app instead
// of ever finding real history to fall through to. Placed after the notif-
// param cleanup above (and after cloud.js's own invite-code cleanup, which
// runs first - cloud.js is a `defer` script ordered before this one, see
// index.html): an invite code is a live credential that MUST be scrubbed by
// replaceState() before anything pushes a fresh entry, or the scrubbed URL
// would sit safely on top while the original, credential-bearing entry
// stayed reachable underneath it forever.
try { history.pushState({ appAnchor: true }, ""); } catch (e) { /* history API unavailable in this embedding */ }
window.addEventListener("popstate", () => {
  // appDialogHistoryPushed (declared later in this file) is only ever read
  // here, never written - by the time any popstate can fire, the whole
  // script has finished its first pass and the variable is long since
  // initialized, so the forward reference below is safe.
  if (appDialogHistoryPushed) return; // the dialog-close listener owns this pop instead
  try { history.pushState({ appAnchor: true }, ""); } catch (e) {}
});
let selectedId = MOVEMENTS[0].id;
// COMM-360. selectedId always needs to point at a real movement internally
// (ladder/superset switching, saveSet's exerciseId, movementById lookups
// throughout the log screen) - it can't just be null. This flag is the real
// "has the user actually picked one" signal: false means selectedId is only
// a placeholder, the log screen shows a pick-a-movement prompt instead of
// naming it, and saveSet() refuses to save against it. Flips true from
// choosePickedMovement() (the picker) and startEditEntry() (opening a real
// past set is as explicit a choice as picking one); reset on clearAllData().
let movementExplicitlyChosen = false;
let weight = 20, reps = 5, sets = 1;
// "reps" (weight×reps×sets, the original/default) or "duration" (a timed
// hold/carry — see sanitizeEntry). durationSeconds is that mode's own value,
// kept separate from reps so switching modes never clobbers the other.
let logEntryType = "reps", durationSeconds = 20;
let logDate = todayISO();
// Live bug hunt (2026-09-11): logDate/wodLogDate below are set once (here,
// or on reset-to-today) and read again whenever a set/WOD is actually
// saved - if a session spans midnight and the member never touches the
// date field (the ordinary flow), the stale value silently mis-dates the
// entry with no visible sign anything went wrong. Mirrors
// movementExplicitlyChosen's shape: false means "still tracking today
// live, read it fresh at save time"; true (set only when the field is
// actually touched, or an existing dated entry is opened for edit) means
// "an explicit date was chosen, honor it exactly." See saveSet()/saveWod().
let logDateExplicitlyChosen = false;
// A ladder groups the next saves (different weight/reps each) under one
// groupId, scoped to one exercise/day — see toggleLadderMode() and saveSet().
// Setting ladderPartnerId turns the same group into a superset: exactly two
// exercises alternating rounds under one groupId (see switchLadderExercise
// and openPicker's "partner" target). ladderPrimaryId is fixed at whatever
// selectedId was when the ladder started — selectedId itself keeps changing
// as the user switches between the two exercises, so it can't double as
// "the other one" once they match; these two ids are the stable pair to
// switch between. ladderBlockLabel is an optional free tag ("A"/"B"/"C"/"D")
// for real-world A/B/C session-block programming — set once per group,
// carried by every round saved into it.
let ladderMode = false, ladderGroupId = null, ladderPrimaryId = null, ladderPartnerId = null, ladderBlockLabel = null;
let editingEntryId = null;
// Never allow a future-dated set, even if a user bypasses the date input's
// max attribute (e.g. via devtools) or the device clock is off.
function clampLogDate(v) {
  const clean = cleanISODate(v);
  if (!clean) return todayISO();
  return clean > todayISO() ? todayISO() : clean;
}
let historyId = null;
let historySearch = "";
const now0 = new Date();
let calYear = now0.getFullYear();
let calMonth = now0.getMonth();
let calSelectedDate = todayISO();
let calView = "calendar";

// WOD tab state
let wodEntries = [];
let customWods = [];
let wodSubTab = "log";
// COMM-360: null (not WOD_LIBRARY[0].id/"Fran") until the user actually
// picks one, unlike selectedId - there's no internal logic depending on
// this always being a valid WOD, so a real null works. wodById(null) is
// undefined, which renderWodLogSection() and the bottom-bar visibility
// check (render()) already treat as "show the pick-a-WOD empty state, no
// save action".
let selectedWodId = null;
let wodMinutes = 3, wodSeconds = 0, wodRounds = 5, wodReps = 0, wodWeight = 20;
// EMOM-only: one rep count per movement in the selected WOD's rotation,
// index-aligned with its emomMovements — kept in sync with that WOD's own
// movement count by renderWodLogSection whenever it renders.
let wodEmomReps = [];
// Design spec §3.6. THIS WAS `= true`, AND THAT WAS A DATA-INTEGRITY BUG,
// not a copy one. Rx means "as prescribed, at the full prescribed weights".
// A beginner is almost always scaled. Defaulting the toggle to Rx meant the
// app silently recorded her session as harder than it actually was — into a
// history she then cannot audit, because neither word is defined anywhere in
// the product. Every "Rx — <benchmark>" badge sat on the same false premise.
//
// null is a third state and it is the point: nothing is chosen yet, the save
// CTA is disabled, and the member has to say which it was. Read `=== false`
// rather than `!wodRx` everywhere it gates the scaled-weight inputs, because
// null is not "scaled" — it is "unanswered".
let wodRx = null;
let wodScaledWeight = 20;
let wodNotes = "";
// Free-text tag for a partner WOD ("with Dana", a team name, ...) — per
// entry (who you partnered with varies attempt to attempt), unlike
// timeCapSeconds below which describes the WOD itself.
let wodPartnerTag = "";
let wodLogDate = todayISO();
// Live bug hunt (2026-09-11): see logDateExplicitlyChosen's comment above —
// same fix, same shape, for the WOD tab's own date field.
let wodLogDateExplicitlyChosen = false;
let editingWodEntryId = null;
let emomStateWodId = null;
let wodHistoryId = null;
let wodHistorySearch = "";
let wodBuilderOpen = false;
let builderFormat = null;
let builderMovements = bag();
let builderMoveSearch = "";
// EMOM-only: how many minutes the rotation runs. Movement order/targets for
// an EMOM come from builderMovements itself (insertion order = rotation
// order) — see createWodFromBuilder.
let builderEmomMinutes = 10;
// Optional, any non-EMOM format — reference-only, never enforced. 0 = no cap.
let builderTimeCapMinutes = 0;
let confirmClear = false;
let storageOK = true;
let storageErrMsg = "";
// Surface write failures instead of swallowing them — a user whose saves are
// silently failing otherwise believes the log is being kept.
function noteStorageError(e) {
  storageOK = false;
  const quota = e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
  storageErrMsg = quota
    ? "אין מקום אחסון פנוי — ייצאו גיבוי ומחקו נתונים ישנים"
    : "השמירה במכשיר נכשלה — הנתונים האחרונים אולי לא נשמרו";
  console.error("storage write failed:", e);
}

// Bodyweight tab state
let bodyweightEntries = [];
let bwWeight = 70;
let bodyweightExpanded = false;
// Whether the percentage table under the 1RM estimate is open. Module-level
// like bodyweightExpanded, because this screen re-renders by replacing its
// own innerHTML - a <details> element would spring shut on every keystroke
// in the weight field.
let pctTableExpanded = false;

// Body measurements (custom types the user defines, e.g. waist/chest — cm)
let measureTypes = [];
let measureEntries = [];
let measureExpandedId = null;
let measureAddOpen = false;
let measureValues = bag(); // per-type stepper input value, keyed by typeId

let importMessage = "";
let importMsgTimeout = null;
function setImportMessage(msg) {
  importMessage = msg;
  clearTimeout(importMsgTimeout);
  importMsgTimeout = setTimeout(() => { importMessage = ""; render(); }, 5000);
}

// ---------- Derived helpers ----------
function entriesFor(id, excludeId) { return entries.filter((e) => e.exerciseId === id && e.id !== excludeId); }
// ONE PASS, for a screen that needs MANY exercises' lists in a row.
//
// entriesFor() is a full scan of `entries`, which is right for the Log tab
// asking about the one movement in front of the member. The History tab asks
// about every movement they have ever logged, THREE TIMES each - once for
// bestLiftedSetFor, once for bestEst1RM, once for bestDurationFor - and it
// re-renders on every keystroke of its own search box. At 60 movements and
// 2000 entries that is 360,000 comparisons per keystroke to draw a list of
// collapsed rows.
//
// Built per render and thrown away. No cache and no invalidation, so nothing
// here can ever go stale - the cost of rebuilding it is the one pass the
// screen was going to make anyway.
function entriesByExercise() {
  const byId = new Map();
  for (const e of entries) {
    let list = byId.get(e.exerciseId);
    if (!list) byId.set(e.exerciseId, (list = []));
    list.push(e);
  }
  return byId;
}
// The index is only safe to substitute when the caller wants the WHOLE list
// for an exercise. `excludeId` (used when re-scoring a PR while editing the
// entry that holds it) has to fall through to the real scan, or the excluded
// row would silently count itself.
function exerciseEntryList(id, excludeId, index) {
  if (index && excludeId === undefined) return index.get(id) || [];
  return entriesFor(id, excludeId);
}
// Actual logged working sets from the last N days, most recent first, capped
// so a movement trained daily doesn't flood the entry screen. No warm-up
// concept anywhere here — every row is a real set someone saved.
// One place that turns a weight/reps/sets triple into the app's own phrasing,
// so the prefill toast and the chip it came from always read the same way.
function entrySummaryFromParts(weight, reps, sets) {
  const core = weight > 0 ? `${weight} ק״ג × ${reps}` : `${reps} חזרות`;
  return sets > 1 ? `${core} × ${sets}` : core;
}
function recentEntriesFor(id, days = 14, cap = 5) {
  const cutoff = localISODate(new Date(Date.now() - days * 86400000));
  return entriesFor(id).filter((e) => e.date >= cutoff).slice(0, cap);
}
// PERCENTAGE WORK OFF THE ESTIMATE.
//
// This app is post-workout management, not a bar-side calculator: you open it
// to record what you did and to work out what to aim for next time. So the
// percentages live under the estimate on the log screen, where a lift is
// being reviewed, and are framed as the NEXT session rather than this one.
//
// The reference is bestEst1RM(), an Epley estimate from real logged sets, and
// NOT a tested single. That is a deliberate trade: it works for every member
// on day one with nothing to fill in, at the cost of being an estimate - a
// number derived from a 5-rep set can sit a few kg either side of a true max.
// The panel says so once, plainly, rather than presenting the figures as
// measured. It is a starting point to adjust from, which is how percentage
// work is used in practice anyway.
//
// Rounded to 2.5 kg because that is what a barbell can actually hold - the
// smallest common plate pair is 1.25 kg a side. An unrounded "77.3 ק\"ג" is a
// number nobody can load, and rounding at the point of display keeps the
// arithmetic honest above it.
const PCT_STEPS = [95, 90, 85, 80, 75, 70, 65, 60];
function roundToPlate(kg) { return Math.round(kg / 2.5) * 2.5; }
function formatPlateKg(kg) { return Number.isInteger(kg) ? String(kg) : kg.toFixed(1); }

// ---- The percentage CHIPS, gated on club_features.strength_percentages ----
//
// The same idea as the table above, on the same screen, one step further: a
// row of tappable chips that fills the weight stepper, so a member planning
// 5x5 at 75% does not read a number off a list and then dial it in by hand
// (~22 taps of a 2.5 kg stepper from the empty bar). The chips REPLACE the
// table when the club turns the key on - see renderLogTab. Two percentage
// surfaces on one screen, disagreeing about their rounding, is exactly the
// drift this codebase is prone to.
//
// STRENGTH_PCT_CHIPS is PCT_STEPS' twin and deliberately a superset of it:
// the same 5% ladder, carried down to 50%, because a chip row can hold ten
// options where the collapsed table was a list to read. Descending for the
// reason PCT_STEPS is descending - the heaviest number is the one being
// planned around, so it is read first.
//
// PCT_STEPS and roundToPlate() are left exactly as they are, and that is the
// deliberate half of the drift: they now serve ONLY the pre-key table, where
// "rounded to 2.5 kg, the smallest jump a barbell can hold" is the whole
// argument and there is no member setting to respect. When the key is on, the
// member has answered that question themselves and roundToIncrement() takes
// their answer. Both are reachable, neither is dead, and when the key is on
// club-wide the table and its rounding can be retired together.
const STRENGTH_PCT_CHIPS = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50];
// Nearest multiple of `inc`, float dust rounded out of the answer. 82.5 * 0.7
// is 57.750000000000004 in IEEE 754 and the naive Math.round(x / inc) * inc
// hands back 57.50000000000001 for some inputs - formatPlateKg() would print
// that as "57.5" while an === against 57.5 would not recognise it, which is
// the kind of gap that only ever shows up in the one test nobody wrote. Two
// decimals is well inside every increment offered.
//
// An unknown increment falls back to 2.5 rather than trusting the argument:
// this is fed from a stored setting, and a hand-edited IndexedDB row must not
// be able to put "0" in the divisor.
function roundToIncrement(kg, inc) {
  const step = PCT_INCREMENTS.includes(inc) ? inc : 2.5;
  if (typeof kg !== "number" || !isFinite(kg) || kg <= 0) return 0;
  return Math.round(Math.round(kg / step) * step * 100) / 100;
}
function bestEst1RM(id, excludeId, index) {
  // Duration entries carry est1RM: 0 (see sanitizeEntry) so they can't win
  // this max by accident, but they're filtered explicitly anyway so an
  // exercise logged only as holds correctly reports "no 1RM" (null), not 0.
  const list = exerciseEntryList(id, excludeId, index).filter((e) => e.type !== "duration");
  return list.length ? Math.max(...list.map((e) => e.est1RM)) : null;
}
// The heaviest set actually put on the bar, as opposed to bestEst1RM() just
// above, which is a formula output nobody has ever lifted. The all-time
// records list used to headline the estimate — someone whose heaviest real
// set was 60×5 was told their Back Squat record was "70 kg", while the row
// they could expand said 1RM — / 5RM 60 right underneath it. A UX audit had
// three separate reviewers name that as the single thing most likely to
// make every other number in the app untrustworthy, so the two numbers are
// now separate functions with separate labels everywhere they appear.
// Ties go to the higher rep count, then the later session: same load for
// more reps is the better lift.
function bestLiftedSetFor(id, excludeId, index) {
  const list = exerciseEntryList(id, excludeId, index).filter((e) => e.type !== "duration");
  if (!list.length) return null;
  return list.reduce((best, e) => {
    if (e.weight !== best.weight) return e.weight > best.weight ? e : best;
    if (e.reps !== best.reps) return e.reps > best.reps ? e : best;
    return (e.ts || 0) > (best.ts || 0) ? e : best;
  });
}
// Bodyweight movements (pull-ups, dips) are logged at 0 kg, where "0 ק״ג × 10"
// would be a worse headline than the rep count on its own.
function formatLiftedSet(e) {
  return e.weight > 0 ? `${e.weight} ק״ג × ${e.reps}` : `${e.reps} חזרות`;
}
function repRecordFor(id, repCount, excludeId) {
  const list = entriesFor(id, excludeId).filter((e) => e.reps === repCount);
  return list.length ? Math.max(...list.map((e) => e.weight)) : null;
}
function bestDurationFor(id, excludeId, index) {
  const list = exerciseEntryList(id, excludeId, index).filter((e) => e.type === "duration");
  return list.length ? Math.max(...list.map((e) => e.durationSeconds)) : null;
}
// Which entry type the Log tab's toggle should default to when an exercise
// is (re)selected — follows whatever this exercise was logged as last time,
// so a hold-only movement like a plank doesn't keep resetting to reps mode.
function inferEntryTypeFor(id) {
  const last = entriesFor(id)[0];
  return last && last.type === "duration" ? "duration" : "reps";
}
// Called right after selectedId changes to a fresh exercise (not while
// editing an existing entry — startEditEntry restores type from the entry
// itself instead).
function syncLogEntryTypeToSelection() {
  logEntryType = inferEntryTypeFor(selectedId);
  if (logEntryType === "duration") {
    const last = entriesFor(selectedId)[0];
    durationSeconds = last.durationSeconds || 20;
  }
}
function activeExercises() {
  const ids = [...new Set(entries.map((e) => e.exerciseId))];
  return ids.map(movementById).filter(Boolean);
}


// ---------- Achievements ----------
// Everything here is derived from data already on this device. No server, no
// account, no comparison between athletes — tiers count personal PRs/weeks,
// never absolute kg, so a bronze/silver/gold badge means the same effort
// regardless of who's training.
const ACHIEVEMENT_PR_CATEGORIES = ["Squat", "Deadlift", "Press", "Olympic", "Pull"];
// Same ladder shape everywhere a tier repeats a behavior at a rising bar:
// an accessible first step, then a clean x5 climb - so "gold" always means
// a comparable order of magnitude more effort than "bronze", not an
// arbitrary per-category number.
// Bronze was `need: 1`, which made the rule literally "1 שיא אישי בקבוצת
// Squat" — so the very first set anyone ever logged in a category minted a
// medal, because with no history every set beats everything on file. That is
// the mechanism behind "5 badges in the first ninety seconds". Design spec
// 5.3.1 moves the first rung to 3, in step with the matching rule in
// saveSet(): nothing is a personal record until there is something to beat.
const PR_TIERS = [{ tier: "bronze", need: 3 }, { tier: "silver", need: 5 }, { tier: "gold", need: 25 }];
// Streaks stay on a calendar ladder instead (month / quarter / half-year) -
// weeks don't take well to a x5 climb, but a shared unit everyone recognizes
// is its own kind of "connected."
const STREAK_TIERS = [{ tier: "bronze", need: 4 }, { tier: "silver", need: 12 }, { tier: "gold", need: 26 }];
const SESSION_MILESTONES = [10, 50, 100, 365];
const TENURE_MILESTONES = [
  { id: "month1", days: 30, label: "חודש בבוקס" },
  { id: "month6", days: 182, label: "חצי שנה בבוקס" },
  { id: "year1", days: 365, label: "שנה בבוקס" },
];
const TIER_LABELS = { bronze: "ברונזה", silver: "כסף", gold: "זהב" };

// Point values follow the same non-linear curve trophy/badge systems (PSN,
// Peloton) use so a tier's weight matches its real rarity instead of every
// badge counting the same: bronze≈2.5x, gold≈7.5x. Every family feeds the
// same score, which is the actual "connect everything" move here - a PR
// badge and an Rx badge both move the same number.
const TIER_POINTS = { bronze: 10, silver: 25, gold: 75 };
const MILESTONE_POINTS = 25;
const RX_POINTS = 15;
const CAPSTONE_POINTS = 200;
// Named like the box's own progression, not borrowed esports tiers - and
// deliberately a different vocabulary than bronze/silver/gold so "you're
// Gold level" (badge tier) and "you're at מתקדם" (overall level) never read
// as the same claim. Thresholds step up non-linearly (Peloton: 0-99 / 100-
// 1999 / 2000-14999), scaled to this app's much smaller point pool.
const ATHLETE_LEVELS = [
  { min: 0, name: "מתחיל" },
  { min: 50, name: "מתמיד" },
  { min: 200, name: "מנוסה" },
  { min: 500, name: "מתקדם" },
  { min: 900, name: brandChampionTitle() },
];
function athleteLevel(score) {
  let level = ATHLETE_LEVELS[0];
  for (const l of ATHLETE_LEVELS) { if (score >= l.min) level = l; }
  const idx = ATHLETE_LEVELS.indexOf(level);
  const next = ATHLETE_LEVELS[idx + 1] || null;
  return { name: level.name, min: level.min, next };
}

// Fresh-eyes audit: a brand-new member's very first set unlocked "השיא
// הראשון" (First PR) and the Progress tab read "3 שיאים החודש" after
// exactly one session — because e.isPR (set in saveSet()) is honest
// against everything on file, and with nothing on file yet a movement's
// first few entries trivially beat "nothing". saveSet()'s own
// MIN_ENTRIES_BEFORE_PR already encodes the right rule for the full-screen
// celebration ("nothing is a personal record until there is something to
// beat"); this applies that same rule to every OTHER place a PR gets
// counted or badged, instead of each reading the raw flag independently
// and drifting from it. Referenced before its declaration further down
// this file — safe, since this only runs inside a function body, well
// after MIN_ENTRIES_BEFORE_PR's const binding exists.
function celebratablePrEntryIds() {
  const ids = new Set();
  const byMovement = bag();
  // Duration entries carry est1RM: 0 (see sanitizeEntry) — skip them so a
  // hold-only movement (e.g. a dead hang under Pull) can't register a
  // phantom 0kg "PR" the first time it's logged.
  for (const e of entries) { if (e.type !== "duration") (byMovement[e.exerciseId] ||= []).push(e); }
  for (const movId of Object.keys(byMovement)) {
    const list = byMovement[movId].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    let max = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.est1RM > max) {
        if (i >= MIN_ENTRIES_BEFORE_PR) ids.add(e.id);
        max = e.est1RM;
      }
    }
  }
  return ids;
}
// Live bug hunt (2026-09-11): entry.isPR is the raw, honest-against-
// everything-on-file flag saveSet() computes at save time - correct for
// renderDetailCard()'s own history chart, which never reads this field and
// recomputes its PR dots fresh every render, but three OTHER surfaces (the
// day list's flame icon, the calendar's per-day dot/aria-label, and its
// "ימי שיא" stat) read the stored flag directly. That flag isn't gated by
// MIN_ENTRIES_BEFORE_PR the way celebratablePrEntryIds() already gates
// every other PR-count/badge surface (so a movement's trivial first-ever
// entry shows a "record" flame), and it's never retroactively cleared when
// a later edit changes the real running max, unlike celebratablePrEntryIds()
// which recomputes from scratch on every call. Duration entries are outside
// celebratablePrEntryIds() itself (see its own comment above) and keep
// reading the raw flag — there's no equivalent gate for that metric.
function isFlameworthyEntry(entry, celebratableIds) {
  return entry.type === "duration" ? !!entry.isPR : celebratableIds.has(entry.id);
}
function categoryPRCounts() {
  const counts = bag();
  const celebratable = celebratablePrEntryIds();
  for (const e of entries) {
    if (!celebratable.has(e.id)) continue;
    const mov = movementById(e.exerciseId);
    if (!mov || !ACHIEVEMENT_PR_CATEGORIES.includes(mov.category)) continue;
    counts[mov.category] = (counts[mov.category] || 0) + 1;
  }
  return counts;
}
function loggedDates() { return [...entries.map((e) => e.date), ...wodEntries.map((e) => e.date)]; }
function weekBucket(iso) { return Math.floor(new Date(iso + "T00:00:00").getTime() / 86400000 / 7); }
function longestWeekStreak() {
  const buckets = [...new Set(loggedDates().map(weekBucket))].sort((a, b) => a - b);
  let longest = 0, current = 0, prev = null;
  for (const b of buckets) {
    current = (prev !== null && b === prev + 1) ? current + 1 : 1;
    longest = Math.max(longest, current);
    prev = b;
  }
  return longest;
}
function totalSessions() { return new Set(loggedDates()).size; }
// WHOLE LOCAL CALENDAR DAYS between an ISO date and today.
//
// Live bug hunt (2026-09-11): raw ms-division drifts by the DST offset around
// a spring-forward/fall-back transition, which can flip a day count
// off-by-one right at local midnight once the drift accumulates.
// computeCurrentStreak() already gets this right elsewhere in this file via
// setDate() local-calendar-day counting; this matches that.
//
// Extracted from daysSinceBoxStart() when the benchmark retest reminder
// needed the same arithmetic. A second copy of a DST-correct day count is the
// exact shape of this codebase's characteristic defect - a right line with a
// missed twin (CLAUDE.md, "Sibling drift") - and the twin here would have
// been silent: a reminder one day early, twice a year, for one member.
function daysSinceISODate(iso) {
  if (!iso) return null;
  const start = new Date(iso + "T00:00:00");
  if (!isFinite(start.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - start.getTime()) / 86400000);
}
function daysSinceBoxStart() {
  if (!boxStartDate) return null;
  return daysSinceISODate(boxStartDate);
}
function earnedRxWodIds() { return new Set(wodEntries.filter((e) => e.rx).map((e) => e.wodId)); }
function loggedCategories() {
  const cats = new Set();
  for (const e of entries) { const m = movementById(e.exerciseId); if (m) cats.add(m.category); }
  return cats;
}
function isWellRounded() {
  const cats = loggedCategories();
  return ACHIEVEMENT_PR_CATEGORIES.every((c) => cats.has(c));
}

function allGoldPRsEarned() { return ACHIEVEMENT_PR_CATEGORIES.every((cat) => (categoryPRCounts()[cat] || 0) >= 25); }
// UX audit: the welcome dialog asks when you started at the box, and a date
// typed there used to be sufficient, on its own, to earn every וותק badge
// whose threshold it cleared — three full-screen celebrations inside the
// first ninety seconds, before a single set had been logged. The date is
// self-reported and costs nothing to type, so it can't be the whole bar.
// The badge still measures tenure, exactly as its rule text says; it just
// won't unlock for someone who has never trained in the app. One session is
// deliberately a low bar — this is about "praise that costs nothing", not
// about making seniority hard to earn.
function tenureMilestoneEarned(m) {
  const d = daysSinceBoxStart();
  return d !== null && d >= m.days && totalSessions() >= 1;
}
function allTenureEarned() {
  return TENURE_MILESTONES.every(tenureMilestoneEarned);
}
// Mirrors how a PlayStation Platinum trophy works: one capstone that unlocks
// only once every other top-shelf badge is in, rather than its own separate
// bar to clear. It's the one badge that ties every family together.
function capstoneEarned() {
  return allGoldPRsEarned() && longestWeekStreak() >= 26 && isWellRounded() && allTenureEarned();
}

const ACHIEVEMENTS = [
  {
    id: "capstone", group: "capstone", glyph: "home",
    name: brandChampionTitle(),
    rule: "זהב בכל קבוצות השיאים + רצף זהב + אתלט שלם + כל מדליות הוותק",
    earned: capstoneEarned,
    points: CAPSTONE_POINTS,
  },
  ...ACHIEVEMENT_PR_CATEGORIES.flatMap((cat) => PR_TIERS.map((t) => ({
    id: `pr-${cat}-${t.tier}`, group: "pr", tier: t.tier, cat, glyph: "bar",
    name: `${CATEGORY_LABELS[cat]} — ${TIER_LABELS[t.tier]}`,
    // The caption is read directly under the medal's own name, so it does
    // not repeat it: the name already says which group and which tier, and
    // "Squat — ברונזה / 3 שיאים אישיים בקבוצת Squat" spent its only line of
    // 11px text saying "Squat" a second time instead of saying what the
    // three are. Same edit, same reason, on every rule below that restated
    // its own name.
    rule: `${t.need} ${t.need === 1 ? "שיא אישי" : "שיאים אישיים"} בקבוצה`,
    earned: () => (categoryPRCounts()[cat] || 0) >= t.need,
    points: TIER_POINTS[t.tier],
    // need/current: fresh-eyes audit, "next up" nudge. Explicit fields
    // (not re-derived from `rule`'s free text or `earned`'s closure) so
    // nearestUpcomingAchievement() can compute a real distance-to-unlock
    // generically across every countable achievement group, without
    // parsing Hebrew strings or duplicating each group's own metric.
    need: t.need, current: () => categoryPRCounts()[cat] || 0,
  }))),
  ...STREAK_TIERS.map((t) => ({
    id: `streak-${t.tier}`, group: "streak", tier: t.tier, glyph: "chevrons",
    name: `רצף — ${TIER_LABELS[t.tier]}`,
    rule: `${t.need} שבועות רצופים עם רישום`,
    earned: () => longestWeekStreak() >= t.need,
    points: TIER_POINTS[t.tier],
    need: t.need, current: () => longestWeekStreak(),
  })),
  ...SESSION_MILESTONES.map((n) => ({
    id: `sessions-${n}`, group: "milestone", glyph: "home",
    name: `${n} אימונים`,
    rule: "ימים שונים שנרשם בהם אימון",
    earned: () => totalSessions() >= n,
    points: MILESTONE_POINTS,
    need: n, current: () => totalSessions(),
  })),
  ...TENURE_MILESTONES.map((m) => ({
    id: `tenure-${m.id}`, group: "milestone", glyph: "flame",
    name: m.label,
    rule: "נספר לפי תאריך ההתחלה שרשמתם",
    earned: () => tenureMilestoneEarned(m),
    points: MILESTONE_POINTS,
    // Design spec 5.2, tier C. Tenure is a fact about the calendar, not
    // something the member did in a session — it still unlocks, still shows
    // in the list and still scores points, it just never interrupts with a
    // full-screen card. Nothing else in ACHIEVEMENTS carries this flag.
    silent: true,
  })),
  {
    id: "well-rounded", group: "milestone", glyph: "chevrons",
    name: "אתלט שלם",
    rule: "תרגיל אחד לפחות מכל קבוצה (סקוואט/דדליפט/לחיצה/אולימפי/משיכה)",
    earned: () => isWellRounded(),
    points: MILESTONE_POINTS,
  },
  ...WOD_LIBRARY.map((w) => ({
    id: `rx-${w.id}`, group: "rx", glyph: "bar",
    name: `Rx — ${w.name}`,
    rule: "רישום ראשון כ-Rx",
    earned: () => earnedRxWodIds().has(w.id),
    points: RX_POINTS,
  })),
];

// Fresh-eyes audit, regular-member persona: 1/59 unlocked reads as a wall
// of locked medals with no sense of what's actually reachable soon - real
// motivation research on fitness apps names exactly this ("show the near
// win") as the difference between an achievements screen someone checks
// and one they stop looking at. Only the three countable groups (pr,
// streak, milestone - see their own need/current fields just above) have
// a generic distance-to-unlock; well-rounded/tenure/rx/capstone stay out
// of this specifically because forcing a fake "3.2 away" onto a boolean
// or calendar-driven achievement would be a worse kind of dishonesty than
// not showing one.
function nearestUpcomingAchievement() {
  let best = null, bestRemaining = Infinity;
  for (const a of ACHIEVEMENTS) {
    if (typeof a.need !== "number" || typeof a.current !== "function") continue;
    if (a.earned()) continue;
    const remaining = a.need - a.current();
    if (remaining > 0 && remaining < bestRemaining) { best = a; bestRemaining = remaining; }
  }
  return best ? { ach: best, remaining: bestRemaining } : null;
}
function renderNextAchievementNudge() {
  const next = nearestUpcomingAchievement();
  if (!next) return "";
  const { ach, remaining } = next;
  const pct = Math.min(100, Math.round((ach.current() / ach.need) * 100));
  return `<div class="ach-section" style="margin-top:0;">
    <div class="ach-section-head"><span class="ach-section-dot" style="background:var(--brass);"></span><h2 class="ach-section-title">המדליה הבאה שלך</h2></div>
    <div class="chart-card" style="text-align:center;">
      <div style="font-weight:800; font-size:14px; color:var(--chalk); margin-bottom:6px;">${esc(ach.name)}</div>
      <div class="ach-level-bar"><div class="ach-level-fill" style="width:${pct}%;"></div></div>
      <div class="ach-summary-label" style="margin-top:6px;">עוד ${remaining} להשלמה</div>
    </div>
  </div>`;
}
function renderMedal(ach, earned) {
  const shape = ach.group === "pr" || ach.group === "streak" ? "shield" : "circle";
  const glowMap = { bronze: "rgba(201,162,39,.7)", silver: "rgba(216,222,228,.8)", gold: "rgba(242,185,12,.8)" };
  const glow = ach.group === "capstone" ? "rgba(255,180,60,.85)"
    : ach.tier ? glowMap[ach.tier]
    : (ach.group === "rx" ? "rgba(62,111,217,.6)" : "rgba(232,93,61,.6)");
  const tierClass = ach.group === "capstone" ? "medal-capstone" : ach.tier ? `tier-${ach.tier}` : (ach.group === "rx" ? "medal-rx" : "medal-milestone");
  const glyphId = ach.glyph === "home" ? "Home" : ach.glyph === "chevrons" ? "Chevrons" : ach.glyph === "bar" ? "Bar" : "Flame";
  const glyphUse = shape === "shield"
    ? `<use href="#glyph${glyphId}" transform="translate(19,16) scale(0.62)"/>`
    : `<use href="#glyph${glyphId}" transform="translate(15,15) scale(0.7)"/>`;
  const plateMap = { bronze: "assets/medal-bronze.png", silver: "assets/medal-silver.png", gold: "assets/medal-gold.png" };
  const symbol = ach.tier
    ? `<div class="medal-shape medal-shape-plate ${tierClass}"><div class="medal-plate"><img src="${plateMap[ach.tier]}" alt="" /><span class="medal-plate-shine" aria-hidden="true"></span></div></div>`
    : shape === "shield"
      ? `<svg class="medal-shape ${tierClass}" viewBox="0 0 100 112"><use href="#medalShield"/>${glyphUse}</svg>`
      : `<svg class="medal-shape shape-circle ${tierClass}" viewBox="0 0 100 100"><use href="#medalCircle"/>${glyphUse}</svg>`;
  // title is a nice-to-have for desktop; it never shows on a touch screen,
  // so EVERY badge prints the rule as a visible caption.
  //
  // Real device report (2026-09-15, first time this app was ever opened on a
  // phone): the caption used to be `earned ? "" : rule`, so the one medal the
  // athlete had actually won was the only one on the screen with no text under
  // it at all - "Squat — ברונזה" and nothing else, sitting next to a locked
  // "Deadlift — ברונזה / 3 שיאים אישיים בקבוצת Deadlift" that explained
  // itself fully. Exactly backwards: the earned medal is the one you want to
  // read, because the rule is the record of what you did to get it. The
  // desktop `title` above carried that text and a touch screen never shows a
  // title, which is the same defect the comment directly above this one was
  // already written about - the fix had simply only ever been applied to the
  // locked half.
  return `<div class="medal-badge ${ach.group === "capstone" ? "capstone-badge" : ""} ${earned ? "earned" : "locked"}" style="--glow-color:${glow};" title="${esc(ach.rule)}">
    ${symbol}
    <div class="medal-name">${esc(ach.name)}</div>
    <div class="medal-rule">${esc(ach.rule)}</div>
  </div>`;
}
function renderAchievementsContent() {
  const earnedMap = bag();
  // Live bug hunt (2026-09-11): a.earned() recomputes from scratch on every
  // render (categoryPRCounts() etc. walk `entries` chronologically), so an
  // unrelated edit to an OLDER entry - a plain correction, nowhere near the
  // badge itself - could drop the running PR count back under a tier's
  // threshold and silently re-lock an already-celebrated medal, regressing
  // the score/level computed from this same map below with it. A medal is
  // meant to be permanent once earned - seenAchievementIds already tracks
  // exactly that ("has this ever been true"), added to the moment a badge is
  // first detected (claimNewlyEarned()) and never removed - so it doubles as
  // the "stays earned" record with no new persisted state needed.
  for (const a of ACHIEVEMENTS) earnedMap[a.id] = a.earned() || seenAchievementIds.has(a.id);
  const earnedCount = ACHIEVEMENTS.filter((a) => earnedMap[a.id]).length;
  const score = ACHIEVEMENTS.reduce((s, a) => s + (earnedMap[a.id] ? a.points : 0), 0);
  const level = athleteLevel(score);

  const capstoneAch = ACHIEVEMENTS.find((a) => a.group === "capstone");
  const capstoneSection = `
    <div class="ach-section" style="text-align:center;">
      ${renderMedal(capstoneAch, earnedMap[capstoneAch.id])}
    </div>`;

  const prSections = ACHIEVEMENT_PR_CATEGORIES.map((cat) => `
    <div class="ach-section">
      <div class="ach-section-head"><span class="ach-section-dot" style="background:${CATEGORY_COLORS[cat]};"></span><h2 class="ach-section-title">${esc(CATEGORY_LABELS[cat])}</h2></div>
      <div class="ach-row">${ACHIEVEMENTS.filter((a) => a.group === "pr" && a.cat === cat).map((a) => renderMedal(a, earnedMap[a.id])).join("")}</div>
    </div>`).join("");

  const streakSection = `
    <div class="ach-section">
      <div class="ach-section-head"><span class="ach-section-dot" style="background:var(--energy);"></span><h2 class="ach-section-title">רצף אימונים</h2></div>
      <div class="ach-row">${ACHIEVEMENTS.filter((a) => a.group === "streak").map((a) => renderMedal(a, earnedMap[a.id])).join("")}</div>
    </div>`;

  const boxStartPrompt = boxStartDate ? "" : `
    <button data-action="open-profile-from-achievements" class="card flex items-center justify-between gap-10" style="width:100%; text-align:right; margin-bottom:12px;">
      <span style="font-size:12.5px; color:var(--chalk); font-weight:600;">הוסיפו תאריך התחלה בבוקס כדי לפתוח את מדליות הוותק</span>
      <span style="color:var(--steel); flex-shrink:0;">${ICONS.chevronsLeft}</span>
    </button>`;

  const milestoneSection = `
    <div class="ach-section">
      <div class="ach-section-head"><span class="ach-section-dot" style="background:var(--brass);"></span><h2 class="ach-section-title">אבני דרך</h2></div>
      ${boxStartPrompt}
      <div class="ach-grid">${ACHIEVEMENTS.filter((a) => a.group === "milestone").map((a) => renderMedal(a, earnedMap[a.id])).join("")}</div>
    </div>`;

  const rxSection = `
    <div class="ach-section">
      <div class="ach-section-head"><span class="ach-section-dot" style="background:var(--blue);"></span><h2 class="ach-section-title">Rx לכל אימון</h2></div>
      <div class="ach-grid">${ACHIEVEMENTS.filter((a) => a.group === "rx").map((a) => renderMedal(a, earnedMap[a.id])).join("")}</div>
    </div>`;

  const progressToNext = level.next
    ? `<div class="ach-level-bar"><div class="ach-level-fill" style="width:${Math.min(100, Math.round(((score - level.min) / (level.next.min - level.min)) * 100))}%;"></div></div>
       <div class="ach-summary-label">${level.next.min - score} נקודות עד ${esc(level.next.name)}</div>`
    : `<div class="ach-summary-label">הדרגה הגבוהה ביותר</div>`;

  // Immersive club redesign: Achievements is a modal overlay, not a
  // tab-driven .scene-page (registering it in PAGE_SCENES would have no
  // effect - render() only stamps body[data-scene] per `tab`, and this
  // overlay sits above the whole app regardless of which tab is behind
  // it). Its own #achievementsOverlay already has a real close button in
  // .modal-head, so that bar stays untouched rather than fighting the
  // modal chrome every other dialog in the app shares - this is a
  // self-contained mini-scene (full-bleed photo + scrim + white title)
  // inside the modal's own scrollable content area, not a second header
  // grid. -16px/-24px bleed matches .modal-list's own 16px/24px padding
  // (index.html) exactly, so the photo touches the modal's real left/right
  // edges rather than floating as a bordered card.
  return `
    <section class="scene-page scene-page--achievements" aria-labelledby="achievementsSceneTitle">
      <div class="scene-page__media" aria-hidden="true"></div>
      <div class="scene-page__scrim" aria-hidden="true"></div>
      <div class="scene-page__intro"><h2 id="achievementsSceneTitle" class="scene-page__title">מדליות</h2></div>
      <div class="scene-sheet">
    <div class="ach-summary">
      <div class="ach-summary-level">${esc(level.name)}</div>
      <div class="ach-summary-num mono">${bidiUnit(`${score} נקודות`)}</div>
      ${progressToNext}
      <div class="ach-summary-label" style="margin-top:8px;">${earnedCount} / ${ACHIEVEMENTS.length} מדליות</div>
    </div>
    ${renderNextAchievementNudge()}
    ${capstoneSection}
    ${prSections}${streakSection}${milestoneSection}${rxSection}
      </div>
    </section>
  `;
}
let achievementsOpenerEl = null;
// Real-user report, root cause: the "who" card that opens this lives
// inside the nav menu, and nothing ever closed the menu when it did - so
// navMenuOverlay stayed "open" (its own isOpen() check still true)
// directly underneath achievements, and currentAppDialog() (used by both
// Escape and the back-button history handler below) returns the FIRST
// registered dialog whose isOpen() is true, in APP_DIALOGS' own
// registration order - navMenu before achievements. Escape or the phone
// back button then closed the hidden nav menu instead of the visible
// achievements sheet, which from the tapping-it-repeatedly-and-nothing-
// visibly-changing user's side of the screen reads exactly as "no way to
// close this." closeNavMenu() is already a safe no-op when the menu isn't
// open (checks navMenuOpen itself), so this costs nothing when
// achievements is opened from userGreeting/the header link instead.
function openAchievements() {
  closeNavMenu();
  achievementsOpenerEl = document.activeElement;
  document.body.style.overflow = "hidden";
  document.getElementById("achievementsOverlay").classList.add("open");
  document.getElementById("achievementsList").innerHTML = renderAchievementsContent();
  setTimeout(() => focusFirstAppDialogEl("achievementsOverlay"), 50);
}
function closeAchievements() {
  document.body.style.overflow = "";
  document.getElementById("achievementsOverlay").classList.remove("open");
  if (achievementsOpenerEl && typeof achievementsOpenerEl.focus === "function") achievementsOpenerEl.focus();
  achievementsOpenerEl = null;
}

// Which badges the athlete has already been shown a celebration for, so a
// save only pops the modal for what's genuinely new this time.
const SEEN_ACHIEVEMENTS_KEY = "haimunia:seenAchievements";
let seenAchievementIds = new Set();
async function loadSeenAchievements() {
  try {
    const v = await dbGetSetting(SEEN_ACHIEVEMENTS_KEY);
    if (Array.isArray(v)) { seenAchievementIds = new Set(v); return; }
  } catch (e) { /* fall through to baseline */ }
  // First time this ships: baseline whatever's already earned silently, so
  // existing progress doesn't trigger a flood of celebrations on next open.
  baselineSeenAchievements();
}
// Marks everything the current history already justifies as seen, without
// celebrating it. A UNION with what was seen before, never a replacement:
// the seen set is also what keeps a medal earned once it has been shown
// (see the achievements screen's earnedMap), including a PR bronze the 2.x
// app awarded at its old threshold of one PR - replacing the set would take
// that medal back.
function baselineSeenAchievements() {
  for (const a of ACHIEVEMENTS) if (a.earned()) seenAchievementIds.add(a.id);
  dbSetSetting(SEEN_ACHIEVEMENTS_KEY, [...seenAchievementIds]).catch(() => {});
}
function newlyEarnedAchievements() {
  return ACHIEVEMENTS.filter((a) => a.earned() && !seenAchievementIds.has(a.id));
}

// Marks everything newly earned as seen (so nothing pops later out of
// context) and returns only the badges allowed to interrupt. A silent badge
// is still earned, still listed and still scored — see the `silent` flag on
// the tenure milestones and design spec 5.2 tier C.
function claimNewlyEarned() {
  const newlyEarned = newlyEarnedAchievements();
  if (!newlyEarned.length) return [];
  for (const a of newlyEarned) seenAchievementIds.add(a.id);
  dbSetSetting(SEEN_ACHIEVEMENTS_KEY, [...seenAchievementIds]).catch(noteStorageError);
  return newlyEarned.filter((a) => !a.silent);
}
function checkForNewAchievements() {
  const loud = claimNewlyEarned();
  if (!loud.length) return;
  showCelebration(null, loud);
}
// prLabel: a short "Exercise — 92.5 kg" style string when this save itself
// was a personal record, or null. Badges and a plain PR can land in the
// same save (a PR that also crosses a tier threshold) - one popup covers
// both instead of firing twice back to back.
function celebrateAfterSave(prLabel, savedLabel) {
  const newBadges = claimNewlyEarned();
  if (!prLabel && !newBadges.length) {
    // FOUND BY WALKING IT (round 10): an ordinary save - not a first entry, not
    // a PR, not a new badge - gave the member almost nothing back. The button
    // stayed enabled with the same weight and reps still loaded, and the only
    // change on screen was one more line in the session list. A member unsure
    // whether the tap registered tapped again and logged the set twice.
    //
    // A confirmation, not a dedupe: two identical sets ARE a normal thing to
    // log (three sets of 90x5 is three real rows), so refusing or merging the
    // second one would break the most ordinary flow in the app to fix a
    // feedback problem. Telling the member the save landed is the actual fix.
    // render() is what PAINTS a toast - showToast() only stores it (see the
    // note beside the restore-failed toast). Both callers here have already
    // rendered by this point, so without this the confirmation would sit in
    // pendingToast until some unrelated render happened to flush it, which is
    // to say: it would look implemented and do nothing.
    if (savedLabel) { showToast(savedLabel); render(); }
    return;
  }
  showCelebration(prLabel, newBadges);
}
// Design spec §1.2 S4 / §5.2 tier A, entry 1: the member's first-ever saved
// entry, framed as ARRIVAL rather than as a record.
//
// Two things this deliberately is not. It is not a medal - with no history
// every set is trivially a personal best, and a card that says שיא אישי on
// day one is precisely how a member learns the phrase means nothing (which
// is what the beginner persona concluded, in those words). And it is not an
// extra interruption: before this, the first save produced no acknowledgment
// at all, because §5.3's PR gates correctly withhold one. The app's single
// most important moment had no response to it. This is that response, and
// it is the only full-screen card a member can receive on day one.
//
// It also earns the right to ask the next question: S5's backup-consent card
// renders on the screen behind this one, so the app has given something
// before it asks for anything.
function celebrateFirstLog(label) {
  firstLogCelebrated = true;
  dbSetSetting(FIRST_LOG_CELEBRATED_KEY, true).catch(noteStorageError);
  // Claimed, not skipped: claimNewlyEarned() is what marks a badge seen, so
  // routing around it would silently swallow anything that legitimately
  // unlocked on this same save. In practice nothing does on entry one (the
  // lowest rung of every family needs 3+), and then badges is empty and no
  // medal is drawn - which is the outcome the spec asks for. If something
  // ever does unlock here it rides along inside this one card rather than
  // queueing a second one behind it.
  const badges = claimNewlyEarned();
  showCelebration(label, badges, {
    arrival: true,
    title: "הרישום הראשון שלך נשמר",
    sub: "מכאן זה מצטבר. כל אימון שתרשמו יופיע ביומן ובגרפים.",
  });
}
let celebrationOpenerEl = null;
// UX audit: a celebration rendered on top of the 5-screen onboarding
// explainer and hid it — both are .modal-overlay at the same z-index:50, so
// two open at once stack by DOM order, not by which one is logically on top
// (cloud.js hit the identical class of bug, see COMM-234 there). The
// walkthrough is a flow you step through, not something to be interrupted,
// so a celebration that lands while it is open is held and replayed on
// close instead of being dropped: the badge is already marked seen by the
// time we get here, so dropping it would silently swallow it.
//
// Generalised past the one overlay that was caught: the rule is that at most
// one .modal-overlay carries .open at a time, so the celebration waits for
// ANY registered app dialog, not just the explainer. The dialog registry
// (registerAppDialog / APP_DIALOGS, further down this file) already knows
// which ones are open, so this is a gate in front of existing infrastructure
// rather than new bookkeeping.
//
// Two entries are excluded, both deliberately:
//   - "celebration" itself, or it could never open.
//   - "welcome", the boot-time first-run sheet. It owns focus and traps it,
//     so no logging action is reachable while it is up; and its own exit
//     path (saveWelcomeForm) closes it before running the achievement check,
//     so gating on it would only ever defer popups that cannot occur through
//     the UI. Onboarding, which that same exit path opens straight after, IS
//     included — that is the stack the audit actually photographed.
const CELEBRATION_NON_BLOCKING_DIALOGS = ["celebration", "welcome"];
let deferredCelebration = null;
function blockingDialogOpen() {
  for (const key in APP_DIALOGS) {
    if (CELEBRATION_NON_BLOCKING_DIALOGS.indexOf(key) >= 0) continue;
    try { if (APP_DIALOGS[key].isOpen()) return true; } catch (e) { /* overlay not in the DOM yet */ }
  }
  return false;
}
function flushDeferredCelebration() {
  if (!deferredCelebration || blockingDialogOpen()) return;
  const held = deferredCelebration;
  deferredCelebration = null;
  showCelebration(held.prLabel, held.badges, held.opts);
}
// opts, when given, overrides the two lines of framing this card writes
// about itself: { title, sub }. Only the arrival card (§5.2 tier A #1) uses
// it, and it exists because that card must NOT say שיא אישי - see
// celebrateFirstLog() for why that distinction is the whole point.
function showCelebration(prLabel, badges, opts) {
  if (blockingDialogOpen()) {
    // Merge rather than replace: the welcome form can fire more than one of
    // these before it closes, and one popup covering both is the same rule
    // celebrateAfterSave() already follows for a PR that also lands a badge.
    const held = deferredCelebration || { prLabel: null, badges: [] };
    const ids = new Set(held.badges.map((a) => a.id));
    deferredCelebration = { prLabel: prLabel || held.prLabel, badges: held.badges.concat(badges.filter((a) => !ids.has(a.id))), opts: opts || held.opts };
    return;
  }
  const title = document.getElementById("celebrationTitle");
  if (title) title.textContent = (opts && opts.title) ? opts.title : (badges.length ? "כל הכבוד!" : "שיא אישי חדש!");
  const prLine = document.getElementById("celebrationPrLine");
  if (prLine) {
    prLine.textContent = prLabel || "";
    prLine.style.display = prLabel ? "block" : "none";
  }
  const medalsEl = document.getElementById("celebrationMedals");
  if (medalsEl) medalsEl.innerHTML = badges.map((a) => renderMedal(a, true)).join("");
  const sub = document.getElementById("celebrationSub");
  if (sub) {
    sub.textContent = (opts && opts.sub) ? opts.sub : (badges.length
      ? (badges.length > 1 ? `${badges.length} מדליות חדשות נפתחו — תמשיכו ככה!` : "מדליה חדשה נפתחה — תמשיכו ככה!")
      : "תמשיכו ככה!");
  }
  document.body.style.overflow = "hidden";
  celebrationOpenerEl = document.activeElement;
  // Recorded as the card opens, and carried through the deferral queue by
  // opts, so closeCelebration() below can tell an arrival card from an
  // ordinary badge one without asking the DOM what it looks like.
  celebrationShowingArrival = !!(opts && opts.arrival);
  const overlayEl = document.getElementById("celebrationOverlay");
  // Fresh-eyes audit, trainee persona: this card fires exactly once per
  // member, ever, and the report was specifically that it read over a
  // busy, translucent scrim - the log form's weight slider and %-of-1RM
  // chips were still visible (and, since the base .modal-overlay carries
  // no pointer-events change, still genuinely interactive) directly behind
  // the one message this app most wants to land cleanly. Every OTHER
  // celebration keeps the standard scrim unchanged - only this one-time
  // arrival gets the opaque backdrop, via a class rather than editing the
  // shared .modal-overlay rule every dialog in the app uses.
  overlayEl.classList.toggle("arrival-card", celebrationShowingArrival);
  overlayEl.classList.add("open");
  setTimeout(() => focusFirstAppDialogEl("celebrationOverlay"), 50);
}
function closeCelebration() {
  document.body.style.overflow = "";
  document.getElementById("celebrationOverlay").classList.remove("open", "arrival-card");
  if (celebrationOpenerEl && typeof celebrationOpenerEl.focus === "function") celebrationOpenerEl.focus();
  celebrationOpenerEl = null;
  // THE moment S5 has been waiting for: not "the overlay stopped being
  // visible" but "the member answered the arrival card". Clearing the debt
  // here, and only for the card that actually owed it, is what makes S5's
  // ordering a fact rather than a race - see shouldShowBackupConsent().
  if (celebrationShowingArrival) {
    celebrationShowingArrival = false;
    firstLogArrivalPending = false;
  }
  // The consent card was suppressed on the render that ran during the save,
  // so the screen underneath is a render behind. This is what makes
  // "arrival answered -> the card is there" true rather than "there on the
  // next thing that happens to render".
  render();
}

// ---------- Update notifications ----------
// Short, user-facing changelog — deliberately separate from CHANGES.md,
// which is developer-facing, technical, and in English. Only add an entry
// here when something a member would actually notice shipped; not every
// version bump needs one. Same list backs both the auto-shown "what's new"
// popup and the bell icon's persistent history — see openNotifications().
// Everything up to 2.34.0 is the 2.x app's own list, verbatim: it is the
// history members actually saw, and their stored lastSeenVersion ("2.34.0")
// is what makes only the entries above it show on first open.
const RELEASE_NOTES = [
  { version: "3.1.0", date: "2026-09-23", items: [
    "ספירת שימוש: המועדון יודע כמה משתמשים באפליקציה וכמה רושמים אימונים, לפי מזהה אקראי של הטלפון — בלי שם ובלי שום פרט מהאימונים. אפשר לכבות בהגדרות ← ספירת שימוש",
  ] },
  { version: "3.0.0", date: "2026-09-23", items: [
    "כל האימונים, המדידות, האימונים שבניתם וההגדרות שלכם נשארו בדיוק איפה שהיו — אין צורך לעשות כלום",
    "עיצוב חדש לכל האפליקציה: תמונות מהמועדון, מצב כהה ובהיר, ואפשרות לטקסט גדול",
    "ניווט חדש: שורת טאבים למטה, ותפריט (☰ למעלה) להגדרות ולשאר המסכים",
    "במסך הרישום: יעדי משקל באחוזים מה-1RM שלכם, בלחיצה אחת",
    "במסך ההתקדמות: מעקב מבחנים (Benchmarks) עם תזכורת מתי לבדוק שוב",
    "באימונים: Rx+, רישום עם שותף/ה, ו-7 אימוני Girls ו-Heroes חדשים",
    "11 תרגילים חדשים, ובונה האימונים זוכר תרגילים שהוספתם",
  ] },
  { version: "2.34.0", date: "2026-09-02", items: [
    "עיצוב מחודש למסכי הרישום, ה-WOD, ההיסטוריה, לוח השנה וההישגים",
    "מסך הרישום כבר לא \"מניח\" ש-Back Squat זה מה שעשיתם — הוא שואל מה עשיתם היום, עד שתבחרו בעצמכם",
    "בבניית אימון אפשר עכשיו לקבוע מגבלת זמן גם בשניות, לא רק בדקות",
    "תיקון: המקלדת בטלפון הייתה יכולה לכסות שדה שממש הקלדתם לתוכו",
    "יש שאלה, רעיון או תקלה לדווח? בהגדרות יש עכשיו קישור ישיר אלינו",
  ] },
  { version: "2.33.0", date: "2026-09-02", items: [
    "תיקון: שורת הניווט התחתונה הייתה יכולה להיראות \"תלויה\" מעל תוכן העמוד במכשירים מסוימים — עכשיו היא תמיד צמודה לתחתית המסך",
  ] },
  { version: "2.32.0", date: "2026-09-02", items: [
    "הניווט חזר לשורת טאבים למטה — לחיצה אחת לכל מסך, במקום דרך תפריט. כפתור ההגדרות (⚙ למעלה) פותח את ההגדרות ישירות",
    "שיפורי נגישות: כל החלונות הקופצים תומכים עכשיו ב-Escape לסגירה וב-Tab למעבר בין השדות בלי \"לברוח\" מהחלון",
  ] },
  { version: "2.31.0", date: "2026-09-02", items: [
    "עיצוב מחודש: תפריט המבורגר חדש (הכפתור ☰ למעלה) עם כל המסכים העיקריים, במקום שורת הטאבים הקבועה",
    "ההגדרות, גיבוי/שחזור נתונים ומחיקת נתונים עברו מהפוטר לתפריט ⟵ הגדרות — פחות עומס בתחתית כל מסך",
    "ריענון ויזואלי לכרטיסים בכל האפליקציה — פינות, צללים ומרווחים מוקפדים יותר",
  ] },
  { version: "2.30.5", date: "2026-09-02", items: [
    "תזכורת גיבוי מוקדמת יותר: הודעה על גיבוי שלא בוצע תופיע אחרי 21 יום במקום 30, כדי לצמצם סיכון לאובדן נתונים",
  ] },
  { version: "2.30.4", date: "2026-08-30", items: [
    "תיקון: גרף ההתקדמות הציג ירידה מזויפת ביום עם כמה סטים (למשל סולם יורד) — עכשיו הוא מציג את השיא של כל יום, לא כל סט בנפרד",
    "לפעמים הטלפון לא שומר את נתוני האפליקציה (כמו השם שלכם) בין פתיחות — זה קורה בעיקר כשלא מתקינים את האפליקציה למסך הבית. אם זה קורה לכם, כדאי להתקין דרך שיתוף ⬆️ ואז \"הוספה למסך הבית\". יש רעיון לשיפור או נתקלתם בבעיה? תפנו אלינו.",
  ] },
  { version: "2.30.2", date: "2026-08-26", items: [
    "תיקון: הזוהר סביב מדליה שנפתחה כבר לא נראה מרובע",
  ] },
  { version: "2.30.1", date: "2026-08-26", items: [
    "מדליות ברונזה/כסף/זהב מבריקות יותר וברורות יותר כשהן עדיין נעולות",
  ] },
  { version: "2.30.0", date: "2026-08-26", items: [
    "עיטורי ברונזה/כסף/זהב מוצגים עכשיו כמדליות משקולת אמיתיות",
  ] },
  { version: "2.29.1", date: "2026-08-26", items: [
    "\"בוקס\" הוחלף ל\"מועדון\" בכל מקום באפליקציה",
  ] },
  { version: "2.29.0", date: "2026-08-26", items: [
    "בבניית EMOM: אפשר עכשיו גם תרגילי החזקה בזמן, וגם סבבי מנוחה בסיבוב",
    "תרגילי קלוריות ומטרים (ריצה, חתירה, אופניים) מקבלים עכשיו תווית נכונה במקום \"חזרות\"",
    "אפשר למחוק אימון מותאם אישית שעדיין לא נרשם עליו כלום, ישירות מרשימת האימונים",
  ] },
  { version: "2.28.0", date: "2026-08-26", items: [
    "אפשר עכשיו להוסיף משקל לתרגילים בסבב EMOM (כמו Wall Balls) — לא רק חזרות",
  ] },
  { version: "2.27.3", date: "2026-08-26", items: [
    "תיקון קטן: מחיקת כל הנתונים מכבה עכשיו גם סולם פעיל, כדי שלא יישאר \"תקוע\" פעיל",
  ] },
  { version: "2.27.2", date: "2026-08-26", items: [
    "תיקון: מעבר לתרגיל או אימון אחר באמצע עריכה יכול היה לדרוס בטעות רישום קיים — עכשיו זה מתחיל רישום חדש כמו שצריך",
  ] },
  { version: "2.27.1", date: "2026-08-26", items: [
    "תיקון: אפשר עכשיו להגיע ל\"כל האימונים שלי\" גם כשלא נבחר אימון עדיין",
  ] },
  { version: "2.27.0", date: "2026-08-26", items: [
    "טאב האימונים כבר לא נפתח עם אימון קבוע (Fran) — עכשיו בוחרים בעצמכם: יצירת אימון או בנצ'מרק",
  ] },
  { version: "2.26.0", date: "2026-08-26", items: [
    "אפשר עכשיו לשנות את גודל הטקסט בכל האפליקציה — בתחתית המסך, ליד הגדרות המראה",
    "לוגו ואייקון חדשים לאפליקציה",
  ] },
  { version: "2.25.1", date: "2026-08-26", items: [
    "תיקון: הקשה ישירה על מספר בכל שדה באפליקציה איפסה אותו במקום לאפשר הקלדה — עכשיו אפשר פשוט להקליד",
  ] },
  { version: "2.25.0", date: "2026-08-25", items: [
    "טאב חדש \"בנצ'מרקים\" באימונים — כל אימוני ה-Girls וה-Heroes הקבועים, במקום אחד",
    "ההתראות בפעמון נעלמות אחרי שרואים אותן, במקום להצטבר",
  ] },
  { version: "2.24.0", date: "2026-08-25", items: [
    "אפשר לרשום סופרסט — שני תרגילים לסירוגין תחת אותו סולם, עם תווית בלוק (A/B/C/D) לתוכניות מסודרות",
    "פורמט EMOM חדש באימונים: בונים סבב תרגילים מתחלף ורושמים חזרות לכל תרגיל בנפרד",
    "אפשר להוסיף מגבלת זמן לאימונים",
  ] },
  { version: "2.23.0", date: "2026-08-25", items: [
    "אפשר לרשום גם תרגילי החזקה בזמן (כמו פלאנק או תלייה) — לא רק משקל וחזרות",
  ] },
  { version: "2.22.0", date: "2026-08-25", items: [
    "הקשה על \"אימון אחרון\" ממלאת אוטומטית את המשקל והחזרות",
    "סטים בסולם (כמה סטים ברצף, כל אחד במשקל שונה) — עכשיו קל יותר למצוא ולהשתמש",
  ] },
];
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
const LAST_SEEN_VERSION_KEY = "haimunia:lastSeenVersion";
let lastSeenVersion = null;
async function loadLastSeenVersion() {
  try {
    const v = await dbGetSetting(LAST_SEEN_VERSION_KEY);
    lastSeenVersion = typeof v === "string" ? v : null;
  } catch (e) { lastSeenVersion = null; }
}
function markNotificationsSeen() {
  lastSeenVersion = APP_VERSION;
  dbSetSetting(LAST_SEEN_VERSION_KEY, APP_VERSION).catch(noteStorageError);
}
function unseenReleaseNotes() {
  if (!lastSeenVersion) return [];
  return RELEASE_NOTES.filter((r) => compareVersions(r.version, lastSeenVersion) > 0);
}
// Live report: opening "מה חדש" always dumped the FULL history back to the
// oldest entry ever written (RELEASE_NOTES only ever grows), so a member
// who had already caught up saw the exact same wall of months-old entries
// every single time - "currently it's super old". lastSeenVersion already
// existed (it drives the header badge and the one-time "חדש" tag below) but
// nothing used it to stop SHOWING an entry once it had been seen - only to
// stop highlighting it as new. Self-cleaning fix: render only entries newer
// than lastSeenVersion, i.e. exactly what unseenReleaseNotes() already
// computes for the badge count. Must be read before openNotifications()
// calls markNotificationsSeen() (it already is - render happens first) or
// this would always render empty.
function renderNotificationsList() {
  const el = document.getElementById("notificationsList");
  if (!el) return;
  const toShow = unseenReleaseNotes();
  if (!toShow.length) {
    // Local var rather than the ternary inline: test/app-innerhtml-sinks.test.mjs
    // (SEC-018) checks each innerHTML sink's ${...} expressions by exact
    // text, and only recognizes esc()/Number()-wrapped values, bare digits,
    // or an allow-listed identifier - not an inline ternary of literals.
    const notifEmptyMessage = RELEASE_NOTES.length ? "אין עדכונים חדשים" : "אין עדכונים עדיין";
    el.innerHTML = `<div class="empty">${notifEmptyMessage}</div>`;
    return;
  }
  // Every entry rendered here is by definition unseen (that is now the only
  // way to reach this branch), so the old per-item "חדש" tag - previously
  // needed to distinguish new from old within one long, undifferentiated
  // list - would just repeat on every row and is dropped.
  el.innerHTML = toShow.slice().reverse().map((r) => `
    <div class="cat-group">
      <div class="cat-head flex items-center gap-8">
        <span class="cat-name mono" style="direction:ltr; unicode-bidi:isolate;">${esc(r.version)}</span>
        <span style="color:var(--steel); font-size:11px; margin-inline-start:auto;">${esc(fmtDate(r.date))}</span>
      </div>
      <ul style="margin:6px 0 4px; padding-inline-start:20px; color:var(--chalk); font-size:13.5px; line-height:1.6;">
        ${r.items.map((i) => `<li>${esc(i)}</li>`).join("")}
      </ul>
    </div>`).join("");
}
// Fresh-eyes audit: this one always-visible header control used to be
// wired only to the offline "what's new" release notes, so a member could
// have unread reactions/comments/achievement notifications and no signal
// for them anywhere outside the Community tab's own small bell chip - the
// least exciting thing in the app (a changelog) had the most prominent,
// every-screen real estate, and the most exciting thing (someone responded
// to you) had none. Real community notifications now take priority here;
// release notes moved into Settings (see the "מה חדש" row there) as a
// permanent link that no longer needs to fight for header space to stay
// discoverable.
function updateNotificationsBadge() {
  const badge = document.getElementById("notificationsBadge");
  const btn = document.getElementById("notificationsBellBtn");
  if (!badge) return;
  const count = unseenReleaseNotes().length;
  badge.textContent = count > 9 ? "9+" : String(count);
  badge.style.display = count > 0 ? "flex" : "none";
  if (btn) btn.setAttribute("aria-label", "עדכוני גרסה");
}
// Prefers the real community notification center when there's something
// unread there; falls back to the offline release-notes overlay otherwise
// (including when Community isn't configured at all, or the member isn't
// signed into it - window.openCommunityNotifCenter simply isn't a function
// yet in either case, same guard used everywhere else this app checks for
// cloud.js).
function openHeaderNotifications() {
  // onlyIfUnseen, and a toast when there is nothing: see openNotifications().
  // The bell is a notifications control, not a changelog link - answering it
  // with an empty "מה חדש" sheet was the reported defect. The badge is
  // refreshed first because the commonest way to get here with social > 0 and
  // no centre to open is a stale count.
  if (openNotifications({ onlyIfUnseen: true })) return;
  updateNotificationsBadge();
  // render(), because showToast() only STORES the pending toast - the same
  // pairing every other showToast() call site in this file uses.
  showToast("אין התראות חדשות");
  render();
}
// A real, user-reported bug: on Chrome/Android, "every time I open the app
// it looks a bit up, then a scroll fixes it" - the bottom tab bar
// specifically, confirmed by the user. Root cause: while a boot-time modal
// (welcome / onboarding / release-notes) is open, document.body.style.overflow
// is "hidden" (each open*() below sets it), which keeps the page unscrollable
// - and Chrome will not collapse its own URL bar while the page can't scroll.
// Closing the modal restores scrollability, but the browser only re-collapses
// its chrome in response to an actual scroll gesture, not automatically. Until
// that happens, #bottomBar/#bottomTabBar (position:fixed; bottom:0) are laid
// out against the taller, stale viewport and sit visibly higher than their
// real resting place - exactly "a bit up" - until the user's own first scroll
// fixes it. A version bump (like this session's) makes this hit almost every
// returning member on their next open, since openNotifications() below is
// what shows them "what's new".
//
// Fix: nudge the browser into recalculating immediately instead of waiting
// for the user. #app's own bottom padding (200px + safe-area-inset-bottom)
// guarantees real scrollable room even on a short tab, so this always has
// somewhere to move. rAF-deferred so it runs after the overflow unlock (and
// this modal's close animation, if any) has actually taken effect.
function nudgeViewportAfterModalClose() {
  requestAnimationFrame(() => {
    window.scrollBy(0, 1);
    window.scrollBy(0, -1);
  });
}
let notificationsOpenerEl = null;
// `onlyIfUnseen` - NEVER OPEN AN EMPTY CHANGELOG THE MEMBER DID NOT ASK FOR.
//
// Reported from a real phone: "the מה חדש sheet opens on the log screen with
// only אין עדכונים חדשים". Reproduced in Chromium, and the path is the bell,
// not the boot gate: openHeaderNotifications() below prefers the COMMUNITY
// notification centre when there is something unread there and falls back to
// this sheet when window.openCommunityNotifCenter is missing or returns
// false - which is exactly the state of a device where the badge is counting
// real community notifications but the centre cannot open (community not
// configured on this device, signed out, module off). The member taps a
// badge that says three things are waiting and gets a full-screen changelog
// that says nothing is.
//
// The guard goes INSIDE this function rather than at that one call site, so
// it also covers the boot gate and any caller added later: a sheet opened on
// the app's own initiative has to have something to say. The one caller that
// deliberately passes nothing is Settings' "מה חדש" row, where an empty
// sheet is the honest answer to a direct question.
//
// Returns whether it opened, so a caller can fall through to its own answer.
function openNotifications(opts) {
  if (opts && opts.onlyIfUnseen && !unseenReleaseNotes().length) return false;
  notificationsOpenerEl = document.activeElement;
  renderNotificationsList();
  document.body.style.overflow = "hidden";
  document.getElementById("notificationsOverlay").classList.add("open");
  if (unseenReleaseNotes().length) { markNotificationsSeen(); updateNotificationsBadge(); }
  setTimeout(() => focusFirstAppDialogEl("notificationsOverlay"), 50);
  return true;
}
function closeNotifications() {
  document.body.style.overflow = "";
  nudgeViewportAfterModalClose();
  document.getElementById("notificationsOverlay").classList.remove("open");
  if (notificationsOpenerEl && typeof notificationsOpenerEl.focus === "function") notificationsOpenerEl.focus();
  notificationsOpenerEl = null;
}

// ---------- Support and bug reporting ----------
// Added 2026-09-15, straight out of the first real-phone session this app
// ever had. Four things were reported as "not working" that day, and the
// only reason they reached anybody is that the person holding the phone was
// also the person who could fix them. A member has no such channel: the app
// has never had a single route for "this is broken" or "I need help", so
// every one of those reports would have ended as a shrug, or as a message in
// the club WhatsApp group that nobody with the code ever reads.
//
// WHY THIS LIVES IN app.js AND NOT cloud.js. Community is opt-in, and the
// training log works with no account, no network and no Supabase at all. A
// member who never joined Community is exactly as entitled to report a bug as
// one who did - more so, since the offline log is the part they use daily.
// Putting this in cloud.js would have made "can I ask for help" depend on
// having said yes to a social feed.
//
// WHY IT HANDS OFF INSTEAD OF WRITING TO THE DATABASE. Reporting a bug is
// precisely the moment the app might be the broken thing. A table write needs
// a live client, a network, a valid session and an intact RLS path - four
// things a bug report should never be gated on. Composing the text locally
// and handing it to WhatsApp or mail costs none of them, works in airplane
// mode, and leaves the member holding their own copy of what they sent.
// See cloud-config.js's supportWhatsApp/supportEmail for the routing.
function supportConfig() {
  const c = (typeof window !== "undefined" && window.HAIMUNIA_CONFIG) || {};
  const digits = String(c.supportWhatsApp || "").replace(/[^0-9]/g, "");
  return { whatsapp: digits, email: String(c.supportEmail || "").trim() };
}
// What the developer needs and the member should not have to be asked for.
// Deliberately contains nothing personal: no name, no handle, no training
// data, no invite code. Version + platform + the three state bits that
// change how the app behaves are what actually narrow a bug down, and every
// one of them is about the DEVICE, not the person. The member can read the
// whole block before sending it - it is rendered on screen, not attached
// invisibly, because a report that quietly ships facts about someone's phone
// without showing them is not something this app should do.
function supportDiagnostics() {
  const online = typeof navigator !== "undefined" && "onLine" in navigator ? (navigator.onLine ? "מקוון" : "לא מקוון") : "לא ידוע";
  return [
    `גרסה: ${APP_VERSION}`,
    `מותקן במסך הבית: ${isStandalone() ? "כן" : "לא"}`,
    `חיבור: ${online}`,
    `דפדפן: ${typeof navigator !== "undefined" ? String(navigator.userAgent || "").slice(0, 160) : "לא ידוע"}`,
  ].join("\n");
}
function supportReportText() {
  const typed = (document.getElementById("supportMessage") || {}).value || "";
  return `דיווח על תקלה — ${brandName()}\n\n${typed.trim() || "(לא נכתב תיאור)"}\n\n--- פרטים טכניים ---\n${supportDiagnostics()}`;
}
function renderSupportContent() {
  const cfg = supportConfig();
  // No configured channel is not a dead end: the member still writes the
  // report and copies it, which is strictly better than a screen that says
  // "contact support" and offers no way to.
  const routes = [];
  if (cfg.whatsapp) routes.push(`<button class="chip-btn primary" data-action="support-send-whatsapp">שליחה בוואטסאפ</button>`);
  if (cfg.email) routes.push(`<button class="chip-btn" data-action="support-send-email">שליחה במייל</button>`);
  routes.push(`<button class="chip-btn" data-action="support-copy">העתקת הדיווח</button>`);
  return `
    <div class="settings-block">
      <div class="settings-block-title">מה קרה?</div>
      <div class="footer-note" style="margin-bottom:8px;">כתבו מה ניסיתם לעשות ומה קרה בפועל. ככל שיהיה מדויק יותר, כך יהיה קל יותר לתקן.</div>
      <label class="field"><span class="field-label">תיאור התקלה</span>
        <textarea class="text-input" id="supportMessage" rows="5" dir="auto" placeholder="למשל: לחצתי על שמירת סט ולא קרה כלום"></textarea>
      </label>
      <div class="chip-row">${routes.join("")}</div>
      <div class="footer-note" id="supportSendNote" role="status" aria-live="polite" style="margin-bottom:0;"></div>
    </div>
    <div class="settings-block">
      <div class="settings-block-title">פרטים טכניים שיישלחו</div>
      <div class="footer-note" style="margin-bottom:6px;">אלה פרטים על המכשיר בלבד — בלי השם שלכם, בלי יומן האימונים ובלי שום נתון אישי.</div>
      <pre class="mono" style="white-space:pre-wrap;word-break:break-word;font-size:11.5px;color:var(--steel);margin:0;">${esc(supportDiagnostics())}</pre>
    </div>`;
}
let supportOpenerEl = null;
function openSupport() {
  closeNavMenu();
  supportOpenerEl = document.activeElement;
  document.getElementById("supportBody").innerHTML = renderSupportContent();
  document.body.style.overflow = "hidden";
  document.getElementById("supportOverlay").classList.add("open");
  setTimeout(() => focusFirstAppDialogEl("supportOverlay"), 50);
}
function closeSupport() {
  nudgeViewportAfterModalClose();
  document.getElementById("supportOverlay").classList.remove("open");
  // After the class is removed, so this dialog no longer counts as open.
  // Support is reachable from a row INSIDE the still-open Settings sheet, and
  // clearing the lock unconditionally let the page scroll behind it.
  releaseScrollLockIfLastDialog();
  if (supportOpenerEl && typeof supportOpenerEl.focus === "function") supportOpenerEl.focus();
  supportOpenerEl = null;
}
function supportNote(text) {
  const el = document.getElementById("supportSendNote");
  if (el) el.textContent = text;
}
// window.open(..., "_blank") rather than assigning location: a wa.me or
// mailto: handoff that fails to resolve should leave the member on their
// half-written report, not navigate the app away from it.
function supportHandoff(url, failText) {
  try {
    const w = window.open(url, "_blank");
    if (!w) supportNote(failText);
  } catch (e) { supportNote(failText); }
}
function supportSendWhatsApp() {
  const cfg = supportConfig();
  if (!cfg.whatsapp) return supportNote("לא הוגדר מספר וואטסאפ לתמיכה. אפשר להעתיק את הדיווח ולשלוח אותו ידנית.");
  supportHandoff(`https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(supportReportText())}`,
    "לא הצלחנו לפתוח את וואטסאפ. אפשר להעתיק את הדיווח ולשלוח אותו ידנית.");
}
function supportSendEmail() {
  const cfg = supportConfig();
  if (!cfg.email) return supportNote("לא הוגדרה כתובת מייל לתמיכה. אפשר להעתיק את הדיווח ולשלוח אותו ידנית.");
  supportHandoff(`mailto:${encodeURIComponent(cfg.email)}?subject=${encodeURIComponent("דיווח על תקלה — " + brandName())}&body=${encodeURIComponent(supportReportText())}`,
    "לא הצלחנו לפתוח את אפליקציית המייל. אפשר להעתיק את הדיווח ולשלוח אותו ידנית.");
}
function supportCopyReport() {
  const text = supportReportText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => supportNote("הדיווח הועתק. אפשר להדביק אותו בוואטסאפ, במייל או בכל מקום אחר."))
      .catch(() => supportNote("ההעתקה נכשלה. אפשר לסמן את הטקסט ולהעתיק ידנית."));
    return;
  }
  supportNote("ההעתקה לא נתמכת בדפדפן הזה. אפשר לסמן את הטקסט ולהעתיק ידנית.");
}

// ---------- First-time onboarding ----------
const HAS_ONBOARDED_KEY = "haimunia:hasOnboarded";
let hasOnboarded = true; // default true so existing devices never see it by accident
async function loadOnboardedFlag() {
  try {
    const v = await dbGetSetting(HAS_ONBOARDED_KEY);
    hasOnboarded = v === true;
  } catch (e) { hasOnboarded = true; }
}
let onboardingOpenerEl = null;
// Design spec §1.2 S3. The explainer's CONTENT is untouched - it is one of
// the best-written things in the product and two personas said so. What
// changes is that it is no longer a gate (nothing opens it but a tap), its
// primary button no longer duplicates the welcome sheet's label, and it now
// says out loud that it can be reached again. That last line is the whole
// reason a member can afford to skip it.
//
// Both are applied here rather than in index.html because index.html is
// owned by another pass right now; they are also the kind of thing that
// belongs in the markup, and the handoff notes says so.
function applyOnboardingCopy() {
  const overlay = document.getElementById("onboardingOverlay");
  if (!overlay) return;
  const primary = overlay.querySelector("[data-action='close-onboarding'].save-btn");
  if (primary) primary.textContent = "הבנתי, קדימה";
  if (primary && !document.getElementById("onboardingReopenNote")) {
    // createElement/textContent rather than insertAdjacentHTML: this is a
    // fixed Hebrew sentence with no interpolation, and building it as DOM
    // keeps it out of the innerHTML sink census entirely.
    const note = document.createElement("div");
    note.id = "onboardingReopenNote";
    note.style.cssText = "color:var(--steel); font-size:12.5px; text-align:center; margin-top:10px;";
    note.textContent = "אפשר לחזור לזה מתי שרוצים — בהגדרות.";
    primary.insertAdjacentElement("afterend", note);
  }
}
function openOnboarding() {
  onboardingOpenerEl = document.activeElement;
  applyOnboardingCopy();
  document.body.style.overflow = "hidden";
  document.getElementById("onboardingOverlay").classList.add("open");
  setTimeout(() => focusFirstAppDialogEl("onboardingOverlay"), 50);
}
function closeOnboarding() {
  hasOnboarded = true;
  dbSetSetting(HAS_ONBOARDED_KEY, true).catch(noteStorageError);
  document.body.style.overflow = "";
  nudgeViewportAfterModalClose();
  document.getElementById("onboardingOverlay").classList.remove("open");
  if (onboardingOpenerEl && typeof onboardingOpenerEl.focus === "function") onboardingOpenerEl.focus();
  onboardingOpenerEl = null;
  flushDeferredCelebration();
  // The tour card on רישום disappears the moment the tour has been taken,
  // and the settings row that replaces it is already rendered - so the
  // screen behind this overlay is stale by the time we get here.
  render();
}

// ---------- First-run sequencing (design spec §1) ----------
//
// THE FINDING. A new member's first load used to stack four surfaces that
// each wanted something before the app had given them anything: the welcome
// sheet (name AND box-start date), the five-screen explainer as a gate, an
// achievement celebration, and the install banner. Two of those carried a
// primary button reading the identical string בואו נתחיל, which is why the
// flow read as "not progressing" rather than as two steps. The stacking half
// of that was fixed in 8afbc57 (one modal queue); this is the SEQUENCE half.
//
// THE RULE, and it is the only rule here: one surface at a time, and nothing
// costs the member anything until the app has given them something. Concretely
// that means each ask is deferred to the moment the member can actually answer
// it from experience rather than on faith:
//
//   name          -> S1, the one blocking sheet, one field, skippable
//   the tour      -> S2, a card on the logging screen, never a gate, and
//                    permanently re-openable from Settings
//   box-start date-> off first run entirely (Settings + the achievements
//                    screen's own prompt card, which is where a member is
//                    actually looking at the tenure badges it unlocks)
//   cloud backup  -> S5, after the first entry exists, because "back up your
//                    workouts" is a meaningless question to someone who has
//                    no workouts
//   install       -> S6, day two, because "keep this app" is a meaningless
//                    question on the first minute of the first day
//
// Everything below is bookkeeping for those five deferrals.

// The calendar date of the very first open. S6 needs it to answer "is this a
// different day from the day they installed", which is not the same question
// as "has time passed" and cannot be reconstructed from the entry log (a
// member can log a set dated last week on their first day).
const FIRST_OPEN_DATE_KEY = "haimunia:firstOpenDate";
let firstOpenDate = null;
async function loadFirstOpenDate() {
  try {
    const v = await dbGetSetting(FIRST_OPEN_DATE_KEY);
    firstOpenDate = v ? cleanISODate(v) : null;
  } catch (e) { /* treated as "unknown" - see maybeShowInstallBanner() */ }
}


// One Tier-A celebration exists on day one and this is it (§5.2). Keyed by
// its own flag rather than by entries.length === 1, so deleting that first
// entry and logging another does not re-run the arrival moment.
const FIRST_LOG_CELEBRATED_KEY = "haimunia:firstLogCelebrated";
let firstLogCelebrated = false;
async function loadFirstLogCelebrated() {
  try { firstLogCelebrated = (await dbGetSetting(FIRST_LOG_CELEBRATED_KEY)) === true; }
  catch (e) { firstLogCelebrated = true; }
}
// "The arrival card is owed and has not been answered yet." Distinct from
// firstLogCelebrated, which means "the arrival card has been SHOWN, ever" -
// the sequencing question S5 asks is about the answer, not the showing.
//
// Deliberately in-memory only, and deliberately NOT persisted. A member who
// reloads while the card is up will never dismiss that card - it is not
// coming back, since firstLogCelebrated is on disk and true - so on the next
// boot nothing is owed and the consent question is free to be asked. A
// persisted flag would strand it forever.
let firstLogArrivalPending = false;
// Which card the celebration overlay is currently showing, so closing an
// ordinary badge celebration cannot clear a debt owed by the arrival card.
// (Reachable only if the arrival card is deferred behind another dialog and
// something else celebrates first - vanishingly unlikely through the UI, but
// "unlikely" is exactly what the bug above was too.)
let celebrationShowingArrival = false;

function totalLoggedEntries() { return entries.length + wodEntries.length; }

// S2. The tour card retires itself two ways - the member took the tour, or
// they have logged three entries and demonstrably do not need it. After that
// the explainer lives only behind Settings › סיור באפליקציה, which is the
// actual fix: the audit's complaint was never that the explainer is bad (two
// personas praised the copy) but that it showed exactly once, as a gate,
// with no way back to it.
function shouldShowTourCard() { return !hasOnboarded && totalLoggedEntries() < 3; }


async function addMovement(name, category) {
  const trimmed = cleanStr(name, LIMITS.nameLen);
  if (!trimmed) return;
  const existing = allMovements().find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    choosePickedMovement(existing.id);
    closePicker();
    render();
    return;
  }
  // Collision-free and charset-safe. The old slug scheme collapsed to a bare
  // "custom--<ts>" for Hebrew names, since the regex stripped every character.
  const id = uid("custom");
  const movement = { id, name: trimmed, category: MOVEMENT_CATEGORIES.includes(category) ? category : "Other" };
  customMovements.push(movement);
  try { await dbAddMovement(movement); } catch (e) { noteStorageError(e); }
  choosePickedMovement(id);
  closePicker();
  render();
}
// How many times the athlete's own heaviest set FOR THIS EXERCISE a new set
// has to be before saving asks "are you sure". Measured against their own
// history, never an absolute kg number, for the same reason the badge tiers
// are: 100 kg is a warm-up for one member and impossible for another.
// 3x a personal best on the same lift is a jump nobody makes in one session;
// a fat-fingered extra zero is 10x.
//
// Deliberately scoped to the one exercise, not to every lift on file. An
// all-time-across-everything reference misfires in exactly the case that
// matters most: the athlete's FIRST set of a new movement, where there is
// nothing to compare against and any honest number can be a large multiple
// of some unrelated lift. Design spec 5.3.3 states the rule as ">= 3x the
// member's best-ever for that exercise, and they have >= 1 prior entry".
const ABSURD_WEIGHT_MULTIPLE = 3;
// THE OTHER HALF OF THE SAME GUARD, and the case the multiple structurally
// cannot cover: the first set of a movement. With no history the reference
// is 0, `reference > 0` makes the whole condition false, and the set saves
// unquestioned — so a first-ever set could carry any number at all,
// including a slipped decimal, and the ONE set most worth questioning was
// the one set never questioned. It is also the most expensive one to get
// wrong: it founds the record. Every later PR, tier and celebration for that
// movement is measured against it, the first-log celebration fires on it,
// and the only way back is to find the entry and edit it.
//
// The comment above argues against absolute kg numbers, and it is right:
// 100 kg is a warm-up for one member and impossible for another. This is
// that argument's one exception, kept narrow in two ways. It applies ONLY
// where there is no proportion to use instead (the moment an athlete has one
// prior set of this movement, their own history takes over again), and each
// number sits far above anything anyone in this room lifts rather than at
// what a member "should" — a ceiling that questioned a real athlete's real
// lift would be worse than the typo it caught. Per category, because a
// deadlift and a strict press are not the same question. Still a
// confirmation and never a rejection: "כן, זה נכון" saves the number as
// typed, exactly as it does for the proportional half.
const FIRST_SET_WEIGHT_CEILING = { Squat: 300, Deadlift: 350, Press: 200, Olympic: 220, Pull: 200, Other: 250 };
// A movement with no category, an unrecognised one, or one that arrived
// through an imported backup (catColor's own "__proto__" reasoning, hence
// the hasOwnProperty lookup) gets the most forgiving ceiling there is —
// computed from the table rather than restated, so adding a category cannot
// leave this number quietly stale. With no category the lift could be any of
// them, and the wrong direction to err is the one that questions a real set.
const UNKNOWN_CATEGORY_WEIGHT_CEILING = Math.max(...Object.values(FIRST_SET_WEIGHT_CEILING));
function firstSetWeightCeiling(category) {
  return Object.prototype.hasOwnProperty.call(FIRST_SET_WEIGHT_CEILING, category)
    ? FIRST_SET_WEIGHT_CEILING[category]
    : UNKNOWN_CATEGORY_WEIGHT_CEILING;
}
// ONE predicate for both save paths. saveSet() and saveWod() each carried
// their own copy of `!sanityConfirmed && best > 0 && weight >= best * N`,
// and the second copy only exists because round 10 noticed the first one had
// not been carried across — exactly the drift this repo keeps finding. The
// first-set half is therefore written once, here, rather than twice.
function weightNeedsSanityCheck(weight, reference, ceiling) {
  if (!isFinite(weight) || weight <= 0) return false;
  return reference > 0 ? weight >= reference * ABSURD_WEIGHT_MULTIPLE : weight >= ceiling;
}
// How many prior entries of the same kind an exercise needs before a result
// can be celebrated as a personal record. Design spec 5.3.1: with nothing on
// file every set trivially beats everything, so calling the first one a
// record is what teaches the member the word means nothing. Matches the
// bronze rung of PR_TIERS, which moved from need 1 to need 3 for the same
// reason.
const MIN_ENTRIES_BEFORE_PR = 3;
// Returns the athlete's own reference weight for one exercise, or 0 when
// there is no history to be proportional to — a first-ever set of a movement
// has no basis for suspicion and is never questioned.
function heaviestLoggedWeightFor(id, excludeId) {
  const list = entriesFor(id, excludeId).filter((e) => e.type !== "duration");
  return list.length ? Math.max(...list.map((e) => e.weight)) : 0;
}
// UX audit: a 300 kg squat typo — ten times the previous set — saved with no
// check at all and then triggered a full celebration and a bronze medal. The
// order was exactly backwards: question it before it lands, don't applaud it
// after. This is a confirmation, never a rejection; "כן, לשמור" always saves
// the number as typed, because the one thing worse than an unchallenged typo
// is an app that refuses to believe a real PR.
// Live bug hunt (2026-09-11): rapid double-tap on the save CTA - a real,
// easy-to-hit case on a touchscreen, especially post-workout with tired/
// sweaty hands - fired this function twice before the first call's render()
// had visibly changed anything to signal "already saved", each creating its
// own fresh uid() entry. Not a storage race (dbPut is awaited, but the
// SYNCHRONOUS entry-creation/array-push above it runs to completion on
// every call regardless); a plain in-flight guard around the whole
// function is what's needed, same shape as cloud.js's reactionBusy for the
// exact same class of bug on the cheer button. try/finally so every
// existing early-return path (unchosen movement, invalid numbers, the
// absurd-weight sanity-confirm prompt) still releases the guard - none of
// those are "a save is in flight", only the path that reaches the actual
// entries.unshift() below is.
let savingSet = false;
async function saveSet(sanityConfirmed) {
  if (savingSet) return;
  savingSet = true;
  try {
  // COMM-360: refuse to save against the placeholder movement nobody
  // actually picked - the empty-state prompt has no save affordance of its
  // own, but defend anyway (same reasoning as saveWod()'s own guard).
  if (!movementExplicitlyChosen) return;
  // Live bug hunt (2026-09-11): read today's date fresh unless the member
  // actually chose one - see logDateExplicitlyChosen's declaration.
  const date = logDateExplicitlyChosen ? clampLogDate(logDate) : todayISO();
  const editId = editingEntryId;
  const existing = editId ? entries.find((e) => e.id === editId) : null;
  // Editing keeps the row's original group/label; a fresh save only joins
  // the active ladder/superset (if any) — see toggleLadderMode().
  const groupId = existing ? (existing.groupId ?? null) : (ladderMode ? ladderGroupId : null);
  const blockLabel = existing ? (existing.blockLabel ?? null) : (ladderMode ? ladderBlockLabel : null);
  let entry, isPR, celebrationLabel, prDetail = null;
  if (logEntryType === "duration") {
    if (!isFinite(durationSeconds) || durationSeconds <= 0 || !isFinite(sets)) return;
    const prevBest = bestDurationFor(selectedId, editId) || 0;
    isPR = durationSeconds > prevBest;
    entry = {
      id: existing ? existing.id : uid("set"),
      ts: existing ? existing.ts : Date.now(),
      // ts is FIRST SAVED (and the History sort key). updatedAt is LAST MODIFIED,
      // and it must advance on every save or the conflict rule degenerates: two
      // devices editing the same existing entry both carried the identical frozen
      // ts, so `incomingTs >= existing.ts` was always true and whoever synced last
      // won unconditionally — no conflict was ever detected for these two types.
      updatedAt: Date.now(),
      exerciseId: selectedId, type: "duration", weight, reps: 0, sets,
      durationSeconds, date, isPR, est1RM: 0, groupId, blockLabel,
    };
    celebrationLabel = `${weight ? weight + ' ק״ג × ' : ""}${formatDuration(durationSeconds)}`;
  } else {
    if (!isFinite(weight) || !isFinite(reps) || !isFinite(sets)) return;
    const reference = heaviestLoggedWeightFor(selectedId, editId);
    const mov = movementById(selectedId);
    if (!sanityConfirmed && weightNeedsSanityCheck(weight, reference, firstSetWeightCeiling(mov && mov.category))) {
      const movSuffix = mov ? "-" + mov.name : "תרגיל הזה";
      askAppConfirm({
        title: `${weight} ק״ג — לוודא?`,
        // Two references, one question. With history the honest comparison is
        // the athlete's own best; without it there is nothing to compare to
        // and saying so is the whole message - a dialog that claimed a
        // previous best of 0 ק״ג would be a lie in the one place the app is
        // asking the member to trust it.
        message: reference > 0
          ? `הסט הכי כבד שלך ב${movSuffix} עד היום הוא ${reference} ק״ג.`
          : `זה הסט הראשון שלך ב${movSuffix}, אז אין עדיין סט קודם להשוות אליו — והמשקל הזה גבוה מהטווח הרגיל.`,
        confirmLabel: "כן, זה נכון", cancelLabel: "תיקון",
        action: "save-set",
      });
      return;
    }
    const prevRepRecord = repRecordFor(selectedId, reps, editId) || 0;
    const prevEst1RM = bestEst1RM(selectedId, editId) || 0;
    const est = estimate1RM(weight, reps);
    isPR = weight > prevRepRecord || est > prevEst1RM;
    prDetail = { repRecordPR: weight > prevRepRecord, est1rmPR: est > prevEst1RM, weight, reps, est, prevRepRecord, prevEst1RM };
    entry = {
      id: existing ? existing.id : uid("set"),
      ts: existing ? existing.ts : Date.now(),
      updatedAt: Date.now(), // last modified — see saveSet for why this is not ts
      exerciseId: selectedId, type: "reps", weight, reps, sets, date, isPR, est1RM: est,
      durationSeconds: 0, groupId, blockLabel,
    };
    celebrationLabel = `${weight} ק״ג × ${reps}`;
  }
  // Live bug hunt (2026-09-11): dbPut() used to run AFTER entries was
  // already mutated (unshift/sort) and nothing rolled that back on
  // failure - confirmed live with a forced QuotaExceededError: the set
  // still incremented entriesCount, still fired the full first-log
  // celebration and PR flagging, and firstLogCelebrated still got
  // permanently stamped true in a DIFFERENT (unaffected) store - all while
  // the actual entry silently never persisted, so a reload showed it
  // simply gone. Writing FIRST and bailing out before any in-memory
  // mutation or celebration decision means a failed save has NO visible
  // side effect beyond the existing storage-error banner - never a
  // celebration for a set that doesn't exist.
  try { await dbPut(entry); storageOK = true; } catch (e) { noteStorageError(e); render(); return; }
  // Three separate gates stand between "the arithmetic says record" and a
  // full-screen card, all from the same finding: praise that costs nothing
  // teaches the member that praise from this app means nothing.
  //
  // 1. Editing NEVER re-fires a celebration, in either direction. Correcting
  //    the audit's 300 kg typo down to 30 fired "שיא אישי חדש!" a second
  //    time, for the LOWER number, because repRecordFor/bestEst1RM exclude
  //    the row being edited — with the inflated value out of the way, every
  //    corrected value looks like a record against what is left. A
  //    correction is not an achievement, whatever the arithmetic says.
  // 2. Nothing is a personal record until there is something to beat: design
  //    spec 5.3.1 puts that at 3 prior entries for the same exercise, in
  //    step with PR_TIERS' bronze rung moving from need 1 to need 3. With no
  //    history every set is trivially a record, which is exactly how a
  //    member earns five medals before they have done anything.
  // The stored isPR flag stays honest under all of this (against everything
  // else on file this really is the best set, and the chart and the flame
  // read that flag); only the praise is withheld. celebratablePrEntryIds()
  // (above) applies this same MIN_ENTRIES_BEFORE_PR rule wherever a PR gets
  // counted or badged instead — "שיאים החודש" and the achievement engine's
  // prTotal both read through it now, not the raw flag.
  const priorForExercise = entriesFor(selectedId, editId).filter((e) => (e.type === "duration") === (logEntryType === "duration")).length;
  const celebratePR = isPR && !existing && priorForExercise >= MIN_ENTRIES_BEFORE_PR;
  // The community PR event deliberately does NOT take the >= 3 gate, only
  // the never-on-an-edit half. Two reasons, both functional rather than
  // editorial: PR_CREATED also drives an individual_performance challenge's
  // numeric progress (see onPrCreatedForChallenges in cloud.js), so gating
  // the EVENT would silently make challenge scoring depend on how many
  // prior sets happen to be on file - a different bug, not a fix.
  //
  // Fresh-eyes audit: the event's OTHER consumer, cloud.js's PR-share
  // prompt ("שיא חדש זוהה. לשתף עם המועדון?"), has no such excuse - it is
  // pure praise/invitation-to-share, the exact thing celebratePR above
  // exists to withhold, and a brand-new member hit it on their literal
  // first-ever set, back to back with the achievement-unlock celebration
  // for the same non-event. So the record now carries `trivial` (computed
  // from this same priorForExercise, attached below) for that ONE consumer
  // to check before opening its dialog - onPrCreatedForChallenges ignores
  // the field entirely and keeps reading new_value_numeric unconditionally,
  // so challenge progress is untouched by this.
  const emitPR = isPR && !existing;
  if (emitPR && prDetail) prDetail.priorForExercise = priorForExercise;
  // 3. And when an edit takes a row that WAS the record below the bar, say
  //    so once, plainly, in the smallest surface available — the member is
  //    owed the correction, not an apology and not a second party.
  if (existing && existing.isPR && !isPR) {
    showToast("עדכנתם את הסט — העיטור על התוצאה הקודמת הוסר.");
  }
  entries = entries.filter((e) => e.id !== entry.id);
  entries.unshift(entry);
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  editingEntryId = null;
  // Mid-ladder, keep the date fixed so every rung lands on the same day —
  // otherwise this reset-to-today would silently misdate rungs 2+ of a
  // ladder logged for a past date.
  if (!ladderMode) { logDate = todayISO(); logDateExplicitlyChosen = false; }
  if (celebratePR) flashPR();
  // Decided HERE, before the render below, not after it. That render is what
  // evaluates S5's consent card, so the debt has to already exist by the time
  // it runs — computing it afterwards is what made the ordering depend on
  // microtask interleaving instead of on a fact.
  const isFirstLogArrival = !ladderMode && !firstLogCelebrated && totalLoggedEntries() === 1;
  if (isFirstLogArrival) firstLogArrivalPending = true;
  render();
  // The full-screen popup is disruptive mid-ladder — an ascending ladder's
  // rungs routinely all beat the previous best est1RM, which would otherwise
  // mean one popup per rung. The barbell flash above still shows a PR inline
  // either way; if this same set unlocks a badge later (once ladder mode is
  // off), that celebration still fires normally then.
  if (!ladderMode) {
    const mov = movementById(entry.exerciseId);
    // The arrival card (§1.2 S4) replaces the ordinary post-save path for
    // exactly one save in a member's life, so the two can never stack. The
    // condition was evaluated above, before render(), and is reused rather
    // than recomputed — recomputing it here would work today and would put
    // the "decided before the render" property back at the mercy of whatever
    // runs in between.
    if (isFirstLogArrival) {
      celebrateFirstLog(mov ? `${mov.name} — ${celebrationLabel}` : celebrationLabel);
    } else {
      celebrateAfterSave(celebratePR && mov ? `${mov.name} — ${celebrationLabel}` : null,
        mov ? `נשמר: ${mov.name} — ${celebrationLabel}` : "נשמר");
    }
  }
  // A new entry is a workout logged; correcting an old one is not.
  if (!existing) countUsage("workout_logged");
  } finally { savingSet = false; }
}
// A ladder (working-set session: same exercise/day, different weight+reps
// each rung) is just consecutive saveSet() calls tagged with one groupId —
// see saveSet(). Turning ladder mode on starts a fresh group; turning it
// off (here or via endLadder()) only stops future saves from joining it,
// rounds already saved keep their tag.
function toggleLadderMode() {
  if (ladderMode) {
    const count = currentLadderRounds().length;
    const wasSuperset = !!ladderPartnerId;
    endLadder();
    if (count > 0) {
      const label = wasSuperset ? "הסופרסט" : "הסולם";
      setImportMessage(count === 1 ? `${label} נשמר — סט אחד` : `${label} נשמר — ${count} סטים`);
    }
    render();
    return;
  }
  ladderMode = true;
  ladderGroupId = uid("ladder");
  ladderPrimaryId = selectedId;
  ladderPartnerId = null;
  ladderBlockLabel = null;
  render();
}
function endLadder() {
  if (!ladderMode) return;
  ladderMode = false;
  ladderGroupId = null;
  ladderPrimaryId = null;
  ladderPartnerId = null;
  ladderBlockLabel = null;
}


function endEntryEditIfActive() {
  if (!editingEntryId) return;
  editingEntryId = null;
  logDate = todayISO();
  logDateExplicitlyChosen = false;
}

function endWodEditIfActive() {
  if (!editingWodEntryId) return;
  editingWodEntryId = null;
  wodLogDate = todayISO();
  wodLogDateExplicitlyChosen = false;
}
// Adds (or would-be-adds) a second exercise to the active ladder, turning it
// into a superset — exactly two exercises alternating rounds under one
// groupId. A no-op if the picked exercise is the same as the primary one
// (a superset needs two distinct movements) or no ladder is running.
function setLadderPartner(id) {
  if (!ladderMode || !id || id === ladderPrimaryId) return;
  ladderPartnerId = id;
  render();
}
// Switches which of the superset's two exercises the next save is for,
// without ending the ladder (unlike the normal exercise picker, which
// always ends it — see pick-movement). ladderPrimaryId/ladderPartnerId are
// the fixed pair to switch between — selectedId itself can't play that role
// since it becomes equal to whichever one is currently active.
function switchLadderExercise(id) {
  if (!ladderMode || !ladderPartnerId) return;
  if (id !== ladderPrimaryId && id !== ladderPartnerId) return;
  selectedId = id;
  syncLogEntryTypeToSelection();
  render();
}
function setLadderBlockLabel(label) {
  if (!ladderMode) return;
  ladderBlockLabel = ["A", "B", "C", "D"].includes(label) ? label : null;
  render();
}
function setLogEntryType(t) {
  const type = t === "duration" ? "duration" : "reps";
  if (type === logEntryType) return;
  logEntryType = type;
  endLadder();
  render();
}
function currentLadderRounds() {
  if (!ladderGroupId) return [];
  return entries.filter((e) => e.groupId === ladderGroupId).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}
// This app is filled in after a workout, not during one — reconstructing a
// session from memory (or a whiteboard scribble) usually means numbers
// close to last time, not random ones. Tapping the "last session" card
// copies them into the steppers as a starting point instead of everyone
// re-dragging from whatever was left over from the previous save.
function prefillFromLast() {
  // Matches the currently toggled mode, not just whatever was logged most
  // recently — prefilling reps numbers into a duration hold (or vice versa)
  // would be meaningless.
  const wantDuration = logEntryType === "duration";
  const last = entriesFor(selectedId).find((e) => (e.type === "duration") === wantDuration);
  if (!last) return;
  weight = last.weight;
  sets = last.sets;
  if (wantDuration) durationSeconds = last.durationSeconds;
  else reps = last.reps;
  render();
}
// ---------- Confirm + undo for the offline log ----------
// cloud.js already owns exactly this pattern for the community half
// (askConfirm / closeConfirm / runConfirm + renderConfirmSheet, pinned by
// test/community-confirm-flow.test.mjs), built precisely because three
// different destructive-action patterns had grown side by side. It lives
// inside that file's IIFE and never reaches window, so this side of the wall
// cannot call it — what follows is the same pattern, the same markup, the
// same two-button shape, deliberately NOT a third visual language and
// deliberately not window.confirm(), which that same work removed.
//
// The finding that brought it here was an asymmetry, not a missing dialog:
// blocking a club member confirms, deleting a post confirms, and deleting
// the only data in this app that cannot be recreated — a logged set — did
// not. A second finding was that no confirmation in the app names its
// subject, so every message built below says which exercise and which set.
let appConfirmDialog = null;
// #content is rebuilt wholesale by render(), so the element that opened the
// dialog is a stale node by the time we close it. The opener is re-found by
// its own data-action/data-id pair instead, which survives the re-render
// whenever the control itself still exists (i.e. after a cancel).
let appConfirmOpener = null;
function askAppConfirm(opts) {
  appConfirmDialog = opts;
  appConfirmOpener = opts.opener || null;
  document.body.style.overflow = "hidden";
  render();
  setTimeout(() => focusFirstAppDialogEl("appConfirmOverlay"), 50);
}
function restoreAppConfirmFocus() {
  const o = appConfirmOpener;
  appConfirmOpener = null;
  if (!o) return;
  const el = document.querySelector(`[data-action="${cssSel(o.action)}"][data-id="${cssSel(o.id)}"]`);
  if (el && typeof el.focus === "function") el.focus();
}
function closeAppConfirm() {
  appConfirmDialog = null;
  // appConfirmDialog is already null, so this dialog no longer counts as open.
  // A confirm raised from inside another dialog (askDeleteCustomWod from the
  // WOD picker, say) must not unlock the page that dialog is still covering.
  releaseScrollLockIfLastDialog();
  render();
  restoreAppConfirmFocus();
}
function runAppConfirm() {
  const c = appConfirmDialog;
  appConfirmDialog = null;
  appConfirmOpener = null;
  releaseScrollLockIfLastDialog();
  if (!c) { render(); return; }
  if (c.action === "delete-entry") deleteEntry(c.payload.id);
  else if (c.action === "delete-wod-entry") deleteWodEntry(c.payload.id);
  else if (c.action === "delete-measure-type") deleteMeasureType(c.payload.id);
  else if (c.action === "delete-measurement-entry") deleteMeasurementEntry(c.payload.id);
  else if (c.action === "delete-custom-wod") deleteCustomWod(c.payload.id);
  else if (c.action === "save-set") saveSet(true);
  else if (c.action === "save-wod") saveWod(true);
  else render();
}
function renderAppConfirmSheet() {
  const c = appConfirmDialog;
  if (!c) return "";
  // Markup mirrors cloud.js's renderConfirmSheet() field for field, so the
  // two halves of the app can never drift into looking like two products.
  return `<div class="modal-overlay open" id="appConfirmOverlay" data-action="close-app-confirm" role="dialog" aria-modal="true" aria-labelledby="appConfirmTitle" style="align-items:center;padding:0 20px;">
      <div class="modal-sheet" style="border-radius:22px;border-bottom:1px solid var(--border);max-height:none;">
        <div style="padding:24px 22px calc(env(safe-area-inset-bottom,0px) + 20px);">
          <h2 id="appConfirmTitle" style="margin-top:0;color:var(--chalk);font-weight:800;font-size:17px;margin-bottom:8px;">${bidiText(c.title)}</h2>
          <div style="color:var(--steel);font-size:13.5px;line-height:1.6;margin-bottom:20px;">${bidiText(c.message)}</div>
          <div class="chip-row" style="margin-top:0;">
            <button class="chip-btn" data-action="app-confirm-no">${esc(c.cancelLabel || "ביטול")}</button>
            <button class="chip-btn primary${c.destructive ? " danger" : ""}" data-action="app-confirm-yes">${esc(c.confirmLabel || "אישור")}</button>
          </div>
        </div>
      </div>
    </div>`;
}

// The audit asked for a confirmation AND a short undo, and it's right to
// want both: a confirmation stops the accident, an undo repairs the one
// that got through anyway (a confirmed delete of the wrong row). Five
// seconds is the window every mail client settled on — long enough to read
// the row you just removed, short enough that it never has to be dismissed.
// Restoring is a plain re-put of the record we already hold in memory, so
// nothing has to be reconstructed from the UI.
// One non-blocking toast, used for two jobs that are the same shape: the
// undo the audit asked for alongside the delete confirmation, and design
// spec 5.2's tier B, the response level between a full-screen card and
// silence. A confirmation stops the accident; an undo repairs the one that
// got through anyway. Five seconds is the window every mail client settled
// on — long enough to read the row you just removed, short enough that it
// never has to be dismissed. `action` is optional: a toast with none is
// pure notification (the revoked-badge message), and restoring a deleted
// record is a plain re-put of the object we already hold in memory, so
// nothing has to be reconstructed from the UI.
// `onExpire` is the third job, and the one the community half needs. Every
// undo above REVERSES a write that already happened — the record is back in
// IndexedDB before the toast is even drawn. A community delete cannot work
// that way (see deferCommunityDelete(), cloud.js): the write is HELD for the
// toast's window instead, so something has to say "the window closed and
// nobody tapped בטלו — send it now". That is this callback, and it fires
// exactly once per toast: on the timeout, or when a newer toast replaces
// this one, and never when the action ran. One clock, owned here, rather
// than a second timer in cloud.js that would eventually disagree with this
// one about when five seconds are up.
const TOAST_WINDOW_MS = 5000;
let pendingToast = null;
let toastTimeout = null;
// `ran` is what separates "the member tapped בטלו" from every other way a
// toast ends. Only the latter releases a held write.
function settleToast(ran) {
  const t = pendingToast;
  clearTimeout(toastTimeout);
  toastTimeout = null;
  pendingToast = null;
  if (t && !ran && typeof t.onExpire === "function") t.onExpire();
  return t;
}
function showToast(label, action, onExpire) {
  settleToast(false);
  pendingToast = { label, action: action || null, onExpire: onExpire || null };
  toastTimeout = setTimeout(() => { settleToast(false); render(); }, TOAST_WINDOW_MS);
}
function offerUndo(label, restore, onExpire) {
  showToast(label, { label: "בטלו", run: restore }, onExpire);
}
function runToastAction() {
  const t = settleToast(true);
  if (t && t.action) t.action.run();
  else render();
}
// A held write must not leave with the page. pagehide is the last event this
// app is guaranteed on a real phone (iOS Safari does not fire beforeunload,
// and a backgrounded tab's setTimeout is throttled to the point where the
// five seconds may simply never elapse), so the window is closed by hand
// there and whatever it was holding goes out immediately.
// The repaint matters on the visibilitychange path and not on pagehide: a
// tab that comes back would otherwise still be showing a toast whose window
// has already closed, offering an undo that can no longer undo anything.
window.addEventListener("pagehide", () => { settleToast(false); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && settleToast(false)) render();
});
function renderToastBar() {
  if (!pendingToast) return "";
  // Painted into #appToastDock (index.html), a position:absolute child of
  // #bottomNavWrap, so it sits entirely ABOVE the save bar and the tab bar
  // rather than on top of them.
  //
  // UX REVIEW, FINDING 1. This used to be its own `position:fixed;
  // bottom:calc(env(safe-area-inset-bottom,0px) + 84px); z-index:45`
  // element. 84px was a hand-tuned offset against a bottom nav that is
  // 138px tall on the viewport it was tuned for, so it cleared neither
  // half of it: measured at 390x844 the toast occupied y=704-760 while
  // #bottomBarBtn - the save button that had just been tapped - sits at
  // y=716-768, a 44px overlap, and document.elementFromPoint() at the save
  // button's own centre returned this card for the full five-second window. The member
  // saw "the set was saved" written across the control they would use to
  // save the next one, and a tap aimed at it hit the toast instead. The
  // offset is gone rather than enlarged: the dock derives the clearance
  // from the wrapper's own height, which is the only number that stays
  // correct when the save bar is hidden, when an install dock is stacked
  // in, or on a device with a large safe-area inset. See #appToastDock.
  //
  // No z-index of its own any more: inside the wrapper it inherits 30, so
  // it is above the page content and still below every .modal-overlay
  // (z-index:50) - it must never paint over a dialog. pointer-events are
  // off on the full-width rail (and on the dock) and back on only for the
  // card itself, so it never eats a tap meant for the content underneath.
  // role="status" so a screen reader hears it without focus being yanked
  // out of the list being edited.
  return `<div id="appToastBar" role="status" aria-live="polite" style="display:flex; justify-content:center; padding:0 16px; pointer-events:none;">
      <div class="flex items-center gap-10" style="pointer-events:auto; width:100%; max-width:420px; min-height:56px; background:var(--surface); border:1px solid var(--brass); border-radius:14px; padding:10px 10px 10px 14px; box-shadow:0 10px 30px rgba(0,0,0,.35);">
        <span style="flex:1; min-width:0; color:var(--chalk); font-size:13px; font-weight:700;">${bidiText(pendingToast.label)}</span>
        ${pendingToast.action ? `<button class="chip-btn" data-action="toast-action">${esc(pendingToast.action.label)}</button>` : ""}
      </div>
    </div>`;
}

// Live bug hunt (2026-09-11): used to seed the edit form straight from the
// in-memory `entries` array, which can go stale for the whole rest of a
// session on a device with two tabs/windows open against the same IndexedDB
// origin — there is no cross-tab sync for the pure-offline path (unlike the
// cloud-sync path's shouldApplyRemote() guard). A tab that booted before a
// sibling tab's edit landed would silently overwrite that edit the next
// time IT saved: saveSet() rebuilds the WHOLE record from whatever the form
// was seeded with, and dbPut() is a blind full-record replace with no
// version check — confirmed live, a Frankenstein record combining one tab's
// stale weight with the other's fresh reps, with zero warning either side.
// Re-reading the current on-disk record the instant editing actually begins
// closes that down to a genuine same-instant race (both tabs opening the
// SAME entry within the same moment) — much narrower than "stale for the
// rest of the session." Falls back to the in-memory copy if the disk read
// fails or somehow doesn't have it (should not normally happen).
async function startEditEntry(id) {
  let entry = entries.find((e) => e.id === id);
  if (!entry) return;
  try {
    const fresh = (await dbLoadAll()).find((e) => e.id === id);
    if (fresh) {
      entry = fresh;
      // Self-heals the in-memory copy too, so History/Calendar reflect the
      // fresh value even before this edit is saved.
      const idx = entries.findIndex((e) => e.id === id);
      if (idx !== -1) entries[idx] = fresh;
    }
  } catch (e) { /* offline/storage error - fall back to the in-memory copy above */ }
  selectedId = entry.exerciseId;
  movementExplicitlyChosen = true; // COMM-360: opening a real past set is as explicit a choice as the picker
  logEntryType = entry.type === "duration" ? "duration" : "reps";
  weight = entry.weight;
  reps = entry.reps;
  sets = entry.sets;
  if (entry.durationSeconds) durationSeconds = entry.durationSeconds;
  logDate = entry.date;
  logDateExplicitlyChosen = true; // opening a real past entry's date is as explicit a choice as touching the date field
  editingEntryId = entry.id;
  tab = "add";
  // Editing an entry can switch exercise and date out from under an active
  // ladder the same way pick-movement/reset-log-date do — without this, the
  // toggle would keep advertising a ladder for a now-unrelated exercise/date.
  // Exception: fixing a typo in one of the active ladder's own rounds should
  // NOT end it — selectedId/logDate already match, and doing so would strand
  // anyone who just wants to correct set 3 and keep adding set 6 afterward.
  if (!ladderGroupId || entry.groupId !== ladderGroupId) endLadder();
  render();
}
function cancelEditEntry() {
  editingEntryId = null;
  logDate = todayISO();
  logDateExplicitlyChosen = false;
  render();
}
// Named for what it destroys, per the "no confirmation in this app says
// what it is about to delete" finding — the trigger is a 23×26px unlabelled
// bin icon sitting flush against an identically sized edit pencil, so the
// dialog is often the first place the athlete finds out which of the two
// they actually hit.
function askDeleteEntry(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const mov = movementById(entry.exerciseId);
  askAppConfirm({
    title: "מחיקת סט",
    message: `${mov ? mov.name : "הסט"} — ${entrySummary(entry)}, ${fmtDate(entry.date)}. הסט יימחק מהמכשיר; אפשר יהיה לבטל למשך כמה שניות.`,
    confirmLabel: "מחיקה", destructive: true,
    action: "delete-entry", payload: { id },
    opener: { action: "delete-entry", id },
  });
}
async function deleteEntry(id) {
  const removed = entries.find((e) => e.id === id);
  entries = entries.filter((e) => e.id !== id);
  if (editingEntryId === id) { editingEntryId = null; logDate = todayISO(); logDateExplicitlyChosen = false; }
  try { await dbDelete(id); } catch (e) { noteStorageError(e); }
  if (removed) {
    const mov = movementById(removed.exerciseId);
    offerUndo(`${mov ? mov.name : "הסט"} — ${entrySummary(removed)} נמחק`, () => restoreEntry(removed));
  }
  render();
}
// Same insert-and-resort shape saveSet() uses, so a restored row lands back
// in exactly the position it was deleted from.
async function restoreEntry(entry) {
  entries = entries.filter((e) => e.id !== entry.id);
  entries.unshift(entry);
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  try { await dbPut(entry); storageOK = true; } catch (e) { noteStorageError(e); }
  render();
}

// ---------- Bodyweight ----------
// Live bug hunt (2026-09-11): confirmed live with two tabs sharing one
// IndexedDB origin - both booted with an empty in-memory bodyweightEntries,
// tab A saved 80kg for today, tab B (never reloaded) then saved 82kg for
// the same today and, because this upserted by scanning tab B's own STALE
// in-memory array (never existing here), created a SECOND row instead of
// updating tab A's - two permanent rows for one calendar date, the older
// one silently orphaned and still feeding the weight chart. Re-reading the
// on-disk store for today's row right before deciding update-vs-insert
// closes it, the same shape startEditEntry() above already uses for the
// strength-set edit version of this bug. Also now writes BEFORE mutating
// in-memory state (same reasoning as saveSet()'s own fix above): a failed
// write must have no visible side effect.
async function saveBodyweight() {
  // A bodyweight of zero is not a reading. Live bug hunt, fresh round 4
  // (2026-09-15) - sibling drift, the shape this round went looking for.
  //
  // saveMeasurement() right below refuses `value <= 0` AND renders its own
  // save button disabled until the value is positive. saveBodyweight()
  // checked only isFinite(), and 0 is perfectly finite - so holding the minus
  // stepper down to its floor and tapping save wrote a real row of 0 ק״ג for
  // today, put "0 ק״ג" in the card header as the member's latest weight, and
  // baked a zero point into the bodyweight trend chart. No warning, no undo
  // prompt, nothing to suggest anything had gone wrong.
  //
  // Both halves of the guard are added here, matching the sibling exactly
  // rather than approximately: the button now goes disabled at zero, and this
  // function refuses it anyway in case the button is ever bypassed.
  if (!isFinite(bwWeight) || bwWeight <= 0) return;
  const today = todayISO();
  let existing = bodyweightEntries.find((e) => e.date === today);
  try {
    const fresh = (await dbLoadBodyweight()).find((e) => e.date === today);
    if (fresh) existing = fresh;
  } catch (e) { /* offline/storage error - fall back to the in-memory copy above */ }
  const entry = existing
    ? { ...existing, weight: bwWeight, ts: Date.now() }
    : { id: uid("bw"), date: today, ts: Date.now(), weight: bwWeight };
  try { await dbPutBodyweight(entry); storageOK = true; } catch (e) { noteStorageError(e); render(); return; }
  bodyweightEntries = bodyweightEntries.filter((e) => e.id !== entry.id);
  bodyweightEntries.unshift(entry);
  render();
}

// ---------- Body measurements (custom, user-named, cm) ----------
function measureTypesSorted() { return measureTypes.slice().sort((a, b) => a.name.localeCompare(b.name)); }
function measureEntriesFor(typeId) { return measureEntries.filter((e) => e.typeId === typeId); }
function latestMeasurement(typeId) {
  const list = measureEntriesFor(typeId).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return list.length ? list[0] : null;
}
async function addMeasureType(name) {
  const trimmed = cleanStr(name, LIMITS.nameLen);
  if (!trimmed) return;
  const existing = measureTypes.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    measureExpandedId = existing.id;
    measureAddOpen = false;
    renderMeasureArea();
    return;
  }
  const type = { id: uid("meas-type"), name: trimmed };
  measureTypes.push(type);
  try { await dbAddMeasureType(type); } catch (e) { noteStorageError(e); }
  measureValues[type.id] = 0;
  measureExpandedId = type.id;
  measureAddOpen = false;
  renderMeasureArea();
}
// Named for what it destroys, same as askDeleteEntry above: this was the
// audit's own framing — the least-guarded destructive action left in the
// app once the entry-delete path was fixed, since it cascades away every
// measurement ever logged under a type with no confirmation at all.
function askDeleteMeasureType(id) {
  const type = measureTypes.find((t) => t.id === id);
  if (!type) return;
  const count = measureEntriesFor(id).length;
  const countText = count > 0 ? ` יימחקו גם ${count} המדידות שנרשמו עבורו.` : "";
  askAppConfirm({
    title: "מחיקת מדד",
    message: `${type.name}.${countText} המדד יימחק מהמכשיר; אפשר יהיה לבטל למשך כמה שניות.`,
    confirmLabel: "מחיקה", destructive: true,
    action: "delete-measure-type", payload: { id },
    opener: { action: "delete-measure-type", id },
  });
}
async function deleteMeasureType(id) {
  const type = measureTypes.find((t) => t.id === id);
  const removedEntries = measureEntriesFor(id);
  measureTypes = measureTypes.filter((t) => t.id !== id);
  measureEntries = measureEntries.filter((e) => e.typeId !== id);
  if (measureExpandedId === id) measureExpandedId = null;
  try {
    await dbDeleteMeasureType(id);
    for (const e of removedEntries) await dbDeleteMeasurement(e.id);
  } catch (e) { noteStorageError(e); }
  if (type) offerUndo(`${type.name} נמחק`, () => restoreMeasureType(type, removedEntries));
  render();
}
// Mirrors restoreEntry(): a plain re-put of the type and its measurements,
// already held in memory, back into the same collections.
async function restoreMeasureType(type, removedEntries) {
  measureTypes = measureTypes.filter((t) => t.id !== type.id);
  measureTypes.push(type);
  measureEntries = measureEntries.filter((e) => e.typeId !== type.id);
  for (const e of removedEntries) measureEntries.unshift(e);
  try {
    await dbAddMeasureType(type);
    for (const e of removedEntries) await dbPutMeasurement(e);
    storageOK = true;
  } catch (e) { noteStorageError(e); }
  render();
}
// Live bug hunt (2026-09-11): same cross-tab duplicate-row race as
// saveBodyweight() above (identical upsert-by-stale-in-memory-array shape),
// confirmed live for a custom measurement type the same way. Same fix:
// re-read the on-disk store for today's row before deciding
// update-vs-insert, and write before mutating in-memory state.
async function saveMeasurement(typeId) {
  const value = measureValues[typeId];
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return;
  const today = todayISO();
  let existing = measureEntries.find((e) => e.typeId === typeId && e.date === today);
  try {
    const fresh = (await dbLoadMeasurements()).find((e) => e.typeId === typeId && e.date === today);
    if (fresh) existing = fresh;
  } catch (e) { /* offline/storage error - fall back to the in-memory copy above */ }
  const entry = existing
    ? { ...existing, value, ts: Date.now() }
    : { id: uid("meas"), typeId, date: today, value, ts: Date.now() };
  try { await dbPutMeasurement(entry); storageOK = true; } catch (e) { noteStorageError(e); renderMeasureArea(); return; }
  measureEntries = measureEntries.filter((e) => e.id !== entry.id);
  measureEntries.unshift(entry);
  renderMeasureArea();
}
// Live bug hunt (2026-09-11): this deleted a single measurement value
// immediately on tap, with no confirmation and no undo - the only
// destructive action left in the app without either, next to every sibling
// delete (a logged set, a WOD entry, an entire measure TYPE) which has both.
// One accidental tap on the trash icon lost a real, hand-entered data point
// with no recovery. Mirrors askDeleteEntry/deleteEntry/restoreEntry above.
function askDeleteMeasurementEntry(id) {
  const entry = measureEntries.find((e) => e.id === id);
  if (!entry) return;
  const type = measureTypes.find((t) => t.id === entry.typeId);
  askAppConfirm({
    title: "מחיקת מדידה",
    message: `${type ? type.name : "המדידה"} — ${entry.value} ס״מ, ${fmtDate(entry.date)}. המדידה תימחק מהמכשיר; אפשר יהיה לבטל למשך כמה שניות.`,
    confirmLabel: "מחיקה", destructive: true,
    action: "delete-measurement-entry", payload: { id },
    opener: { action: "delete-measurement-entry", id },
  });
}
async function deleteMeasurementEntry(id) {
  const removed = measureEntries.find((e) => e.id === id);
  measureEntries = measureEntries.filter((e) => e.id !== id);
  try { await dbDeleteMeasurement(id); } catch (e) { noteStorageError(e); }
  if (removed) {
    const type = measureTypes.find((t) => t.id === removed.typeId);
    offerUndo(`${type ? type.name : "המדידה"} — ${removed.value} ס״מ נמחקה`, () => restoreMeasurementEntry(removed));
  }
  // Full render(), not renderMeasureArea(): the undo toast just offered
  // above is painted by render()'s own write to #appToastDock (see
  // render()), not the measurements section - renderMeasureArea() alone
  // would leave the toast built in memory but never actually painted,
  // exactly the same reason deleteMeasureType() (the sibling this mirrors)
  // already calls the full render().
  render();
}
// Same insert-and-resort shape restoreEntry() uses for a logged set.
async function restoreMeasurementEntry(entry) {
  measureEntries = measureEntries.filter((e) => e.id !== entry.id);
  measureEntries.unshift(entry);
  try { await dbPutMeasurement(entry); storageOK = true; } catch (e) { noteStorageError(e); }
  render();
}

const USER_NAME_KEY = "haimunia:userName";
let userName = null;
async function loadUserName() {
  try {
    const stored = await dbGetSetting(USER_NAME_KEY);
    if (stored !== null && stored !== undefined) { userName = cleanStr(stored, LIMITS.nameLen); return; }
  } catch (e) { /* fall through to migration */ }
  // one-time migration off localStorage
  let legacy = null;
  try { legacy = localStorage.getItem(USER_NAME_KEY); } catch (e) {}
  if (legacy !== null) {
    userName = cleanStr(legacy, LIMITS.nameLen);
    try { await dbSetSetting(USER_NAME_KEY, userName); } catch (e) {}
    try { localStorage.removeItem(USER_NAME_KEY); } catch (e) {}
  }
}

// Box-tenure badges need the athlete's actual join date, not their first log
// - someone can start using the app long after they joined the box, and
// firstLogDate would silently measure "time using this app" instead.
const BOX_START_KEY = "haimunia:boxStartDate";
let boxStartDate = null;
async function loadBoxStartDate() {
  try {
    const v = await dbGetSetting(BOX_START_KEY);
    boxStartDate = v ? cleanISODate(v) : null;
  } catch (e) { /* keep the default */ }
}

function renderUserGreeting() {
  const el = document.getElementById("userGreeting");
  if (!el) return;
  // Composed above the assignment on purpose: test/app-innerhtml-sinks.test.mjs
  // reads the innerHTML LINE and requires every interpolation on it to be
  // esc()/Number()/an allow-listed constant. Same escaping either way -
  // bidiText() calls esc() itself - so the isolation is built here and the
  // sink keeps a bare identifier.
  const greetingHtml = userName ? `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">שלום ${bidiText(userName)}</span>${ICONS.chevronsLeft}` : "";
  el.innerHTML = greetingHtml;
  el.setAttribute("aria-label", userName ? `שלום ${userName} — פתיחת מדליות והישגים` : "פתיחת מדליות והישגים");
}
let welcomeEditing = false;
let welcomeOpenerEl = null;
function openWelcomeModal(editing) {
  welcomeEditing = !!editing;
  welcomeOpenerEl = document.activeElement;
  document.body.style.overflow = "hidden";
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.classList.add("open");
  const title = document.getElementById("welcomeTitle");
  const subtitle = document.getElementById("welcomeSubtitle");
  const saveLabel = document.getElementById("welcomeSaveLabel");
  const skipBtn = document.getElementById("welcomeSkipBtn");
  if (title) title.textContent = welcomeEditing ? "עריכת פרופיל" : "ברוכים הבאים לאימוניה";
  if (subtitle) subtitle.textContent = "איך נקרא לך?";
  // Design spec §1.2 S1. The rule this enforces: no two consecutive primary
  // buttons in a flow may carry the same label. The explainer's primary
  // (set in openOnboarding()) used to read the identical בואו נתחיל, and
  // tapping through two identical buttons in a row is why the first run read
  // as a screen that had not advanced rather than as two separate steps.
  if (saveLabel) saveLabel.textContent = welcomeEditing ? "שמירה" : "יאללה, נתחיל";
  if (skipBtn) {
    skipBtn.textContent = welcomeEditing ? "ביטול" : "דילוג";
    skipBtn.dataset.action = welcomeEditing ? "cancel-welcome-name" : "skip-user-name";
    // .link-btn is sized for a line of text inside a paragraph; this one is
    // the only exit from a focus-trapping sheet on the first screen a member
    // ever sees, so it gets a real 44px target regardless of its font size.
    skipBtn.style.minHeight = "44px";
    skipBtn.style.padding = "10px 16px";
  }
  const input = document.getElementById("welcomeNameInput");
  if (input) {
    input.value = welcomeEditing ? (userName || "") : "";
    setTimeout(() => input.focus(), 50);
  }
  // The box-start date leaves first run entirely (§1.4). It exists only to
  // unlock the three tenure badges, and asking a brand-new member for it
  // before they have trained even once is what produced the audit's
  // hollow-praise finding: two badges awarded for typing a date, which
  // taught the beginner persona that praise from this app means nothing.
  // It stays here in EDIT mode, because this same sheet is the profile
  // editor reached from Settings and from the achievements screen's own
  // prompt card - which is the right place to ask, since the member is
  // looking at the tenure badges it unlocks when they see it.
  const boxLabel = document.getElementById("welcomeBoxStartLabel");
  const boxInput = document.getElementById("welcomeBoxStartInput");
  if (boxLabel) boxLabel.style.display = welcomeEditing ? "" : "none";
  if (boxInput) {
    boxInput.style.display = welcomeEditing ? "" : "none";
    boxInput.max = todayISO();
    boxInput.value = welcomeEditing ? (boxStartDate || "") : "";
  }
}
function closeWelcomeModal() {
  document.body.style.overflow = "";
  nudgeViewportAfterModalClose();
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.classList.remove("open");
  if (welcomeOpenerEl && typeof welcomeOpenerEl.focus === "function") welcomeOpenerEl.focus();
  welcomeOpenerEl = null;
}
function saveUserName(name) {
  const trimmed = cleanStr(name, LIMITS.nameLen);
  userName = trimmed;
  dbSetSetting(USER_NAME_KEY, trimmed).catch(noteStorageError);
  closeWelcomeModal();
  renderUserGreeting();
}
function saveBoxStartDate(v) {
  const cleaned = v ? cleanISODate(v) : null;
  const today = todayISO();
  boxStartDate = (cleaned && cleaned <= today) ? cleaned : null;
  dbSetSetting(BOX_START_KEY, boxStartDate).catch(noteStorageError);
}
// Saves both welcome-modal fields together, so hitting Enter in the name
// field or skipping the name doesn't discard a box-start-date the user
// already picked.
function saveWelcomeForm(name) {
  const boxInput = document.getElementById("welcomeBoxStartInput");
  // In first-run mode the date field is hidden (see openWelcomeModal), so
  // this reads the empty string and saveBoxStartDate() nulls it - the same
  // no-op it performs for anyone who leaves the field blank while editing.
  // Reading it unconditionally is deliberate: it keeps ONE save path, so
  // editing the profile can never silently discard a date the member typed.
  saveBoxStartDate(boxInput ? boxInput.value : "");
  saveUserName(name);
  // Design spec §1.2. This function used to open the five-screen explainer
  // straight after the welcome sheet - a second full-screen gate whose
  // primary button carried the same label as the one just tapped. The
  // explainer is now pulled by the member from the tour card on רישום
  // (shouldShowTourCard) or from Settings, and nothing at all opens between
  // the welcome sheet and the logging screen.
  //
  // The celebration ordering this comment used to explain is now moot from
  // here (there is no second overlay to stack against), but the deferral
  // machinery it describes is unchanged and still governs every other
  // dialog - see showCelebration()'s blockingDialogOpen() gate.
  //
  // Still checked here, because "edit profile" is the surface where a
  // box-start date is actually entered, and a date entered by a member who
  // already has sessions on file can legitimately qualify for tenure badges
  // (which, since the audit, are silent anyway - §5.2 tier C).
  checkForNewAchievements();
  render();
}

// Design spec §3.6: "after the first explicit choice, that choice becomes
// THIS MEMBER'S remembered default for the next WOD. Not a global Rx
// default." So the app stops guessing and starts remembering: unanswered
// until they answer once, then pre-filled with their own answer — which for
// most members is scaled, and for a competitor is Rx, without either being
// imposed on the other.
const WOD_RX_DEFAULT_KEY = "haimunia:wodRxDefault";

// RX+ (2026-09-19). A THIRD ANSWER IN THE SAME FIELD.
//
// Rx+ is the standard CrossFit answer above Rx: the workout as prescribed and
// then heavier - a competitor's weights, or the movement's harder variant. The
// club asks for it because filing it as plain Rx flattens a real difference in
// effort, and filing it as a separate boolean beside `rx` would make every
// reader of an entry ask two questions to learn one fact.
//
// So it is the SAME field, with a third value: true (Rx), false (Scaled),
// "plus" (Rx+). That shape is what makes it safe to add here. Everything that
// asks `e.rx ?` - the Rx-per-WOD achievements, formatWodEntry's scaled-weight
// suffix, the club comparison key's rx/scaled bucket - reads "plus" as Rx,
// which is what Rx+ is: Rx, and more. Only the places that mean the WORD get
// a third branch, and they all go through wodEffortLabel/wodEffortTag below
// rather than repeating the ternary, because that ternary had five copies and
// this is exactly how the fifth one gets missed.
//
// AT THE CLOUD BOUNDARY IT IS Rx. club_wod_results.rx is a boolean column and
// this branch adds no migration, so the three bridges that cross into cloud.js
// coerce with `!== false`: an Rx+ result publishes to the club board as Rx,
// which is true, rather than as a string the RPC would silently read as Rx
// anyway (202609080002's jsonb_typeof guard) without anybody having decided
// that here. The distinction is kept where it was asked for - the member's own
// record and their own history.
const WOD_EFFORT_PLUS = "plus";
// The guard behind the save CTA, in one predicate instead of three copies of
// `wodRx !== true && wodRx !== false`. null still means unanswered, and
// unanswered still refuses to save (design spec §3.6).
function wodEffortAnswered(rx) { return rx === true || rx === false || rx === WOD_EFFORT_PLUS; }
// The full label, where a row names the choice in words.
function wodEffortLabel(rx) {
  if (rx === WOD_EFFORT_PLUS) return "מוגבר (Rx+)";
  return rx ? "מלא (Rx)" : "מותאם (Scaled)";
}
// The suffix form, where Rx is the unmarked case and only a departure from it
// is worth the ink. Includes its own separator so a caller cannot forget it.
function wodEffortTag(rx) {
  if (rx === WOD_EFFORT_PLUS) return " · Rx+";
  return rx ? "" : " · מותאם";
}
let wodRxDefault = null;
async function loadWodRxDefault() {
  try {
    const v = await dbGetSetting(WOD_RX_DEFAULT_KEY);
    wodRxDefault = wodEffortAnswered(v) ? v : null;
  } catch (e) { wodRxDefault = null; }
  // A remembered answer pre-selects the toggle; no answer leaves it unset.
  wodRx = wodRxDefault;
}
function setWodRx(rx) {
  // Refuses anything that is not one of the three answers rather than storing
  // it: this writes the member's remembered default to disk, and a value
  // loadWodRxDefault() would then reject is a silently forgotten preference.
  if (!wodEffortAnswered(rx)) return;
  wodRx = rx;
  wodRxDefault = rx;
  dbSetSetting(WOD_RX_DEFAULT_KEY, rx).catch(noteStorageError);
}

const BAR_WEIGHT_KEY = "haimunia:barWeight";
async function loadBarWeight() {
  try {
    const stored = await dbGetSetting(BAR_WEIGHT_KEY);
    if (BAR_OPTIONS.includes(stored)) barWeight = stored;
  } catch (e) { /* keep the default */ }
}
function setBarWeight(kg) {
  if (!BAR_OPTIONS.includes(kg)) return;
  barWeight = kg;
  dbSetSetting(BAR_WEIGHT_KEY, kg).catch(noteStorageError);
  // Total can never be less than the bar itself - bump it up if needed so the
  // barbell visual actually changes even if the user never touches "weight".
  if (weight < barWeight) weight = barWeight;
  updateLogQuickUI("weight");
  const barRow = document.getElementById("barWeightRow");
  if (barRow) barRow.outerHTML = renderBarWeightRow();
}

// THE MEMBER'S SMALLEST JUMP, for the percentage chips (COMM/strength-pct).
//
// A sibling of barWeight above and stored the same way, because it is the
// same kind of fact: what THIS member's equipment can actually express. 2.5 kg
// is the default and the standard answer - a pair of 1.25s - but a box with
// microplates works in 1 kg, and a member running the percentages off
// dumbbells or a machine stack works in 2. Rounding 72.3 to a number nobody
// in the room can load is the failure this setting exists to avoid, and the
// app cannot know which one that is.
//
// Deliberately NOT in the Settings sheet: it is only ever meaningful next to
// the chips it rounds, it is the only control there whose effect is invisible
// anywhere else, and the chips themselves only exist when the club has turned
// the key on. So it lives inside the gated block, at the point of use.
const PCT_INCREMENTS = [1, 2, 2.5];
const PCT_INCREMENT_KEY = "haimunia:pctIncrement";
let pctIncrement = 2.5;
async function loadPctIncrement() {
  try {
    const stored = await dbGetSetting(PCT_INCREMENT_KEY);
    if (PCT_INCREMENTS.includes(stored)) pctIncrement = stored;
  } catch (e) { /* keep the default */ }
}
function setPctIncrement(inc) {
  if (!PCT_INCREMENTS.includes(inc)) return;
  pctIncrement = inc;
  dbSetSetting(PCT_INCREMENT_KEY, inc).catch(noteStorageError);
}

// Theme preference lives in localStorage, not IndexedDB — it has to be
// readable synchronously by theme-init.js before first paint, and it isn't
// user training data, so "clear all data" deliberately leaves it alone.
const THEME_KEY = "haimunia:theme";
let themePref = "dark";
function loadThemePref() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") themePref = stored;
  } catch (e) { /* keep the default */ }
}
function resolvedTheme() {
  if (themePref !== "auto") return themePref;
  return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
}
function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolvedTheme() === "light" ? "#F2F5FA" : "#152342");
}
function applyThemePref() {
  const root = document.documentElement;
  if (themePref === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", themePref);
  syncThemeColorMeta();
}
function setThemePref(pref) {
  if (pref !== "light" && pref !== "dark" && pref !== "auto") return;
  themePref = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
  applyThemePref();
  // The whole field (visible label + segmented track) is what gets
  // replaced, not just the track — the label lives inside renderThemeRow()
  // now, so swapping only #themeRow would strand the old one and insert a
  // second copy.
  const field = document.getElementById("themeField");
  if (field) field.outerHTML = renderThemeRow();
}
// Design spec 4.1/4.2. Was three .link-btn underlined links separated by
// "·" dots — which read as three links, not as one control with one of
// three states, and carried only an invisible aria-label. Now the shared
// .segmented/.segmented-opt component index.html ships (its rule is grouped
// with #themeRow/#textScaleRow precisely so this swap has no second copy of
// the values to drift from), plus a real visible label that aria-labelledby
// points at, so a sighted and a screen-reader user are told the same thing
// by the same words. Selection is carried by background + weight + border,
// never by color alone, so it survives greyscale and the light theme.
function renderThemeRow() {
  const opts = [["dark", "כהה"], ["light", "בהיר"], ["auto", "אוטומטי"]];
  return `<div id="themeField" style="margin-bottom:12px;">
    <div id="themeRowLabel" style="font-size:13px; font-weight:700; color:var(--chalk); margin-bottom:8px;">ערכת צבעים</div>
    <div id="themeRow" class="segmented" role="radiogroup" aria-labelledby="themeRowLabel">
      ${opts.map(([val, label]) => `<button class="segmented-opt" data-action="set-theme" data-pref="${val}" role="radio" aria-checked="${themePref === val}">${label}</button>`).join("")}
    </div>
  </div>`;
}

const LAST_EXPORT_KEY = "boxlog:lastExportAt";
let lastExportAt = null;
async function loadLastExport() {
  try {
    const v = await dbGetSetting(LAST_EXPORT_KEY);
    if (v) { lastExportAt = Number(v); return; }
  } catch (e) {}
  try {
    const legacy = localStorage.getItem(LAST_EXPORT_KEY);
    if (legacy) {
      lastExportAt = Number(legacy);
      await dbSetSetting(LAST_EXPORT_KEY, lastExportAt).catch(() => {});
      localStorage.removeItem(LAST_EXPORT_KEY);
    }
  } catch (e) {}
}
function markExported() {
  lastExportAt = Date.now();
  dbSetSetting(LAST_EXPORT_KEY, lastExportAt).catch(() => {});
}
function daysSinceLastExport() {
  if (!lastExportAt || !isFinite(lastExportAt)) return null;
  return Math.floor((Date.now() - lastExportAt) / 86400000);
}
const BACKUP_APP_ID = "box-log";
const BACKUP_VERSION = 1;

// Live bug hunt, round 9 (2026-09-11): session notes (saveSessionNote(),
// stored as sessionNote:<date> rows in the settings store) were never in
// this payload at all - confirmed live, a real hand-typed training note
// survived on disk but was absent from every backup, including the
// auto-downloaded safety backup clearAllData() takes right before wiping
// everything. The Settings screen's own copy frames export as "the full
// training log", and a member's free-text reflections on a session are
// training-log content by any reasonable reading of that, unlike the
// name/box-start-date exclusion (which IS explicitly disclosed in that
// same copy). Now async: dbGetAllSettings() is the only way to read every
// sessionNote:* row without knowing every date in advance.
async function buildBackupPayload() {
  const settingsRows = await dbGetAllSettings().catch(() => []);
  const sessionNotes = bag();
  for (const row of settingsRows) {
    if (row && typeof row.key === "string" && row.key.startsWith("sessionNote:") && row.value) {
      sessionNotes[row.key.slice("sessionNote:".length)] = row.value;
    }
  }
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    customMovements,
    wodEntries,
    customWods,
    bodyweightEntries,
    measureTypes,
    measureEntries,
    sessionNotes,
    customWodMovementTags,
  };
}

function downloadBackup(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a tick to start before tearing down the blob URL.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

async function exportData() {
  downloadBackup(await buildBackupPayload(), `box-log-backup-${todayISO()}.json`);
  markExported();
  render();
}


const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

function triggerImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) importDataFromFile(input.files[0]);
  });
  input.click();
}

// A backup file is untrusted input — it may have been edited, corrupted, or
// received from someone else. Every record is rebuilt field by field from a
// whitelist; nothing from the file object is ever stored or rendered as-is.
async function importDataFromFile(file) {
  const bad = (msg) => { setImportMessage(msg || "הייבוא נכשל — הקובץ אינו קובץ גיבוי תקין"); render(); };

  if (!file || file.size > MAX_BACKUP_BYTES) {
    return bad("הייבוא נכשל — הקובץ גדול מדי (מעל 25MB)");
  }

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) { return bad(); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return bad();
  if (data.app !== BACKUP_APP_ID) return bad(`הייבוא נכשל — הקובץ אינו גיבוי של ${brandName()}`);
  if (Number(data.version) > BACKUP_VERSION) {
    return bad("הייבוא נכשל — הגיבוי נוצר בגרסה חדשה יותר של האפליקציה");
  }

  // LIMITS.importItems bounds untrusted input size here, at the one place
  // it's actually meant to apply - a hand-edited or malicious backup file.
  const clean = {
    customMovements: sanitizeList(data.customMovements, sanitizeMovement, LIMITS.importItems),
    customWods: sanitizeList(data.customWods, sanitizeCustomWod, LIMITS.importItems),
    entries: sanitizeList(data.entries, sanitizeEntry, LIMITS.importItems),
    wodEntries: sanitizeList(data.wodEntries, sanitizeWodEntry, LIMITS.importItems),
    bodyweightEntries: sanitizeList(data.bodyweightEntries, sanitizeBodyweight, LIMITS.importItems),
    // (wodEntries is filtered against the WOD catalogue below, once the
    // imported customWods are known - see dropOrphanWodEntries.)
    measureTypes: sanitizeList(data.measureTypes, sanitizeMeasureType, LIMITS.importItems),
    measureEntries: sanitizeList(data.measureEntries, sanitizeMeasurement, LIMITS.importItems),
  };
  // AN IMPORTED RESULT MUST POINT AT A WOD THAT EXISTS. Live bug hunt, fresh
  // round 8 (2026-09-15).
  //
  // Nothing validated wodId on the way in, so a backup carrying a result for
  // a WOD that no longer exists - a deleted custom WOD, an older-shape file, a
  // hand-edited one - imported cleanly and then sat in the calendar forever as
  // "? מלא (Rx) 8:20". Its edit pencil was a SILENT no-op, because
  // startEditWodEntry() bails on `if (!w) return;`, so the only way out was
  // delete, with nothing on screen explaining what the row even was.
  //
  // restoreWodEntry() already refuses to bring back an entry whose WOD is
  // gone, and says why - that guard was written after this exact failure mode
  // was found on the undo path. Import never got it.
  //
  // Checked AFTER the imported customWods are in hand, since a result may
  // legitimately reference a custom WOD that arrives in the same file.
  // WOD_LIBRARY (built-ins) + the custom WODs arriving in THIS file. allWods() cannot be used yet: customWods is not
  // assigned until the import commits.
  const knownWodIds = new Set(
    WOD_LIBRARY.map((w) => w.id)
      .concat((clean.customWods || []).map((w) => w && w.id))
  );
  const orphanWodEntries = (clean.wodEntries || []).filter((e) => e && !knownWodIds.has(e.wodId));
  if (orphanWodEntries.length) {
    clean.wodEntries = clean.wodEntries.filter((e) => e && knownWodIds.has(e.wodId));
  }

  // Live bug hunt, round 9 (2026-09-11): sessionNotes/customWodMovementTags
  // restore, the same fix buildBackupPayload() got above. Kept out of the
  // incoming/rejected/ok/failed counters below - those "X רישומים" counts
  // are specifically about the seven array-shaped training-record groups; a
  // session note and a WOD-builder movement suggestion are neither.
  const incomingTags = sanitizeList(data.customWodMovementTags, sanitizeWodMovementTag, LIMITS.importItems);
  const incomingNotes = bag();
  if (data.sessionNotes && typeof data.sessionNotes === "object" && !Array.isArray(data.sessionNotes)) {
    for (const [date, text] of Object.entries(data.sessionNotes)) {
      const cleanDate = cleanISODate(date);
      const cleanText = cleanMultilineStr(text, LIMITS.notesLen);
      if (cleanDate && cleanText) incomingNotes[cleanDate] = cleanText;
    }
  }
  const incoming = Object.values(clean).reduce((n, l) => n + l.length, 0);
  const rawCount = ["customMovements", "customWods", "entries", "wodEntries", "bodyweightEntries", "measureTypes", "measureEntries"]
    .reduce((n, k) => n + (Array.isArray(data[k]) ? data[k].length : 0), 0);
  const rejected = Math.max(0, rawCount - incoming);

  // Design spec §3.7 / §4.4, same class as the "אזור מסוכן" rename below:
  // these four member-facing counts used to be measured in "רשומות", which
  // is the DATABASE word for a row. The member never wrote a רשומה - they
  // wrote a רישום, which is what this app calls it absolutely everywhere
  // else (the tab is literally named רישום, and so are רישום סט / יומן
  // האימונים / הרישום הראשון). Reached straight from the settings backup
  // card's "ייבוא גיבוי", so it is the same screen as the rename.
  if (incoming === 0) return bad("הייבוא נכשל — לא נמצאו רישומים תקינים בקובץ");

  // The import merges into existing data and cannot be undone from inside the
  // app, so confirm first and drop a rollback backup on the way in.
  const hasExisting = entries.length || wodEntries.length || bodyweightEntries.length || customMovements.length || customWods.length || measureTypes.length;
  // Live bug hunt (2026-09-11): a 1-record backup (a very real case - a
  // single manually-recreated entry, or a trimmed test file) confirmed as
  // "לייבא 1 רישומים?" - missing singular.
  const incomingLabel = incoming === 1 ? "רישום אחד" : `${incoming} רישומים`;
  const question = hasExisting
    ? `הייבוא יוסיף ${incomingLabel} לנתונים הקיימים ולא ניתן לבטל אותו.\nלפני כן יורד גיבוי של המצב הנוכחי.\n\nלהמשיך?`
    : `לייבא ${incomingLabel}?`;
  if (!window.confirm(question)) { setImportMessage("הייבוא בוטל"); render(); return; }

  if (hasExisting) {
    try { downloadBackup(await buildBackupPayload(), `box-log-rollback-${todayISO()}.json`); } catch (e) {}
  }

  let ok = 0, failed = 0;
  const write = async (list, fn) => {
    for (const rec of list) {
      try { await fn(rec); ok++; } catch (e) { failed++; if (failed === 1) noteStorageError(e); }
    }
  };
  await write(clean.customMovements, dbAddMovement);
  await write(clean.customWods, dbAddCustomWod);
  await write(clean.entries, dbPut);
  await write(clean.wodEntries, dbPutWodEntry);
  await write(clean.bodyweightEntries, dbPutBodyweight);
  await write(clean.measureTypes, dbAddMeasureType);
  await write(clean.measureEntries, dbPutMeasurement);
  for (const [date, text] of Object.entries(incomingNotes)) {
    try { await dbSetSetting(`sessionNote:${date}`, text); } catch (e) {}
  }
  for (const tag of incomingTags) {
    try { await dbAddWodMovementTag(tag); } catch (e) {}
  }

  await reloadFromDb();
  // Imported history is past progress, not something earned right now: the
  // 2.x app re-baselined here, and without it a restored log's next save
  // popped one celebration listing every medal it had ever earned.
  baselineSeenAchievements();

  const parts = [ok === 1 ? "יובא רישום אחד" : `יובאו ${ok} רישומים`];
  // Say what was dropped, rather than letting a count quietly not add up.
  if (orphanWodEntries.length) {
    parts.push(orphanWodEntries.length === 1
      ? "רישום אימון אחד דולג — האימון שלו כבר לא קיים"
      : `${orphanWodEntries.length} רישומי אימון דולגו — האימונים שלהם כבר לא קיימים`);
  }
  if (rejected) parts.push(`${rejected} נפסלו`);
  if (failed) parts.push(`${failed} נכשלו בשמירה`);
  setImportMessage(parts.join(", "));
  render();
}

// Single source of truth for pulling state out of IndexedDB. Everything is
// re-sanitized on the way in, so records written by an older build of the app
// cannot poison the render path either.
async function reloadFromDb() {
  try {
    entries = sanitizeList(await dbLoadAll(), sanitizeEntry).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    customMovements = sanitizeList(await dbLoadMovements(), sanitizeMovement);
    wodEntries = sanitizeList(await dbLoadWodEntries(), sanitizeWodEntry).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    customWods = sanitizeList(await dbLoadCustomWods(), sanitizeCustomWod);
    bodyweightEntries = sanitizeList(await dbLoadBodyweight(), sanitizeBodyweight).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (bodyweightEntries[0]) bwWeight = bodyweightEntries[0].weight;
    measureTypes = sanitizeList(await dbLoadMeasureTypes(), sanitizeMeasureType);
    measureEntries = sanitizeList(await dbLoadMeasurements(), sanitizeMeasurement);
    customWodMovementTags = sanitizeList(await dbLoadWodMovementTags(), sanitizeWodMovementTag);
    storageOK = true;
    storageErrMsg = "";
    return true;
  } catch (e) {
    noteStorageError(e);
    return false;
  }
}

async function clearAllData() {
  // The one truly irreversible action in the app used to have no safety
  // net, unlike import (which downloads a rollback file for a far less
  // destructive merge). Auto-download the same backup export would
  // produce, before anything is actually wiped.
  const hasData = entries.length || wodEntries.length || customMovements.length || customWods.length || bodyweightEntries.length || measureTypes.length || measureEntries.length;
  if (hasData) downloadBackup(await buildBackupPayload(), `box-log-backup-before-delete-${todayISO()}.json`);
  endLadder();
  entries = [];
  wodEntries = [];
  customMovements = [];
  customWods = [];
  bodyweightEntries = [];
  measureTypes = [];
  measureEntries = [];
  measureValues = bag();
  customWodMovementTags = [];
  try {
    await dbClear();
    await dbClearWodEntries();
    await dbClearMovements();
    await dbClearCustomWods();
    await dbClearBodyweight();
    await dbClearMeasureTypes();
    await dbClearMeasurements();
    await dbClearWodMovementTags();
    // "delete everything" must also drop the stored name and export marker.
    await dbClearSettings();
    try { localStorage.removeItem(USER_NAME_KEY); localStorage.removeItem(LAST_EXPORT_KEY); } catch (e) {}
    userName = null;
    boxStartDate = null;
    seenAchievementIds = new Set();
    lastExportAt = null;
    // dbClearSettings() above has already wiped these on disk; this is the
    // in-memory half, and without it the flags survive the wipe and the
    // member is dropped back at the welcome sheet with a first run that has
    // already been marked as spent — no tour card, no arrival card, and an
    // install banner eligible immediately. A device that has just been
    // returned to empty is a first run by every definition the sequence
    // uses, so say so. (hasOnboarded was already in this position before
    // the §1 work and was already wrong; it is fixed here with the rest.)
    hasOnboarded = false;
    firstLogCelebrated = false;
    firstLogArrivalPending = false;
    celebrationShowingArrival = false;
    firstOpenDate = todayISO();
    await dbSetSetting(FIRST_OPEN_DATE_KEY, firstOpenDate).catch(() => {});
    // The install dismissal is deliberately NOT cleared here, for the same
    // reason the theme preference is not: it is a standing answer about this
    // browser, not training data, and "delete my workouts" is not permission
    // to re-ask a question the member already declined.
  } catch (e) {
    noteStorageError(e);
  }
  selectedId = MOVEMENTS[0].id;
  movementExplicitlyChosen = false; // COMM-360: back to "nothing chosen yet", same as a cold load
  historyId = null;
  selectedWodId = null; // COMM-360
  wodHistoryId = null;
  bwWeight = 70;
  barWeight = 20;
  // A member setting, wiped with the rest of them by dbClearSettings() above -
  // this is the in-memory half, same as barWeight.
  pctIncrement = 2.5;
  // dbClearSettings() above wiped the remembered Rx choice on disk; this is
  // the in-memory half. Back to unanswered, which is what a member with no
  // history is - the whole point of §3.6 is that the app must not guess.
  wodRx = null;
  wodRxDefault = null;
  measureExpandedId = null;
  measureAddOpen = false;
  benchmarkExpandedId = null;
  logDate = todayISO();
  logDateExplicitlyChosen = false;
  editingEntryId = null;
  wodLogDate = todayISO();
  wodLogDateExplicitlyChosen = false;
  editingWodEntryId = null;
  confirmClear = false;
  renderUserGreeting();
  render();
  // Live bug hunt (2026-09-11): "מחיקת כל הנתונים" is triggered from inside
  // Settings, which is still open at this point - opening Welcome on top of
  // it left TWO modal-overlays open at once (verified live:
  // document.querySelectorAll(".modal-overlay.open") returned both ids
  // simultaneously), violating the single-dialog-open invariant
  // scene-dialog-stacking.mjs guards elsewhere. Welcome is escapable:false
  // by design (a first run is meant to be stepped through, not dismissed),
  // so with Settings still open underneath, a back-press/Escape right after
  // a full data wipe silently closed the HIDDEN Settings sheet instead of
  // doing anything the member could see - exactly the moment back doing
  // nothing is most confusing. Close Settings first; closeSettings() is
  // already a safe no-op if it wasn't the one that triggered this.
  if (userName === null) { closeSettings(); openWelcomeModal(); }
}

// ---------- WOD helpers & actions ----------
// The two training features the community edition switches per club
// (club_features). This edition has no club switchboard to read, and the
// member asked for both, so they are simply on.
function strengthPercentagesOn() { return true; }
function benchmarksOn() { return true; }
function allWods() { return WOD_LIBRARY.concat(customWods); }
function wodById(id) { return allWods().find((w) => w.id === id); }
function wodEntriesFor(id, excludeId) { return wodEntries.filter((e) => e.wodId === id && e.id !== excludeId); }
function recentWodEntriesFor(id, days = 14, cap = 5) {
  const cutoff = localISODate(new Date(Date.now() - days * 86400000));
  return wodEntriesFor(id).filter((e) => e.date >= cutoff).slice(0, cap);
}
function activeWods() {
  const ids = [...new Set(wodEntries.map((e) => e.wodId))];
  return ids.map(wodById).filter(Boolean);
}
function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function scoreValue(e) {
  if (e.scoreType === "time") return e.timeSeconds;
  if (e.scoreType === "amrap") return e.rounds * 1000 + e.reps;
  if (e.scoreType === "emom") return 0; // no single comparable score — see bestWodScore
  return e.weight;
}
// WHICH END OF THE RANGE WINS, in one place. A time is a race (7:42 beats
// 9:01); rounds, reps and kilos are all "more is better". bestWodScore()
// carried this as an inline `scoreType === "time"` branch, and the benchmark
// tracker needs exactly the same rule over exactly the same score types —
// which is how this codebase ends up with a right line and a missed copy of
// it (CLAUDE.md, "Sibling drift"). One function, both callers.
function scoreLowerIsBetter(scoreType) { return scoreType === "time"; }
// Live bug hunt (2026-09-11): rx (optional) restricts the comparison to
// entries of that same Rx/Scaled status. Callers that don't pass it get the
// old unfiltered behavior; saveWod()'s own PR check and formatWodBest()
// below now both pass it, since Rx and Scaled are already treated as
// meaningfully different everywhere else in the app (a dedicated toggle,
// the "· מותאם" tag, a separate scaledWeight field) but this comparison
// used to ignore that entirely - a Scaled attempt could flash "new record"
// and overwrite an Rx best just because they share a scoreType.
function bestWodScore(id, excludeId, rx) {
  const w = wodById(id);
  // EMOM has no cross-attempt scoring yet: consistency (did every round)
  // matters more than a single number, and there's no agreed way to reduce
  // "10 reps of A, 8 of B" to one comparable value. No PR concept for it.
  if (w.scoreType === "emom") return null;
  let list = wodEntriesFor(id, excludeId);
  // Rx+ gets its own bucket, on the same argument that separated Rx from
  // Scaled here in the first place: a heavier version of the workout is a
  // different effort, and a PR against it is not a PR against the prescribed
  // one. Strict equality does that for all three with no extra branch.
  if (wodEffortAnswered(rx)) list = list.filter((e) => e.rx === rx);
  if (!list.length) return null;
  const values = list.map(scoreValue);
  return scoreLowerIsBetter(w.scoreType) ? Math.min(...values) : Math.max(...values);
}
// WHICH EFFORT BUCKET A MEMBER'S BEST ACTUALLY CAME FROM: Rx first, then Rx+,
// then Scaled, stopping at the first bucket they have an attempt in. Split out
// of formatWodBest() below when the benchmark tracker needed the same answer —
// the headline number and the chart under it have to come from one bucket, and
// two copies of this loop is the way they quietly stop doing so.
function bestWodEffort(id) {
  for (const effort of [true, WOD_EFFORT_PLUS, false]) {
    if (bestWodScore(id, null, effort) !== null) return effort;
  }
  return null;
}
function formatWodEntry(e) {
  const base = e.scoreType === "time" ? formatClock(e.timeSeconds)
    : e.scoreType === "amrap" ? `${e.rounds}+${e.reps}`
    : e.scoreType === "emom" ? (e.emomReps || []).join(" · ")
    : `${e.weight} ק״ג`;
  return (!e.rx && e.scaledWeight) ? `${base} @ ${e.scaledWeight} ק״ג` : base;
}
function lastScaledAttempt(id) {
  const list = wodEntriesFor(id).filter((e) => !e.rx).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return list.length ? list[0] : null;
}
function formatWodBest(id) {
  const w = wodById(id);
  // Live bug hunt (2026-09-11): prefer the Rx best - the standard/
  // prescribed version of the WOD - falling back to the Scaled best only
  // when there's no Rx attempt on file at all. See bestWodScore()'s comment.
  // RX+ (2026-09-19) made this a three-step fallback, and it had to: Rx+ is
  // its own bucket in bestWodScore() now, so a member whose only attempts at
  // a WOD are Rx+ had an Rx best of null, a Scaled best of null, and read
  // "—" next to results they had actually logged. Rx stays first (it is the
  // prescribed version, the one comparable to everybody else's), Rx+ second
  // because it is also at-or-above prescribed, Scaled last.
  const effort = bestWodEffort(id);
  if (effort === null) return "—";
  return formatWodScore(w.scoreType, bestWodScore(id, null, effort));
}
// The score-to-text half of formatWodBest(), on its own so the benchmark
// tracker prints a time, a rounds+reps and a load the same way the WOD tab
// does rather than growing a second set of formats for the same four types.
function formatWodScore(scoreType, value) {
  if (value === null || !isFinite(value)) return "—";
  if (scoreType === "time") return formatClock(value);
  if (scoreType === "amrap") return `${Math.floor(value / 1000)}+${value % 1000}`;
  return `${value} ק״ג`;
}

async function addCustomWod(name, scoreType, desc, extra) {
  const trimmed = cleanStr(name, LIMITS.nameLen);
  if (!trimmed) return;
  if (!WOD_SCORE_TYPES.includes(scoreType)) return;
  const existing = allWods().find((w) => w.name.toLowerCase() === trimmed.toLowerCase());
  // Live bug hunt (2026-09-11): this branch silently discarded everything the
  // member just built (format, movements, EMOM rotation, time cap...) and
  // swapped in the pre-existing WOD of that name instead, with no message at
  // all - confirmed live via the WOD builder. Redirecting to the existing WOD
  // is kept (a name is still a name), but it's no longer silent.
  if (existing) { showToast(`כבר קיים אימון בשם "${trimmed}" — נבחר האימון הקיים, והשינויים שבניתם לא נשמרו.`); choosePickedWod(existing.id); closeWodPicker(); closeWodBuilder(); render(); return; }
  const id = uid("customwod");
  // extra carries scoreType-specific structured fields (currently just EMOM's
  // movement rotation — see sanitizeCustomWod) that, unlike every other
  // format, aren't fully representable as free text alone.
  const wod = { id, name: trimmed, category: "Custom", scoreType, desc: cleanStr(desc, LIMITS.notesLen), ...(extra || {}) };
  customWods.push(wod);
  try { await dbAddCustomWod(wod); } catch (e) { noteStorageError(e); }
  choosePickedWod(id);
  closeWodPicker();
  closeWodBuilder();
  render();
}


const TEXT_SCALE_KEY = "haimunia:textScale";
let textScalePref = "normal";
function loadTextScalePref() {
  let stored = "normal";
  try { stored = localStorage.getItem(TEXT_SCALE_KEY) || "normal"; } catch (e) {}
  textScalePref = stored === "large" ? "large" : "normal";
}
function applyTextScalePref() {
  if (textScalePref === "large") document.documentElement.setAttribute("data-text-scale", "large");
  else document.documentElement.removeAttribute("data-text-scale");
}
function setTextScalePref(pref) {
  if (pref !== "normal" && pref !== "large") return;
  textScalePref = pref;
  try { localStorage.setItem(TEXT_SCALE_KEY, pref); } catch (e) {}
  applyTextScalePref();
  // Same whole-field replacement as setThemePref(), same reasoning.
  const field = document.getElementById("textScaleField");
  if (field) field.outerHTML = renderTextScaleRow();
}
// Same migration as renderThemeRow() above, same reasoning.
//
// Two steps, not the three design spec 4.3 asks for. `xlarge` was REMOVED
// from this control after direct member feedback that it was too big, and
// test/text-scale.test.mjs plus scripts/browser-check/text-scale.mjs both
// pin its absence. The spec's third step is also specified at 1.35 of a
// type-only scale, which this control does not implement — it still drives
// `zoom` on <html>, i.e. the whole page — so re-adding it here as a zoom
// step would reverse a documented product decision AND ship it through the
// wrong mechanism. Left alone deliberately, raised rather than guessed.
function renderTextScaleRow() {
  const opts = [["normal", "רגיל"], ["large", "גדול"]];
  return `<div id="textScaleField" style="margin-bottom:8px;">
    <div id="textScaleRowLabel" style="font-size:13px; font-weight:700; color:var(--chalk); margin-bottom:8px;">גודל טקסט</div>
    <div id="textScaleRow" class="segmented" role="radiogroup" aria-labelledby="textScaleRowLabel" style="margin-top:0;">
      ${opts.map(([val, label]) => `<button class="segmented-opt" data-action="set-text-scale" data-pref="${val}" role="radio" aria-checked="${textScalePref === val}">${label}</button>`).join("")}
    </div>
    <div style="color:var(--steel); font-size:13px; margin-top:8px;">כך ייראה הטקסט באפליקציה</div>
  </div>`;
}

// Security hunt round 8: this was the one delete-* action in the whole
// dispatcher with no askAppConfirm step - a single tap deleted a custom
// WOD outright, and its ✕ sat pixel-adjacent to the pick-wod button
// beside it (see the .movement-btn gap fix in index.html). Named for what
// it destroys, same convention as askDeleteEntry/askDeleteMeasureType.
function askDeleteCustomWod(id) {
  const wod = customWods.find((item) => item.id === id);
  if (!wod) return;
  askAppConfirm({
    title: "מחיקת אימון",
    message: `${wod.name}. האימון המותאם אישית יימחק לצמיתות.`,
    confirmLabel: "מחיקה", destructive: true,
    action: "delete-custom-wod", payload: { id },
    opener: { action: "delete-custom-wod", id },
  });
}
async function deleteCustomWod(id) {
  const wod = customWods.find((item) => item.id === id);
  if (!wod || wod.category !== "Custom" || wodEntriesFor(id).length) return false;
  customWods = customWods.filter((item) => item.id !== id);
  if (selectedWodId === id) selectedWodId = null;
  if (wodHistoryId === id) wodHistoryId = null;
  renderWodPickerList("");
  render();
  try { await dbDeleteCustomWod(id); } catch (e) {
    customWods.push(wod);
    noteStorageError(e);
    render();
    return false;
  }
  return true;
}

// ---------- WOD builder ----------
let wodBuilderOpenerEl = null;
// Live bug hunt (2026-09-11): "בניית אימון מותאם אישית" is reachable from
// INSIDE the WOD picker (open-wod-builder, dispatched with the picker still
// open underneath) - this never closed it first, same root-cause shape as
// the earlier achievements/nav-menu bug (openAchievements()/openSettings()
// both call closeNavMenu() first for exactly this reason). With both
// wodPickerOpen and wodBuilderOpen true at once, currentAppDialog() (first
// match by registration order) kept treating the now-INVISIBLE picker as
// "the" open dialog: Escape closed the hidden picker while the visible
// builder stayed open (a second Escape was needed), Shift+Tab from the
// builder's first control tabbed into the hidden picker's controls instead
// of wrapping within the builder, and the picker's own close() reset
// document.body.style.overflow to "" one press early even though the
// builder - a full-screen modal - should still be blocking scroll.
// closeWodPicker() is a safe no-op when the picker was never open (the
// other entry point, "יצירת אימון משלי", opens the builder directly).
function openWodBuilder(prefillName) {
  closeWodPicker();
  wodBuilderOpen = true;
  wodBuilderOpenerEl = document.activeElement;
  builderFormat = null;
  builderMovements = bag();
  builderMoveSearch = "";
  builderEmomMinutes = 10;
  builderTimeCapMinutes = 0;
  document.body.style.overflow = "hidden";
  const overlay = document.getElementById("wodBuilderOverlay");
  overlay.style.height = (window.visualViewport ? window.visualViewport.height : window.innerHeight) + "px";
  overlay.classList.add("open");
  document.getElementById("wodBuilderName").value = prefillName || "";
  document.getElementById("wodBuilderName").removeAttribute("aria-invalid");
  const nameHint = document.getElementById("wodBuilderNameHint");
  if (nameHint) { nameHint.textContent = ""; nameHint.style.display = "none"; }
  const moveSearch = document.getElementById("wodBuilderMoveSearch");
  if (moveSearch) moveSearch.value = "";
  renderWodBuilderMovements("");
  renderWodBuilderFormats();
  setTimeout(() => focusFirstAppDialogEl("wodBuilderOverlay"), 50);
}
function closeWodBuilder() {
  wodBuilderOpen = false;
  document.body.style.overflow = "";
  const overlay = document.getElementById("wodBuilderOverlay");
  if (overlay) overlay.classList.remove("open");
  if (wodBuilderOpenerEl && typeof wodBuilderOpenerEl.focus === "function") wodBuilderOpenerEl.focus();
  wodBuilderOpenerEl = null;
}
function renderWodBuilderFormats() {
  document.querySelectorAll("#wodBuilderFormats .format-chip").forEach((btn) => {
    const active = btn.dataset.format === builderFormat;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", String(active));
    btn.style.borderColor = "";
  });
  const hint = document.getElementById("wodBuilderFormatHint");
  if (hint) {
    hint.textContent = "חובה לבחור אחד";
    hint.style.color = "var(--steel)";
  }
  const isEmom = builderFormat === "emom";
  const emomEl = document.getElementById("wodBuilderEmomOptions");
  if (emomEl) {
    emomEl.innerHTML = isEmom ? `
      <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;">כמה דקות</div>
      <div class="steppers" style="margin-bottom:16px;">${renderStepper("emomMinutes", "דקות", builderEmomMinutes, 1, 1, "builder-emom-minutes")}</div>
    ` : "";
  }
  const movesLabel = document.getElementById("wodBuilderMovesLabel");
  if (movesLabel) movesLabel.textContent = isEmom ? "תרגילים (סדר הסיבוב — לפי סדר הבחירה)" : "תרגילים (אופציונלי)";
  // Reference-only, shown for every format except EMOM (which already has
  // its own minutes) — never enforced or scored against, see saveWod().
  const capEl = document.getElementById("wodBuilderTimeCapOptions");
  if (capEl) {
    capEl.innerHTML = (builderFormat && !isEmom) ? `
      <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;">מגבלת זמן (אופציונלי, 0 = ללא)</div>
      <div class="steppers" style="margin-bottom:16px;">${renderStepper("timeCapMinutes", "דקות", builderTimeCapMinutes, 1, 0, "builder-time-cap")}</div>
    ` : "";
  }
}
function renderWodBuilderMovements(query) {
  const el = document.getElementById("wodBuilderMovements");
  if (!el) return;
  if (typeof query === "string") builderMoveSearch = query;
  const q = builderMoveSearch.trim().toLowerCase();
  const filtered = allWodMovementTags().filter((m) => m.name.toLowerCase().includes(q));
  const exactMatch = allWodMovementTags().some((m) => m.name.toLowerCase() === q);
  const byCategory = bag();
  filtered.forEach((m) => { (byCategory[m.category] = byCategory[m.category] || []).push(m); });
  const addRow = builderMoveSearch.trim() && !exactMatch
    ? `<div style="border:1px solid var(--brass); border-radius:12px; padding:10px 12px; margin-bottom:10px;">
         <div style="font-weight:700; font-size:13px; color:var(--brass); margin-bottom:8px;">הוספת "${bidiText(builderMoveSearch.trim())}" — לאיזו קטגוריה?</div>
         <div class="flex wrap gap-8">
           ${WOD_MOVE_CATEGORIES.map((cat) => `<button class="format-chip" style="flex:0 0 auto; padding:8px 14px;" data-action="add-builder-movement-tag" data-name="${esc(builderMoveSearch.trim())}" data-category="${cat}">${esc(catLabel(cat))}</button>`).join("")}
         </div>
       </div>`
    : `<button class="movement-btn" data-action="focus-wod-builder-search" style="border-color:var(--brass); margin-bottom:10px;">
         <span style="font-weight:700; font-size:14px; color:var(--brass);">+ הוספת תרגיל/סקילס חדש</span>
       </button>`;
  if (Object.keys(byCategory).length === 0) {
    const noneHtml = builderMoveSearch.trim() ? `<div style="color:var(--steel); text-align:center; padding:16px 0; font-size:13px;">לא נמצא תרגיל התואם ל-"${bidiText(builderMoveSearch)}"</div>` : "";
    el.innerHTML = addRow + noneHtml;
    return;
  }
  el.innerHTML = addRow + Object.entries(byCategory).map(([cat, items]) => `
    <div class="cat-group">
      <div class="cat-head"><div class="dot" style="background:${esc(catColor(cat))}"></div><h3 class="cat-name">${esc(catLabel(cat))}</h3></div>
      ${items.map((m) => {
        const entry = builderMovements[m.name];
        const checked = !!(entry && entry.checked);
        const data = entry || { reps: 10, weight: 0, type: "reps", durationSeconds: 20 };
        const isEmom = builderFormat === "emom";
        const hasWeight = WOD_MOVE_CATEGORIES_WITH_WEIGHT.has(m.category);
        const isDuration = data.type === "duration";
        // An EMOM station can be a rest minute ("סבב ללא תרגיל"), and a
        // non-rest station is reps or a timed hold, optionally at a weight -
        // the older app's model, which members already have on disk (see
        // sanitizeWodShape). Outside EMOM the rest flag means nothing, so it
        // is neither shown nor read.
        const isRest = isEmom && !!data.isRest;
        // Unchecking a station keeps its entry (checked:false) instead of
        // deleting it, so re-checking restores its original position in
        // the rotation instead of silently moving it to the end.
        const rotationNum = isEmom && checked ? activeBuilderMovementNames().indexOf(m.name) + 1 : null;
        return `
        <button class="movecheck-row ${checked ? "checked" : ""}" data-action="toggle-builder-movement" data-name="${esc(m.name)}" role="checkbox" aria-checked="${checked}">
          <span style="font-weight:600; font-size:14px;">${rotationNum ? `${rotationNum}. ` : ""}${bidiText(m.name)}${isRest ? ` <span style="background:var(--border); color:var(--chalk); border-radius:6px; padding:2px 6px; font-size:10.5px; font-weight:700;">מנוחה</span>` : ""}</span>
          <div class="movecheck-box">${checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--avatar-ink)" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' : ""}</div>
        </button>
        ${checked && isEmom ? `
        <div class="flex gap-8" style="margin:-2px 0 6px; padding:0 2px;">
          <button class="format-chip ${isRest ? "active" : ""}" style="flex:0 0 auto; padding:6px 12px; font-size:11.5px;" data-action="toggle-builder-movement-rest" data-name="${esc(m.name)}" role="checkbox" aria-checked="${isRest}">מנוחה — סבב ללא תרגיל</button>
        </div>` : ""}
        ${checked && !isRest ? `
        <div class="flex gap-8" style="margin:-2px 0 6px; padding:0 2px;" role="radiogroup" aria-label="חזרות או זמן — ${esc(m.name)}">
          <button class="format-chip ${!isDuration ? "active" : ""}" style="flex:0 0 auto; padding:6px 12px; font-size:11.5px;" data-action="toggle-builder-movement-type" data-name="${esc(m.name)}" data-type="reps" role="radio" aria-checked="${!isDuration}">חזרות</button>
          <button class="format-chip ${isDuration ? "active" : ""}" style="flex:0 0 auto; padding:6px 12px; font-size:11.5px;" data-action="toggle-builder-movement-type" data-name="${esc(m.name)}" data-type="duration" role="radio" aria-checked="${isDuration}">זמן</button>
        </div>
        <div class="flex" style="gap:8px; margin:0 0 10px; padding:0 2px;">
          ${isDuration ? renderStepper(m.name, "שניות", data.durationSeconds, 5, 1, "builder-movement-duration") : renderStepper(m.name, isEmom ? "חזרות בכל סבב" : "חזרות", data.reps, 1, 0, "builder-movement-reps")}
          ${hasWeight ? renderStepper(m.name, "ק\"ג", data.weight, 2.5, 0, "builder-movement-weight") : ""}
        </div>` : ""}`;
      }).join("")}
    </div>`).join("");
}
// Selected, in original rotation order — filters out unchecked entries
// rather than reading Object.keys(builderMovements) directly, since an
// unchecked station stays in the object (see toggleBuilderMovement) so a
// re-check can restore its position instead of moving it to the end.
function activeBuilderMovementNames() {
  return Object.keys(builderMovements).filter((name) => builderMovements[name].checked);
}
function toggleBuilderMovement(name) {
  if (Object.prototype.hasOwnProperty.call(builderMovements, name)) builderMovements[name].checked = !builderMovements[name].checked;
  else builderMovements[name] = { reps: 10, weight: 0, type: "reps", durationSeconds: 20, checked: true };
  renderWodBuilderMovements();
}
function setBuilderMovementType(name, type) {
  if (!builderMovements[name]) return;
  builderMovements[name].type = type === "duration" ? "duration" : "reps";
  renderWodBuilderMovements();
}
function toggleBuilderMovementRest(name) {
  if (!builderMovements[name]) return;
  builderMovements[name].isRest = !builderMovements[name].isRest;
  renderWodBuilderMovements();
}
// Changing the format is a step change: a station flagged as EMOM rest
// carries no reps, but nothing outside EMOM reads that flag, so leaving it
// set would silently publish the station as a normal "10 Burpees" line in a
// For Time / AMRAP description.
function setBuilderFormat(format) {
  const wasEmom = builderFormat === "emom";
  builderFormat = format;
  if (wasEmom && format !== "emom") {
    Object.keys(builderMovements).forEach((n) => { builderMovements[n].isRest = false; });
  }
  renderWodBuilderFormats();
  renderWodBuilderMovements();
}
function createWodFromBuilder() {
  const nameInput = document.getElementById("wodBuilderName");
  const name = nameInput ? cleanStr(nameInput.value, LIMITS.nameLen) : "";
  const nameHint = document.getElementById("wodBuilderNameHint");
  if (!name) {
    if (nameInput) { nameInput.setAttribute("aria-invalid", "true"); nameInput.focus(); }
    if (nameHint) { nameHint.textContent = "יש להזין שם לאימון"; nameHint.style.display = "block"; }
    return;
  }
  if (nameInput) nameInput.removeAttribute("aria-invalid");
  if (nameHint) { nameHint.textContent = ""; nameHint.style.display = "none"; }
  if (!builderFormat) {
    const hint = document.getElementById("wodBuilderFormatHint");
    if (hint) {
      hint.textContent = "יש לבחור פורמט למעלה כדי להמשיך";
      hint.style.color = "var(--red)";
    }
    document.querySelectorAll("#wodBuilderFormats .format-chip").forEach((btn) => {
      btn.style.borderColor = "var(--red)";
    });
    return;
  }
  if (builderFormat === "emom") {
    const emomMovements = activeBuilderMovementNames();
    if (emomMovements.length === 0) {
      const hint = document.getElementById("wodBuilderFormatHint");
      if (hint) { hint.textContent = "יש לבחור לפחות תרגיל אחד לסיבוב"; hint.style.color = "var(--red)"; }
      return;
    }
    // Every field that does not belong to a station's own type is zeroed,
    // so a duration station's never-shown default "reps: 10" is not stored
    // as if it meant something. The type array is what the log form reads to
    // decide which stepper (or none, for rest) each slot gets.
    const emomMovementTypes = emomMovements.map((n) => builderMovements[n].isRest ? "rest" : builderMovements[n].type === "duration" ? "duration" : "reps");
    const emomTargetReps = emomMovements.map((n, i) => emomMovementTypes[i] === "reps" ? builderMovements[n].reps : 0);
    const emomTargetDurations = emomMovements.map((n, i) => emomMovementTypes[i] === "duration" ? (builderMovements[n].durationSeconds || 0) : 0);
    const emomTargetWeights = emomMovements.map((n, i) => emomMovementTypes[i] === "rest" ? 0 : (builderMovements[n].weight || 0));
    addCustomWod(name, "emom", emomWodDesc(builderEmomMinutes, emomMovements, emomMovementTypes, emomTargetReps, emomTargetDurations, emomTargetWeights), {
      emomMinutes: builderEmomMinutes, emomMovements, emomMovementTypes, emomTargetReps, emomTargetDurations, emomTargetWeights,
    });
    return;
  }
  const activeMovements = {};
  for (const n of activeBuilderMovementNames()) activeMovements[n] = builderMovements[n];
  addCustomWod(name, builderFormat, builderMovementsToDesc(activeMovements), {
    timeCapSeconds: builderTimeCapMinutes > 0 ? builderTimeCapMinutes * 60 : null,
  });
}
// Pure by design, same reasoning as builderMovementsToDesc — a compact,
// human-readable summary of the rotation for the WOD picker/log header.
function emomWodDesc(minutes, movements, types, targetReps, targetDurations, targetWeights) {
  return `EMOM ${minutes}: ${movements.map((n, i) => {
    const type = types?.[i] || "reps";
    if (type === "rest") return "Rest";
    const weight = targetWeights?.[i];
    const suffix = weight ? ` @ ${weight}kg` : "";
    return type === "duration" ? `${formatDuration(targetDurations?.[i])} ${n}${suffix}` : `${targetReps?.[i] || 0} ${n}${suffix}`;
  }).join(" / ")}`;
}
// Pure by design (no DOM/state reads) so it's directly testable — the
// builder's per-movement reps/weight/duration fields are never stored as
// structured data on the WOD itself, only baked into this free-text desc.
function builderMovementsToDesc(movements) {
  return Object.entries(movements)
    .map(([name, d]) => d.type === "duration"
      ? `${formatDuration(d.durationSeconds)} ${name}${d.weight ? ` @ ${d.weight}kg` : ""}`
      : `${d.reps} ${name}${d.weight ? ` @ ${d.weight}kg` : ""}`)
    .join(", ");
}

// Same in-flight guard as saveSet() above, same live-report double-tap bug
// reproduced against the WOD save CTA too.
let savingWod = false;
async function saveWod(sanityConfirmed) {
  if (savingWod) return;
  savingWod = true;
  try {
  const w = wodById(selectedWodId);
  // COMM-360: no WOD chosen yet (selectedWodId now defaults to null, not a
  // real WOD) - the empty state has no save button, but defend anyway.
  if (!w) return;
  // Design spec §3.6: no default, so there is a real state in which this form
  // is not answered yet. The CTA is disabled in that state (see render()),
  // and this is the guard behind it - a WOD may not be filed as Rx or as
  // scaled because of what the app assumed.
  if (!wodEffortAnswered(wodRx)) return;
  if (!isFinite(wodMinutes) || !isFinite(wodSeconds) || !isFinite(wodRounds) || !isFinite(wodReps) || !isFinite(wodWeight) || !isFinite(wodScaledWeight)) return;
  if (w.scoreType === "emom" && !wodEmomReps.every((r) => isFinite(r))) return;
  const editId = editingWodEntryId;
  const existing = editId ? wodEntries.find((e) => e.id === editId) : null;
  // Live bug hunt (2026-09-11): rx-scoped now - see bestWodScore()'s comment.
  const prevBest = bestWodScore(selectedWodId, editId, wodRx);
  // Same guard as saveSet(), and missed here for the same reason the rest of
  // this function's siblings were not: a load-format WOD is a max-lift
  // benchmark, so it takes a raw weight and reaches the identical celebration
  // overlay. Without this, a 400 typed where 40 was meant threw a full-screen
  // "שיא אישי חדש" and wrote a permanent fake record, with no way back except
  // finding and editing the entry.
  //
  // The first-attempt half arrived with the same fix as saveSet()'s, through
  // the shared predicate: prevBest is rx-scoped, so "no previous best" is not
  // only a brand-new WOD - a member's first Rx attempt at a WOD they have
  // scaled ten times has no Rx best either, and reached the celebration with
  // nothing standing between it and a typo. A load WOD names no movement
  // category (the built-in library has no load entries at all; these are
  // Custom and Club WODs), so it takes the unknown-category ceiling, which is
  // the most forgiving one by construction.
  if (w.scoreType === "load" && !sanityConfirmed
      && weightNeedsSanityCheck(wodWeight, prevBest, firstSetWeightCeiling(null))) {
    // savingWod is cleared by this function's own finally, not here.
    askAppConfirm({
      title: `${wodWeight} ק״ג — לוודא?`,
      message: prevBest > 0
        ? `התוצאה הטובה שלך ב-${w.name} עד היום היא ${prevBest} ק״ג.`
        : `זו התוצאה הראשונה שלך ב-${w.name}, אז אין עדיין תוצאה להשוות אליה — והמשקל הזה גבוה מהטווח הרגיל.`,
      confirmLabel: "כן, זה נכון", cancelLabel: "תיקון",
      action: "save-wod",
    });
    return;
  }
  const entry = {
    id: existing ? existing.id : uid("wod"),
    ts: existing ? existing.ts : Date.now(),
    updatedAt: Date.now(), // last modified — see saveSet for why this is not ts
    // Live bug hunt (2026-09-11): same fix as saveSet() - see
    // logDateExplicitlyChosen's declaration.
    date: wodLogDateExplicitlyChosen ? clampLogDate(wodLogDate) : todayISO(),
    wodId: selectedWodId,
    scoreType: w.scoreType,
    rx: wodRx,
  };
  if (w.scoreType === "time") entry.timeSeconds = wodMinutes * 60 + wodSeconds;
  else if (w.scoreType === "amrap") { entry.rounds = wodRounds; entry.reps = wodReps; }
  // Only the loggable stations are stored: a rest minute has nothing to
  // log, and the older app (whose entries members already have on disk)
  // wrote emomReps this way. startEditWodEntry() re-expands it.
  else if (w.scoreType === "emom") entry.emomReps = wodEmomReps.filter((_, i) => w.emomMovementTypes?.[i] !== "rest");
  else entry.weight = wodWeight;
  entry.notes = wodNotes.trim() || null;
  entry.scaledWeight = wodRx === false ? wodScaledWeight : null;
  entry.partnerTag = cleanStr(wodPartnerTag, LIMITS.partnerTag) || null;

  // EMOM has no cross-attempt scoring (yet) — see bestWodScore/scoreValue.
  const val = scoreValue(entry);
  // NOTHING TO BEAT IS NOT A RECORD. Live bug hunt, fresh round 8
  // (2026-09-15) - HIGH, and it fired constantly rather than at an edge.
  //
  // `prevBest === null ||` made a WOD's FIRST-EVER attempt a personal record
  // by definition. Every member's first Fran, first Grace, first anything
  // opened the full-screen celebration, stored isPR: true in IndexedDB, and
  // left a permanent flame on the entry and a record dot on the calendar day
  // - for a result with no history to compare against.
  //
  // The strength side says this in its own words: "nothing is a personal
  // record until there is something to beat", and enforces it with
  // MIN_ENTRIES_BEFORE_PR. The WOD side inverted the same question. A
  // threshold is not needed here - a WOD result is one attempt, not a set, so
  // "is there a previous best" IS the question - but the answer had the wrong
  // sign.
  // ONE LINE, deliberately: test/hunt-round8-wod-log.test.mjs pins this
  // decision by slicing the source from `const isPR` to the next newline, so
  // wrapping it hides the `prevBest !== null &&` that guard exists to protect.
  const isPR = w.scoreType === "emom" ? false : (prevBest !== null && (scoreLowerIsBetter(w.scoreType) ? val < prevBest : val > prevBest));
  entry.isPR = isPR;

  // Live bug hunt (2026-09-11): same write-before-mutate fix as saveSet()
  // above - a failed write must have no visible side effect (no PR flash,
  // no first-log celebration for a WOD entry that doesn't exist on disk).
  try { await dbPutWodEntry(entry); storageOK = true; } catch (e) { noteStorageError(e); render(); return; }
  wodEntries = wodEntries.filter((e) => e.id !== entry.id);
  wodEntries.unshift(entry);
  wodEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  wodNotes = "";
  wodPartnerTag = "";
  editingWodEntryId = null;
  wodLogDate = todayISO();
  wodLogDateExplicitlyChosen = false;
  // NEVER on an edit. Live bug hunt, fresh round 3 (2026-09-15) - HIGH.
  // bestWodScore() excludes the row being edited from its own comparison
  // pool, so correcting a typo (59:00 down to a real 5:30) looked like a
  // brand-new personal record and reopened the full-screen celebration.
  //
  // saveSet() has carried exactly this guard, and a comment describing
  // exactly this bug, since the strength side hit it first: "Correcting the
  // audit's 300 kg typo down to 30 fired 'שיא אישי חדש!' a second time".
  // The WOD side was simply never given the same gate.
  const celebratePR = isPR && !existing;
  // And say so when an edit REMOVES one. saveSet() has told members this
  // since the strength side hit it ("you updated the set - the mark on the
  // previous result was removed"); the WOD side dropped the flame in silence.
  // Live bug hunt, fresh round 8 (2026-09-15).
  if (existing && existing.isPR && !isPR) showToast("עדכנתם את האימון — העיטור על התוצאה הקודמת הוסר.");
  if (celebratePR) flashWodPR(entry.rx);
  // Same ordering rule as saveSet(): the debt is claimed before the render
  // that evaluates S5's consent card, never after it.
  const isFirstLogArrival = !firstLogCelebrated && totalLoggedEntries() === 1;
  if (isFirstLogArrival) firstLogArrivalPending = true;
  render();
  // A logged WOD is just as much a first entry as a logged set - a member
  // who starts on the אימונים tab gets the same arrival moment (§1.2 S4).
  if (isFirstLogArrival) {
    celebrateFirstLog(`${w.name} — ${formatWodEntry(entry)}`);
  } else {
    celebrateAfterSave(celebratePR ? `${w.name} — ${formatWodEntry(entry)}` : null,
      `נשמר: ${w.name} — ${formatWodEntry(entry)}`);
  }
  // Same rule as saveSet(): a new result counts, an edit does not.
  if (!existing) countUsage("workout_logged");
  } finally { savingWod = false; }
}
// Live bug hunt (2026-09-11): same two-tab staleness fix as startEditEntry()
// above - see its own comment.
async function startEditWodEntry(id) {
  let entry = wodEntries.find((e) => e.id === id);
  if (!entry) return;
  try {
    const fresh = (await dbLoadWodEntries()).find((e) => e.id === id);
    if (fresh) {
      entry = fresh;
      const idx = wodEntries.findIndex((e) => e.id === id);
      if (idx !== -1) wodEntries[idx] = fresh;
    }
  } catch (e) { /* offline/storage error - fall back to the in-memory copy above */ }
  const w = wodById(entry.wodId);
  if (!w) return;
  selectedWodId = entry.wodId;
  emomStateWodId = entry.scoreType === "emom" ? entry.wodId : null;
  wodRx = entry.rx;
  wodNotes = entry.notes || "";
  wodPartnerTag = entry.partnerTag || "";
  wodScaledWeight = entry.scaledWeight || 20;
  if (entry.scoreType === "time") { wodMinutes = Math.floor((entry.timeSeconds || 0) / 60); wodSeconds = (entry.timeSeconds || 0) % 60; }
  else if (entry.scoreType === "amrap") { wodRounds = entry.rounds || 0; wodReps = entry.reps || 0; }
  else if (entry.scoreType === "emom") {
    // entry.emomReps holds only the non-rest stations (see saveWod), so it
    // is re-expanded against the WOD's own rotation - rest slots get 0 - to
    // line up with w.emomMovements again. Reading it as-is shifted every
    // value after a rest slot onto the wrong station, and a re-save wrote
    // the shift to disk.
    const compact = (entry.emomReps || []).slice();
    let ci = 0;
    wodEmomReps = w.emomMovements.map((_, i) => (w.emomMovementTypes?.[i] === "rest" ? 0 : compact[ci++]) ?? 0);
  }
  else wodWeight = entry.weight || 0;
  wodLogDate = entry.date;
  wodLogDateExplicitlyChosen = true; // opening a real past WOD entry's date is as explicit a choice as touching the date field
  editingWodEntryId = entry.id;
  tab = "wod";
  wodSubTab = "log";
  render();
}
function cancelEditWodEntry() {
  editingWodEntryId = null;
  wodLogDate = todayISO();
  wodLogDateExplicitlyChosen = false;
  wodNotes = "";
  wodPartnerTag = "";
  render();
}
// A logged WOD result is the same irreplaceable, hand-entered training data
// a logged set is, deleted from the same kind of unlabelled bin icon — it
// gets the identical confirm + undo rather than being the one destructive
// action left asymmetric.
function askDeleteWodEntry(id) {
  const entry = wodEntries.find((e) => e.id === id);
  if (!entry) return;
  const w = wodById(entry.wodId);
  askAppConfirm({
    title: "מחיקת אימון",
    message: `${w ? w.name : "האימון"} — ${formatWodEntry(entry)}, ${fmtDate(entry.date)}. הרישום יימחק מהמכשיר; אפשר יהיה לבטל למשך כמה שניות.`,
    confirmLabel: "מחיקה", destructive: true,
    action: "delete-wod-entry", payload: { id },
    opener: { action: "delete-wod-entry", id },
  });
}
async function deleteWodEntry(id) {
  const removed = wodEntries.find((e) => e.id === id);
  wodEntries = wodEntries.filter((e) => e.id !== id);
  if (editingWodEntryId === id) { editingWodEntryId = null; wodLogDate = todayISO(); wodLogDateExplicitlyChosen = false; }
  try { await dbDeleteWodEntry(id); } catch (e) { noteStorageError(e); }
  if (removed) {
    const w = wodById(removed.wodId);
    offerUndo(`${w ? w.name : "האימון"} — ${formatWodEntry(removed)} נמחק`, () => restoreWodEntry(removed));
  }
  render();
}
async function restoreWodEntry(entry) {
  // Live bug hunt (2026-09-11): the WOD this entry belongs to can be deleted
  // AFTER this undo was offered - deleteCustomWod()'s own history guard only
  // sees wodEntries as they are at the moment of deletion, and an entry
  // sitting in the undo window has already been filtered out of that array.
  // Restoring it anyway created a permanently orphaned entry: invisible in
  // the History subtab (activeWods() drops it via wodById()), shown as
  // "? מלא" forever in the calendar, and its own edit pencil a silent no-op.
  // Refuse instead, with an honest toast.
  if (!wodById(entry.wodId)) {
    showToast("אי אפשר לשחזר — האימון עצמו נמחק בינתיים.");
    render(); // showToast() only stores the pending toast - render() is what actually paints it
    return;
  }
  wodEntries = wodEntries.filter((e) => e.id !== entry.id);
  wodEntries.unshift(entry);
  wodEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  try { await dbPutWodEntry(entry); storageOK = true; } catch (e) { noteStorageError(e); }
  render();
}

let wodPrFlashTimeout = null;
// SAY WHICH LEVEL THE RECORD IS AT (2026-09-15).
//
// bestWodScore(id, excludeId, rx) has always kept an Rx best and a scaled best
// as separate ladders, so a scaled athlete's PR is already a real PR in our
// data - which is better than Wodify, where only Rx metcons can be PRs at all.
// The UI just never said so: the same "שיא חדש!" appeared either way, which
// leaves a scaled athlete to wonder whether the app is humouring them.
//
// The research on this is consistent: scaled athletes read an unmarked board
// as "everyone else did the real one", and competitive athletes suppress
// honest scaled logging to protect a leaderboard position. Both failures end
// in the same place - people not logging - which is the one outcome this app
// cannot afford, since every downstream feature is built on the log.
function flashWodPR(rx) {
  const el = document.getElementById("wodFlashBox");
  if (!el) return;
  const label = el.querySelector("[data-wod-flash-label]");
  // Named rather than qualified: "שיא אישי מסוקיילד" states the level as a
  // fact about the record. A hedge like "שיא (מסוקיילד)" reads as an asterisk.
  if (label) label.textContent = rx === false ? "שיא אישי מסוקיילד!" : "שיא חדש!";
  el.style.display = "flex";
  clearTimeout(wodPrFlashTimeout);
  wodPrFlashTimeout = setTimeout(() => { if (el) el.style.display = "none"; }, 1400);
}

let prFlashTimeout = null;
function flashPR() {
  const el = document.getElementById("barWrap");
  if (!el) return;
  el.classList.add("pr");
  const flash = document.getElementById("prFlash");
  if (flash) flash.style.display = "flex";
  clearTimeout(prFlashTimeout);
  prFlashTimeout = setTimeout(() => {
    el.classList.remove("pr");
    if (flash) flash.style.display = "none";
  }, 1400);
}

function showUpdateBanner() {
  const el = document.getElementById("updateBanner");
  if (el) el.style.display = "block";
  dismissInstallBanner();
}

// ---------- Icons ----------
const ICONS = {
  // The inner arc used to carve a circular hole under nonzero winding, so
  // this rendered as a crescent, not a flame. Same drop shape as index.html's
  // #glyphFlame (used by the medal sprite), just as a standalone icon.
  flame: '<svg width="15" height="15" viewBox="0 0 100 100" fill="var(--brass)" stroke="none"><path d="M50 14 C40 32 30 40 30 56 C30 72 40 84 50 84 C60 84 70 72 70 56 C70 46 64 40 60 44 C60 30 56 20 50 14 Z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  dumbbell: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="2" stroke-linecap="round"><path d="M4 9v6M20 9v6M2 10v4M22 10v4M7 12h10"/></svg>',
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--steel)" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linecap="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--steel)" stroke-width="2.2" stroke-linecap="round"><path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/></svg>',
  flat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--steel)" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  chevronsLeft: '<img src="./assets/icon-chevrons.png" alt="" width="11" height="10" style="transform:scaleX(-1); vertical-align:middle;" />',
  // The two log-screen empty-state glyphs. Drawn to cloud.js's
  // EMPTY_STATE_ICONS conventions on purpose - 28-box, 1.8 stroke, round
  // caps and joins, currentColor - so the log screen's empty state and the
  // coach dashboard's look like one set. Kept here rather than borrowed
  // from cloud.js for the mirror image of the reason stated there: app.js
  // is the offline log and must not depend on the community module loading.
  emptyBarbell: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5M7 6.5v11M17 6.5v11M20 9.5v5M7 12h10"/></svg>',
  emptyDay: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4.5" width="16" height="16" rx="2.5"/><path d="M9 2.8h6M8.5 10.5h7M8.5 15h4"/></svg>',
  ladder: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v18M18 3v18M6 8h12M6 13h12M6 18h12"/></svg>',
  repeat: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  // A help circle, sized 20x20 to match settingsIcon: both render inside the
  // 30px .icon-chip in the nav menu and the desktop sidebar, and the 22x22
  // tab-bar glyphs overflow it. Added rather than reusing an existing icon -
  // the nearest candidates were the gear, which would put two identical
  // glyphs on adjacent rows, and the pencil, which says "write something"
  // rather than "get help".
  helpIcon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a3 3 0 0 1 5.6 1c0 2-2.8 2.5-2.8 4"/><path d="M12 17.5h.01"/></svg>',
  bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  calendarIcon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  chartIcon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V12M12 20V4M20 20v-7"/></svg>',
  stopwatchIcon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3"/></svg>',
  logIcon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/></svg>',
  communityIcon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.3"/><path d="M16.3 14c2.6.2 4.5 2.1 5 5"/></svg>',
  settingsIcon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  // Redesign, Phase 3 fix: byte-identical gear glyph to settingsIcon above,
  // just 22x22 instead of 20x20 - settingsIcon was sized for the 30px
  // .icon-chip context (nav menu / settings row) and reusing it directly
  // for the bottom tab bar's "ניהול" icon made it render 2px smaller than
  // its five 22x22 siblings in the same row. Keep settingsIcon itself
  // untouched so its existing .icon-chip usage doesn't shift.
  manageTabIcon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

// ---------- Rendering ----------
// The percentage surface, in its two forms. renderLogTab decides only WHETHER
// to show one (`est && !isDuration` - no estimate and no percentages, a hold
// has no 1RM to take a percentage of); these two decide what it looks like.
//
// The collapsed table is what shipped before club_features.strength_percentages
// existed and is what every member still sees until their club turns the key
// on. Untouched, deliberately, down to its 2.5 kg rounding note.
function renderPctTable(est) {
  return `
    <div style="margin-bottom:12px;">
      <button data-action="toggle-pct-table" class="movement-btn ${pctTableExpanded ? "active" : ""}" aria-expanded="${pctTableExpanded}" style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <span>אחוזים לאימון הבא</span>
        <span style="display:inline-flex; transition:transform .2s; transform:rotate(${pctTableExpanded ? "90deg" : "180deg"});">${ICONS.chevron}</span>
      </button>
      ${pctTableExpanded ? `<div class="chart-card" style="margin-top:8px;">
        <div class="footer-note" style="margin:0 0 10px;">מחושב מ־1RM משוער (${est} ק״ג) — הערכה מהסטים שרשמתם, לא מקס שנבדק. נקודת פתיחה להתאמה.</div>
        <div class="log-list">
          ${PCT_STEPS.map((pct) => `<div class="log-row"><span style="color:var(--steel); font-weight:700;">${pct}%</span><span class="mono" style="font-weight:700; color:var(--brass);">${bidiUnit(`${formatPlateKg(roundToPlate(est * pct / 100))} ק״ג`)}</span></div>`).join("")}
        </div>
        <div class="footer-note" style="margin:10px 0 0;">מעוגל ל־2.5 ק״ג — הקפיצה הקטנה ביותר שאפשר להעמיס על המוט.</div>
      </div>` : ""}
    </div>`;
}
// The chips, behind the key. Every chip is a BUTTON that fills the weight
// stepper, for the same reason the "last 14 days" chips below became buttons:
// a number the member has to read and then dial in by hand is ~22 taps of a
// 2.5 kg stepper away from being useful, and they are standing in a gym.
//
// Built entirely from existing tokens and existing classes (.format-chip,
// .mono, .footer-note, --surface2/--border/--steel/--chalk/--brass), so it
// themes itself and adds no CSS rule that could be missed from a dark block.
//
// It says what it is computed from, in the same words the table does, because
// that sentence is a product rule and not a caption: a member has to be able
// to tell an Epley estimate from a tested single before loading a bar to it.
function renderStrengthPctChips(est) {
  const chipStyle = "background:var(--surface2); border:1px solid var(--border); border-radius:10px; padding:6px 10px; font-size:12.5px; font-weight:700; color:var(--steel); min-height:44px; cursor:pointer;";
  return `
    <div style="margin-bottom:12px;" id="strengthPctChips">
      <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;" id="strengthPctLabel">משקלי עבודה — אחוז מ־1RM משוער (${est} ק״ג)</div>
      <div class="flex wrap gap-8" role="group" aria-labelledby="strengthPctLabel">
        ${STRENGTH_PCT_CHIPS.map((pct) => {
          const loadKg = roundToIncrement(est * pct / 100, pctIncrement);
          const shown = formatPlateKg(loadKg);
          return `<button type="button" class="mono" data-action="set-weight-from-pct" data-pct="${pct}" data-kg="${esc(String(loadKg))}" aria-label="${esc(`${pct} אחוז — ${shown} ק״ג, מילוי מהיר`)}" style="${chipStyle}">${pct}% <span style="color:var(--chalk);">${shown}</span></button>`;
        }).join("")}
      </div>
      <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin:10px 0 6px;" id="pctIncrementLabel">עיגול לקפיצה של</div>
      <div class="flex gap-8" role="radiogroup" aria-labelledby="pctIncrementLabel">
        ${PCT_INCREMENTS.map((inc) => `<button class="format-chip ${pctIncrement === inc ? "active" : ""}" data-action="set-pct-increment" data-inc="${inc}" role="radio" aria-checked="${pctIncrement === inc}">${formatPlateKg(inc)} ק״ג</button>`).join("")}
      </div>
      <div class="footer-note" style="margin:10px 0 0;">מחושב מ־1RM משוער (${est} ק״ג) — הערכה מהסטים שרשמתם, לא מקס שנבדק. נקודת פתיחה להתאמה.</div>
    </div>`;
}
function renderBarWeightRow() {
  return `<div id="barWeightRow">
    <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;" id="barWeightLabel">משקל המוט</div>
    <div class="flex gap-8" style="margin-bottom:12px;" role="radiogroup" aria-labelledby="barWeightLabel">
      ${BAR_OPTIONS.map((kg) => `<button class="format-chip ${barWeight === kg ? "active" : ""}" data-action="set-bar-weight" data-kg="${kg}" role="radio" aria-checked="${barWeight === kg}">${kg} ק״ג</button>`).join("")}
    </div>
  </div>`;
}
function renderBarbell(w) {
  const plates = calcPlates(w);
  const left = [...plates].reverse();
  const right = plates;
  const renderSide = (list) => list.map((p) =>
    `<div class="plate" style="width:${p.w}px;height:${p.h}px;background:${p.color};"></div>`
  ).join("");
  return `
    <div class="barbell">
      <div class="bar-row">
        ${renderSide(left)}
        <div class="collar"></div><div class="sleeve"></div>
        <div class="bar-center">${w}</div>
        <div class="sleeve"></div><div class="collar"></div>
        ${renderSide(right)}
      </div>
      <span class="bar-caption">${w < barWeight ? `מתחת למשקל המוט (${barWeight} ק״ג)` : `מוט ${barWeight} ק״ג + ${plates.length} משקולות`}</span>
    </div>`;
}

// How many points it takes before a line is a TREND rather than a pair of
// dots. Three, and the number is already the app's own answer: the "עוד N
// נתונים ותראו כאן מגמה" note below used it before this compact state
// existed.
const CHART_MIN_TREND_POINTS = 3;
// One or two points, drawn as a compact readout instead of a plot.
//
// Real-phone report: "a progress chart with one or two points fills a whole
// empty area". It did, exactly: the plot is a fixed padTop + plotH +
// padBottom = 174px tall whatever n is, so a member who has logged one set
// of a movement opened its card onto 174px of blank chart with a single dot
// in it and a note underneath explaining that it is not a trend yet. The
// note was the previous pass at this defect and it treated the symptom - it
// said the right thing, under the wrong thing.
//
// The data is genuine and stays, and so does the note: what goes is the
// EMPTY AREA around them. Each point becomes a row of its own - the value
// the plot would have drawn, and the date it would have labelled - which at
// n=1 or 2 is the entire information content of that 174px, in about 60px.
//
// role="img" + aria-label, not a table: this replaces a chart, the summary
// it carries is the same chartLabel() the plot uses, and
// test/chart-accessible-name.test.mjs asserts a single-point chart still has
// a real accessible name. It is a <div> rather than an <svg> because there
// is no longer a drawing - see that test, which was updated with this
// change rather than worked around.
function renderCompactChart(data, chartLabel) {
  const rows = data.slice().reverse().map((d) => `
    <div class="chart-compact-row">
      <span class="mono chart-compact-value${d.isPR ? " pr" : ""}">${bidiUnit(String(d.est1RM))}</span>
      <span class="chart-compact-date">${bidiUnit(d.dateLabel)}</span>
    </div>`).join("");
  const missing = CHART_MIN_TREND_POINTS - data.length;
  return `<div class="chart-compact" role="img" aria-label="${esc(chartLabel)}">${rows}</div>
    <div style="color:var(--steel); font-size:11.5px; text-align:center; margin-top:6px;">עוד ${missing} ${missing === 1 ? "נתון" : "נתונים"} ותראו כאן מגמה</div>`;
}
function renderChart(data) {
  if (!data.length) return `<div class="flex col items-center" style="padding:32px 0; gap:8px;">${ICONS.dumbbell}<span style="color:var(--steel); font-size:13px;">אין עדיין נתונים לתרגיל הזה</span></div>`;
  const n = data.length;
  // Every point gets its own date label now (rotated, to fit more before they
  // overlap). Few points still render at the original full-width 300 viewBox;
  // once labels would start crowding, the chart grows wide instead of
  // cramming, and scrolls horizontally so every date stays readable.
  const padTop = 20, padBottom = 44, plotH = 110, padX = 24, spacing = 44;
  const h = padTop + plotH + padBottom;
  const naturalW = padX * 2 + Math.max(0, n - 1) * spacing;
  const wide = naturalW > 300;
  const w = wide ? naturalW : 300;
  // RTL defect, found by a design review and missed by every persona: this
  // used to be `padX + i * step`, i.e. oldest at the left edge and newest at
  // the right, inside a page that is `dir="rtl"` end to end. A Hebrew reader
  // starts at the RIGHT, so the line was read newest-to-oldest and a rising
  // set of numbers appeared to descend — the chart said the opposite of what
  // the data said. Mirroring the x axis (oldest right, newest left) is the
  // whole fix; the y axis is unaffected, since up is up in every direction.
  const xs = data.map((d, i) => w - padX - i * ((w - 2 * padX) / Math.max(1, n - 1)));
  const ys = data.map((d) => d.est1RM);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const range = maxY - minY || 1;
  const pts = data.map((d, i) => ({
    x: xs[i],
    y: padTop + plotH - ((d.est1RM - minY) / range) * plotH,
    isPR: d.isPR,
    label: d.dateLabel,
  }));
  const polyline = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.isPR ? 5 : 2.5}" fill="${p.isPR ? "var(--brass)" : "var(--chalk)"}" ${p.isPR ? 'stroke="var(--surface)" stroke-width="2"' : ""}/>`).join("");
  const labelY = padTop + plotH + 12;
  // Rotation and anchor mirror with the axis above: rotate(+45)/anchor start
  // tilts each date away from its point in the same direction the plot now
  // runs, instead of leaning back across the line it belongs to.
  const labels = pts.map((p) => `<text x="${p.x.toFixed(1)}" y="${labelY}" font-size="9" fill="var(--steel)" text-anchor="start" transform="rotate(45 ${p.x.toFixed(1)} ${labelY})">${esc(p.label)}</text>`).join("");
  // COMM-359. This SVG carries the same progression a sighted user reads
  // visually (range, trend, which points are PRs) with nothing exposed to
  // assistive tech before this - role="img" + a computed summary stands in
  // for the actual chart; no unit is assumed here since this one function
  // renders est1RM, bodyweight and body-measurement charts alike.
  const prCount = pts.filter((p) => p.isPR).length;
  const first = data[0], lastPoint = data[n - 1];
  const chartLabel = n === 1
    ? `גרף התקדמות: נתון יחיד, ${lastPoint.dateLabel}: ${lastPoint.est1RM}`
    : `גרף התקדמות: ${n} נתונים בין ${first.dateLabel} (${first.est1RM}) ל-${lastPoint.dateLabel} (${lastPoint.est1RM})` + (prCount ? `, כולל ${prCount === 1 ? "שיא אישי אחד" : `${prCount} שיאים אישיים`}` : "");
  // Before any of the plot is emitted, and after chartLabel: a chart with
  // fewer than three points is not drawn at all. See renderCompactChart().
  if (n < CHART_MIN_TREND_POINTS) return renderCompactChart(data, chartLabel);
  const svg = `<svg role="img" aria-label="${esc(chartLabel)}" viewBox="0 0 ${w} ${h}" style="${wide ? `width:${w}px;` : "width:100%;"} height:${h}px; display:block;">
    <polyline points="${polyline}" fill="none" stroke="var(--brass)" stroke-width="2"/>
    ${dots}${labels}
  </svg>`;
  // Which way the picture runs is not self-evident from a line alone, and
  // the app's own best habit is telling the member what a number is built
  // from. Only worth saying once there are two points to have a direction.
  // Unconditional now: nothing below this line runs for n < 3.
  const axisNote = `<div style="color:var(--steel); font-size:11px; text-align:center; margin-top:4px;">מימין לשמאל: מהישן לחדש.</div>`;
  // dir="ltr" on the scroll box only, never on the SVG: a wide chart in an
  // RTL container opens scrolled to its right edge, which after the mirror
  // above is the OLDEST data. Flipping the scroll container's own direction
  // lands the initial scroll position on the newest end, where the member
  // actually wants to be.
  return (wide ? `<div dir="ltr" style="overflow-x:auto; -webkit-overflow-scrolling:touch;">${svg}</div>` : svg) + axisNote;
}

// One-line summary for an entry regardless of its type — used anywhere a
// logged set/hold needs a compact label (recent-history strip, day footer).
function entrySummary(e) {
  if (e.type === "duration") return `${e.sets}×${formatDuration(e.durationSeconds)}${e.weight ? " @ " + e.weight : ""}`;
  return `${e.sets}×${e.reps} @ ${e.weight}`;
}
// showExercise: true for a superset (two exercises in the same group) so
// each round is legible on its own — a plain single-exercise ladder omits
// it, matching the existing compact "reps×weight" style.
function ladderRoundSummary(r, showExercise) {
  const prefix = showExercise ? `${movementById(r.exerciseId) ? movementById(r.exerciseId).name : "?"}: ` : "";
  if (r.type === "duration") return `${prefix}${formatDuration(r.durationSeconds)}${r.weight ? " @ " + r.weight : ""}`;
  return `${prefix}${r.reps}×${r.weight}`;
}

// Design spec §1.2 S2. The five-screen explainer, demoted from a gate to a
// pull. A gate is answered by whoever is in a hurry with a dismissal; a card
// on an otherwise empty screen is answered by whoever actually wants it, and
// it is still there tomorrow for whoever did not.
//
// PLACEMENT NOTE, and it is a deliberate departure from the spec's wording.
// §1.2 S2 says "directly under the page title, above מה עשינו היום?". That
// puts a tour advertisement above the app's primary control on the first
// screen a member ever sees, which is the same mistake the install banner
// makes, one size smaller - and it contradicts the spec's own next sentence,
// which describes this as "the second-most prominent thing after the
// exercise picker". It renders directly BELOW the picker instead: on a
// first-run screen that is otherwise a paragraph of grey text and a large
// void, nothing above the fold competes with it, and the app's whole job
// stays the first thing on the page.
//
// PROMINENCE, revisited. The sentence above ("nothing above the fold
// competes with it") was true only because the picker above it was styled
// as flatly as this card was. Now that the picker reads as the primary
// action it is meant to be, an optional one-minute explainer wearing a
// brass border, a filled surface and a card shadow was the second-loudest
// thing on the screen and out of proportion to what it offers. It keeps its
// place, its copy and its 64px target - only the three accents are gone
// (.tour-offer, index.html).
// THE FIRST OPEN AFTER THE 2.x APP. This edition reads a member's existing
// data where it already is (same database, same keys), and writes a marker
// the first time it has run on a device, so any later migration starts from
// a known edition instead of guessing from which keys happen to exist.
//
// Before that marker exists on a device that already has data, the log
// screen offers one download of everything - the insurance the plan asks for
// against a defect in this upgrade, and the first file the 2.x export could
// not make, since it left out the per-day notes. It is an offer, not a gate:
// nothing is blocked while it is unanswered, and either answer writes the
// marker so it is asked exactly once.
const EDITION_KEY = "haimunia:schemaEdition";
const EDITION = "standalone-1";
let editionMarker = null;
let upgradeBackupOffered = false;
async function loadEditionMarker() {
  try { editionMarker = (await dbGetSetting(EDITION_KEY)) || null; } catch (e) { editionMarker = null; }
}
function markEditionSeen() {
  editionMarker = EDITION;
  upgradeBackupOffered = false;
  dbSetSetting(EDITION_KEY, EDITION).catch(noteStorageError);
}
function renderUpgradeBackupCard() {
  if (!upgradeBackupOffered) return "";
  return `
    <div class="card" style="margin-bottom:12px;">
      <div style="font-weight:700; font-size:14px; color:var(--chalk); margin-bottom:4px;">האפליקציה התעדכנה — כל הנתונים שלכם כאן</div>
      <div style="color:var(--steel); font-size:12.5px; margin-bottom:12px;">ליתר ביטחון, אפשר לשמור עכשיו קובץ גיבוי של כל האימונים, המדידות וההערות.</div>
      <div class="flex items-center gap-10">
        <button class="chip-btn" data-action="upgrade-backup-download" style="flex:1; min-height:44px;">הורדת גיבוי</button>
        <button class="chip-btn" data-action="upgrade-backup-dismiss" style="flex:1; min-height:44px;">לא עכשיו</button>
      </div>
    </div>`;
}
// The visible switch for src/usage.js. Same segmented control as the text
// size and theme rows, so it reads as one of the member's own settings.
function renderUsageCountingRow() {
  const on = !window.HaimuniaUsage || window.HaimuniaUsage.isOn();
  const opts = [["on", "פעיל"], ["off", "כבוי"]];
  return `<div id="usageCountingRow" class="segmented" role="radiogroup" aria-label="ספירת שימוש" style="margin-top:0;">
    ${opts.map(([val, label]) => `<button class="segmented-opt" data-action="set-usage-counting" data-pref="${val}" role="radio" aria-checked="${(val === "on") === on}">${label}</button>`).join("")}
  </div>`;
}
function renderTourCard() {
  if (!shouldShowTourCard()) return "";
  return `
    <button class="exercise-row tour-offer" data-action="open-onboarding" style="min-height:64px; margin-bottom:12px;">
      <div style="text-align:right;">
        <div style="font-weight:700; font-size:13.5px; color:var(--chalk);">סיור קצר במסכים</div>
        <!-- "ארבעת" is a claim about the explainer's contents: the overlay
             has exactly four rows, one per screen. -->
        <div style="color:var(--steel); font-size:12.5px; margin-top:2px;">דקה, ומכירים את ארבעת המסכים</div>
      </div>
      <span style="color:var(--steel); flex-shrink:0;">${ICONS.chevronsLeft}</span>
    </button>`;
}


function renderLogTab() {
  const selected = movementById(selectedId);
  const isDuration = logEntryType === "duration";
  const isBarbell = isBarbellMovement(selectedId);
  const est = isDuration ? null : bestEst1RM(selectedId);
  const bestHold = isDuration ? bestDurationFor(selectedId) : null;
  // Matches whichever mode is toggled — a duration exercise's most recent
  // reps-mode entry (or vice versa) isn't "last session" for this toggle.
  const last = entriesFor(selectedId).find((e) => (e.type === "duration") === isDuration);
  const isToday = logDate === todayISO();
  const dayEntries = entries.filter((e) => e.date === logDate);
  const dayLabel = isToday ? "היום" : fmtDate(logDate);

  // Immersive club redesign: dayEntries.length also decides the intro's
  // completion mark/subtitle (VISUAL_QA_PROTOCOL.md's Add-screen target:
  // "green completion mark, short subtitle" in the photo zone) - computed
  // here rather than duplicated, since dayEntries is already built above.
  const hasLoggedToday = dayEntries.length > 0;
  return `
    <section class="scene-page ${PAGE_SCENES.add.className}" aria-labelledby="pageTitle-add">
      <div class="scene-page__media" aria-hidden="true"></div>
      <div class="scene-page__scrim" aria-hidden="true"></div>
      <div class="scene-page__intro">
        <div class="scene-page__brand">${esc(brandWordmark())}</div>
        <h1 id="pageTitle-add" class="scene-page__title">${hasLoggedToday ? `<span aria-hidden="true" style="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:999px; background:var(--club-success); flex-shrink:0;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>` : ""}<span>סיכום אימון</span></h1>
        <p class="scene-page__subtitle">${hasLoggedToday ? "עבודה מעולה!" : "מוכנים להתחיל?"}</p>
      </div>
      <div class="scene-sheet">
    <div class="stripe-ribbon" aria-hidden="true"></div>
    ${!storageOK ? `<div class="footer-note" style="color:var(--red-text); background:rgba(216,69,60,.1); border:1px solid var(--red); border-radius:12px; padding:10px 14px; margin-bottom:12px;" role="alert">${esc(storageErrMsg)}</div>` : ""}
    ${editingEntryId ? `
    <div style="background:rgba(232,185,138,.12); border:1px solid var(--brass); border-radius:12px; padding:10px 14px; margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
      <span style="color:var(--brass); font-weight:700; font-size:13px;">עריכת סט קיים</span>
      <button data-action="cancel-edit-entry" style="color:var(--steel); font-size:12px; text-decoration:underline;">ביטול</button>
    </div>` : ""}

    <div class="scene-summary-meta"><bdi>${esc(fmtDate(logDate))}</bdi></div>

    ${dayEntries.length === 0 ? `
    <div class="day-empty">${ICONS.emptyDay}<span>${isToday ? "עדיין לא נרשמו סטים היום. כאן מתעדים את האימון שהושלם." : `עדיין לא נרשמו סטים ב-${esc(dayLabel)}.`}</span></div>` : `
    <h2 class="section-label">${isToday ? "סיכום האימון" : `סיכום ${esc(dayLabel)}`}</h2>
    <div class="chart-card" style="margin-bottom:8px;">${renderDayEntriesListHtml(dayEntries, [])}</div>
    <button class="link-btn link-btn--tap" data-action="view-log-date-calendar" style="display:flex; align-items:center; justify-content:space-between; width:100%; margin-bottom:0;">
      <span>הערות לאימון ופרטי היום · ${bidiText(entrySummary(dayEntries[0]))}</span>
      <span class="flex items-center gap-6">לוח השנה${ICONS.chevronsLeft}</span>
    </button>`}

    <!-- .pick-hero only while nothing is chosen - see index.html for why the
         chosen state deliberately stays a calm row. The chosen branch's
         markup is untouched: several checks read the exercise name off
         ".exercise-select span", i.e. the FIRST span in this button, so
         nothing may be inserted ahead of it. -->
    <button class="exercise-select${movementExplicitlyChosen ? "" : " pick-hero"}" data-action="open-picker">
      ${movementExplicitlyChosen ? `
      <div class="flex items-center gap-8">
        <div class="dot" style="background:${esc(catColor(selected.category))}"></div>
        <span style="font-weight:800; font-size:16px;">${bidiText(selected.name)}</span>
      </div>
      <span class="flex items-center gap-6" style="color:var(--steel); font-size:12px; font-weight:600;">שינוי${ICONS.chevronsLeft}</span>` : `
      <span class="pick-hero-title">מה עשינו היום?</span>
      <span class="pick-hero-cta">בחירת תרגיל${ICONS.chevronsLeft}</span>`}
    </button>



    ${renderUpgradeBackupCard()}
    ${renderTourCard()}

    <!-- The four-slot empty state (icon / forward-looking headline / one
         line of explanation / a when-line), the same pattern d540a34 landed
         in cloud.js's emptyStateHtml() and the coach dashboard uses.
         It replaces a single unstyled sentence floating in roughly 60% of a
         blank screen. The when-line is the load-bearing slot here: an empty
         log screen that says what is about to appear in it reads as ready,
         where one that says only "choose an exercise" reads as broken. -->
    ${!movementExplicitlyChosen ? `
    <div class="log-empty" data-empty-state="log-choose-exercise">
      <span class="log-empty-medal" aria-hidden="true">${ICONS.emptyBarbell}</span>
      <div class="log-empty-text">
        <h2 class="log-empty-head">כאן מתעדים את האימון של היום</h2>
        <div class="log-empty-body">בוחרים תרגיל בכרטיס שלמעלה, ומשקל, חזרות וסטים נפתחים בדיוק כאן.</div>
      </div>
      <div class="log-empty-when">מיד אחרי הבחירה יופיעו כאן גם השיא שלכם, האימון האחרון וההיסטוריה בתרגיל.</div>
    </div>` : `

    <h2 class="sr-only">רישום סט</h2>
    <div class="rx-toggle" role="radiogroup" aria-label="סוג רישום">
      <button class="rx-btn ${!isDuration ? "active-type" : ""}" data-action="set-log-entry-type" data-type="reps" role="radio" aria-checked="${!isDuration}">משקל וחזרות</button>
      <button class="rx-btn ${isDuration ? "active-type" : ""}" data-action="set-log-entry-type" data-type="duration" role="radio" aria-checked="${isDuration}"><span style="display:inline-flex; width:16px; height:16px; vertical-align:-3px; margin-left:4px;">${ICONS.stopwatchIcon}</span>החזקה בזמן</button>
    </div>

    <div class="flex items-center gap-8" style="margin-bottom:12px;">
      <input type="date" id="logDateInput" value="${esc(logDate)}" max="${todayISO()}" aria-label="תאריך רישום הסט" style="flex:1; min-width:0; background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:12px 14px; color:var(--chalk); font-size:14px; font-weight:700; font-family:inherit;" />
      ${logDate !== todayISO() ? `<button data-action="reset-log-date" class="reset-date-btn">היום</button>` : ""}
    </div>

    ${(est || bestHold || last) ? `
    <div class="stat-row">
      ${est ? `<div class="stat-card stat-hero"><div class="stat-label">1RM משוער</div><div class="stat-value mono" style="color:var(--brass);">${est} ק״ג</div></div>` : ""}
      ${bestHold ? `<div class="stat-card stat-hero"><div class="stat-label">שיא החזקה</div><div class="stat-value mono" style="color:var(--brass);">${formatDuration(bestHold)}</div></div>` : ""}
      ${last ? `<button data-action="prefill-last" class="stat-card stat-hero" style="text-align:right;" aria-label="מילוי הנתונים מהאימון האחרון — ${isDuration ? formatDuration(last.durationSeconds) : `${last.weight} על ${last.reps}`}">
        <div class="flex items-center justify-between gap-6">
          <span class="stat-label">אימון אחרון</span>
          <span style="color:var(--steel);">${ICONS.repeat}</span>
        </div>
        <div class="stat-value mono">${isDuration ? formatDuration(last.durationSeconds) : `${last.weight}×${last.reps}`}</div>
      </button>` : ""}
    </div>` : ""}

    ${est && !isDuration ? `${strengthPercentagesOn() ? renderStrengthPctChips(est) : renderPctTable(est)}` : ""}

    ${(() => {
      const recent = recentEntriesFor(selectedId);
      if (recent.length === 0) return "";
      return `
      <div style="margin-bottom:12px;">
        <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;">ב-14 הימים האחרונים</div>
        <div class="flex wrap gap-8">
          ${recent.map((e) => {
            // TAP TO PREFILL (2026-09-15). These chips existed already and were
            // read-only decoration: the member could SEE that they squatted
            // 100x5 on Sunday and then had to dial 100 back in by hand, which
            // from the default is ~32 taps of a 2.5kg stepper.
            //
            // This is the one mechanic Hevy and Strong both build their whole
            // logging loop around - a "previous" column you tap to copy
            // forward - and the reason reviewers call those apps fast. Ours is
            // strictly better suited to it: we log AFTER training, so the
            // member is reconstructing a session they have already done, and
            // the most likely value for today is a value from a recent day.
            //
            // Duration entries are deliberately not tappable: they carry no
            // weight/reps/sets triple to copy, so a tap would silently do
            // nothing, which is worse than a chip that plainly isn't a button.
            const fillable = !isDuration && typeof e.weight === "number" && typeof e.reps === "number";
            const label = `${esc(fmtDate(e.date))}: <span style="color:var(--chalk);">${esc(entrySummary(e))}</span>`;
            if (!fillable) return `<span class="mono" style="background:var(--surface2); border-radius:10px; padding:6px 10px; font-size:12.5px; font-weight:700; color:var(--steel);">${label}</span>`;
            return `<button type="button" class="mono" data-action="prefill-from-recent" data-weight="${esc(String(e.weight))}" data-reps="${esc(String(e.reps))}" data-sets="${esc(String(e.sets || 1))}" aria-label="${esc(`מילוי מהיר — ${entrySummary(e)} מ־${fmtDate(e.date)}`)}" style="background:var(--surface2); border:1px solid var(--border); border-radius:10px; padding:6px 10px; font-size:12.5px; font-weight:700; color:var(--steel); min-height:44px; cursor:pointer;">${label}</button>`;
          }).join("")}
        </div>
      </div>`;
    })()}

    ${isDuration || !isBarbell ? "" : renderBarWeightRow()}

    <div class="bar-wrap" id="barWrap">
      <div class="pr-flash" id="prFlash" style="display:none;">${ICONS.flame}<span>שיא חדש!</span></div>
      ${isDuration || !isBarbell ? "" : `<div id="barbellVisual">${renderBarbell(weight)}</div>`}
    </div>

    <div class="steppers">
      ${renderStepper("weight", "משקל (ק\"ג)", weight, 2.5, isDuration || !isBarbell ? 0 : barWeight)}
      ${isDuration ? renderStepper("durationSeconds", "משך (שניות)", durationSeconds, 5, 1) : renderStepper("reps", "חזרות", reps, 1, 1)}
      ${renderStepper("sets", "סטים", sets, 1, 1)}
    </div>

    ${isDuration
      ? `<div class="est-line">‹ משך ההחזקה: <b id="durationLineValue">${formatDuration(durationSeconds)}</b></div>`
      : `<div class="est-line">‹ הסט הזה מעריך 1RM של <b id="estLineValue">${estimate1RM(weight, reps)} ק״ג</b></div>`}

    ${(() => {
      const rounds = ladderMode ? currentLadderRounds() : [];
      const nextNum = rounds.length + 1;
      const isSuperset = !!ladderPartnerId;
      const modeLabel = isSuperset ? "סופרסט" : "סולם";
      const partner = ladderPartnerId ? movementById(ladderPartnerId) : null;
      // Most single-set sessions never touch ladder/superset, so it no
      // longer competes at full CTA weight with the actual set entry above
      // it - a plain link-sized entry point until it's actually active,
      // where the full control (live round count, block label, panel)
      // still gets the same weight it always did.
      if (!ladderMode) {
        return `<button data-action="toggle-ladder-mode" class="link-btn link-btn--tap" aria-pressed="false" style="display:block; margin-bottom:12px; font-size:12.5px;">${ICONS.ladder} רישום סולם / סופרסט</button>`;
      }
      return `
      <button data-action="toggle-ladder-mode" class="movement-btn active" aria-pressed="true" style="margin-bottom:0;">
        <div class="flex items-center gap-8">
          <span style="display:inline-flex; color:var(--brass); flex-shrink:0;">${ICONS.ladder}</span>
          <div style="text-align:right;">
            <div aria-live="polite" style="font-weight:700; font-size:14px; color:var(--brass);">${rounds.length ? `${modeLabel} פעיל — ${rounds.length === 1 ? "סט אחד נרשם" : `${rounds.length} סטים נרשמו`} · הבא: ${nextNum}` : `${modeLabel} פעיל — קבעו את הסט הראשון למטה`}</div>
          </div>
        </div>
        <span style="color:var(--brass); font-size:12px; font-weight:700; flex-shrink:0;">סיום</span>
      </button>
      <div style="border:1px solid var(--brass); border-top:none; border-radius:0 0 12px 12px; padding:10px 12px; margin-bottom:12px; margin-top:-1px;">
        <div class="flex items-center gap-8" style="margin-bottom:10px;" role="radiogroup" aria-label="תווית בלוק (לא חובה)">
          <span style="color:var(--steel); font-size:11px; font-weight:700;">בלוק:</span>
          ${["A", "B", "C", "D"].map((l) => `<button class="format-chip ${ladderBlockLabel === l ? "active" : ""}" style="flex:0 0 auto; padding:5px 12px; font-size:12px;" data-action="set-ladder-block-label" data-label="${l}" role="radio" aria-checked="${ladderBlockLabel === l}">${l}</button>`).join("")}
          ${ladderBlockLabel ? `<button class="format-chip" style="flex:0 0 auto; padding:5px 12px; font-size:12px;" data-action="set-ladder-block-label" data-label="">ללא</button>` : ""}
        </div>
        ${partner ? (() => {
          const primary = movementById(ladderPrimaryId);
          return `
        <div class="flex items-center gap-8" style="margin-bottom:10px;" role="radiogroup" aria-label="תרגיל נוכחי בסופרסט">
          <button class="format-chip ${selectedId === ladderPrimaryId ? "active" : ""}" style="padding:8px 10px; font-size:12.5px;" data-action="ladder-switch-exercise" data-id="${esc(ladderPrimaryId)}" role="radio" aria-checked="${selectedId === ladderPrimaryId}">${bidiText(primary ? primary.name : "?")}</button>
          <button class="format-chip ${selectedId === ladderPartnerId ? "active" : ""}" style="padding:8px 10px; font-size:12.5px;" data-action="ladder-switch-exercise" data-id="${esc(ladderPartnerId)}" role="radio" aria-checked="${selectedId === ladderPartnerId}">${bidiText(partner.name)}</button>
        </div>`;
        })() : `
        <button data-action="open-picker" data-target="partner" class="link-btn link-btn--tap" style="display:block; margin-bottom:10px; font-size:12.5px;">${ICONS.repeat} הוספת תרגיל שני (סופרסט)</button>`}
        ${rounds.length ? `<div class="flex wrap gap-8">
          ${rounds.map((r, i) => `
            <span class="flex items-center gap-6 mono" style="background:var(--surface2); border-radius:10px; padding:6px 10px; font-size:13px; font-weight:700;">
              ${i + 1}. ${esc(ladderRoundSummary(r, isSuperset))}
              <button data-action="delete-entry" data-id="${esc(r.id)}" aria-label="מחיקת סט ${i + 1} מה${modeLabel}" style="color:var(--steel); padding:0; display:inline-flex;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </span>`).join("")}
        </div>` : `<div style="color:var(--steel); font-size:12px;">אפשר לשנות משקל וחזרות לכל סט בנפרד — לחצו על כפתור השמירה בכל פעם שסט מוכן</div>`}
      </div>`;
    })()}
    `}



      </div>
    </section>
  `;
}

function renderStepper(field, label, value, step, min, action) {
  action = action || "step";
  // Every attribute below is escaped: `field` can be a user-authored movement
  // name coming from the WOD builder, and `value` can come off disk.
  const f = esc(field), a = esc(action), st = esc(step), mn = esc(min), v = esc(value);
  return `
    <div class="stepper">
      <span class="stepper-label">${esc(label)}</span>
      <div class="stepper-box">
        <button class="stepper-btn" data-action="${a}" data-field="${f}" data-dir="-1" data-step="${st}" data-min="${mn}" aria-label="הפחתה — ${esc(label)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <input class="stepper-val mono" type="text" inputmode="decimal" data-action="${a}" data-field="${f}" data-min="${mn}" value="${v}" aria-label="${esc(label)}" />
        <button class="stepper-btn" data-action="${a}" data-field="${f}" data-dir="1" data-step="${st}" data-min="${mn}" aria-label="הוספה — ${esc(label)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </div>`;
}

// A progress chart plots progress over TIME (day to day), not every set —
// several sets logged in one session are reps of the same workout, not
// separate data points, and plotting one per set put multiple points on
// the exact same date (reported directly, screenshots showing "10.09"
// three times on one chart). Standard practice in every fitness tracker
// that does this well (Strong, Hevy, ...): one point per day, the best
// set of that day. Collapses `entries` to at most one per distinct date,
// keeping whichever entry scores highest under `valueOf` — the trend/PR
// math downstream already only cares about one number per day, so this
// is the one place that needs to change, not renderChart or the RM table
// (bestEst1RM/repRecordFor already take a global max across all sets
// regardless of day, which was never the part that was wrong).
function bestPerDay(entries, valueOf) {
  const byDate = new Map();
  for (const e of entries) {
    const current = byDate.get(e.date);
    if (!current || valueOf(e) > valueOf(current)) byDate.set(e.date, e);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function renderDetailCard(m) {
  const hEntries = entriesFor(m.id);
  if (hEntries.length === 0) return "";
  // The most recently logged entry decides which mode this card renders in —
  // a movement almost never switches between holds and reps, and this keeps
  // the chart/PR-table meaningful instead of averaging two unrelated units.
  const isDuration = hEntries[0].type === "duration";
  if (isDuration) return renderDurationDetailCard(m, hEntries.filter((e) => e.type === "duration"));
  let max = -Infinity;
  const chartData = bestPerDay(hEntries.filter((e) => e.type !== "duration"), (e) => e.est1RM).map((e) => {
    const isPR = e.est1RM >= max;
    if (e.est1RM > max) max = e.est1RM;
    return { dateLabel: fmtDate(e.date), est1RM: e.est1RM, isPR };
  });
  const prPoints = chartData.filter((d) => d.isPR);
  const trend = prPoints.length >= 2 ? +(prPoints[prPoints.length - 1].est1RM - prPoints[prPoints.length - 2].est1RM).toFixed(1) : null;
  // Spelled out under the rep table rather than left to be inferred from the
  // "1RM" cell, which reads "—" for anyone who has never logged a single:
  // the headline record above and this row now say two different things
  // because they ARE two different things, and both say which is which.
  const est1rm = bestEst1RM(m.id);
  return `
    <div class="chart-card" style="margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-top:none;">
      <div class="flex items-center justify-between" style="margin-bottom:12px;">
        <span style="font-weight:800; font-size:15px;">${bidiText(m.name)}</span>
        <div class="flex items-center gap-8">
          ${trend !== null ? `<span class="flex items-center gap-6" style="font-weight:700; font-size:12px;">${trend > 0 ? ICONS.up : trend < 0 ? ICONS.down : ICONS.flat}<span class="mono">${bidiUnit(`${trend > 0 ? "+" : ""}${trend} ק״ג`)}</span> 1RM משוער</span>` : ""}
        </div>
      </div>
      ${renderChart(chartData)}
      <div class="rep-table">
        ${STANDARD_REPS.map((r) => {
          const rec = repRecordFor(m.id, r);
          return `<div class="rep-cell"><div class="rep-cell-label">${r}RM</div><div class="rep-cell-val mono" style="color:${rec ? "var(--chalk)" : "var(--border)"};">${rec ?? "—"}</div></div>`;
        }).join("")}
      </div>
      ${est1rm ? `<div class="footer-note" style="margin-top:10px; text-align:center;">1RM משוער: <span class="mono">${bidiUnit(`${est1rm} ק״ג`)}</span> — חישוב מהסט הטוב ביותר, לא הרמה שבוצעה</div>` : ""}
    </div>`;
}

// Duration-mode counterpart to the block above — same chart, but plotting
// hold time instead of est1RM, and a single best-hold stat instead of the
// STANDARD_REPS grid (a rep-record table means nothing for a timed hold).
function renderDurationDetailCard(m, durationEntries) {
  let max = -Infinity;
  const chartData = bestPerDay(durationEntries, (e) => e.durationSeconds).map((e) => {
    const isPR = e.durationSeconds >= max;
    if (e.durationSeconds > max) max = e.durationSeconds;
    return { dateLabel: fmtDate(e.date), est1RM: e.durationSeconds, isPR };
  });
  const prPoints = chartData.filter((d) => d.isPR);
  const trendSec = prPoints.length >= 2 ? prPoints[prPoints.length - 1].est1RM - prPoints[prPoints.length - 2].est1RM : null;
  const best = bestDurationFor(m.id);
  return `
    <div class="chart-card" style="margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-top:none;">
      <div class="flex items-center justify-between" style="margin-bottom:12px;">
        <span style="font-weight:800; font-size:15px;">${bidiText(m.name)}</span>
        <div class="flex items-center gap-8">
          ${trendSec !== null ? `<span class="flex items-center gap-6" style="font-weight:700; font-size:12px;">${trendSec > 0 ? ICONS.up : trendSec < 0 ? ICONS.down : ICONS.flat}<span class="mono">${trendSec > 0 ? "+" : ""}${formatDuration(Math.abs(trendSec))}</span> שיא החזקה</span>` : ""}
        </div>
      </div>
      ${renderChart(chartData)}
      ${best ? `<div class="rep-table"><div class="rep-cell"><div class="rep-cell-label">שיא החזקה</div><div class="rep-cell-val mono" style="color:var(--chalk);">${formatDuration(best)}</div></div></div>` : ""}
    </div>`;
}

function renderHistoryListArea() {
  const area = document.getElementById("historyListArea");
  if (!area) return;
  const q = historySearch.trim().toLowerCase();
  const active = activeExercises().filter((m) => m.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (activeExercises().length === 0) {
    area.innerHTML = `<div class="flex col items-center" style="padding:40px 0; gap:8px;">${ICONS.dumbbell}<span style="color:var(--steel); font-size:13px;">רשמו סט כדי להתחיל לראות התקדמות</span></div>`;
    return;
  }
  if (active.length === 0) {
    const noneHtml = `<div style="color:var(--steel); text-align:center; padding:20px 0; font-size:13px;">לא נמצא תרגיל התואם ל-"${bidiText(historySearch)}"</div>
      <button class="link-btn link-btn--tap" data-action="clear-history-search" style="display:block; margin:0 auto;">ניקוי החיפוש</button>`;
    area.innerHTML = noneHtml;
    return;
  }
  // No exercise auto-expands - reported directly: the first exercise's
  // full chart used to render open before any tap, which also meant it
  // was the FIRST thing on the page even when the member wanted a
  // completely different exercise's history. Every row starts collapsed;
  // only the one actually tapped (historyId === m.id, same as every
  // other row below) ever shows renderDetailCard's chart/RM table.
  // Built once for the whole list, not three times per row - see
  // entriesByExercise()'s own comment for the arithmetic.
  const byExercise = entriesByExercise();
  area.innerHTML = active.map((m) => {
    const row = `
      <button class="exercise-row ${historyId === m.id ? "active" : ""}" data-action="select-history" data-id="${esc(m.id)}" style="${historyId === m.id ? "margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;" : ""}">
        <div class="flex items-center gap-8">
          <span style="display:inline-flex; transition:transform .2s; transform:rotate(${historyId === m.id ? "90deg" : "180deg"});">${ICONS.chevron}</span>
          <div class="dot" style="background:${esc(catColor(m.category))}"></div>
          <span style="font-weight:700; font-size:14px;">${bidiText(m.name)}</span>
        </div>
        ${(() => {
          // The record is the heaviest set actually lifted; the estimate is
          // a second, smaller, explicitly labelled line under it. Before
          // this the estimate WAS the headline, unlabelled, which is how
          // "Back Squat — 70 kg" ended up sitting directly above an
          // expanded panel reading 1RM — / 5RM 60 for someone whose
          // heaviest real set was 60×5.
          const bestSet = bestLiftedSetFor(m.id, undefined, byExercise);
          const est = bestEst1RM(m.id, undefined, byExercise);
          const hold = bestDurationFor(m.id, undefined, byExercise);
          const headline = bestSet ? formatLiftedSet(bestSet) : hold ? formatDuration(hold) : "—";
          return `<span style="text-align:left;">
          <span class="mono" style="display:block; color:var(--brass); font-weight:700; font-size:14px;">${bidiUnit(headline)}</span>
          ${bestSet && est ? `<span class="mono" style="display:block; color:var(--steel); font-weight:600; font-size:11px;">${bidiUnit(`1RM משוער ${est} ק״ג`)}</span>` : ""}
        </span>`;
        })()}
      </button>`;
    const detail = historyId === m.id ? renderDetailCard(m) + `<div style="height:8px;"></div>` : "";
    return row + detail;
  }).join("");
}

// ---------- Calendar tab ----------
const MONTH_NAMES = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const REPORT_CATEGORIES = ["Squat","Deadlift","Press","Olympic","Pull","Other"];

function isoDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Whether any strength set or WOD attempt was logged on a given date —
// shared by the calendar's day dots and the header streak indicator so the
// two never define "counts as a trained day" differently.
function hasAnyEntryOn(iso, index) {
  if (index) return index.ent.has(iso) || index.wod.has(iso);
  return entries.some((e) => e.date === iso) || wodEntries.some((e) => e.date === iso);
}
// THE CALENDAR ASKED THE SAME QUESTION THIRTY-ONE TIMES.
//
// renderCalendarGrid() ran entries.filter(), wodEntries.filter() AND
// hasAnyEntryOn() - itself two more scans - once per day cell. Drawing one
// month was therefore ~124 full passes over both arrays, and it redraws on
// every month change and every day tap. computeCurrentStreak() was worse in
// a quieter way: it walks backward a day at a time calling hasAnyEntryOn(),
// so a 100-day streak cost 200 scans to display one number in the header.
//
// Same rule as entriesByExercise(): built per render, never cached, so there
// is no invalidation to get wrong. A Map lookup replaces a scan, and the one
// pass that builds it is cheaper than the two the old code did for a SINGLE
// day.
function buildDayIndex() {
  const ent = new Map();
  const wod = new Map();
  for (const e of entries) {
    let list = ent.get(e.date);
    if (!list) ent.set(e.date, (list = []));
    list.push(e);
  }
  for (const e of wodEntries) {
    let list = wod.get(e.date);
    if (!list) wod.set(e.date, (list = []));
    list.push(e);
  }
  return { ent, wod };
}
// Consecutive days, counting backward from today, with at least one logged
// entry. Today not being logged yet doesn't break the streak — it's just
// not counted until it is; the first fully-empty day (including today, if
// yesterday also has nothing) resets it to 0.
function computeCurrentStreak() {
  let streak = 0;
  // One index for the whole walk, instead of two array scans per day.
  const index = buildDayIndex();
  const d = new Date(todayISO() + "T00:00:00");
  if (!hasAnyEntryOn(localISODate(d), index)) d.setDate(d.getDate() - 1);
  while (hasAnyEntryOn(localISODate(d), index)) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
function updateStreakLabel() {
  const el = document.getElementById("streakLabel");
  if (!el) return;
  const streak = computeCurrentStreak();
  if (streak <= 0) { el.style.display = "none"; return; }
  el.innerHTML = `${ICONS.flame}<span>${streak}</span>`;
  el.style.display = "flex";
  el.setAttribute("aria-label", `${streak} ${streak === 1 ? "יום" : "ימים"} ברצף`);
}
// COMM-341. Training days / total sets / PR days for the month currently
// shown - a real feature (a monthly summary), not just decoration, so it
// lives next to renderCalendarGrid() and is recomputed on every month nav
// the grid itself already handles. "Total sets" counts strength entries
// only (one row in `entries` is one logged set); a WOD session is a
// different unit of work and isn't folded into that count. "PR days"
// counts a day once even if it carried multiple PRs.
function computeCalendarMonthStats(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const monthEntries = entries.filter((e) => e.date.startsWith(prefix));
  const monthWods = wodEntries.filter((e) => e.date.startsWith(prefix));
  const trainingDays = new Set([...monthEntries, ...monthWods].map((e) => e.date)).size;
  // Live bug hunt (2026-09-11): gate the strength half through
  // isFlameworthyEntry() - see its own comment. wodEntries.isPR is untouched
  // here, out of this bug's scope.
  const celebratableIds = celebratablePrEntryIds();
  const prDays = new Set([
    ...monthEntries.filter((e) => isFlameworthyEntry(e, celebratableIds)),
    ...monthWods.filter((e) => e.isPR),
  ].map((e) => e.date)).size;
  return { trainingDays, totalSets: monthEntries.length, prDays };
}
function renderCalendarGrid() {
  const grid = document.getElementById("calGrid");
  const label = document.getElementById("calMonthLabel");
  if (!grid || !label) return;
  label.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstWeekday = new Date(calYear, calMonth, 1).getDay();
  const today = todayISO();
  // Live bug hunt (2026-09-11): see isFlameworthyEntry()'s comment - computed
  // once per grid render, not per day, since celebratablePrEntryIds() walks
  // every entry on file.
  const celebratableIds = celebratablePrEntryIds();
  // Same reasoning as celebratableIds directly above: once per grid, not
  // once per day. See buildDayIndex().
  const dayIndex = buildDayIndex();
  let cells = "";
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoDate(calYear, calMonth, d);
    const dayEntries = dayIndex.ent.get(iso) || [];
    const dayWods = dayIndex.wod.get(iso) || [];
    const hasData = hasAnyEntryOn(iso, dayIndex);
    const hasPR = dayEntries.some((e) => isFlameworthyEntry(e, celebratableIds)) || dayWods.some((e) => e.isPR);
    const cls = ["cal-cell"];
    if (iso === today) cls.push("today");
    if (iso === calSelectedDate) cls.push("selected");
    const dayAria = `${d}${hasData ? (hasPR ? " — שיא אישי" : " — יש נתונים") : ""}`;
    cells += `<button class="${cls.join(" ")}" data-action="cal-select-day" data-date="${esc(iso)}" aria-label="${esc(dayAria)}" aria-pressed="${iso === calSelectedDate}" ${iso === today ? 'aria-current="date"' : ""}>
      <span class="cal-daynum" aria-hidden="true">${d}</span>
      ${hasData ? `<div class="cal-dot ${hasPR ? "pr" : ""}" aria-hidden="true"></div>` : ""}
    </button>`;
  }
  grid.innerHTML = cells;
  const statsEl = document.getElementById("calMonthStats");
  if (statsEl) {
    const stats = computeCalendarMonthStats(calYear, calMonth);
    statsEl.innerHTML = `
      <div class="cal-month-stat"><div class="cal-month-stat-value">${stats.trainingDays}</div><div class="cal-month-stat-label">ימי אימון</div></div>
      <div class="cal-month-stat"><div class="cal-month-stat-value">${stats.totalSets}</div><div class="cal-month-stat-label">סטים</div></div>
      <div class="cal-month-stat"><div class="cal-month-stat-value">${stats.prDays}</div><div class="cal-month-stat-label">ימי שיא</div></div>
    `;
  }
  renderCalDetail();
}

// Partitions same-day entries into ladder groups (rows sharing a groupId)
// and singletons (an ordinary set, or a ladder row from an older backup
// with no groupId). Groups keep the incoming (most-recent-first) order;
// rounds within a group are oldest-first, i.e. the order they were logged.
function groupDayEntries(list) {
  const seen = new Set();
  const groups = [];
  for (const e of list) {
    const key = e.groupId || e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(e.groupId
      ? list.filter((x) => x.groupId === e.groupId).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0))
      : [e]);
  }
  return groups;
}
// One free-text note per calendar date (how the whole session felt) —
// distinct from the per-WOD-entry scaling notes on wodEntries records.
// Keyed straight into the existing settings key-value store, same as every
// other small per-device flag; a note per day for years of use is trivial
// volume for it.
let calNoteDate = null; // which date calNoteText currently reflects
let calNoteText = "";
let calNoteLoading = false;
async function loadSessionNoteFor(date) {
  if (calNoteDate === date || calNoteLoading) return;
  calNoteLoading = true;
  try {
    const v = await dbGetSetting(`sessionNote:${date}`);
    calNoteText = typeof v === "string" ? v : "";
  } catch (e) { calNoteText = ""; }
  calNoteDate = date;
  calNoteLoading = false;
  if (tab === "calendar" && calSelectedDate === date) renderCalDetail();
}
async function saveSessionNote(date, text) {
  // Live bug hunt (2026-09-11): this field is a genuinely multi-line
  // textarea (rows="3", "הרגשה, אנרגיה, מה עבד ומה פחות..."), but cleanStr()
  // deletes \n/\r outright - confirmed live, a 3-line reflection was saved
  // with its line breaks silently stripped and the sentences fused together
  // word-to-word, with no warning shown. cleanMultilineStr() is the same
  // cleaner minus that one behavior, for fields where a line break is real
  // content, not something to discard.
  const cleaned = cleanMultilineStr(text, LIMITS.notesLen);
  calNoteText = cleaned;
  calNoteDate = date;
  try {
    await dbSetSetting(`sessionNote:${date}`, cleaned);
    setImportMessage("ההערה נשמרה");
  } catch (e) { noteStorageError(e); }
  render();
}
// Factored out of renderCalDetail (Direction 06) so the Add tab can show
// TODAY's actual logged sets - numbered, per-set edit/delete - the way the
// approved mockup's "סיכום האימון" card does, instead of a one-line "אחרון:
// X, Y סטים נרשמו" summary that made a member tap out to the calendar just
// to see what they had already done. Single implementation: the calendar's
// own day-detail and the log screen's today's-sets card must never drift
// into two different renderings of the identical underlying data.
function renderDayEntriesListHtml(dayEntries, dayWods) {
  if (dayEntries.length === 0 && dayWods.length === 0) return `<div class="empty">לא נרשם דבר ביום הזה.</div>`;
  // Live bug hunt (2026-09-11): see isFlameworthyEntry()'s comment.
  const celebratableIds = celebratablePrEntryIds();
  return `
    <div class="log-list">
      ${groupDayEntries(dayEntries).map((group) => {
        if (group.length === 1) {
          const e = group[0];
          return `
        <div class="log-row">
          <div class="flex items-center gap-8">
            ${isFlameworthyEntry(e, celebratableIds) ? ICONS.flame : ""}
            <span style="font-weight:700; font-size:14px;">${bidiText(movementById(e.exerciseId) ? movementById(e.exerciseId).name : "?")}</span>
          </div>
          <div class="flex items-center gap-10">
            <span class="mono" style="color:var(--steel); font-size:13px;">${esc(entrySummary(e))}</span>
            <button data-action="edit-entry" data-id="${esc(e.id)}" aria-label="עריכת סט" class="icon-btn-sm">${ICONS.edit}</button>
            <button data-action="delete-entry" data-id="${esc(e.id)}" aria-label="מחיקת סט" class="icon-btn-sm">${ICONS.trash}</button>
          </div>
        </div>`;
        }
        // Ladder or superset: one card, exercise name(s) + PR flame shown
        // once, then every round on its own line with its own edit/delete —
        // each rung stays individually correctable, per the point of this
        // whole feature. A superset is just a ladder whose rounds span two
        // exerciseIds instead of one — derived from the group's own data,
        // not from any currently-active session state.
        const anyPR = group.some((e) => isFlameworthyEntry(e, celebratableIds));
        const exerciseIds = [...new Set(group.map((e) => e.exerciseId))];
        const isSuperset = exerciseIds.length > 1;
        const name = bidiText(exerciseIds.map((id) => movementById(id) ? movementById(id).name : "?").join(" + "));
        const blockTag = group[0].blockLabel ? ` · בלוק ${esc(group[0].blockLabel)}` : "";
        return `
        <div class="log-row" style="flex-direction:column; align-items:stretch; gap:8px;">
          <div class="flex items-center gap-8">
            ${anyPR ? ICONS.flame : ""}
            <span style="font-weight:700; font-size:14px;">${name}</span>
            <span style="color:var(--steel); font-size:11px;">${isSuperset ? "סופרסט" : "סולם"} · ${group.length} סטים${blockTag}</span>
          </div>
          <div class="flex col gap-6">
            ${group.map((e, i) => `
            <div class="flex items-center justify-between">
              <span class="mono flex items-center gap-6" style="color:var(--steel); font-size:13px;">${bidiUnit(`${i + 1}. ${ladderRoundSummary(e, isSuperset)}`)}${isFlameworthyEntry(e, celebratableIds) ? ICONS.flame : ""}</span>
              <div class="flex items-center gap-6">
                <button data-action="edit-entry" data-id="${esc(e.id)}" aria-label="עריכת סט ${i + 1}" class="icon-btn-sm">${ICONS.edit}</button>
                <button data-action="delete-entry" data-id="${esc(e.id)}" aria-label="מחיקת סט ${i + 1}" class="icon-btn-sm">${ICONS.trash}</button>
              </div>
            </div>`).join("")}
          </div>
        </div>`;
      }).join("")}
      ${dayWods.map((e) => {
        const w = wodById(e.wodId);
        return `
        <div class="log-row" style="${e.notes ? "flex-direction:column; align-items:stretch; gap:4px;" : ""}">
          <div class="flex items-center justify-between" style="width:100%;">
            <div class="flex items-center gap-8">
              ${e.isPR ? ICONS.flame : ""}
              <span style="font-weight:700; font-size:14px;">${bidiText(w ? w.name : "?")}</span>
              <span style="color:var(--steel); font-size:11px;">${wodEffortLabel(e.rx)}${e.partnerTag ? ` · ${bidiText(e.partnerTag)}` : ""}</span>
            </div>
            <div class="flex items-center gap-10">
              <span class="mono" style="color:var(--steel); font-size:13px;">${bidiUnit(formatWodEntry(e))}</span>
              <button data-action="edit-wod-entry" data-id="${esc(e.id)}" aria-label="עריכת אימון" class="icon-btn-sm">${ICONS.edit}</button>
              <button data-action="delete-wod-entry" data-id="${esc(e.id)}" aria-label="מחיקת אימון" class="icon-btn-sm">${ICONS.trash}</button>
            </div>
          </div>
          ${e.notes ? `<div style="color:var(--steel); font-size:12px; padding-inline-start:23px;">${bidiText(e.notes)}</div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

function renderCalDetail() {
  const el = document.getElementById("calDetail");
  if (!el) return;
  if (calNoteDate !== calSelectedDate) loadSessionNoteFor(calSelectedDate);
  const dayEntries = entries.filter((e) => e.date === calSelectedDate).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const dayWods = wodEntries.filter((e) => e.date === calSelectedDate).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const d = new Date(calSelectedDate + "T00:00:00");
  const label = d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  el.innerHTML = `
    <h2 class="section-label" style="margin-top:4px;">${label.toUpperCase()}</h2>
    <div class="chart-card">
    ${renderDayEntriesListHtml(dayEntries, dayWods)}
    ${calSelectedDate > todayISO() ? "" : `<button class="link-btn link-btn--tap" data-action="cal-log-day" data-date="${esc(calSelectedDate)}" style="display:block; margin-top:8px;">+ הוספת רישום לתאריך הזה</button>`}

    <h3 class="section-label" style="margin-top:16px;">איך היה האימון היום</h3>
    <textarea id="sessionNoteInput" class="text-input" dir="auto" maxlength="${LIMITS.notesLen}" rows="3" placeholder="הרגשה, אנרגיה, מה עבד ומה פחות..." aria-label="איך היה האימון היום" style="resize:vertical; min-height:64px; font-family:inherit; margin-bottom:8px;">${esc(calNoteDate === calSelectedDate ? calNoteText : "")}</textarea>
    <button data-action="save-session-note" data-date="${esc(calSelectedDate)}" class="link-btn link-btn--tap" style="display:block;">שמירת הערה</button>
    </div>
  `;
}

function daysAgoLabel(iso) {
  // UX review, finding 2, wording half. This returned "מעולם לא" ("never"),
  // which is the same false-by-construction assertion 202609060020 took out
  // of the coach lists and admin.js took out of the roster: an absence of
  // rows in the log is a fact about the log, not a verdict on the member,
  // and on this screen it is read by someone who may well have trained the
  // category for years before installing the app. "טרם נרשם" ("not recorded
  // yet") says what is actually true, and it is a statement about the
  // record. The colour half of the finding is in renderVolumeReport().
  if (!iso) return "טרם נרשם";
  const diff = daysSinceISODate(iso);
  if (diff === 0) return "היום";
  if (diff === 1) return "לפני יום";
  return `לפני ${diff} ימים`;
}

// A category is OVERDUE, not merely un-recent, after this many days. See the
// colour block inside renderVolumeReport() for why it is 30 and not 14, and
// why the states between a week and a month are deliberately neutral.
const VOLUME_OVERDUE_DAYS = 30;
// "סטים 0/1" was the whole label. A slash between two bare numbers says
// nothing about what either one counts, and it reads worst exactly where it
// matters: a row showing 0 this week and 1 this month looked like a score, a
// ratio, or a fraction of some target, and a member reported it as all three.
// The card's own subtitle already explains the two windows; the row now names
// them itself so it is legible without reading the subtitle first.
//
// Through bidiUnit() at the call site, not interpolated bare: this lands in a
// `.mono` span, which index.html declares `direction:ltr`, and a Hebrew word
// next to a number in an LTR box is the defect that whole helper exists for -
// "3 סטים ב-7 ימים · 11 ב-30 ימים" painted with the counts and their windows
// swapped. Measured, in Chromium, before and after.
function volumeCountsLabel(setsWeek, setsMonth) {
  // "1 סטים" is not Hebrew. The plural is only carried on the first half -
  // the second is a bare number under the same noun, the way the row reads
  // out loud ("one set in seven days, two in thirty").
  const week = setsWeek === 1 ? "סט אחד" : `${setsWeek} סטים`;
  return `${week} ב-7 ימים · ${setsMonth} ב-30 ימים`;
}
function renderVolumeReport() {
  const now = new Date();
  const cutoff7 = new Date(now); cutoff7.setDate(now.getDate() - 6);
  const cutoff7ISO = localISODate(cutoff7);
  const cutoff30 = new Date(now); cutoff30.setDate(now.getDate() - 29);
  const cutoff30ISO = localISODate(cutoff30);

  const cats = REPORT_CATEGORIES.concat(customMovements.length ? ["Custom"] : []);
  const rows = cats.map((cat) => {
    const catEntries = entries.filter((e) => { const m = movementById(e.exerciseId); return m && m.category === cat; });
    const setsWeek = catEntries.filter((e) => e.date >= cutoff7ISO).reduce((s, e) => s + e.sets, 0);
    const setsMonth = catEntries.filter((e) => e.date >= cutoff30ISO).reduce((s, e) => s + e.sets, 0);
    const lastDate = catEntries.length ? catEntries.map((e) => e.date).sort().slice(-1)[0] : null;
    const diff = daysSinceISODate(lastDate);
    // .10, not .15: this badge now also renders on a white scene-sheet
    // (Calendar used to be a fixed-navy sheet - see .scene-sheet's own
    // comment) where the red state measured 4.456:1 against --red-text,
    // just under AA, and the dark-theme green state measured 4.505:1 -
    // technically passing but with no real margin. .10 clears both with
    // headroom (4.78/4.81) and improves every other state too, checked
    // against both themes' real token values, not assumed.
    let flagColor = "var(--steel)", flagBg = "rgba(138,143,151,.10)", flagText = daysAgoLabel(lastDate);
    // UX REVIEW, FINDING 2. `diff === null` used to take this row's
    // var(--red-text) on rgba(216,69,60,.10) - byte-for-byte the `diff > 14`
    // styling below it - so a category the member has never logged and a
    // category they have let lapse for a month rendered as the same alarm.
    // Measured at 390x844 with a single set logged, five of the six rows
    // were red - on a screen the member had done nothing wrong on yet, and
    // on a brand-new install it is all six. That is the fastest way there
    // is to teach someone that red here means nothing.
    //
    // Never-logged now keeps the neutral default declared above, and red is
    // left to mean exactly one thing: trained, and overdue. The two neutral
    // rows are told apart by their words, not their colour - "טרם נרשם"
    // against "לפני 9 ימים" - because they are the same kind of fact: no
    // action is being asked for.
    //
    // The null branch is explicitly separated rather than deleted: `null <=
    // 7` coerces to 0 <= 7 and is TRUE, so falling through would paint every
    // never-logged category as trained-this-week green, which is worse than
    // the defect being fixed.
    //
    // THE THRESHOLD ITSELF, reported from a real phone after that fix: "in
    // the calendar category volume card, anything not trained for 14 days
    // turns red, so a weekly trainee sees mostly red". Both halves are true
    // and they compound. This box programmes strength in blocks, so a member
    // training four days a week touches each of the six categories on a
    // rotation - two weeks between Olympic days is an ordinary, healthy
    // fortnight, not a lapse - and one busy fortnight painted four of six
    // rows red at once. Red that fires on a normal training rotation stops
    // being read as a warning within about two visits, which costs exactly
    // the case it exists for.
    //
    // Red now means a full month untouched (VOLUME_OVERDUE_DAYS), which is
    // no longer a rotation at any sane cadence - it is a category that has
    // fallen out of the programme. Everything between a week and that is
    // "not recent", which is a FACT and not a fault, so it takes the same
    // neutral --steel the never-logged row above already takes: the two are
    // told apart by their words ("לפני 9 ימים" / "טרם נרשם"), which is the
    // rule this block settled on last time and is just being applied to one
    // more state.
    if (diff !== null) {
      if (diff <= 7) { flagColor = "var(--green-text)"; flagBg = "rgba(75,155,95,.10)"; }
      else if (diff > VOLUME_OVERDUE_DAYS) { flagColor = "var(--red-text)"; flagBg = "rgba(216,69,60,.10)"; }
    }
    return `
      <div class="report-row">
        <div class="flex items-center gap-8">
          <div class="dot" style="background:${esc(catColor(cat))}"></div>
          <span style="font-weight:700; font-size:14px;">${esc(catLabel(cat))}</span>
        </div>
        <div class="flex items-center gap-10">
          <span class="mono" style="color:var(--steel); font-size:12px;">${bidiUnit(volumeCountsLabel(setsWeek, setsMonth))}</span>
          <span class="report-flag" style="color:${flagColor}; background:${flagBg};">${flagText}</span>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="chart-card">
    <h2 class="section-label">נפח ותדירות לפי קטגוריה</h2>
    <div style="color:var(--steel); font-size:11px; margin-bottom:10px;">מספר הסטים ב-7 וב-30 הימים האחרונים, וזמן מאז האימון האחרון</div>
    ${rows}
    </div>
  `;
}

function renderCalendarTab() {
  const monthPrefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-`;
  const dates = [...new Set([...entries, ...wodEntries].filter(e => e.date.startsWith(monthPrefix)).map(e => e.date))].sort().reverse();
  const listHtml = calView === "list" ? `<div class="history-month-list">${dates.length ? dates.map(date => `<section aria-label="${esc(fmtDate(date))}"><h2 class="section-label">${esc(fmtDate(date))}</h2>${renderDayEntriesListHtml(entries.filter(e => e.date === date), wodEntries.filter(e => e.date === date))}</section>`).join("") : `<div class="empty">לא נרשמו אימונים בחודש הזה.</div>`}</div>` : "";
  return `
    <section class="scene-page ${PAGE_SCENES.calendar.className}" aria-labelledby="pageTitle-calendar">
      <div class="scene-page__media" aria-hidden="true"></div>
      <div class="scene-page__scrim" aria-hidden="true"></div>
      <div class="scene-page__intro">
        <div class="scene-page__brand">${esc(brandWordmark())}</div>
        <h1 id="pageTitle-calendar" class="scene-page__title">לוח שנה</h1>
      </div>
      <div class="scene-sheet">
    <div class="stripe-ribbon" aria-hidden="true"></div>
    <div class="cal-panel" data-calendar-view="${calView}">
      <div class="cal-header">
        <button class="cal-nav-btn" data-action="cal-prev" aria-label="חודש קודם">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--chalk)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <span class="cal-month-label" id="calMonthLabel"></span>
        <button class="cal-view-btn" data-action="cal-toggle-view" aria-pressed="${calView === "list"}" aria-label="${calView === "list" ? "הצגת לוח שנה" : "הצגת רשימת אימונים"}">${calView === "list" ? "לוח" : "רשימה"}</button>
        <button class="cal-nav-btn" data-action="cal-next" aria-label="חודש הבא">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--chalk)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="cal-weekdays">${["א","ב","ג","ד","ה","ו","ש"].map((d) => `<div class="cal-weekday">${d}</div>`).join("")}</div>
      <div class="cal-grid" id="calGrid"></div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot" aria-hidden="true"></span>יש נתונים</span>
        <span class="cal-legend-item"><span class="cal-dot pr" aria-hidden="true"></span>שיא אישי</span>
      </div>
    </div>
    ${listHtml}
    <div id="calDetail" role="region" aria-label="פירוט היום הנבחר" ${calView === "list" ? "hidden" : ""} style="margin-bottom:20px;"></div>
    <div class="cal-month-stats" id="calMonthStats"></div>
    ${renderVolumeReport()}
      </div>
    </section>
  `;
}
function renderBodyweightArea() {
  const el = document.getElementById("bodyweightArea");
  if (!el) return;
  const sorted = bodyweightEntries.slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  const last = bodyweightEntries.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  const chartData = sorted.map((e) => ({ dateLabel: fmtDate(e.date), est1RM: e.weight, isPR: false }));
  const header = `
    <h2 class="section-label">משקל גוף</h2>
    <button class="exercise-row ${bodyweightExpanded ? "active" : ""}" data-action="toggle-bodyweight" style="${bodyweightExpanded ? "margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;" : ""}">
      <div class="flex items-center gap-8">
        <span style="display:inline-flex; transition:transform .2s; transform:rotate(${bodyweightExpanded ? "90deg" : "180deg"});">${ICONS.chevron}</span>
        <span style="font-weight:700; font-size:14px;">משקל גוף</span>
      </div>
      ${last ? `<span class="mono" style="color:var(--brass); font-weight:700; font-size:14px;">${bidiUnit(`${last.weight} ק״ג`)}</span>` : `<span style="color:var(--steel); font-size:12px;">אין עדיין מדידות</span>`}
    </button>`;
  const detail = bodyweightExpanded ? `
    <div class="chart-card" style="margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-top:none;">
      ${last ? `<div style="color:var(--steel); font-size:12px; margin-bottom:${chartData.length ? "12px" : "0"};">עודכן לאחרונה: ${fmtDate(last.date)}</div>` : ""}
      ${chartData.length ? renderChart(chartData) : ""}
      <div class="steppers" style="margin-top:14px; margin-bottom:0;">
        ${renderStepper("bwWeight", "משקל (ק\"ג)", bwWeight, 0.5, 0, "bw-step")}
      </div>
      <button data-action="save-bw" class="save-btn" style="max-width:none; margin-top:14px;"${bwWeight > 0 ? "" : " disabled"}>רישום משקל גוף — היום</button>
    </div>
    <div style="height:8px;"></div>` : "";
  el.innerHTML = header + detail;
}

function renderMeasureArea() {
  const el = document.getElementById("measureArea");
  if (!el) return;
  const types = measureTypesSorted();

  // Adding a new measurement TYPE is rare (roughly once per type, ever);
  // logging today's value into a type you already track is what happens
  // every visit. The add control used to render first with CTA styling,
  // outranking the actual measurements below it - now it's a plain row
  // after the real data, same weight as everything else on screen.
  const addRow = measureAddOpen
    ? `<div style="border:1px solid var(--brass); border-radius:12px; padding:10px 12px; margin-top:${types.length ? "8px" : "0"};">
         <input id="measureTypeInput" class="text-input" dir="auto" maxlength="80" autocomplete="off" placeholder="לדוגמה: היקף מותן" aria-label="שם מדד חדש" style="margin-bottom:8px;" />
         <div class="flex gap-8">
           <button data-action="confirm-add-measure-type" class="save-btn" style="max-width:none; flex:1;">הוספה</button>
           <button data-action="cancel-add-measure-type" style="color:var(--steel); font-size:13px; padding:0 10px;">ביטול</button>
         </div>
       </div>`
    : `<button class="link-btn" data-action="open-add-measure-type" style="margin-top:${types.length ? "8px" : "0"};">+ הוספת מדד חדש</button>`;

  const rows = types.map((t) => {
    const expanded = measureExpandedId === t.id;
    const last = latestMeasurement(t.id);
    const header = `
      <button class="exercise-row ${expanded ? "active" : ""}" data-action="toggle-measure-type" data-id="${esc(t.id)}" style="${expanded ? "margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;" : ""}">
        <div class="flex items-center gap-8">
          <span style="display:inline-flex; transition:transform .2s; transform:rotate(${expanded ? "90deg" : "180deg"});">${ICONS.chevron}</span>
          <span style="font-weight:700; font-size:14px;">${bidiText(t.name)}</span>
        </div>
        ${last ? `<span class="mono" style="color:var(--brass); font-weight:700; font-size:14px;">${bidiUnit(`${last.value} ס״מ`)}</span>` : `<span style="color:var(--steel); font-size:12px;">אין עדיין מדידות</span>`}
      </button>`;
    if (!expanded) return header;

    if (typeof measureValues[t.id] !== "number") measureValues[t.id] = last ? last.value : 0;
    const sorted = measureEntriesFor(t.id).slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const chartData = sorted.map((e) => ({ dateLabel: fmtDate(e.date), est1RM: e.value, isPR: false }));
    const recent = measureEntriesFor(t.id).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
    const detail = `
      <div class="chart-card" style="margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-top:none;">
        <div class="flex items-center justify-between" style="margin-bottom:${chartData.length ? "12px" : "0"};">
          ${last ? `<span style="color:var(--steel); font-size:12px;">עודכן לאחרונה: ${fmtDate(last.date)}</span>` : `<span style="color:var(--steel); font-size:12px;">אין עדיין מדידות</span>`}
          <button data-action="delete-measure-type" data-id="${esc(t.id)}" aria-label="מחיקת מדד" class="icon-btn-sm">${ICONS.trash}</button>
        </div>
        ${chartData.length ? renderChart(chartData) : ""}
        <div class="steppers" style="margin-top:14px; margin-bottom:0;">
          ${renderStepper(t.id, 'ס״מ', measureValues[t.id], 0.5, 0, "measure-step")}
        </div>
        <button data-action="save-measurement" data-id="${esc(t.id)}" class="save-btn" style="max-width:none; margin-top:14px;"${measureValues[t.id] > 0 ? "" : " disabled"}>רישום מדידה — היום</button>
        ${recent.length ? `
        <div class="log-list" style="margin-top:14px;">
          ${recent.map((e) => `
            <div class="log-row">
              <span style="color:var(--steel); font-size:12px;">${fmtDate(e.date)}</span>
              <div class="flex items-center gap-10">
                <span class="mono" style="font-size:13px;">${bidiUnit(`${e.value} ס״מ`)}</span>
                <button data-action="delete-measurement-entry" data-id="${esc(e.id)}" aria-label="מחיקת מדידה" class="icon-btn-sm">${ICONS.trash}</button>
              </div>
            </div>`).join("")}
        </div>` : ""}
      </div>
      <div style="height:8px;"></div>`;
    return header + detail;
  }).join("");

  el.innerHTML = `
    <h2 class="section-label" style="margin-top:4px;">מדדי גוף</h2>
    ${rows}
    ${addRow}
  `;
  if (measureAddOpen) {
    const input = document.getElementById("measureTypeInput");
    if (input) {
      setTimeout(() => input.focus(), 50);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addMeasureType(e.target.value); }
      });
    }
  }
}

// ---------- Benchmark tracking (club_features.benchmarks) ----------
//
// WHAT THIS IS. A fixed list of the classic named workouts, each one showing
// every attempt over time, the best result, and the same progress chart the
// rest of this screen draws. Plus a reminder when a benchmark has not been
// retested for BENCHMARK_RETEST_DAYS.
//
// No lifts here. The member's lifts, with their estimated 1RM, are already
// the exercise list at the top of this screen; a second copy of them under
// this heading (as 3.0.0 shipped) showed every lift twice.
//
// WHAT IT DELIBERATELY IS NOT: a second store. A Fran attempt IS a wod_entry
// - the row this app has always written, already queued through
// queueSyncRecord() into private_records, already covered by
// buildBackupPayload(), already re-applied by applyRemotePrivateRecord(). So attempts sync exactly like every other
// record because they ARE every other record, and nothing here writes
// anything. A `benchmark_attempt` record type would also have needed a
// migration to get past private_records' record_type check constraint
// (202608260001), and supabase/migrations/ is the one directory two open
// branches cannot both touch (CLAUDE.md, "Parallel work").
//
// This whole section reads and renders. Every number below is derived from
// entries/wodEntries on each render, held nowhere, and invalidated by nothing.
const BENCHMARK_WOD_IDS = ["fran", "grace", "helen", "diane", "cindy", "murph", "isabel", "karen"];
// A quarter. Long enough that a member is not nagged about a workout they did
// six weeks ago, short enough that a stale number stops being presented as
// current. Retests are the point of a benchmark - a best from 2024 is a
// souvenir, not a measurement.
const BENCHMARK_RETEST_DAYS = 90;
// Which row is open. Same one-at-a-time shape as historyId and
// measureExpandedId, and for the same reason: a chart per row, all expanded,
// is a screen nobody scrolls.
let benchmarkExpandedId = null;

// THE BEST RESULT, for a list of attempts that have already been reduced to
// comparable numbers. The direction comes from scoreLowerIsBetter(), which is
// the same rule bestWodScore() applies - one function, so a time can never
// start being "best = highest" on one screen and "best = lowest" on another.
//
// Returns the winning ATTEMPT, not the bare number: the chart needs its date
// and the list needs to mark the row. null for nothing to compare - an empty
// list, or an EMOM, which has no single comparable score at all (see
// scoreValue/bestWodScore; "10 of A, 8 of B" does not reduce to one number,
// and inventing one here would put a fake PR on the screen).
//
// Ties go to the EARLIER attempt: a result you have merely matched is not a
// new best, which is the same call saveSet/saveWod make when they decide
// whether to celebrate.
function benchmarkBest(attempts, scoreType) {
  if (scoreType === "emom") return null;
  const usable = (attempts || []).filter((a) => a && isFinite(a.value));
  if (!usable.length) return null;
  const lower = scoreLowerIsBetter(scoreType);
  return usable.reduce((best, a) => (lower ? a.value < best.value : a.value > best.value) ? a : best);
}

// One attempt at a NAMED WORKOUT: the entry's own comparable score, through
// scoreValue() - the same reduction the WOD tab's PR check uses.
function benchmarkWodAttempt(e) {
  return {
    id: e.id, date: e.date, ts: e.ts || 0, value: scoreValue(e),
    effort: e.rx, text: formatWodEntry(e),
  };
}
// THE FIXED EIGHT. Always all eight, in this order, whether or not the member
// has ever done one: the list is the club's, not the member's, and a benchmark
// never attempted is the most useful row on the screen for somebody new.
//
// Rx, Rx+ and Scaled are not comparable results (bestWodScore() has been
// effort-scoped since the 2026-09-11 hunt found a scaled attempt overwriting
// an Rx best), so the BEST and the CHART are scoped to one bucket -
// bestWodEffort()'s, the same one formatWodBest() headlines. Every attempt
// still appears in the list underneath, tagged, because "every attempt over
// time" is what was asked for and hiding a member's own scaled attempts from
// their own history would be a strange thing to do.
function benchmarkWodItems() {
  return BENCHMARK_WOD_IDS.map((wodId) => {
    const w = wodById(wodId);
    if (!w) return null; // a library id that no longer exists is not a crash
    const effort = bestWodEffort(wodId);
    const all = wodEntriesFor(wodId).map(benchmarkWodAttempt).sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const tracked = effort === null ? [] : all.filter((a) => a.effort === effort);
    return benchmarkItem({
      id: `wod:${wodId}`, kind: "wod", refId: wodId, name: w.name, subtitle: w.desc,
      scoreType: w.scoreType, effort, all, tracked,
    });
  }).filter(Boolean);
}
// The derived half of every item, so "best", "how long ago" and "is it due"
// are computed once rather than per caller.
function benchmarkItem(base) {
  const best = benchmarkBest(base.tracked, base.scoreType);
  // ANY attempt, not the tracked bucket's: the question the reminder asks is
  // "when did you last test this", and a scaled retest is still a retest.
  const last = base.all.length ? base.all[base.all.length - 1] : null;
  const daysSince = last ? daysSinceISODate(last.date) : null;
  return Object.assign({}, base, {
    best, lastDate: last ? last.date : null, daysSince,
    // Never attempted is NOT due for a retest - there is nothing to re-test,
    // and a reminder that fires on day one for eight workouts at once is how a
    // member learns to ignore this section.
    retestDue: daysSince !== null && daysSince > BENCHMARK_RETEST_DAYS,
  });
}
function benchmarkItems() { return benchmarkWodItems(); }
function formatBenchmarkValue(item, value) { return formatWodScore(item.scoreType, value); }

function renderBenchmarkAttemptRow(item, attempt) {
  const isBest = item.best && item.best.id === attempt.id;
  // esc(), not bidiText(), for both spans. The score is a .mono run (a clock, a
  // rounds+reps pair, a kilo figure) and the run-level isolation rule keeps
  // those bare - see the bidi binding's own comment. The date and effort tag
  // are this file's own strings with no member input in them at all.
  return `<div data-benchmark-attempt="${esc(attempt.id)}" class="flex items-center justify-between" style="padding:7px 0; border-bottom:1px solid var(--border);">
    <span style="color:var(--steel); font-size:12px;">${esc(fmtDate(attempt.date))}${item.kind === "wod" ? esc(wodEffortTag(attempt.effort)) : ""}</span>
    <span class="flex items-center gap-6">
      ${isBest ? `<span style="color:var(--brass); font-size:11px; font-weight:700;">שיא</span>` : ""}
      <span class="mono" style="font-weight:700; font-size:13px; color:${isBest ? "var(--brass)" : "var(--chalk)"};">${bidiUnit(attempt.text)}</span>
    </span>
  </div>`;
}

function renderBenchmarkCard(item) {
  // isPR marks the running best as the line climbs, exactly as
  // renderDetailCard() does - so a PR dot means the same thing on both charts.
  const lower = scoreLowerIsBetter(item.scoreType);
  let running = null;
  const chartData = item.tracked.map((a) => {
    const isPR = running === null || (lower ? a.value <= running : a.value >= running);
    if (running === null || (lower ? a.value < running : a.value > running)) running = a.value;
    // est1RM is renderChart()'s parameter name for "the number on the y axis",
    // not a claim about what the number is - it already plots bodyweight and
    // body measurements through the same field.
    return { dateLabel: fmtDate(a.date), est1RM: a.value, isPR };
  });
  const attempts = item.all.slice().reverse(); // newest first, like every other list here
  return `
    <div class="chart-card" style="margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-top:none;">
      ${item.subtitle ? `<div class="wod-desc" style="margin-bottom:10px;">${bidiText(item.subtitle)}</div>` : ""}
      ${item.retestDue ? `<div class="footer-note" style="margin:0 0 10px; text-align:center;">עברו ${item.daysSince} יום מאז הניסיון האחרון — זה הזמן לבדוק שוב.</div>` : ""}
      ${item.tracked.length ? renderChart(chartData) : `<div style="color:var(--steel); font-size:13px; text-align:center; padding:18px 0;">אין עדיין תוצאה לבנצ'מרק הזה</div>`}
      ${item.kind === "wod" && item.effort !== null && item.tracked.length < item.all.length
        ? `<div class="footer-note" style="margin-top:10px; text-align:center;">הגרף והשיא מציגים את הניסיונות ב${esc(wodEffortLabel(item.effort))} בלבד — תוצאות בדרגות מאמץ שונות אינן ברות השוואה. כל הניסיונות מופיעים ברשימה למטה.</div>` : ""}
      ${attempts.length ? `<h3 class="section-label" style="margin-top:14px;">כל הניסיונות</h3>${attempts.map((a) => renderBenchmarkAttemptRow(item, a)).join("")}` : ""}
      <button class="link-btn" data-action="log-benchmark" data-id="${esc(item.refId)}" style="display:block; margin:12px auto 0;">רישום ניסיון ב-${esc(item.name)}</button>
    </div>
    <div style="height:8px;"></div>`;
}

function renderBenchmarkRow(item) {
  const open = benchmarkExpandedId === item.id;
  const best = item.best ? formatBenchmarkValue(item, item.best.value) : null;
  return `
    <button class="exercise-row ${open ? "active" : ""}" data-action="toggle-benchmark" data-id="${esc(item.id)}" aria-expanded="${open}" style="${open ? "margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;" : ""}">
      <div class="flex items-center gap-8">
        <span style="display:inline-flex; transition:transform .2s; transform:rotate(${open ? "90deg" : "180deg"});">${ICONS.chevron}</span>
        <span style="font-weight:700; font-size:14px;">${bidiText(item.name)}</span>
        ${item.retestDue ? `<span data-benchmark-retest="${esc(item.id)}" style="color:var(--brass); border:1px solid var(--brass); border-radius:999px; padding:1px 7px; font-size:10px; font-weight:700;">לבדיקה מחדש</span>` : ""}
      </div>
      <span style="text-align:left;">
        ${best
          ? `<span class="mono" style="display:block; color:var(--brass); font-weight:700; font-size:14px;">${bidiUnit(best)}</span>`
          : `<span style="display:block; color:var(--steel); font-size:12px;">טרם נוסה</span>`}
      </span>
    </button>`;
}

// THE REMINDER, AND WHERE IT IS ALLOWED TO APPEAR. On this screen and nowhere
// else: no notification row, no bell badge, and above all no push. Push
// delivery is the community layer's (notif_push_pending, gated on
// club_features.push_notifications), it costs a member an interruption on
// their phone, and "you have not done Fran since April" is not worth one.
// Nothing in this file touches that path, and this comment is here so a later
// change that wants to has to argue with it first.
function renderBenchmarkArea() {
  const el = document.getElementById("benchmarkArea");
  if (!el) return;
  // The gate, and the whole section in ONE innerHTML sink rather than a write
  // and an `= ""` beside it - test/app-innerhtml-sinks.test.mjs pins the count
  // in app.js on purpose, and one surface is worth one line of that budget.
  //
  // Off - which is every club until an admin switches it on, and every member
  // who has never signed into the community layer at all - and this section
  // does not exist rather than rendering an empty heading.
  el.innerHTML = benchmarksOn() ? benchmarkSectionHtml() : "";
  if (el.firstElementChild) { el.setAttribute("role", "region"); el.setAttribute("aria-label", "בנצ'מרקים"); }
  else { el.removeAttribute("role"); el.removeAttribute("aria-label"); }
}
function benchmarkSectionHtml() {
  const items = benchmarkItems();
  const due = items.filter((i) => i.retestDue);
  return `
    <h2 class="section-label">בנצ'מרקים</h2>
    ${due.length ? `<div class="footer-note" style="margin:0 0 10px;">${due.length === 1 ? `בנצ'מרק אחד לא נבדק` : `${due.length} בנצ'מרקים לא נבדקו`} מעל ${BENCHMARK_RETEST_DAYS} יום: ${esc(due.map((i) => i.name).join(", "))}</div>` : ""}
    ${items.map((item) => renderBenchmarkRow(item) + (benchmarkExpandedId === item.id ? renderBenchmarkCard(item) : "")).join("")}`;
}

function renderHistoryTab() {
  const now = new Date();
  const monthPrefix = localISODate(now).slice(0, 7);
  const celebratablePrIds = celebratablePrEntryIds();
  const prCountThisMonth = entries.filter((e) => celebratablePrIds.has(e.id) && e.date.startsWith(monthPrefix)).length;
  const start = new Date(now); start.setDate(now.getDate() - now.getDay());
  const startISO = localISODate(start);
  const sessionsThisWeek = new Set(entries.filter((e) => e.date >= startISO).map((e) => e.date)).size;
  const totalSetsLogged = entries.reduce((sum, e) => sum + e.sets, 0);

  return `
    <section class="scene-page ${PAGE_SCENES.history.className}" aria-labelledby="pageTitle-history">
      <div class="scene-page__media" aria-hidden="true"></div>
      <div class="scene-page__scrim" aria-hidden="true"></div>
      <div class="scene-page__intro">
        <div class="scene-page__brand">${esc(brandWordmark())}</div>
        <h1 id="pageTitle-history" class="scene-page__title">התקדמות</h1>
      </div>
      <div class="scene-sheet">
    <div class="stripe-ribbon" aria-hidden="true"></div>
    ${!storageOK ? `<div class="footer-note" style="color:var(--red-text); background:rgba(216,69,60,.1); border:1px solid var(--red); border-radius:12px; padding:10px 14px; margin-bottom:12px;" role="alert">${esc(storageErrMsg)}</div>` : ""}
    <div class="stat-row">
      <div class="stat-card stat-hero" style="text-align:center;"><div class="stat-value mono" style="color:var(--brass); font-size:20px;">${prCountThisMonth}</div><div class="stat-label">שיאים החודש</div></div>
      <div class="stat-card" style="text-align:center;"><div class="stat-value mono" style="font-size:20px;">${sessionsThisWeek}</div><div class="stat-label">אימונים השבוע</div></div>
      <div class="stat-card" style="text-align:center;"><div class="stat-value mono" style="font-size:20px;">${totalSetsLogged}</div><div class="stat-label">סטים שנרשמו</div></div>
    </div>

    ${activeExercises().length > 0 ? `
    <h2 class="section-label">שיאים כלל-זמנים</h2>
    <div class="search-box" style="margin:0 0 12px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--steel)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="historySearch" dir="auto" placeholder="חיפוש בתרגילים שלך" aria-label="חיפוש בתרגילים שלך" value="${esc(historySearch)}" />
    </div>` : ""}

    <div id="historyListArea" role="region" aria-label="שיאים כלל-זמנים"></div>

    <!-- Benchmarks sit below the member's own movements, not above them
         (owner's call after testing on an iPhone, 2026-09-24): the list a
         member opens Progress for comes first. -->
    <div id="benchmarkArea"></div>

    <div id="bodyweightArea" role="region" aria-label="משקל גוף"></div>

    <div id="measureArea" role="region" aria-label="מדדי גוף"></div>
      </div>
    </section>
  `;
}

// Was renderFooter() - same elements, same data-actions, same ids, same
// live-state computation on every call (confirmClear/importMessage/backup
// staleness), just regrouped into labeled sections for the new settings
// screen instead of one long stack of links glued under every tab's
// content. Called unconditionally from render() into #settingsBody, same
// "always regenerated into a normally-hidden container" treatment as
// renderNavMenuList().
function renderSettingsBody() {
  const hasData = entries.length || wodEntries.length || bodyweightEntries.length || measureTypes.length;
  const days = daysSinceLastExport();
  // iOS evicts unvisited IndexedDB after ~7 days, and in this edition a
  // downloaded file is the ONLY copy anywhere else, so the nudge has to sit
  // under that window.
  const staleThreshold = 5;
  // COMM-355: same threshold, now in the .settings-warn icon+box treatment
  // (COMM-323) instead of a plain colored line.
  const staleBackupNote = hasData && (days === null || days >= staleThreshold)
    ? `<div class="settings-warn" role="status">⚠️<span>${esc(days === null ? "עדיין לא ביצעתם גיבוי — לא הורדתם קובץ גיבוי" : `קובץ הגיבוי האחרון שהורדתם הוא מלפני ${days} ימים`)} — ייצוא גיבוי למטה</span></div>`
    : "";
  const initial = userName ? userName.trim().charAt(0) : "";
  // COMM-323: card-based redesign - .settings-pane of .settings-block
  // cards instead of the old flat .divider-label + bare .card list. The
  // profile card reuses .who (the exact same avatar+name component the nav
  // menu already renders) rather than a near-duplicate; every
  // Community-only row (cloud/backup panel, legal links) is preserved as
  // its own section, not dropped.
  return `
    <div class="settings-pane">
      <div class="settings-club-edge" aria-hidden="true"></div>
      <div class="who" style="margin:0;">
        <div class="who-avatar">${esc(initial)}</div>
        <div style="flex:1; min-width:0;">
          <div class="who-name">${userName ? bidiText(userName) : "אורח/ת"}</div>
          <div class="who-sub">פרופיל אישי</div>
        </div>
        <button class="icon-chip icon-chip-steel" data-action="edit-user-name" aria-label="עריכת פרופיל">${ICONS.edit}</button>
      </div>

      <div class="settings-block">
        <div class="settings-block-title">מראה</div>
        ${renderThemeRow()}
        ${renderTextScaleRow()}
      </div>

      <!-- Design spec §1.5. Every surface the first-run sequence defers has
           to have somewhere to live, or deferring it is just deleting it.
           This card is that somewhere: the explainer that is no longer a
           gate, the install prompt that no longer fires on load, and the
           box-start date that no longer appears on the welcome sheet. Each
           row is the permanent home of exactly one thing §1.2 moved out of
           the member's first minute. -->
      <div class="settings-block">
        <div class="settings-block-title">עזרה והתאמה</div>
        <button class="exercise-row" data-action="open-onboarding" style="margin-bottom:8px;">
          <span style="font-weight:700; font-size:13.5px;">סיור באפליקציה</span>
          <span style="color:var(--steel); flex-shrink:0;">${ICONS.chevronsLeft}</span>
        </button>
        <!-- Fresh-eyes audit: this used to be the header's always-visible
             icon, which meant the least exciting thing in the app (a
             changelog) had the most prominent real estate on every screen.
             Settings is its permanent home now - still one tap away, just
             not competing with the community notification badge for the
             one slot every screen shares. -->
        <button class="exercise-row" data-action="open-release-notes" style="margin-bottom:8px;">
          <span style="font-weight:700; font-size:13.5px;">מה חדש באפליקציה</span>
          <span class="flex items-center gap-6" style="flex-shrink:0;">${unseenReleaseNotes().length ? `<span class="tab-badge" aria-hidden="true">${unseenReleaseNotes().length}</span>` : ""}<span style="color:var(--steel);">${ICONS.chevronsLeft}</span></span>
        </button>
        ${isStandalone() ? "" : `
        <button class="exercise-row" data-action="show-install-hint" style="margin-bottom:8px;">
          <span style="font-weight:700; font-size:13.5px;">התקנה במסך הבית</span>
          <span style="color:var(--steel); flex-shrink:0;">${ICONS.chevronsLeft}</span>
        </button>`}
        <button class="exercise-row" data-action="edit-box-start-date" style="margin-bottom:8px;">
          <div style="text-align:right;">
            <div style="font-weight:700; font-size:13.5px;">מתי התחלתי להתאמן בבוקס</div>
            <div style="color:var(--steel); font-size:12px; margin-top:2px;">${boxStartDate ? esc(fmtDate(boxStartDate)) : "לא הוגדר — פותח את מדליות הוותק"}</div>
          </div>
          <span style="color:var(--steel); flex-shrink:0;">${ICONS.chevronsLeft}</span>
        </button>
        <!-- Real device report, 2026-09-15. Until this row existed the app
             had no route at all for "this is broken" or "I need help" - the
             four defects found in the first real-phone session reached a
             developer only because the tester happened to be one. Filed
             under עזרה rather than as its own block: a member looking for
             help looks here first, and a fifth top-level settings card for
             one row would bury it further down the same screen. -->
        <button class="exercise-row" data-action="open-support" style="margin-bottom:0;">
          <div style="text-align:right;">
            <div style="font-weight:700; font-size:13.5px;">תמיכה ודיווח על תקלה</div>
            <div style="color:var(--steel); font-size:12px; margin-top:2px;">משהו לא עובד? ספרו לנו</div>
          </div>
          <span style="color:var(--steel); flex-shrink:0;">${ICONS.chevronsLeft}</span>
        </button>
      </div>

      <div class="settings-block">
        <div class="settings-block-title">קובץ גיבוי להורדה</div>
        <div class="footer-note"${storageOK ? "" : ' style="color:var(--red-text);" role="alert"'}>${storageOK ? esc("נשמר במכשיר הזה בלבד, ללא שרת") : esc(storageErrMsg || "שמירה נכשלה — בדקו את מקום האחסון")}</div>
        ${staleBackupNote}
        <div class="flex items-center justify-center gap-10" style="margin-bottom:8px; flex-wrap:wrap;">
          <button class="link-btn" data-action="export-data">ייצוא גיבוי</button>
          <span style="color:var(--border); font-size:11px;">·</span>
          <button class="link-btn" data-action="import-data">ייבוא גיבוי</button>
        </div>
        ${importMessage ? `<div class="footer-note" role="status" aria-live="polite" style="color:var(--brass); margin-bottom:8px;">${esc(importMessage)}</div>` : ""}
        <div class="footer-note" style="margin-bottom:0;">קובץ הגיבוי הוא טקסט פשוט (JSON) וכולל את יומן האימונים המלא, התרגילים והאימונים שהוספתם, משקל גוף ומדידות — בלי השם שלכם ובלי הגדרות. הוא יורד לתיקיית ההורדות של המכשיר ונשאר שם: במכשיר משותף כל מי שמשתמש בו יכול לפתוח אותו. שמרו אותו במקום בטוח, ומחקו אותו מההורדות אם אינכם צריכים אותו שם</div>
      </div>

      <div class="settings-block">
        <div class="settings-block-title">ספירת שימוש</div>
        <div class="footer-note" style="margin-bottom:8px;">כדי שהמועדון ידע כמה משתמשים באפליקציה, נספרים רק פתיחת האפליקציה, רישום אימון ופתיחת מסך — בלי שם ובלי שום פרט מהאימונים. לכל ספירה מצורף מזהה אקראי קבוע של הטלפון: הוא לא מגלה מי אתם, אבל מקשר את הספירות של הטלפון הזה לאורך הימים. יומני השרת שומרים את כתובת ה־IP לזמן קצר, והספירות עצמן נמחקות אחרי 180 יום.</div>
        ${renderUsageCountingRow()}
      </div>

      <div class="settings-block">
        <div class="settings-block-title">משפטי</div>
        <div class="flex items-center justify-center gap-8"><a class="link-btn" href="./privacy.html" target="_blank" rel="noopener">פרטיות</a></div>
      </div>

      <div class="settings-block">
        <!-- Design spec §4.4. The title here was "אזור מסוכן", a calque of
             the developer idiom "danger zone", printed in var(--red-text).
             The beginner persona read it as the app reporting a fault with
             her PHONE, not as a heading over a control to approach slowly:
             a red warning that fires before she has touched anything is
             indistinguishable from an error message. The heading now names
             what the section DOES, and the red moves off it and stays where
             it belongs - on the .chip-btn.danger control itself, which
             test/audit-ux-fixes.test.mjs pins - so the colour warns about an
             action rather than about the app.
             The rest of the block moved to the same register. It now says
             what actually gets deleted and that clearAllData() downloads a
             backup file first (it has done that since the audit and never
             told anyone, which is the single most reassuring fact on this
             screen), and the confirm names its subject instead of asking a
             bare "למחוק הכל?" - the rule the askAppConfirm comment above
             already sets for every other destructive action in this file. -->
        <div class="settings-block-title">מחיקת נתונים</div>
        <div class="footer-note">מוחק מהמכשיר הזה את יומן האימונים, התרגילים והאימונים שהוספתם, משקל הגוף והמדידות. לפני המחיקה יורד אוטומטית קובץ גיבוי, כדי שתמיד תהיה דרך חזרה</div>
        ${!confirmClear
          ? `<div style="text-align:center;"><button class="chip-btn danger" data-action="ask-clear">מחיקת כל הנתונים</button></div>`
          : `
          <div class="flex items-center justify-center gap-10">
            <span style="color:var(--steel); font-size:11px;">למחוק את הכל מהמכשיר הזה?</span>
            <button class="chip-btn primary danger" data-action="do-clear">כן, מחיקה</button>
            <button class="chip-btn" data-action="cancel-clear">ביטול</button>
          </div>`}
      </div>
      <div class="footer-note" style="text-align:center; margin-top:2px;">© ${new Date().getFullYear()} Shahaf Rachmany · v${APP_VERSION}</div>
    </div>`;
}

function updateLogQuickUI(field) {
  const valMap = { weight, reps, sets, durationSeconds };
  const inp = document.querySelector(`.stepper-val[data-action="step"][data-field="${cssSel(field)}"]`);
  if (inp) inp.value = valMap[field];
  if (field === "weight" && logEntryType === "reps") {
    const bv = document.getElementById("barbellVisual");
    if (bv) bv.innerHTML = renderBarbell(weight);
    // The weight stepper's floor tracks barWeight (total can't be less
    // than the empty bar) - but only for movements actually loaded on a
    // barbell (isBarbellMovement) - keep every element carrying data-min
    // in sync with it. A non-barbell movement (weighted pull-up, dumbbell
    // press, machine leg press, ...) keeps a plain 0 floor instead.
    if (isBarbellMovement(selectedId)) {
      document.querySelectorAll('[data-action="step"][data-field="weight"]').forEach((elm) => { elm.dataset.min = barWeight; });
    }
  }
  if (logEntryType === "reps") {
    const estEl = document.getElementById("estLineValue");
    if (estEl) estEl.textContent = estimate1RM(weight, reps) + ' ק״ג';
  } else if (field === "durationSeconds") {
    const durEl = document.getElementById("durationLineValue");
    if (durEl) durEl.textContent = formatDuration(durationSeconds);
  }
}

// Bound every numeric field at both ends. Previously only a floor was applied,
// so "1e12" typed into a weight box propagated straight through the app state.
// Every numeric stepper field (main log, WOD log, bodyweight, the WOD
// builder's per-movement/EMOM/time-cap fields, body measurements) used
// to require a matching branch added to four separate functions -
// fieldMax/getFieldValue/setFieldState/applyFieldValue - for every new
// field type. One config table now drives all four instead, so adding a
// field type is one entry, not four edits kept in sync by hand.
const FIELD_ACTIONS = {
  "step": {
    max: (field) => FIELD_MAX[field] ?? LIMITS.weight,
    get: (field) => ({ weight, reps, sets, durationSeconds })[field],
    set: (field, value) => {
      if (field === "weight") weight = value;
      else if (field === "reps") reps = value;
      else if (field === "sets") sets = value;
      else if (field === "durationSeconds") durationSeconds = value;
    },
    sync: (field) => updateLogQuickUI(field),
  },
  "wod-step": {
    max: (field) => FIELD_MAX[field] ?? LIMITS.weight,
    get: (field) => ({ wodMinutes, wodSeconds, wodRounds, wodReps, wodWeight, wodScaledWeight })[field],
    set: (field, value) => {
      if (field === "wodMinutes") wodMinutes = value;
      else if (field === "wodSeconds") wodSeconds = value;
      else if (field === "wodRounds") wodRounds = value;
      else if (field === "wodReps") wodReps = value;
      else if (field === "wodWeight") wodWeight = value;
      else if (field === "wodScaledWeight") wodScaledWeight = value;
    },
    sync: (field) => {
      const valMap = { wodMinutes, wodSeconds, wodRounds, wodReps, wodWeight, wodScaledWeight };
      const inp = document.querySelector(`.stepper-val[data-action="wod-step"][data-field="${cssSel(field)}"]`);
      if (inp) inp.value = valMap[field];
    },
  },
  "bw-step": {
    max: () => LIMITS.bodyweight,
    get: () => bwWeight,
    set: (field, value) => { bwWeight = value; },
    sync: () => {
      const inp = document.querySelector(`.stepper-val[data-action="bw-step"][data-field="bwWeight"]`);
      if (inp) inp.value = bwWeight;
      const bwBtn = document.querySelector(`[data-action="save-bw"]`);
      if (bwBtn) bwBtn.disabled = !(bwWeight > 0);
      // The save button's disabled state has to be patched here for the same
      // reason the measurement sibling below spells out at length: this path
      // patches the DOM in place and never calls render(), so an attribute
      // decided at render time goes stale the moment the stepper moves. Added
      // 2026-09-15 with the zero-bodyweight guard - without it the button
      // would render enabled at 70, stay enabled all the way down to 0, and
      // then stay disabled after the member stepped back up.
    },
  },
  "builder-movement-reps": {
    max: () => LIMITS.reps,
    get: (field) => builderMovements[field] ? builderMovements[field].reps : 0,
    set: (field, value) => { if (builderMovements[field]) builderMovements[field].reps = value; },
    sync: () => renderWodBuilderMovements(),
  },
  "builder-movement-weight": {
    max: () => LIMITS.weight,
    get: (field) => builderMovements[field] ? builderMovements[field].weight : 0,
    set: (field, value) => { if (builderMovements[field]) builderMovements[field].weight = value; },
    sync: () => renderWodBuilderMovements(),
  },
  "builder-movement-duration": {
    max: () => LIMITS.duration,
    get: (field) => builderMovements[field] ? builderMovements[field].durationSeconds : 0,
    set: (field, value) => { if (builderMovements[field]) builderMovements[field].durationSeconds = value; },
    sync: () => renderWodBuilderMovements(),
  },
  "builder-emom-minutes": {
    max: () => LIMITS.minutes,
    get: () => builderEmomMinutes,
    set: (field, value) => { builderEmomMinutes = value; },
    sync: () => {
      const inp = document.querySelector(`.stepper-val[data-action="builder-emom-minutes"]`);
      if (inp) inp.value = builderEmomMinutes;
    },
  },
  "builder-time-cap": {
    max: () => LIMITS.minutes,
    get: () => builderTimeCapMinutes,
    set: (field, value) => { builderTimeCapMinutes = value; },
    sync: () => {
      const inp = document.querySelector(`.stepper-val[data-action="builder-time-cap"]`);
      if (inp) inp.value = builderTimeCapMinutes;
    },
  },
  "wod-emom-step": {
    max: () => LIMITS.reps,
    get: (field) => typeof wodEmomReps[+field] === "number" ? wodEmomReps[+field] : 0,
    set: (field, value) => { wodEmomReps[+field] = value; },
    sync: (field, value) => {
      const inp = document.querySelector(`.stepper-val[data-action="wod-emom-step"][data-field="${cssSel(field)}"]`);
      if (inp) inp.value = value;
    },
  },
  "measure-step": {
    max: () => LIMITS.measurement,
    get: (field) => typeof measureValues[field] === "number" ? measureValues[field] : 0,
    set: (field, value) => { measureValues[field] = value; },
    sync: (field, value) => {
      const inp = document.querySelector(`.stepper-val[data-action="measure-step"][data-field="${cssSel(field)}"]`);
      if (inp) inp.value = value;
      // Live bug hunt (2026-09-11): "רישום מדידה — היום" silently did
      // nothing at value 0 (a fresh measure type's own default), with zero
      // feedback - a member could tap it repeatedly thinking it was broken.
      // The save button is disabled at 0 instead (see renderMeasureArea());
      // this stepper action is the ::-related, in-place-DOM-patch path
      // (see applyFieldValue() above - it calls only this sync(), never a
      // full render()), so the button's disabled state has to be kept in
      // sync here too, or it would stay stuck disabled after the member
      // raises the value above 0.
      const btn = document.querySelector(`[data-action="save-measurement"][data-id="${cssSel(field)}"]`);
      if (btn) btn.disabled = !(value > 0);
    },
  },
};

function clampField(action, field, value, min) {
  const lo = isFinite(min) ? min : 0;
  const hi = fieldMax(action, field);
  if (typeof value !== "number" || !isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, +value.toFixed(2)));
}

function getFieldValue(action, field) {
  const cfg = FIELD_ACTIONS[action];
  return cfg ? cfg.get(field) : 0;
}

// Pure state write, no DOM side effects — safe to call on every keystroke.
function setFieldState(action, field, value) {
  const cfg = FIELD_ACTIONS[action];
  if (cfg) cfg.set(field, value);
}

// Full commit: validates, writes state, and resyncs every dependent display
// (including the field's own text) — used by +/- buttons and on blur.
function applyFieldValue(action, field, value) {
  if (typeof value !== "number" || !isFinite(value)) {
    value = getFieldValue(action, field);
    if (typeof value !== "number" || !isFinite(value)) value = 0;
  }
  setFieldState(action, field, value);
  const cfg = FIELD_ACTIONS[action];
  if (cfg) cfg.sync(field, value);
}

// WHO HAD THE KEYBOARD, carried across a render (2026-09-16).
//
// REPORTED FROM A REAL PHONE: "when I press the type boxes it jumps off them,
// and I need to press again." Tapping a field in the community sign-in put the
// caret there, and a moment later the field lost it.
//
// Nothing was wrong with the field. render() replaces #content wholesale, and
// any render that lands while a member is typing destroys the very node that
// holds their focus - the browser then has nowhere to put it and drops it to
// <body>, closing the keyboard. It is invisible on a fast connection, because
// every pending request has already resolved before a human can tap. Over 4G,
// a profile or club-features response arriving 300ms after the tap lands
// squarely in the middle of it. That is why the SECOND tap always works: by
// then there is nothing left in flight to trigger another render.
//
// Identity, not the node: the node is gone by the time we look for it again.
// An id when the field has one, otherwise the owning form plus the field name,
// which is what every form in this app gives its inputs.
function focusFieldIdentity(el) {
  if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && el.tagName !== "SELECT")) return null;
  const content = document.getElementById("content");
  // Only fields inside the region render() actually replaces. A dialog or the
  // settings sheet lives elsewhere and keeps its own focus untouched.
  if (!content || !content.contains(el)) return null;
  if (el.id) return "#" + el.id;
  if (el.name && el.form && el.form.id) return el.form.id + "::" + el.name;
  return null;
}
function findFieldByIdentity(key) {
  if (!key) return null;
  try {
    if (key.charAt(0) === "#") return document.getElementById(key.slice(1));
    const at = key.indexOf("::");
    const form = document.getElementById(key.slice(0, at));
    return form && form.elements ? form.elements[key.slice(at + 2)] : null;
  } catch (e) { return null; }
}
// Anonymous usage counting (src/usage.js). The one door from this file into
// it: fire and forget, never awaited, never able to throw into a render or a
// save. With counting switched off, or no network, it does nothing at all.
function countUsage(event, screen) {
  try { if (window.HaimuniaUsage) window.HaimuniaUsage.count(event, screen); } catch (e) { /* counting never breaks the app */ }
}
// Counted where the screen is drawn rather than at each of the several
// places that set `tab`, so no route to a screen can be missed.
let lastCountedScreen = null;
function render() {
  let content;
  try {
    if (tab === "add") {
      const selected = movementById(selectedId);
      content = renderLogTab();
      // COMM-360: only name the save action once a movement is actually
      // chosen - selected is always truthy (selectedId keeps a placeholder
      // id internally), so movementExplicitlyChosen is the real gate here,
      // matching the bottom-bar visibility check below.
      if (selected && movementExplicitlyChosen) {
        const prefix = editingEntryId ? "עדכון סט — " : ladderMode ? `הוספת סט ${currentLadderRounds().length + 1} ל${ladderPartnerId ? "סופרסט" : "סולם"} — ` : "רישום סט — ";
        document.getElementById("bottomBarBtn").dataset.action = "save-set";
        document.getElementById("saveBtnLabel").textContent = editingEntryId || ladderMode ? prefix + selected.name : "שמירת אימון";
      } else {
        // The bar is hidden in this state (see the display rule below), but
        // #bottomBarBtn/#saveBtnLabel are long-lived DOM nodes that survive
        // every tab switch, so whatever the last visible screen wrote stays
        // pinned there. A UX audit caught the mirror image of this on the
        // workouts tab, where the CTA still read "רישום סט" - keep the label
        // truthful for the screen that's actually up, hidden or not.
        document.getElementById("bottomBarBtn").dataset.action = "open-picker";
        document.getElementById("saveBtnLabel").textContent = "בחירת תרגיל";
      }
    } else if (tab === "history") {
      content = renderHistoryTab();
    } else if (tab === "calendar") {
      content = renderCalendarTab();
    } else if (tab === "wod") {
      content = renderWodTab();
      syncWodSaveCta(wodSubTab === "log" ? wodById(selectedWodId) : null);
    }
  } catch (err) {
    console.error("render error:", err);
    // Security hunt (2026-09-11): the raw JS exception message used to be
    // shown here verbatim. It's already HTML-escaped via bidiText() (no
    // injection risk - the prior security pass's CHANGES.md entry already
    // closed that half), but the message itself can still name an internal
    // property/variable a developer never meant a member to see. Console
    // still gets the full detail for debugging; the screen gets a plain,
    // non-revealing line instead.
    content = `<div style="padding:40px 16px; text-align:center;">
      <div style="color:var(--red-text); font-weight:700; margin-bottom:8px;">משהו השתבש בהצגת הטאב הזה</div>
      <div style="color:var(--steel); font-size:12px;">אפשר לנסות לרענן את האפליקציה או לעבור לטאב אחר.</div>
    </div>`;
  }
  const navMenuListEl = document.getElementById("navMenuList");
  if (navMenuListEl) {
    // Own try/catch, same reasoning as the tab-content one above: a
    // problem building the nav menu (e.g. cloud.js's community-preview
    // export mid-transition) must never take down the rest of render() -
    // in particular the content write and the post-render Community
    // hook below it, which is exactly the failure this guarded against
    // during development.
    try { navMenuListEl.innerHTML = renderNavMenuList(); }
    catch (err) { console.error("nav menu render error:", err); }
  }
  const settingsBodyEl = document.getElementById("settingsBody");
  if (settingsBodyEl) {
    try { settingsBodyEl.innerHTML = renderSettingsBody(); }
    catch (err) { console.error("settings render error:", err); }
  }
  const desktopSidebarEl = document.getElementById("desktopSidebar");
  if (desktopSidebarEl) {
    try { desktopSidebarEl.innerHTML = renderDesktopSidebar(); }
    catch (err) { console.error("desktop sidebar render error:", err); }
  }
  const bottomTabBarEl = document.getElementById("bottomTabBar");
  if (bottomTabBarEl) {
    try { bottomTabBarEl.innerHTML = renderBottomTabBar(); }
    catch (err) { console.error("bottom tab bar render error:", err); }
  }
  // COMM-360: the save action only appears once something is actually
  // chosen on either tab - same rule, applied symmetrically.
  document.getElementById("bottomBar").style.display = ((tab === "add" && movementExplicitlyChosen) || (tab === "wod" && wodSubTab === "log" && wodById(selectedWodId))) ? "flex" : "none";
  // §1.2 S6: the install prompt is a deferred question, so its gate has to
  // be re-checked as the member's situation changes rather than once at the
  // moment the browser offered it. No-op unless all four conditions hold.
  maybeShowInstallBanner();
  updateStreakLabel();
  updateNotificationsBadge();
  // Every overlay here shares .modal-overlay and the same fixed z-index:50,
  // so two open at once stack by DOM order alone. The undo
  // bar is not in this concatenation at all any more and is not an overlay
  // either: it is written to #appToastDock below, inside #bottomNavWrap,
  // where it inherits that wrapper's z-index:30 and so still loses to every
  // one of these.
  // Immersive club redesign: one attribute drives every scene page's chrome
  // (header overlay, hidden brand-stripe, dark bottom bar) via CSS alone -
  // see body[data-scene] rules in index.html. Stamped on <body>, not #app:
  // #bottomNavWrap (the fixed save-bar + tab bar) is a SIBLING of #app in
  // the DOM, not a descendant (confirmed by reading the actual markup, not
  // assumed from IMPLEMENTATION_SPEC.md's illustrative sample), so an
  // #app-scoped attribute could never reach the bottom bar's own styling.
  // Removed entirely on a non-scene tab (Settings/Manage/dialogs keep the
  // ordinary light chrome).
  const scene = PAGE_SCENES[tab];
  if (scene) document.body.dataset.scene = scene.className; else delete document.body.dataset.scene;
  if (tab !== lastCountedScreen) { lastCountedScreen = tab; countUsage("screen_open", tab); }
  // Captured BEFORE the swap, restored after - see focusFieldIdentity.
  const focusKey = focusFieldIdentity(document.activeElement);
  let caret = null, typed = null;
  if (focusKey) {
    // selectionStart throws on input types that have no text selection
    // (number, email, date), so a failure here just means "no caret to keep".
    try { caret = { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }; } catch (e) { caret = null; }
    // The value too, and ONLY for the focused field. A login name or an invite
    // code lives in the DOM and not in state, so the swap erased what the
    // member had typed as well as where they were - focus restored onto an
    // empty box would still read as "it ate what I wrote".
    //
    // Deliberately just this one field. setFieldErrors' own note is the reason:
    // a form that refills itself wholesale would be worse than the bug, because
    // it would resurrect fields the app cleared on purpose. Nothing clears a
    // field out from under the member's own cursor.
    try { typed = document.activeElement.value; } catch (e) { typed = null; }
  }
  document.getElementById("content").innerHTML = content + renderAppConfirmSheet();
  // The toast is NOT part of #content any more - it is painted into its own
  // dock inside #bottomNavWrap so that it can be positioned against the
  // bottom nav instead of against the viewport (finding 1; see
  // renderToastBar()). Written on every render, including the one the
  // expiry timer fires, so clearing pendingToast still clears the bar.
  // Guarded because several unit tests build a #content in isolation.
  const toastDock = document.getElementById("appToastDock");
  if (toastDock) toastDock.innerHTML = renderToastBar();
  const contentPanel = document.getElementById("content");
  const activeNavItem = getNavItems().find((i) => i.tab === tab);
  if (activeNavItem && document.getElementById(activeNavItem.rowId)) contentPanel.setAttribute("aria-labelledby", activeNavItem.rowId);
  else contentPanel.removeAttribute("aria-labelledby");
  if (focusKey) {
    const again = findFieldByIdentity(focusKey);
    // Only when the swap is what took focus away. If the member has moved to
    // another control in the meantime, or a dialog has taken over, leave it
    // alone - restoring here would be the same theft in the other direction.
    const active = document.activeElement;
    if (again && (!active || active === document.body)) {
      try {
        // Value before focus: setting .value moves the caret to the end, so
        // the range below has to be applied after it.
        if (typed != null && again.value === "" && typed !== "") again.value = typed;
        again.focus();
        // Without this the caret returns to position 0 and the next keystroke
        // lands at the front of what they already typed.
        if (caret && caret.start != null) again.setSelectionRange(caret.start, caret.end);
      } catch (e) {}
    }
  }
  try {
    if (tab === "add") {
      const dateInput = document.getElementById("logDateInput");
      if (dateInput) dateInput.addEventListener("change", (e) => {
        logDate = clampLogDate(e.target.value);
        logDateExplicitlyChosen = true;
        endLadder(); // a ladder is scoped to one day
        render();
      });
    }
    if (tab === "history") {
      renderBenchmarkArea();
      renderHistoryListArea();
      renderBodyweightArea();
      renderMeasureArea();
      const search = document.getElementById("historySearch");
      if (search) search.addEventListener("input", (e) => { historySearch = cleanStr(e.target.value, LIMITS.nameLen); renderHistoryListArea(); });
    }
    if (tab === "calendar") renderCalendarGrid();
    if (tab === "wod") renderWodContent();
    // browser-check audit (dialog-back-button.mjs) found a real gap in the
    // history/back-button fix above APP_DIALOGS: the boot-time loop that
    // attaches a MutationObserver to each registered overlay
    // (`for (const key in APP_DIALOGS) { const el = document.getElementById(...)... }`)
    // only ever finds an overlay that is a PERMANENT node already in
    // index.html at that point (navMenu, settings, picker, achievements,
    // etc). appConfirmOverlay is not one of those - renderAppConfirmSheet()
    // is generated fresh and concatenated into #content's innerHTML on
    // every render, only while a confirm is open (see this function, a few
    // lines above: `... + renderAppConfirmSheet()`) - so at boot time
    // document.getElementById("appConfirmOverlay") is null, `if (el)`
    // is false, and NO observer is ever attached for it. The practical
    // effect measured in a real browser: opening the destructive-delete
    // confirm sheet pushed NO history entry, so a back-press while it was
    // open did not consume a reserved entry - it fell through to whatever
    // real entry preceded this app's own page, which on a fresh tab is the
    // browser's own initial about:blank, navigating the PWA away entirely.
    // That is a worse outcome than the original bug (silently doing
    // nothing): the single most safety-critical dialog in the app (it
    // gates deleting a logged set - the one thing in this app that cannot
    // be recreated) had no back-button protection at all, and a back-press
    // on it could look like the app crashing to a blank screen.
    // syncAppDialogHistoryState() itself is shape-agnostic (it reads
    // currentAppDialog(), not any one overlay's node) - calling it here,
    // after every render, the same call-based hook cloud.js's
    // syncCloudDialogFocus() above already relies on for its OWN
    // dynamically-rendered dialogs, closes the gap for appConfirm without
    // requiring every future dynamically-rendered dialog to remember to
    // reserve a permanent DOM node just to be observable.
    if (typeof syncAppDialogHistoryState === "function") syncAppDialogHistoryState();
  } catch (err) {
    console.error("post-render error:", err);
  }
}

// ---------- WOD tab ----------
// The אימונים save CTA, in one place. Two call sites set it - the full
// render() and renderWodContent()'s partial sub-tab update - and they had
// drifted into two copies of the same three lines. Design spec §3.6 adds a
// third state to it (unanswered -> disabled), and a rule with three states
// is one copy too many to keep in two places.
//
// Disabled rather than hidden: the member should see that filing this WOD is
// the next thing, and why it is not available yet. The reason is stated on
// screen by the helper line under the toggle, not left to be inferred from a
// greyed-out button - a disabled control with no explanation is the thing
// this spec section is complaining about elsewhere.
function syncWodSaveCta(w) {
  const btn = document.getElementById("bottomBarBtn");
  const label = document.getElementById("saveBtnLabel");
  if (!btn || !label) return;
  if (w) {
    btn.dataset.action = "save-wod";
    label.textContent = `${editingWodEntryId ? "עדכון" : "רישום"} אימון — ${w.name}`;
    const unanswered = !wodEffortAnswered(wodRx);
    btn.disabled = unanswered;
    btn.setAttribute("aria-disabled", String(unanswered));
    btn.style.opacity = unanswered ? ".45" : "";
  } else if (wodSubTab === "log") {
    // The label is a long-lived node and must not keep advertising another
    // screen's action just because the bar happens to be hidden right now -
    // the audit caught אימונים › רישום showing a CTA reading "רישום סט".
    btn.dataset.action = "open-wod-picker";
    label.textContent = "בחירת אימון";
    btn.disabled = false;
    btn.setAttribute("aria-disabled", "false");
    btn.style.opacity = "";
  }
}

// Design spec §3.6's last bullet: "סוג ניקוד: For Time" -> "איך מודדים: זמן"
// with a .term-sub gloss. Same treatment, and for the same reason, as the
// Rx/Scaled toggle three rows below it - a stat card that answers "how is
// this workout scored?" in an English term the member has never been given a
// definition for is not an answer. Hebrew leads, the English stays in
// parentheses so it remains learnable off the whiteboard at the box.
//
// The gloss strings are deliberately the SAME sentences the WOD builder's
// format chips already carry, so a member meets one explanation of AMRAP,
// not two slightly different ones. Those chips live in index.html's markup,
// so this is currently a second copy of that copy - noted for whoever owns
// that file; unifying it needs one of the two to move.
const SCORE_TYPE_LABELS = {
  time: "זמן (For Time)",
  amrap: "סבבים (AMRAP)",
  emom: "כל דקה (EMOM)",
  load: "משקל (Load)",
};
const SCORE_TYPE_GLOSS = {
  time: "כמה מהר סיימתם",
  amrap: "כמה סיבובים הספקתם",
  emom: "תרגיל חדש כל דקה",
  load: "המשקל הכי כבד שהרמתם",
};

function renderWodLogSection() {
  const w = wodById(selectedWodId);
  // UX audit: the default sub-tab of the אימונים tab used to be one grey
  // sentence with no interactive element anywhere on it except the three
  // sub-tab pills — two reviewers only escaped by guessing that "Benchmarks"
  // must be where workouts live.
  //
  // A design review diagnosed this as "one misplaced early return", the
  // open-wod-picker button below being unreachable behind it. Half right:
  // the early return is indeed the cause, but that button cannot simply move
  // above it — it dereferences the SELECTED wod (catColor(w.category),
  // w.name, w.desc, w.timeCapSeconds) and is the "change your mind"
  // affordance for a workout already chosen, so hoisting it would throw on
  // the very screen it was meant to fix. The empty state needs a door of its
  // own, which is what this is: the four-slot pattern (icon / what will be
  // here / what fills it / a real action), with the builder offered as the
  // secondary path since wodBuilder is otherwise reachable only from inside
  // the picker.
  if (!w) return `
    <div class="flex col items-center" style="padding:32px 20px; gap:10px; text-align:center;">
      <span style="display:inline-flex; width:28px; height:28px; color:var(--steel);">${ICONS.stopwatchIcon}</span>
      <h2 style="font-size:15px; font-weight:700; color:var(--chalk);">בחרו אימון ונרשום אותו</h2>
      <div style="font-size:13px; color:var(--steel);">אימונים מוכרים מהמועדון, או אימון משלכם.</div>
      <button class="exercise-select" data-action="open-wod-picker" style="width:100%; min-height:56px; margin-top:4px;">
        <span style="font-weight:800; font-size:16px;">בחירת אימון</span>
        <span class="flex items-center gap-6" style="color:var(--steel); font-size:12px; font-weight:600;">${ICONS.chevronsLeft}</span>
      </button>
      <button class="link-btn" data-action="open-wod-builder" data-name="" style="min-height:44px;">יצירת אימון משלי</button>
    </div>`;
  const best = formatWodBest(selectedWodId);
  const isToday = wodLogDate === todayISO();
  const dayWods = wodEntries.filter((e) => e.date === wodLogDate);
  const dayLabel = isToday ? "היום" : fmtDate(wodLogDate);
  const lastScaled = lastScaledAttempt(selectedWodId);
  const history = wodEntriesFor(selectedWodId).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

  let inputsHtml = "";
  if (w.scoreType === "time") {
    inputsHtml = `<div class="steppers">
      ${renderStepper("wodMinutes", "דקות", wodMinutes, 1, 0, "wod-step")}
      ${renderStepper("wodSeconds", "שניות", wodSeconds, 5, 0, "wod-step")}
    </div>`;
  } else if (w.scoreType === "amrap") {
    inputsHtml = `<div class="steppers">
      ${renderStepper("wodRounds", "סבבים", wodRounds, 1, 0, "wod-step")}
      ${renderStepper("wodReps", "+ חזרות", wodReps, 1, 0, "wod-step")}
    </div>`;
  } else if (w.scoreType === "emom") {
    // Resync to this WOD's own rotation whenever it doesn't already match —
    // covers first-ever render, switching from a differently-shaped EMOM,
    // and switching in from a non-EMOM WOD. Prefills from the WOD's own
    // target reps, same "starting point, not a blank form" idea as
    // prefill-from-last elsewhere in the app.
    if (emomStateWodId !== w.id || wodEmomReps.length !== w.emomMovements.length) {
      wodEmomReps = emomPrefill(w);
      emomStateWodId = w.id;
    }
    // A rest station gets a label and no stepper; a timed station steps in
    // seconds. Its target weight, when it has one, goes in the label.
    inputsHtml = `
    <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;">EMOM ${w.emomMinutes} — לפי תרגיל, לכל סבב</div>
    <div class="steppers">
      ${w.emomMovements.map((name, i) => {
        const type = w.emomMovementTypes?.[i] || "reps";
        const weight = w.emomTargetWeights?.[i];
        const weightSuffix = weight ? ` (${weight} ק״ג)` : "";
        if (type === "rest") return `<div class="stepper" style="opacity:.7;"><span class="stepper-label">${i + 1}. מנוחה</span></div>`;
        if (type === "duration") return renderStepper(String(i), `${i + 1}. ${name}${weightSuffix} — שניות`, wodEmomReps[i], 5, 0, "wod-emom-step");
        return renderStepper(String(i), `${i + 1}. ${name}${weightSuffix} — חזרות`, wodEmomReps[i], 1, 0, "wod-emom-step");
      }).join("")}
    </div>`;
  } else {
    inputsHtml = `<div class="steppers">
      ${renderStepper("wodWeight", "משקל (ק\"ג)", wodWeight, 2.5, 0, "wod-step")}
    </div>`;
  }

  return `
    <h2 class="sr-only">רישום תוצאת אימון</h2>
    ${editingWodEntryId ? `
    <div style="background:rgba(232,185,138,.12); border:1px solid var(--brass); border-radius:12px; padding:10px 14px; margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
      <span style="color:var(--brass); font-weight:700; font-size:13px;">עריכת אימון קיים</span>
      <button data-action="cancel-edit-wod-entry" style="color:var(--steel); font-size:12px; text-decoration:underline;">ביטול</button>
    </div>` : ""}

    <button class="exercise-select" data-action="open-wod-picker">
      <div class="flex items-center gap-8">
        <div class="dot" style="background:${esc(catColor(w.category))}"></div>
        <div>
          <span style="font-weight:800; font-size:16px;">${bidiText(w.name)}</span>
          ${w.desc ? `<div class="wod-desc">${bidiText(w.desc)}</div>` : ""}
          ${w.timeCapSeconds ? `<div class="wod-desc" style="color:var(--brass);">מגבלת זמן: ${formatClock(w.timeCapSeconds)}</div>` : ""}
        </div>
      </div>
      <span class="flex items-center gap-6" style="color:var(--steel); font-size:12px; font-weight:600;">שינוי${ICONS.chevronsLeft}</span>
    </button>


    <div class="flex items-center gap-8" style="margin-bottom:12px;">
      <input type="date" id="wodLogDateInput" value="${esc(wodLogDate)}" max="${todayISO()}" aria-label="תאריך רישום האימון" style="flex:1; min-width:0; background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:12px 14px; color:var(--chalk); font-size:14px; font-weight:700; font-family:inherit;" />
      ${wodLogDate !== todayISO() ? `<button data-action="reset-wod-log-date" class="reset-date-btn">היום</button>` : ""}
    </div>

    ${history.length > 0 ? `
    <div style="background:rgba(232,185,138,.12); border:1px solid var(--brass); border-radius:14px; padding:12px 14px; margin-bottom:16px;">
      <div style="color:var(--brass); font-weight:800; font-size:13px; margin-bottom:8px;">↺ עשית את זה ${history.length === 1 ? "פעם אחת" : `${history.length} פעמים`} בעבר — השוואה למטה</div>
      <div class="flex items-center justify-between">
        <div>
          <div class="stat-label">שיא</div>
          <div class="mono" style="color:var(--brass); font-weight:800; font-size:16px;">${bidiUnit(best)}</div>
        </div>
        <div style="text-align:left;">
          <div class="stat-label">אחרון (${fmtDate(history[0].date)})</div>
          <div class="mono" style="font-weight:700; font-size:16px;">${bidiUnit(formatWodEntry(history[0]) + wodEffortTag(history[0].rx))}</div>
        </div>
      </div>
    </div>` : `
    <div class="stat-row">
      <div class="stat-card"><div class="stat-label">שיא</div><div class="stat-value mono" style="color:var(--brass);">${best}</div></div>
      <div class="stat-card"><div class="stat-label">איך מודדים</div><div class="stat-value" style="font-size:14px;">${esc(SCORE_TYPE_LABELS[w.scoreType] || "")}<span class="term-sub">${esc(SCORE_TYPE_GLOSS[w.scoreType] || "")}</span></div></div>
    </div>`}

    ${(() => {
      const recent = recentWodEntriesFor(selectedWodId);
      if (recent.length === 0) return "";
      return `
      <div style="margin-bottom:16px;">
        <div style="color:var(--steel); font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px;">ב-14 הימים האחרונים</div>
        <div class="flex wrap gap-8">
          ${recent.map((e) => `<span class="mono" style="background:var(--surface2); border-radius:10px; padding:6px 10px; font-size:12.5px; font-weight:700; color:var(--steel);">${bidiUnitHtml(`${esc(fmtDate(e.date))}: <span style="color:var(--chalk);">${esc(formatWodEntry(e))}</span>${esc(wodEffortTag(e.rx))}`)}</span>`).join("")}
        </div>
      </div>`;
    })()}

    <div id="wodFlashBox" class="flex items-center justify-center" style="display:none; gap:6px; color:#fff; font-weight:800; font-size:14px; background-image:var(--stripe); border-radius:14px; padding:10px 0; margin-bottom:16px; text-shadow:0 1px 3px rgba(0,0,0,.5);">${ICONS.flame}<span data-wod-flash-label>שיא חדש!</span></div>

    <!-- Design spec §3.6. Hebrew-first with the English kept in parentheses,
         so Rx and Scaled stay LEARNABLE rather than disappearing - the member
         will meet both words on the whiteboard at the box, and an app that
         hides them leaves her unable to read it. The .term-sub gloss under
         each is tier-1 permanent disclosure: it is the answer to "which one
         was I?", which is the actual question, and it never has to be tapped
         for. The heading asks the question in words instead of leaving two
         bare nouns to be interpreted.
         .rx-toggle.unset draws the dashed "nothing chosen yet" frame - an
         unmade choice must not look like a made one, which is precisely how
         the old pre-selected Rx read. All of this CSS already shipped in
         index.html and was inert until these labels existed. -->
    <div style="color:var(--chalk); font-weight:700; font-size:13px; margin-bottom:6px;">איך ביצעתם את האימון?</div>
    <div class="rx-toggle ${wodRx === null ? "unset" : ""}" role="radiogroup" aria-label="איך ביצעתם את האימון">
      <button class="rx-btn ${wodRx === true ? "active-rx" : ""}" data-action="set-rx" data-rx="1" role="radio" aria-checked="${wodRx === true}">מלא (Rx)<span class="term-sub">בדיוק כפי שנכתב</span></button>
      <button class="rx-btn ${wodRx === false ? "active-scaled" : ""}" data-action="set-rx" data-rx="0" role="radio" aria-checked="${wodRx === false}">מותאם (Scaled)<span class="term-sub">במשקלים שמתאימים לי</span></button>
      <button class="rx-btn ${wodRx === WOD_EFFORT_PLUS ? "active-plus" : ""}" data-action="set-rx" data-rx="plus" role="radio" aria-checked="${wodRx === WOD_EFFORT_PLUS}">מוגבר (Rx+)<span class="term-sub">כבד מהמוגדר</span></button>
    </div>
    ${wodRx === null ? `<div class="footer-note" role="status" style="color:var(--brass); margin-top:-10px; margin-bottom:16px;">בחרו איך ביצעתם את האימון</div>` : ""}

    <input id="wodPartnerTagInput" class="text-input" dir="auto" maxlength="${LIMITS.partnerTag}" style="margin-bottom:16px;" placeholder="עם פרטנר? (אופציונלי, לדוגמה עם דנה)" aria-label="שם הפרטנר (אופציונלי)" value="${esc(wodPartnerTag)}" />

    ${wodRx === false ? `
    <div class="steppers" style="margin-bottom:16px;">
      ${renderStepper("wodScaledWeight", "משקל מותאם (ק\"ג)", wodScaledWeight, 2.5, 0, "wod-step")}
    </div>
    <input id="wodNotesInput" class="text-input" dir="auto" style="margin-bottom:8px;" placeholder="שינוי בתרגיל? (אופציונלי, לדוגמה מתח עם רצועה)" aria-label="שינוי בתרגיל (אופציונלי)" value="${esc(wodNotes)}" />
    <div class="flex items-center justify-between" style="margin-bottom:16px;">
      ${lastScaled ? `<button data-action="copy-last-scaled" style="color:var(--steel); font-size:12px; text-align:right;">↺ בפעם הקודמת: ${lastScaled.notes ? bidiText(lastScaled.notes) + " — " : ""}${formatWodEntry(lastScaled)}</button>` : `<span style="color:var(--steel); font-size:12px;">פעם ראשונה שמתאימים את זה</span>`}
    </div>` : ""}

    ${inputsHtml}

    ${dayWods.length === 0 ? `
    <div class="empty">${isToday ? "עדיין לא נרשמו אימונים היום." : `עדיין לא נרשמו אימונים ב-${esc(dayLabel)}.`}</div>` : `
    <button class="exercise-row" data-action="view-log-wod-date-calendar" style="margin-bottom:0;">
      <div class="flex items-center gap-8">
        ${dayWods[0].isPR ? ICONS.flame : ""}
        <div style="text-align:right;">
          <div style="font-weight:700; font-size:13px;">אחרון: ${bidiText(wodById(dayWods[0].wodId) ? wodById(dayWods[0].wodId).name : "?")} — ${formatWodEntry(dayWods[0])} (${wodEffortLabel(dayWods[0].rx)})</div>
          <div style="color:var(--steel); font-size:11px;">${dayWods.length} אימון${dayWods.length === 1 ? "" : "ים"} נרשמו ${isToday ? "היום" : `ב-${esc(dayLabel)}`}</div>
        </div>
      </div>
      <span class="flex items-center gap-6" style="color:var(--steel); font-size:12px; font-weight:600;">צפייה ביום${ICONS.chevronsLeft}</span>
    </button>`}
  `;
}

function renderWodDetailCard(w) {
  const list = wodEntriesFor(w.id);
  if (list.length === 0) return "";
  // EMOM has no single comparable score (see bestWodScore/scoreValue) — a
  // PR-trend chart would either be misleadingly flat or falsely mark every
  // attempt as a "PR". Skip the chart for it; the per-attempt list below
  // (with formatWodEntry's per-movement reps) is the useful part.
  const isEmom = w.scoreType === "emom";
  let chartHtml = "";
  if (!isEmom) {
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    // Live bug hunt (2026-09-11): two fixes so this chart's PR dots can never
    // disagree with the real per-entry isPR flag in the attempt list right
    // below it again:
    //  1. STRICT comparison, not inclusive - an exact tie is not a second PR
    //     (matches saveWod()'s own < / > check on the stored flag).
    //  2. Rx and Scaled tracked as separate running bests, matching
    //     bestWodScore()'s own rx-aware fix - a Scaled attempt no longer
    //     "beats" an earlier Rx one just because they share a scoreType.
    //
    // RX+ (2026-09-19) is the twin of that second fix, and the reason this is
    // a Map keyed on the effort rather than the two named variables it used to
    // be: bestWodScore() buckets by strict equality on e.rx, so with a third
    // value the old `e.rx ? rxBucket : scaledBucket` would have filed Rx+ with
    // Rx here while the stored isPR flag put it on its own - the chart dots
    // disagreeing with the attempt list underneath them, which is exactly what
    // fix 1 and 2 were for. One bucket per distinct answer, from the data.
    const lower = scoreLowerIsBetter(w.scoreType);
    const worstPossible = lower ? Infinity : -Infinity;
    const bestSoFar = new Map();
    const chartData = sorted.map((e) => {
      const val = scoreValue(e);
      const bucket = String(e.rx);
      const prevBest = bestSoFar.has(bucket) ? bestSoFar.get(bucket) : worstPossible;
      const isPR = lower ? val < prevBest : val > prevBest;
      bestSoFar.set(bucket, lower ? Math.min(prevBest, val) : Math.max(prevBest, val));
      return { dateLabel: fmtDate(e.date), est1RM: val, isPR };
    });
    chartHtml = renderChart(chartData);
  }
  const recent = list.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
  return `
    <div class="chart-card" style="margin-top:-4px; border-top-left-radius:0; border-top-right-radius:0; border-top:none;">
      <div class="flex items-center justify-between" style="margin-bottom:12px;">
        <span style="font-weight:800; font-size:15px;">${bidiText(w.name)}</span>
        ${isEmom ? "" : `<span class="mono" style="color:var(--brass); font-weight:700; font-size:13px;">${bidiUnit(`שיא: ${formatWodBest(w.id)}`)}</span>`}
      </div>
      ${chartHtml}
      <div class="log-list" style="margin-top:12px;">
        ${recent.map((e) => `
          <div class="log-row" style="${e.notes ? "flex-direction:column; align-items:stretch; gap:4px;" : ""}">
            <div class="flex items-center justify-between" style="width:100%;">
              <div class="flex items-center gap-8">
                ${e.isPR ? ICONS.flame : ""}
                <span style="color:var(--steel); font-size:12px;">${fmtDate(e.date)}</span>
                <span style="color:var(--steel); font-size:11px;">${wodEffortLabel(e.rx)}${e.partnerTag ? ` · ${bidiText(e.partnerTag)}` : ""}</span>
              </div>
              <span class="flex items-center gap-6">
                <span class="mono" style="font-size:13px;">${bidiUnit(formatWodEntry(e))}</span>
              </span>
            </div>
            ${e.notes ? `<div style="color:var(--steel); font-size:12px;">${bidiText(e.notes)}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

function renderWodHistoryListArea() {
  const area = document.getElementById("wodHistoryListArea");
  if (!area) return;
  const q = wodHistorySearch.trim().toLowerCase();
  const active = activeWods().filter((w) => w.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (activeWods().length === 0) {
    // This is the WOD tab's היסטוריה sub-tab with nothing in it, and the line
    // it used to carry - "רשמו אימון כדי להתחיל לראות התקדמות" - was written
    // for the PROGRESS screen and pasted here. It described a different
    // screen's job: history is not a trend, it is the record of what you did
    // and the best you have done at each one. Says what WILL be here instead,
    // which is also the honest answer to "why is this empty".
    //
    // Its twin on the progress tab (renderHistoryListArea, "רשמו סט כדי
    // להתחיל לראות התקדמות") is deliberately NOT changed: that screen really
    // is about progress, and there the sentence is correct.
    area.innerHTML = `<div class="flex col items-center" style="padding:40px 0; gap:8px;">${ICONS.dumbbell}<span style="color:var(--steel); font-size:13px;">עוד לא נרשם כאן אימון — כל אימון שתרשמו יופיע כאן עם השיא שלכם בו</span></div>`;
    return;
  }
  if (active.length === 0) {
    const noneHtml = `<div style="color:var(--steel); text-align:center; padding:20px 0; font-size:13px;">לא נמצא אימון התואם ל-"${bidiText(wodHistorySearch)}"</div>
      <button class="link-btn link-btn--tap" data-action="clear-wod-history-search" style="display:block; margin:0 auto;">ניקוי החיפוש</button>`;
    area.innerHTML = noneHtml;
    return;
  }
  area.innerHTML = active.map((w) => {
    const row = `
      <button class="exercise-row ${wodHistoryId === w.id ? "active" : ""}" data-action="select-wod-history" data-id="${esc(w.id)}" style="${wodHistoryId === w.id ? "margin-bottom:0; border-bottom-left-radius:0; border-bottom-right-radius:0;" : ""}">
        <div class="flex items-center gap-8">
          <span style="display:inline-flex; transition:transform .2s; transform:rotate(${wodHistoryId === w.id ? "90deg" : "180deg"});">${ICONS.chevron}</span>
          <div class="dot" style="background:${esc(catColor(w.category))}"></div>
          <span style="font-weight:700; font-size:14px;">${bidiText(w.name)}</span>
        </div>
        <span class="mono" style="color:var(--brass); font-weight:700; font-size:14px;">${bidiUnit(formatWodBest(w.id))}</span>
      </button>`;
    const detail = wodHistoryId === w.id ? renderWodDetailCard(w) + `<div style="height:8px;"></div>` : "";
    return row + detail;
  }).join("");
}

function renderWodHistorySection() {
  return `
    ${activeWods().length > 0 ? `
    <h2 class="section-label">שיאים כלל-זמנים</h2>
    <div class="search-box" style="margin:0 0 12px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--steel)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="wodHistorySearch" dir="auto" placeholder="חיפוש באימונים שלך" aria-label="חיפוש באימונים שלך" value="${esc(wodHistorySearch)}" />
    </div>` : `<h2 class="sr-only">שיאים כלל-זמנים</h2>`}
    <div id="wodHistoryListArea" role="region" aria-label="שיאים כלל-זמנים"></div>
  `;
}

// The drill-in marker below is U+203A ">", not U+2039 "<": both are
// Bidi_Mirrored, so inside this RTL page the engine draws each one flipped.
// Authoring ">" is what actually paints the left-pointing chevron every
// other drill-in row in the app shows (ICONS.chevronsLeft, and the settings
// navrow's scaleX(-1) chevron) - "forward" is leftward here, same rule the
// calendar's cal-next arrow follows.
// Grouped by Girls/Heroes (the only two categories WOD_LIBRARY actually
// uses) with the same .cat-group/.cat-head pattern the exercise/strength
// pickers already use, instead of one flat undifferentiated list. Hebrew
// labels are local to the WOD library, not catLabel()'s CATEGORY_LABELS
// table - that table is scoped to strength MOVEMENT categories
// (Squat/Deadlift/…) and mixing WOD-library categories into it would blur two
// different classification systems that happen to share the word "category".
//
// ONE TABLE, BOTH SCREENS, which is the part that was missing. Reported from
// a real phone: "the same benchmark category is called בנות in the library
// and GIRLS in the workout picker". Both are right about their own screen and
// the app was wrong overall - the catalogue read this table and the picker
// read catLabel(), where Girls/Heroes are identity entries, so one group had
// two names three taps apart.
//
// The fix is to give the picker this table too (wodCatLabel below), NOT to
// put Hebrew into CATEGORY_LABELS. test/community-term-disclosure.test.mjs
// pins that map as an identity map on an explicit product decision - "Back
// Squat" and "Fran" are what the coach says on the floor, and translating
// the movement vocabulary would put the picker, the progress panel, the
// calendar and the achievement headers into a different language from the
// whiteboard. A benchmark GROUP heading is not movement vocabulary; the six
// movement categories are, and they are untouched.
const WOD_LIBRARY_CATEGORY_LABELS = { Girls: "בנות", Heroes: "גיבורים" };
// The WOD picker also lists Club and Custom, which are not benchmark groups
// and have no Hebrew name of their own - they fall through to catLabel(), so
// this is the library's table where it has an answer and the shared one
// everywhere else.
function wodCatLabel(cat) {
  return Object.prototype.hasOwnProperty.call(WOD_LIBRARY_CATEGORY_LABELS, cat)
    ? WOD_LIBRARY_CATEGORY_LABELS[cat]
    : catLabel(cat);
}
function renderWodBenchmarksSection() {
  const groups = Object.entries(
    WOD_LIBRARY.reduce((acc, w) => { (acc[w.category] = acc[w.category] || []).push(w); return acc; }, {})
  );
  return groups.map(([cat, list]) => `
    <div class="cat-group">
      <div class="cat-head"><h2 class="cat-name">${esc(wodCatLabel(cat))}</h2></div>
      ${list.map((w) => `<button class="movement-btn" data-action="select-benchmark" data-id="${esc(w.id)}">
        <div><span style="font-weight:700;">${bidiText(w.name)}</span>${w.desc ? `<div class="wod-desc">${bidiText(w.desc)}</div>` : ""}</div>
        <span aria-hidden="true">›</span>
      </button>`).join("")}
    </div>`).join("");
}

function renderWodTab() {
  return `
    <section class="scene-page ${PAGE_SCENES.wod.className}" aria-labelledby="pageTitle-wod">
      <div class="scene-page__media" aria-hidden="true"></div>
      <div class="scene-page__scrim" aria-hidden="true"></div>
      <div class="scene-page__intro">
        <h1 id="pageTitle-wod" class="scene-page__title">ספריית אימונים</h1>
      </div>
      <div class="scene-sheet">
    <div class="stripe-ribbon" aria-hidden="true"></div>
    ${!storageOK ? `<div class="footer-note" style="color:var(--red-text); background:rgba(216,69,60,.1); border:1px solid var(--red); border-radius:12px; padding:10px 14px; margin-bottom:12px;" role="alert">${esc(storageErrMsg)}</div>` : ""}
    <div class="subtabbar" role="tablist" aria-label="תצוגת ספריית האימונים">
      <button class="subtabbtn ${wodSubTab === "log" ? "active" : ""}" id="wodSubtab-log" data-action="switch-wod-subtab" data-subtab="log" role="tab" aria-selected="${wodSubTab === "log"}" aria-controls="wodContent" tabindex="${wodSubTab === "log" ? "0" : "-1"}">רישום</button>
      <button class="subtabbtn ${wodSubTab === "history" ? "active" : ""}" id="wodSubtab-history" data-action="switch-wod-subtab" data-subtab="history" role="tab" aria-selected="${wodSubTab === "history"}" aria-controls="wodContent" tabindex="${wodSubTab === "history" ? "0" : "-1"}">היסטוריה</button>
      <button class="subtabbtn ${wodSubTab === "benchmarks" ? "active" : ""}" id="wodSubtab-benchmarks" data-action="switch-wod-subtab" data-subtab="benchmarks" role="tab" aria-selected="${wodSubTab === "benchmarks"}" aria-controls="wodContent" tabindex="${wodSubTab === "benchmarks" ? "0" : "-1"}">קטלוג</button>
    </div>
    <div id="wodContent" role="tabpanel" aria-labelledby="wodSubtab-${wodSubTab}"></div>
      </div>
    </section>
  `;
}

function renderWodContent() {
  const el = document.getElementById("wodContent");
  if (!el) return;
  el.innerHTML = wodSubTab === "log" ? renderWodLogSection() : wodSubTab === "benchmarks" ? renderWodBenchmarksSection() : renderWodHistorySection();
  if (wodSubTab === "log") {
    const notesInput = document.getElementById("wodNotesInput");
    if (notesInput) notesInput.addEventListener("input", (e) => { wodNotes = cleanStr(e.target.value, LIMITS.notesLen); });
    const partnerInput = document.getElementById("wodPartnerTagInput");
    if (partnerInput) partnerInput.addEventListener("input", (e) => { wodPartnerTag = cleanStr(e.target.value, LIMITS.partnerTag); });
    const dateInput = document.getElementById("wodLogDateInput");
    if (dateInput) dateInput.addEventListener("change", (e) => {
      wodLogDate = clampLogDate(e.target.value);
      wodLogDateExplicitlyChosen = true;
      renderWodContent();
    });
  }
  if (wodSubTab === "history") {
    renderWodHistoryListArea();
    const search = document.getElementById("wodHistorySearch");
    if (search) search.addEventListener("input", (e) => { wodHistorySearch = cleanStr(e.target.value, LIMITS.nameLen); renderWodHistoryListArea(); });
  }
}

// ---------- Picker ----------
let pickerOpen = false;
// "primary" (the normal case — picking selectedId) or "partner" (picking
// the second exercise of an active superset — see setLadderPartner).
let pickerTarget = "primary";
function syncPickerViewport() {
  const overlay = document.getElementById("pickerOverlay");
  if (!overlay) return;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  overlay.style.height = vh + "px";
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => { if (pickerOpen) syncPickerViewport(); });
}
let pickerOpenerEl = null;
function openPicker(target) {
  pickerOpen = true;
  pickerOpenerEl = document.activeElement;
  pickerTarget = target === "partner" ? "partner" : "primary";
  document.body.style.overflow = "hidden";
  syncPickerViewport();
  document.getElementById("pickerOverlay").classList.add("open");
  const search = document.getElementById("pickerSearch");
  search.value = "";
  renderPickerList("");
  setTimeout(() => search.focus(), 50);
}
// Routes a picked movement id to the right place depending on pickerTarget:
// the normal exercise selection, or the active ladder's superset partner.
function choosePickedMovement(id) {
  if (pickerTarget === "partner") { setLadderPartner(id); return; }
  if (id !== selectedId) endEntryEditIfActive();
  selectedId = id;
  movementExplicitlyChosen = true; // COMM-360
  syncLogEntryTypeToSelection();
  endLadder();
}

// The log form's starting values for an EMOM: each station's own target -
// seconds for a timed station, reps otherwise, 0 for rest. Shared by the
// picker and the render-time resync so the two cannot disagree.
function emomPrefill(w) {
  return w.emomMovements.map((_, i) => (w.emomMovementTypes?.[i] === "duration" ? w.emomTargetDurations?.[i] : w.emomTargetReps?.[i]) || 0);
}
function choosePickedWod(id) {
  const next = wodById(id);
  if (!next) return;
  if (id !== selectedWodId) {
    endWodEditIfActive();
    wodNotes = "";
    wodEmomReps = next.scoreType === "emom" ? emomPrefill(next) : [];
    emomStateWodId = next.scoreType === "emom" ? next.id : null;
  }
  selectedWodId = id;
}
function closePicker() {
  pickerOpen = false;
  document.body.style.overflow = "";
  document.getElementById("pickerOverlay").classList.remove("open");
  if (pickerOpenerEl && typeof pickerOpenerEl.focus === "function") pickerOpenerEl.focus();
  pickerOpenerEl = null;
}

// ---- Shared Escape + Tab-trap for app.js's own full-page overlays ----
// COMM-328. Originally only the nav menu and Settings were wired into this
// (see history) - the other 8 dialogs (picker, WOD picker/builder,
// celebration, achievements, notifications, onboarding, welcome) had only a
// hand-copied backdrop-click guard each, no Escape-to-close or focus
// trapping. All 8 are registered below, alongside navMenu/settings.
// escapable defaults true; onboarding/welcome opt out (def.escapable =
// false) since they're a first-run flow meant to be stepped through
// deliberately, not dismissed by an accidental Escape - they still get the
// Tab trap and focus restore, just not the close-on-Escape behavior.
const APP_DIALOGS = {};
function registerAppDialog(key, def) { APP_DIALOGS[key] = Object.assign({ escapable: true }, def); }
function currentAppDialog() {
  for (const key in APP_DIALOGS) { if (APP_DIALOGS[key].isOpen()) return APP_DIALOGS[key]; }
  return null;
}
// RELEASE THE BACKGROUND SCROLL LOCK ONLY WHEN THE LAST DIALOG CLOSES.
//
// Live bug hunt, fresh round 5 (2026-09-15). Every dialog's open routine sets
// body.style.overflow = "hidden" and every close routine cleared it
// unconditionally - which is correct for one dialog and wrong the moment one
// is opened from inside another. Support opens from a row INSIDE the still
// open Settings sheet; closing Support unlocked the page while Settings was
// still on screen, and the background then scrolled behind it. The same holds
// for any confirm raised from inside another dialog.
//
// This is the same shape as round 4's focus bug - a nested close that only
// handled the "everything is closed now" case - found in a different shared
// resource. That fix was scoped to focus in the community layer; this is the
// app layer's scroll lock, and it was never revisited.
//
// Called AFTER the closing dialog's own isOpen() has already gone false, so
// it asks a simple question: is anything still open?
function releaseScrollLockIfLastDialog() {
  if (currentAppDialog()) return;
  document.body.style.overflow = "";
}
function appDialogFocusables(overlayId) {
  const el = document.getElementById(overlayId);
  if (!el) return [];
  // a[href], not the bare [href] this used to be - a non-interactive
  // <use href="#glyphN"> (the achievements panel's medal SVGs) matches a
  // bare [href] selector too, which would have put a decorative SVG
  // fragment reference into the Tab trap.
  return Array.from(el.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((n) => !n.disabled && n.getClientRects().length > 0);
}
function focusFirstAppDialogEl(overlayId) {
  const f = appDialogFocusables(overlayId);
  if (f.length) f[0].focus();
}
document.addEventListener("keydown", (e) => {
  const dlg = currentAppDialog();
  if (!dlg) return;
  // Live bug hunt (2026-09-11): flushDeferredCelebration() was only wired
  // into closeOnboarding() and the tail of the generic click handler below -
  // closing a dialog via Escape left a celebration deferred behind it stuck
  // until some unrelated later click happened to flush it, popping up
  // completely disconnected from the moment it was actually earned.
  if (e.key === "Escape") { if (dlg.escapable) { e.preventDefault(); dlg.close(); flushDeferredCelebration(); } return; }
  if (e.key !== "Tab") return;
  const focusables = appDialogFocusables(dlg.overlayId);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
// Registered FIRST, ahead of every other dialog below: currentAppDialog()
// returns the first open entry in insertion order, and askAppConfirm() is
// always a modal-on-modal - it can fire while the WOD picker or Settings is
// still up. Escape has to close the confirm, not the thing underneath it.
registerAppDialog("appConfirm", { overlayId: "appConfirmOverlay", isOpen: () => !!appConfirmDialog, close: closeAppConfirm });
// Second, and for the same reason: support is opened FROM the Settings sheet
// and sits on top of it, so while it is up BOTH are open. currentAppDialog()
// returns the first open entry in insertion order, so registering support
// after "settings" below would make Escape and the phone's back button close
// the sheet underneath and leave the visible one - which is the exact defect
// openAchievements()'s own comment above describes, reached a second way.
registerAppDialog("support", { overlayId: "supportOverlay", isOpen: () => document.getElementById("supportOverlay").classList.contains("open"), close: closeSupport });

// COMM-358. Every role="tablist" group in this app (the fixed bottom tab
// bar, WOD's Rx/Scaled-style subtabbar, Community's feed-scope filter)
// already pairs role="tab" with aria-selected - that markup sets an
// assistive-tech user's expectation of Arrow/Home/End navigation with only
// the selected tab as a Tab stop, which nothing implemented before this.
// One shared, generic handler rather than one per widget: it only cares
// that the focused element is role="tab" inside a role="tablist", never
// which feature rendered it, so a future tablist gets this for free by
// following the same two roles + tabindex convention documented below.
// Automatic activation (moving focus also switches the tab) matches how
// every tab here already switches on click, not on a separate confirm step.
function tablistTabs(tablist) {
  // Unlike a dialog's focus trap, a tablist here never mixes visible and
  // hidden tabs in the same DOM query - every rendered [role="tab"] in a
  // given tablist is on-screen whenever the tablist itself is, so this
  // only needs to skip a parked/disabled one (the feed scope filter's
  // "coming soon" chip carries no role="tab" at all, but stay defensive).
  return Array.from(tablist.querySelectorAll('[role="tab"]')).filter((t) => !t.disabled);
}
document.addEventListener("keydown", (e) => {
  const tab = e.target.closest && e.target.closest('[role="tab"]');
  if (!tab) return;
  const tablist = tab.closest('[role="tablist"]');
  if (!tablist) return;
  const tabs = tablistTabs(tablist);
  const i = tabs.indexOf(tab);
  if (i === -1) return;
  // Right/Left follow the visual direction (swapped under RTL, this app's
  // only direction - checked via the dir attribute directly, since jsdom's
  // getComputedStyle doesn't resolve an inherited `direction` the way a
  // real browser does); Up/Down and Home/End are direction-agnostic.
  const rtl = (tablist.closest("[dir]") || document.documentElement).dir === "rtl";
  let next;
  if (e.key === "ArrowRight") next = tabs[i + (rtl ? -1 : 1)];
  else if (e.key === "ArrowLeft") next = tabs[i + (rtl ? 1 : -1)];
  else if (e.key === "ArrowDown") next = tabs[i + 1];
  else if (e.key === "ArrowUp") next = tabs[i - 1];
  else if (e.key === "Home") next = tabs[0];
  else if (e.key === "End") next = tabs[tabs.length - 1];
  else return;
  e.preventDefault();
  if (!next || next === tab) return;
  next.click();
  // The click above may fully re-render the tablist's own container
  // (bottomTabBar/communityFeedFilters do; the WOD subtabbar mutates its
  // existing buttons in place) - re-find "the now-selected tab" inside the
  // same container by id rather than trusting `next` is still the live
  // node, then focus it. render()/rerender() here are synchronous, so the
  // new markup already exists by the time this runs.
  const container = tablist.id ? document.getElementById(tablist.id) : tablist;
  const selected = container && container.querySelector('[role="tab"][aria-selected="true"]');
  if (selected) selected.focus();
});

let navMenuOpen = false;
let navMenuOpenerEl = null;
function openNavMenu() {
  navMenuOpen = true;
  navMenuOpenerEl = document.activeElement;
  document.body.style.overflow = "hidden";
  document.getElementById("navMenuOverlay").classList.add("open");
  setTimeout(() => focusFirstAppDialogEl("navMenuOverlay"), 50);
}
function closeNavMenu() {
  if (!navMenuOpen) return;
  navMenuOpen = false;
  document.body.style.overflow = "";
  const overlay = document.getElementById("navMenuOverlay");
  if (overlay) overlay.classList.remove("open");
  if (navMenuOpenerEl && typeof navMenuOpenerEl.focus === "function") navMenuOpenerEl.focus();
  navMenuOpenerEl = null;
}
registerAppDialog("navMenu", { overlayId: "navMenuOverlay", isOpen: () => navMenuOpen, close: closeNavMenu });

let settingsOpen = false;
let settingsOpenerEl = null;
// #settingsBody is repopulated on EVERY render() regardless of whether this
// overlay is open (see renderSettingsBody and closeSettings for why that is
// deliberate). The cost of that is a real defect: from the moment any
// anonymous backup session exists, cloud.js's backupCredentials form sits in
// the document permanently, and its `input[name="username"]
// autocomplete="username"` collides with the identical field on the
// Community login screen. Two same-named credential fields in one document
// is how a password manager fills the wrong one.
//
// `inert` is the fix, rather than skipping the render: it takes the whole
// closed overlay out of the accessibility tree, out of the tab order and out
// of hit-testing in one attribute, without changing when the body is built -
// several checks legitimately read #settingsBody while the sheet is closed
// (the storage-quota error surfaces there, for one), and they should keep
// being able to.
function setSettingsInert(inert) {
  const overlay = document.getElementById("settingsOverlay");
  if (!overlay) return;
  if (inert) overlay.setAttribute("inert", "");
  else overlay.removeAttribute("inert");
}
// Same fix, same root cause as openAchievements() just above: Settings is
// also reached from a row inside the nav menu, and nothing closed the menu
// underneath it either.
function openSettings() {
  closeNavMenu();
  settingsOpen = true;
  settingsOpenerEl = document.activeElement;
  document.body.style.overflow = "hidden";
  // Before .open and before the focus call below: focus cannot land inside
  // an inert subtree, so lifting it has to happen first.
  setSettingsInert(false);
  document.getElementById("settingsOverlay").classList.add("open");
  setTimeout(() => focusFirstAppDialogEl("settingsOverlay"), 50);
}
function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  // COMM-339: reset the armed "delete everything" confirm on close, not just
  // on an explicit cancel/confirm inside clearAllData() - otherwise a user
  // who backs out by closing the sheet sees it still armed on reopen, one
  // tap from a wipe with no fresh warning. render() so #settingsBody (kept
  // current on every render() regardless of open state, see renderSettingsBody())
  // actually reflects the reset before the next open, the same reason
  // ask-clear/cancel-clear call render() themselves.
  confirmClear = false;
  render();
  document.body.style.overflow = "";
  const overlay = document.getElementById("settingsOverlay");
  if (overlay) overlay.classList.remove("open");
  if (settingsOpenerEl && typeof settingsOpenerEl.focus === "function") settingsOpenerEl.focus();
  settingsOpenerEl = null;
  // AFTER focus has been returned to the opener: setting inert while focus is
  // still inside the subtree would blur it to <body> and lose the member's
  // place on the screen behind.
  setSettingsInert(true);
}
registerAppDialog("settings", { overlayId: "settingsOverlay", isOpen: () => settingsOpen, close: closeSettings });
// COMM-328. The remaining 8 dialogs (picker/wodPicker/wodBuilder use their
// own boolean state var, already tracked for other reasons; the other 5
// have no boolean of their own, so isOpen reads the overlay's own "open"
// class - the same source of truth their existing open()/close() pair
// already used). onboarding and welcome opt out of Escape-to-close: both
// are a first-run flow meant to be stepped through deliberately, not
// dismissed by an accidental Escape - they still get the Tab trap and
// focus restore, just not the close-on-Escape behavior.
registerAppDialog("picker", { overlayId: "pickerOverlay", isOpen: () => pickerOpen, close: closePicker });
registerAppDialog("wodPicker", { overlayId: "wodPickerOverlay", isOpen: () => wodPickerOpen, close: closeWodPicker });
registerAppDialog("wodBuilder", { overlayId: "wodBuilderOverlay", isOpen: () => wodBuilderOpen, close: closeWodBuilder });
registerAppDialog("achievements", { overlayId: "achievementsOverlay", isOpen: () => document.getElementById("achievementsOverlay").classList.contains("open"), close: closeAchievements });
registerAppDialog("celebration", { overlayId: "celebrationOverlay", isOpen: () => document.getElementById("celebrationOverlay").classList.contains("open"), close: closeCelebration });
registerAppDialog("notifications", { overlayId: "notificationsOverlay", isOpen: () => document.getElementById("notificationsOverlay").classList.contains("open"), close: closeNotifications });
registerAppDialog("onboarding", { overlayId: "onboardingOverlay", isOpen: () => document.getElementById("onboardingOverlay").classList.contains("open"), close: closeOnboarding, escapable: false });
registerAppDialog("welcome", { overlayId: "welcomeOverlay", isOpen: () => document.getElementById("welcomeOverlay").classList.contains("open"), close: closeWelcomeModal, escapable: false });

// Real-user report: on a phone, with an app dialog open (achievements was
// the one caught, but the gap is every dialog registered above), the
// Android back gesture/button did nothing - there is no Escape key on a
// phone, and this app never pushed a history entry for a dialog opening,
// so "back" had no state of its own to consume. Depending on the browser
// that either does nothing or backgrounds/exits an installed PWA, which is
// exactly "had to close the app to get back out." Escape-to-close (COMM-328
// above) already does the right thing for a keyboard; this is the same
// idea for hardware/gesture back.
//
// This reservation sits ON TOP OF the un-consumable boot-time anchor near
// the top of this file (the urlNotif block) - that anchor is what keeps an
// ORDINARY screen's edge-swipe from falling through to the OS at all; this
// dialog layer is what makes back/Escape/swipe close a dialog specifically
// once it IS caught. Two different bugs, two entries, same history.
//
// A MutationObserver on each registered overlay's own `class` attribute
// (not a hook added to all dozen individual open()/close() functions)
// catches every dialog transition centrally, including the several that
// close by directly manipulating classList rather than going through render().
// history.pushState() on open reserves exactly one back-press to close the
// dialog; closing it any OTHER way (X, Escape, backdrop) consumes that same
// reserved entry via history.back() so a later real back-press is never
// left pointing at a dead state that requires two presses to get past.
let appDialogHistoryPushed = false;
let appDialogClosingViaHistory = false;
function syncAppDialogHistoryState() {
  const open = !!currentAppDialog();
  if (open && !appDialogHistoryPushed) {
    try { history.pushState({ appDialog: true }, ""); appDialogHistoryPushed = true; } catch (e) { /* history API unavailable in this embedding */ }
  } else if (!open && appDialogHistoryPushed && !appDialogClosingViaHistory) {
    appDialogHistoryPushed = false;
    try { history.back(); } catch (e) {}
  }
}
window.addEventListener("popstate", () => {
  if (!appDialogHistoryPushed) return;
  appDialogHistoryPushed = false;
  const dlg = currentAppDialog();
  if (!dlg) return;
  // browser-check audit (dialog-back-button.mjs): the Escape handler right
  // above this block already refuses to close a dialog whose def.escapable
  // is false (onboarding/welcome opted out because a first-run flow is
  // "meant to be stepped through deliberately, not dismissed by an
  // accidental Escape" - see their own registerAppDialog() comments) but
  // this handler, added afterward for the back-button gap, called dlg.close()
  // unconditionally. On a real phone that meant a hardware back-press on the
  // welcome sheet silently ran closeWelcomeModal() WITHOUT ever calling
  // saveUserName() - the member's name was simply never recorded and the
  // gate vanished, functionally worse than the bug this fix was written to
  // close. Re-arm the same reserved history entry instead, so a
  // non-escapable dialog treats back exactly like it already treats
  // Escape - the press is swallowed, not treated as "leave" or "exit the
  // app" on the NEXT press either.
  if (!dlg.escapable) {
    try { history.pushState({ appDialog: true }, ""); appDialogHistoryPushed = true; } catch (e) {}
    return;
  }
  appDialogClosingViaHistory = true; dlg.close(); appDialogClosingViaHistory = false;
  // Live bug hunt (2026-09-11): same gap as the Escape handler above, for
  // the hardware/gesture back-button path - see that comment.
  flushDeferredCelebration();
});
for (const key in APP_DIALOGS) {
  const el = document.getElementById(APP_DIALOGS[key].overlayId);
  if (el) new MutationObserver(syncAppDialogHistoryState).observe(el, { attributes: true, attributeFilter: ["class"] });
}

function renderPickerList(query) {
  const q = query.toLowerCase();
  const filtered = allMovements().filter((m) => m.name.toLowerCase().includes(q));
  const exactMatch = allMovements().some((m) => m.name.toLowerCase() === q);
  const byCategory = bag();
  filtered.forEach((m) => { (byCategory[m.category] = byCategory[m.category] || []).push(m); });
  const list = document.getElementById("pickerList");
  const addRow = query.trim() && !exactMatch
    ? `<div style="border:1px solid var(--brass); border-radius:12px; padding:10px 12px; margin-top:4px; margin-bottom:8px;">
         <div style="font-weight:700; font-size:13px; color:var(--brass); margin-bottom:8px;">הוספת "${bidiText(query.trim())}" — לאיזו קטגוריה?</div>
         <div class="flex wrap gap-8">
           ${MOVEMENT_CATEGORIES.map((cat) => `<button class="format-chip" style="flex:0 0 auto; padding:8px 14px;" data-action="add-movement" data-name="${esc(query.trim())}" data-category="${cat}">${cat}</button>`).join("")}
         </div>
       </div>`
    : `<button class="movement-btn" data-action="focus-picker-search" style="border-color:var(--brass); margin-top:4px; margin-bottom:8px;">
         <span style="font-weight:700; font-size:14px; color:var(--brass);">+ הוספת תרגיל חדש</span>
       </button>`;
  if (Object.keys(byCategory).length === 0) {
    list.innerHTML = addRow + `<div style="color:var(--steel); text-align:center; padding:16px 0; font-size:13px;">לא נמצא תרגיל</div>`;
    return;
  }
  list.innerHTML = addRow + Object.entries(byCategory).map(([cat, items]) => `
    <div class="cat-group">
      <div class="cat-head"><div class="dot" style="background:${esc(catColor(cat))}"></div><h3 class="cat-name">${esc(catLabel(cat))}</h3></div>
      ${items.map((m) => `
        <button class="movement-btn ${selectedId === m.id ? "active" : ""}" data-action="pick-movement" data-id="${esc(m.id)}">
          <span style="font-weight:600; font-size:14px;">${bidiText(m.name)}</span>
          ${selectedId === m.id ? `<div class="dot" style="background:var(--brass);"></div>` : ""}
        </button>`).join("")}
    </div>`).join("");
}

let wodPickerOpen = false;
function syncWodPickerViewport() {
  const overlay = document.getElementById("wodPickerOverlay");
  if (!overlay) return;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  overlay.style.height = vh + "px";
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => { if (wodPickerOpen) syncWodPickerViewport(); });
  window.visualViewport.addEventListener("resize", () => {
    if (wodBuilderOpen) {
      const overlay = document.getElementById("wodBuilderOverlay");
      if (overlay) overlay.style.height = window.visualViewport.height + "px";
    }
  });
}
let wodPickerOpenerEl = null;
function openWodPicker() {
  wodPickerOpen = true;
  wodPickerOpenerEl = document.activeElement;
  document.body.style.overflow = "hidden";
  syncWodPickerViewport();
  document.getElementById("wodPickerOverlay").classList.add("open");
  const search = document.getElementById("wodPickerSearch");
  search.value = "";
  renderWodPickerList("");
  setTimeout(() => search.focus(), 50);
}
function closeWodPicker() {
  wodPickerOpen = false;
  document.body.style.overflow = "";
  document.getElementById("wodPickerOverlay").classList.remove("open");
  if (wodPickerOpenerEl && typeof wodPickerOpenerEl.focus === "function") wodPickerOpenerEl.focus();
  wodPickerOpenerEl = null;
}
function renderWodPickerList(query) {
  const q = query.toLowerCase();
  // A RETIRED club WOD is still in allWods() — it has to be, or the member's
  // own logged history of it would render as an unknown workout and any
  // challenge or feed post still referencing the id would stop resolving.
  // What retirement means is that the box has stopped programming it, so it
  // leaves the picker for NEW logs. The exception is a member who has
  // actually done it: for them the row is the doorway to their own history
  // and to logging it again, so hiding it would take away data they own.
  const filtered = allWods().filter((w) =>
    w.name.toLowerCase().includes(q)
    && !(w.category === "Club" && w.retiredAt && wodEntriesFor(w.id).length === 0));
  const exactMatch = allWods().some((w) => w.name.toLowerCase() === q);
  const byCategory = bag();
  filtered.forEach((w) => { (byCategory[w.category] = byCategory[w.category] || []).push(w); });
  const list = document.getElementById("wodPickerList");
  const addRow = query.trim() && !exactMatch
    ? `<button class="movement-btn" data-action="open-wod-builder" data-name="${esc(query.trim())}" style="border-color:var(--energy); margin-top:4px;">
         <span style="font-weight:700; font-size:14px; color:var(--energy-text);">+ בניית "${bidiText(query.trim())}" כאימון חדש</span>
       </button>`
    : `<button class="movement-btn" data-action="open-wod-builder" data-name="" style="border-color:var(--energy); margin-top:4px;">
         <span style="font-weight:700; font-size:14px; color:var(--energy-text);">+ בניית אימון מותאם אישית</span>
       </button>`;
  if (Object.keys(byCategory).length === 0) {
    list.innerHTML = addRow + `<div style="color:var(--steel); text-align:center; padding:16px 0; font-size:13px;">לא נמצא אימון</div>`;
    return;
  }
  // Club sits between the benchmarks and the member's own: it is the box's
  // programming, so it outranks a private WOD but not Fran.
  const order = ["Girls", "Heroes", "Club", "Custom"];
  const cats = Object.keys(byCategory).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  list.innerHTML = addRow + `<div style="height:12px;"></div>` + cats.map((cat) => `
    <div class="cat-group">
      <div class="cat-head"><div class="dot" style="background:${esc(catColor(cat))}"></div><h3 class="cat-name">${esc(wodCatLabel(cat))}</h3></div>
      ${byCategory[cat].map((w) => `
        <div class="movement-btn ${selectedWodId === w.id ? "active" : ""}" style="padding:0; overflow:hidden;">
        <button style="flex:1; padding:12px 14px; text-align:right;" data-action="pick-wod" data-id="${esc(w.id)}">
          <div>
            <span style="font-weight:600; font-size:14px;">${bidiText(w.name)}</span>
            ${w.desc ? `<div class="wod-desc">${bidiText(w.desc)}</div>` : ""}
          </div>
          ${selectedWodId === w.id ? `<div class="dot" style="background:var(--brass);"></div>` : ""}
        </button>
        ${w.category === "Custom" && wodEntriesFor(w.id).length === 0 ? `<button data-action="delete-custom-wod" data-id="${esc(w.id)}" aria-label="מחיקת ${esc(w.name)}" style="padding:12px; color:var(--red-text);">✕</button>` : ""}
        </div>`).join("")}
    </div>`).join("");
}

// ---------- Service worker update handshake ----------
let pendingWorker = null;
// Set right before we ask a waiting worker to take over, so the
// controllerchange listener below can tell "we asked for this swap" apart
// from self.clients.claim() firing that same event on the very first
// install too (a page with no prior controller still gets one controllerchange
// the moment the first SW claims it — that's not an update, and reloading
// for it was wiping out whatever someone had just started typing, every
// single first visit).
let swapRequested = false;
// True once this tab's controller has changed for ANY reason - including a
// sibling tab applying the update and clients.claim() swapping us too. See the
// controllerchange listener: without this, a banner in the non-acting tab
// becomes a button that can never do anything.
let controllerAlreadySwapped = false;
// Live bug hunt (2026-09-11): showUpdateBanner() never cleared/marked
// pendingWorker, so the SAME visibilitychange listener that legitimately
// auto-applies an update arriving while hidden ALSO fired on the very NEXT
// visibility change after the banner was already showing - a member who
// locked and unlocked their screen once (explicitly named below as the
// common case) got the reload anyway, silently, without ever tapping the
// banner, dropping whatever they had typed but not yet saved. This flag is
// what actually makes "requires a manual tap" true: once the banner is up,
// only reload-app's own call to applyUpdate() may apply it - no future
// visibilitychange may, until a fresh offerUpdate() arrives.
let updateBannerShowing = false;
function applyUpdate() {
  const worker = pendingWorker;
  pendingWorker = null; // guard against a second trigger firing before the reload lands
  updateBannerShowing = false;
  // If the controller already changed under us - another tab tapped its own
  // banner and clients.claim() swapped this one too - there is nothing left to
  // ask for and no second controllerchange coming. Reload straight away, which
  // is the whole of what the handshake would have achieved.
  if (controllerAlreadySwapped) { location.reload(); return; }
  if (worker) {
    swapRequested = true;
    try { worker.postMessage({ type: "SKIP_WAITING" }); return; } catch (e) { swapRequested = false; }
  }
  location.reload();
}
// A new version becomes available mid-session fairly often here — the phone
// screen locks between sets, which already fires visibilitychange, so most
// updates apply the moment someone picks the phone back up, with no banner
// and no manual reopen needed. The one case that still needs the banner:
// the update lands while the page has been continuously visible (an
// uninterrupted stretch of active use) — reloading out from under someone
// mid-set would drop whatever they just typed but haven't tapped Save on
// yet, since nothing here persists until that tap.
function offerUpdate(worker) {
  pendingWorker = worker;
  if (document.visibilityState === "visible") { updateBannerShowing = true; showUpdateBanner(); }
  else applyUpdate();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && pendingWorker && !updateBannerShowing) applyUpdate();
});

// ---------- Install prompt ----------
// Chrome/Android fire beforeinstallprompt once, early, and let a page defer
// and replay it later — that's what lets us show our own banner instead of
// relying on the browser's own (often buried) install affordance. iOS Safari
// never fires this event at all, so there the banner simply never appears.
let deferredInstallPrompt = null;
const INSTALL_DISMISS_KEY = "haimunia:installDismissed";

function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}

function installDismissed() {
  // localStorage, not sessionStorage. The old key was session-scoped, so a
  // banner the member had explicitly dismissed came back on the very next
  // cold open, forever - persona finding B10. "No" now means no.
  try { return !!localStorage.getItem(INSTALL_DISMISS_KEY); } catch (e) { return false; }
}

// Design spec §1.2 S6. WHERE this banner lives was fixed in 53d6230 (out of
// position:fixed, so it can no longer cover the bottom nav or the save CTA).
// WHEN it appears is what is fixed here.
//
// It used to appear the instant Chrome fired beforeinstallprompt, which is
// during the first load - so on a brand-new profile with an empty log, on an
// otherwise near-empty screen, the largest and most colourful block in the
// app was an advertisement for itself, shown before the app had done
// anything for the member at all. Measured on a fresh profile: it was on
// screen at the logging step of the very first run, above the fold.
//
// All four conditions must hold, and each answers a real question:
//   1. the browser has actually offered an install (or iOS, handled by its
//      own separate banner) - otherwise the button would do nothing;
//   2. there is at least one saved entry - "keep this app" is not a question
//      a member can answer before the app holds anything of theirs;
//   3. today is a different calendar date from the first open - one session
//      is not enough evidence to ask someone to commit, and a member who
//      never comes back is never asked at all;
//   4. they have never dismissed it.
function installGateOpen() {
  if (isStandalone()) return false;
  if (installDismissed()) return false;
  if (totalLoggedEntries() < 1) return false;
  // An unknown first-open date means a device that predates this key, i.e.
  // an existing member - they are long past day one, so the day-two rule is
  // satisfied rather than blocked by the missing value.
  if (firstOpenDate && todayISO() === firstOpenDate) return false;
  return true;
}

// The gated entry point. Safe to call on every render: it is four cheap
// comparisons and a style write, and calling it from render() is what lets
// the banner appear on the day-two visit that qualifies rather than only at
// the moment beforeinstallprompt happens to fire (which is once, on load,
// before any of the other three conditions can possibly be true).
function maybeShowInstallBanner() {
  if (!deferredInstallPrompt) return;
  if (!installGateOpen()) return;
  showInstallBanner();
}

// Unconditional - the deliberate path, used by Settings › התקנה במסך הבית,
// where the member asked for it and the gate above is not the question.
function showInstallBanner() {
  if (isStandalone()) return;
  const updateEl = document.getElementById("updateBanner");
  if (updateEl && updateEl.style.display === "block") return;
  const el = document.getElementById("installBanner");
  if (el) el.style.display = "block";
}

function dismissInstallBanner() {
  const el = document.getElementById("installBanner");
  if (el) el.style.display = "none";
  try { localStorage.setItem(INSTALL_DISMISS_KEY, "1"); } catch (e) {}
}

async function installApp() {
  dismissInstallBanner();
  if (!deferredInstallPrompt) return;
  const evt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    evt.prompt();
    await evt.userChoice;
  } catch (e) {}
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Held, not shown. Chrome fires this once, early, during the first load -
  // which is the single worst moment to ask (see installGateOpen). Keeping
  // the event is the whole point of preventDefault() here; the banner goes
  // up on the first render that qualifies, which may be days later.
  maybeShowInstallBanner();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  dismissInstallBanner();
});

// iOS Safari never fires beforeinstallprompt, so showInstallBanner() above
// never appears there — the exact device where NOT being on the home
// screen matters most, since Safari evicts a site's IndexedDB after ~7
// days without a visit (home-screen installs get their own separate,
// much longer-lived clock instead). This is a second, independent banner
// with its own dismissal, not a variant of the Chrome/Android one, since
// there's no deferred prompt to trigger here — only instructions.
const IOS_INSTALL_DISMISS_KEY = "haimunia:iosInstallDismissed";
function isIOSDevice() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function maybeShowIOSInstallBanner() {
  if (!isIOSDevice() || isStandalone()) return;
  try { if (localStorage.getItem(IOS_INSTALL_DISMISS_KEY)) return; } catch (e) {}
  // §1.2 S6 applies here too, and more sharply. This banner's argument is
  // "install it or iOS will evict your data" — an argument that is empty on
  // day one, when there is no data to evict, and which lands on a member who
  // has not yet seen the app do anything. Same two conditions as the
  // Chrome/Android gate: something saved, and not on the first day. (The
  // held-prompt condition has no analogue here; iOS never offers one, which
  // is why this banner exists at all.)
  if (totalLoggedEntries() < 1) return;
  if (firstOpenDate && todayISO() === firstOpenDate) return;
  const el = document.getElementById("iosInstallBanner");
  if (el) el.style.display = "block";
}
function dismissIOSInstallBanner() {
  const el = document.getElementById("iosInstallBanner");
  if (el) el.style.display = "none";
  try { localStorage.setItem(IOS_INSTALL_DISMISS_KEY, "1"); } catch (e) {}
}

// ---------- Event delegation ----------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "reload-app") { applyUpdate(); }
  else if (action === "install-app") { installApp(); }
  else if (action === "dismiss-install-hint") { dismissInstallBanner(); }
  else if (action === "dismiss-ios-install-hint") { dismissIOSInstallBanner(); }
  else if (action === "switch-tab") { tab = el.dataset.tab; closeNavMenu(); render(); window.scrollTo(0, 0); }
  else if (action === "open-nav-menu") { openNavMenu(); }
  else if (action === "close-nav-menu") {
    if (el.id === "navMenuOverlay" && e.target !== el) return;
    closeNavMenu();
  }
  else if (action === "open-settings") { closeNavMenu(); openSettings(); }
  else if (action === "close-settings") {
    if (el.id === "settingsOverlay" && e.target !== el) return;
    closeSettings();
  }
  else if (action === "view-today-calendar") {
    tab = "calendar";
    const t = new Date();
    calYear = t.getFullYear();
    calMonth = t.getMonth();
    calSelectedDate = todayISO();
    render();
  }
  else if (action === "view-log-date-calendar") {
    calView = "calendar";
    tab = "calendar";
    const d = new Date(logDate + "T00:00:00");
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    calSelectedDate = logDate;
    render();
  }
  else if (action === "reset-log-date") { logDate = todayISO(); logDateExplicitlyChosen = false; endLadder(); render(); }
  else if (action === "toggle-ladder-mode") { toggleLadderMode(); }
  else if (action === "set-log-entry-type") { setLogEntryType(el.dataset.type); }
  else if (action === "ladder-switch-exercise") { switchLadderExercise(el.dataset.id); }
  else if (action === "set-ladder-block-label") { setLadderBlockLabel(el.dataset.label); }
  else if (action === "prefill-last") { prefillFromLast(); }
  else if (action === "cancel-edit-entry") { cancelEditEntry(); }
  else if (action === "edit-entry") { startEditEntry(el.dataset.id); }
  else if (action === "view-log-wod-date-calendar") {
    tab = "calendar";
    const d = new Date(wodLogDate + "T00:00:00");
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    calSelectedDate = wodLogDate;
    render();
  }
  else if (action === "reset-wod-log-date") { wodLogDate = todayISO(); wodLogDateExplicitlyChosen = false; renderWodContent(); }
  else if (action === "cancel-edit-wod-entry") { cancelEditWodEntry(); }
  else if (action === "edit-wod-entry") { startEditWodEntry(el.dataset.id); }
  else if (action === "open-picker") { openPicker(el.dataset.target); }
  else if (action === "close-picker") {
    if (el.id === "pickerOverlay" && e.target !== el) return;
    closePicker();
  }
  else if (action === "pick-movement") { choosePickedMovement(el.dataset.id); closePicker(); render(); }
  else if (action === "add-movement") { addMovement(el.dataset.name, el.dataset.category); }
  else if (action === "focus-picker-search") { document.getElementById("pickerSearch").focus(); }
  else if ((action === "step" || action === "wod-step" || action === "bw-step" || action === "builder-movement-reps" || action === "builder-movement-weight" || action === "builder-movement-duration" || action === "builder-emom-minutes" || action === "builder-time-cap" || action === "wod-emom-step" || action === "measure-step") && el.classList.contains("stepper-btn")) {
    const field = el.dataset.field, dir = +el.dataset.dir, step = +el.dataset.step, min = +el.dataset.min;
    const current = getFieldValue(action, field);
    const base = (typeof current === "number" && isFinite(current)) ? current : 0;
    const next = clampField(action, field, +(base + dir * step).toFixed(2), min);
    applyFieldValue(action, field, next);
  }
  else if (action === "save-set") { saveSet(); }
  else if (action === "set-bar-weight") { setBarWeight(+el.dataset.kg); }
  else if (action === "set-theme") { setThemePref(el.dataset.pref); }
  else if (action === "set-text-scale") { setTextScalePref(el.dataset.pref); }
  else if (action === "set-usage-counting") {
    if (window.HaimuniaUsage) window.HaimuniaUsage.setOn(el.dataset.pref === "on");
    // Swap only the row, as the text-size row does, so focus stays put.
    const row = document.getElementById("usageCountingRow");
    if (row) {
      row.outerHTML = renderUsageCountingRow();
      const chosen = document.querySelector(`#usageCountingRow [data-pref="${el.dataset.pref === "on" ? "on" : "off"}"]`);
      if (chosen) chosen.focus();
    }
  }
  else if (action === "delete-entry") { askDeleteEntry(el.dataset.id); }
  else if (action === "app-confirm-yes") { runAppConfirm(); }
  else if (action === "app-confirm-no") { closeAppConfirm(); }
  else if (action === "close-app-confirm") {
    if (el.id === "appConfirmOverlay" && e.target !== el) return;
    closeAppConfirm();
  }
  else if (action === "toast-action") { runToastAction(); }
  else if (action === "cal-prev") { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } if (calView === "list") render(); else renderCalendarGrid(); }
  else if (action === "cal-next") { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } if (calView === "list") render(); else renderCalendarGrid(); }
  else if (action === "cal-toggle-view") { calView = calView === "list" ? "calendar" : "list"; render(); }
  else if (action === "cal-select-day") { calSelectedDate = el.dataset.date; renderCalendarGrid(); }
  else if (action === "save-session-note") {
    const text = document.getElementById("sessionNoteInput");
    saveSessionNote(el.dataset.date, text ? text.value : "");
  }
  else if (action === "select-history") { historyId = historyId === el.dataset.id ? null : el.dataset.id; renderHistoryListArea(); }
  // Ported from the 2.x app, which members already use: a day on the
  // calendar hands straight to the log form set to that date, instead of
  // making them find the date picker themselves.
  else if (action === "cal-log-day") {
    logDate = clampLogDate(el.dataset.date);
    logDateExplicitlyChosen = true;
    endLadder(); // a ladder is scoped to one day
    tab = "add";
    render();
    window.scrollTo(0, 0);
  }
  // Also from 2.x: a search that matched nothing offers its own way back.
  else if (action === "clear-history-search") {
    historySearch = "";
    const box = document.getElementById("historySearch");
    if (box) { box.value = ""; box.focus(); }
    renderHistoryListArea();
  }
  else if (action === "clear-wod-history-search") {
    wodHistorySearch = "";
    const box = document.getElementById("wodHistorySearch");
    if (box) { box.value = ""; box.focus(); }
    renderWodHistoryListArea();
  }
  else if (action === "export-data") { exportData(); }
  else if (action === "upgrade-backup-download") { markEditionSeen(); exportData(); }
  else if (action === "upgrade-backup-dismiss") { markEditionSeen(); render(); }
  else if (action === "import-data") { triggerImport(); }
  else if (action === "ask-clear") { confirmClear = true; render(); }
  else if (action === "do-clear") { clearAllData(); }
  else if (action === "cancel-clear") { confirmClear = false; render(); }
  else if (action === "switch-wod-subtab") {
    wodSubTab = el.dataset.subtab;
    // The pill buttons themselves live in renderWodTab(), which only runs
    // on a full top-level tab switch — renderWodContent() alone only swaps
    // #wodContent's innerHTML, so without this the highlighted pill stayed
    // stuck on whichever subtab was active when the WOD tab was first
    // opened, even though the content underneath switched correctly.
    document.querySelectorAll(".subtabbar .subtabbtn").forEach((btn) => {
      const active = btn.dataset.subtab === wodSubTab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
      btn.setAttribute("tabindex", active ? "0" : "-1");
    });
    const wodPanel = document.getElementById("wodContent");
    if (wodPanel) wodPanel.setAttribute("aria-labelledby", "wodSubtab-" + wodSubTab);
    renderWodContent();
    // Same reasoning as the pill highlight above: the fixed bottom bar's
    // visibility/action is normally set inside the full render(), which
    // this partial update deliberately skips - sync it here too, or
    // switching away from the log sub-tab leaves a stale save-wod button
    // pinned for a WOD you're no longer even looking at.
    const w = wodSubTab === "log" ? wodById(selectedWodId) : null;
    document.getElementById("bottomBar").style.display = w ? "flex" : "none";
    syncWodSaveCta(w);
  }
  else if (action === "open-wod-picker") { openWodPicker(); }
  else if (action === "close-wod-picker") {
    if (el.id === "wodPickerOverlay" && e.target !== el) return;
    closeWodPicker();
  }
  else if (action === "pick-wod") {
    choosePickedWod(el.dataset.id);
    closeWodPicker();
    renderWodContent();
  }
  else if (action === "delete-custom-wod") { askDeleteCustomWod(el.dataset.id); }
  else if (action === "select-benchmark") {
    choosePickedWod(el.dataset.id);
    wodSubTab = "log";
    render();
  }
  else if (action === "open-wod-builder") { openWodBuilder(el.dataset.name || ""); }
  else if (action === "close-wod-builder") {
    if (el.id === "wodBuilderOverlay" && e.target !== el) return;
    closeWodBuilder();
  }
  else if (action === "builder-set-format") { setBuilderFormat(el.dataset.format); }
  else if (action === "toggle-builder-movement-rest") { toggleBuilderMovementRest(el.dataset.name); }
  else if (action === "toggle-builder-movement") { toggleBuilderMovement(el.dataset.name); }
  else if (action === "toggle-builder-movement-type") { setBuilderMovementType(el.dataset.name, el.dataset.type); }
  else if (action === "add-builder-movement-tag") {
    const name = cleanStr(el.dataset.name, LIMITS.nameLen), category = el.dataset.category;
    if (!name) return;
    if (allWodMovementTags().length >= 500) return;
    if (!allWodMovementTags().some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      const tag = { name, category: WOD_MOVE_CATEGORIES.includes(category) ? category : "Gymnastics" };
      customWodMovementTags.push(tag);
      dbAddWodMovementTag(tag).catch(noteStorageError);
    }
    builderMovements[name] = { reps: 10, weight: 0, checked: true };
    builderMoveSearch = "";
    const moveSearch = document.getElementById("wodBuilderMoveSearch");
    if (moveSearch) moveSearch.value = "";
    renderWodBuilderMovements("");
  }
  else if (action === "focus-wod-builder-search") { document.getElementById("wodBuilderMoveSearch").focus(); }
  else if (action === "create-wod") { createWodFromBuilder(); }
  else if (action === "save-bw") { saveBodyweight(); }
  else if (action === "toggle-bodyweight") { bodyweightExpanded = !bodyweightExpanded; renderBodyweightArea(); }
  else if (action === "toggle-pct-table") { pctTableExpanded = !pctTableExpanded; render(); }
  else if (action === "set-weight-from-pct") {
    // Exactly what prefill-from-recent does, for the same reason and with the
    // same named toast: a chip that silently changes a number somewhere above
    // the fold has not told anyone anything.
    const loadKg = Number(el.dataset.kg);
    if (isFinite(loadKg) && loadKg > 0) {
      applyFieldValue("step", "weight", loadKg);
      showToast(`מולא: ${el.dataset.pct}% — ${formatPlateKg(loadKg)} ק״ג`);
    }
  }
  else if (action === "set-pct-increment") {
    // render(), not a patch in place: every chip's kg changes, not one.
    setPctIncrement(Number(el.dataset.inc));
    render();
  }
  else if (action === "open-add-measure-type") { measureAddOpen = true; renderMeasureArea(); }
  else if (action === "cancel-add-measure-type") { measureAddOpen = false; renderMeasureArea(); }
  else if (action === "confirm-add-measure-type") {
    const input = document.getElementById("measureTypeInput");
    addMeasureType(input ? input.value : "");
  }
  else if (action === "toggle-measure-type") {
    measureExpandedId = measureExpandedId === el.dataset.id ? null : el.dataset.id;
    renderMeasureArea();
  }
  else if (action === "toggle-benchmark") {
    benchmarkExpandedId = benchmarkExpandedId === el.dataset.id ? null : el.dataset.id;
    renderBenchmarkArea();
  }
  else if (action === "log-benchmark") {
    // The same three lines select-benchmark runs in the WOD tab's catalogue,
    // plus the top-level tab switch this one starts from a different screen.
    // A benchmark you have just been told to retest with no way to get to the
    // form from there is a reminder that makes the member do the navigating.
    choosePickedWod(el.dataset.id);
    wodSubTab = "log";
    tab = "wod";
    render();
  }
  else if (action === "delete-measure-type") { askDeleteMeasureType(el.dataset.id); }
  else if (action === "save-measurement") { saveMeasurement(el.dataset.id); }
  else if (action === "delete-measurement-entry") { askDeleteMeasurementEntry(el.dataset.id); }
  else if (action === "save-user-name") { saveWelcomeForm(document.getElementById("welcomeNameInput").value); }
  else if (action === "skip-user-name") { saveWelcomeForm(""); }
  else if (action === "cancel-welcome-name") { closeWelcomeModal(); }
  else if (action === "edit-user-name") { openWelcomeModal(true); }
  else if (action === "open-profile-from-achievements") { closeAchievements(); openWelcomeModal(true); }
  // §1.4: the box-start date's new homes. Both land on the same profile
  // sheet in edit mode, where the date field IS shown - the difference is
  // only which control focuses, so a member who came specifically to answer
  // "when did I start at the box" is not left hunting for the field.
  else if (action === "edit-box-start-date") {
    closeSettings();
    openWelcomeModal(true);
    setTimeout(() => {
      const d = document.getElementById("welcomeBoxStartInput");
      if (d) d.focus();
    }, 60);
  }
  // §1.2 S3 / §1.5: the explainer is now only ever pulled - from the tour
  // card on רישום, or from Settings, forever.
  else if (action === "open-onboarding") { closeSettings(); openOnboarding(); }
  // §1.5: permanently available afterwards, which is what makes deferring
  // the prompt to day two safe - a member who wants it on day one can still
  // have it, they just are not asked.
  else if (action === "show-install-hint") {
    closeSettings();
    try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch (e) {}
    if (isIOSDevice()) {
      try { localStorage.removeItem(IOS_INSTALL_DISMISS_KEY); } catch (e) {}
      maybeShowIOSInstallBanner();
    } else if (deferredInstallPrompt) {
      showInstallBanner();
    } else {
      // No held prompt means the browser will not offer one (already
      // installed, or an engine that never fires the event). Saying so is
      // better than a control that visibly does nothing.
      showToast("הדפדפן הזה לא מציע התקנה כרגע — אפשר להוסיף למסך הבית מתפריט הדפדפן.");
    }
  }
  else if (action === "close-celebration") {
    if (el.id === "celebrationOverlay" && e.target !== el) return;
    closeCelebration();
  }
  else if (action === "open-achievements") { openAchievements(); }
  else if (action === "close-achievements") {
    if (el.id === "achievementsOverlay" && e.target !== el) return;
    closeAchievements();
  }
  else if (action === "open-notifications") { openHeaderNotifications(); }
  // Settings' own "מה חדש" row (fresh-eyes audit) always means release
  // notes specifically, never the smart header routing above - a member
  // tapping it to read the changelog must not land in Community's
  // notification center just because they happen to have unread there.
  else if (action === "open-release-notes") { openNotifications(); }
  else if (action === "prefill-from-recent") {
    const w = Number(el.dataset.weight), r = Number(el.dataset.reps), st = Number(el.dataset.sets);
    if (isFinite(w)) applyFieldValue("step", "weight", w);
    if (isFinite(r)) applyFieldValue("step", "reps", r);
    if (isFinite(st) && st > 0) applyFieldValue("step", "sets", st);
    // Named, because "filled" alone invites "filled with what?" from someone
    // who has just finished training and is not reading carefully.
    showToast(`מולא: ${entrySummaryFromParts(w, r, st)}`);
  }
  else if (action === "open-support") { openSupport(); }
  else if (action === "close-support") {
    // THE BACKDROP GUARD, missing when this shipped and reported from a real
    // phone the same day: "trying to put text it closes page". #supportOverlay
    // carries data-action="close-support" so a tap on the dim area behind the
    // sheet dismisses it - but the handler above resolves an action with
    // e.target.closest("[data-action]"), which walks UP from whatever was
    // tapped. Nothing inside the sheet carries its own data-action, so a tap
    // on the textarea found the overlay and closed the dialog the instant the
    // member tried to type. Every other overlay-level close in this file
    // already had this exact line (close-settings, close-notifications,
    // close-nav-menu); this one was written without it.
    if (el.id === "supportOverlay" && e.target !== el) return;
    closeSupport();
  }
  else if (action === "support-send-whatsapp") { supportSendWhatsApp(); }
  else if (action === "support-send-email") { supportSendEmail(); }
  else if (action === "support-copy") { supportCopyReport(); }
  else if (action === "close-notifications") {
    if (el.id === "notificationsOverlay" && e.target !== el) return;
    closeNotifications();
  }
  else if (action === "close-onboarding") {
    if (el.id === "onboardingOverlay" && e.target !== el) return;
    closeOnboarding();
  }
  else if (action === "set-rx") {
    // setWodRx, not a bare assignment: the choice is also remembered as this
    // member's own default for the next WOD (design spec §3.6), which is what
    // replaces the global Rx default rather than merely removing it.
    // Three answers now, so the dataset value is mapped rather than compared
    // to "1": `=== "1"` turned every non-Rx chip, Rx+ included, into Scaled.
    setWodRx(el.dataset.rx === "plus" ? WOD_EFFORT_PLUS : el.dataset.rx === "1");
    render();
  }
  else if (action === "copy-last-scaled") {
    const last = lastScaledAttempt(selectedWodId);
    wodNotes = last && last.notes ? last.notes : "";
    if (last && last.scaledWeight) wodScaledWeight = last.scaledWeight;
    renderWodContent();
  }
  else if (action === "save-wod") { saveWod(); }
  else if (action === "delete-wod-entry") { askDeleteWodEntry(el.dataset.id); }
  else if (action === "select-wod-history") { wodHistoryId = wodHistoryId === el.dataset.id ? null : el.dataset.id; renderWodHistoryListArea(); }
  // Every dialog in this app is closed by a click somewhere in this handler,
  // so one call here drains the celebration queue after ANY of them closes,
  // rather than repeating a flush in ten separate close* functions. The
  // early `return`s above are all backdrop guards that leave their dialog
  // open, so skipping the flush on those paths is the correct behaviour.
  flushDeferredCelebration();
});
document.getElementById("pickerSearch").addEventListener("input", (e) => renderPickerList(cleanStr(e.target.value, LIMITS.nameLen)));
document.getElementById("pickerSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (!q) return;
  const exact = allMovements().find((m) => m.name.toLowerCase() === q.toLowerCase());
  if (exact) { choosePickedMovement(exact.id); closePicker(); render(); }
  else e.target.blur();
});
document.getElementById("wodPickerSearch").addEventListener("input", (e) => renderWodPickerList(cleanStr(e.target.value, LIMITS.nameLen)));
document.getElementById("wodBuilderMoveSearch").addEventListener("input", (e) => renderWodBuilderMovements(cleanStr(e.target.value, LIMITS.nameLen)));
document.getElementById("wodBuilderMoveSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur();
});
document.getElementById("welcomeNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveWelcomeForm(e.target.value); }
});

document.addEventListener("focusin", (e) => {
  // Select (don't clear) the existing value: typing immediately replaces
  // it, same as before, but the value is never destructively wiped just
  // from tapping in — a screen reader still announces it, and clicking to
  // reposition the cursor for a small edit still works normally.
  if (e.target.classList && e.target.classList.contains("stepper-val")) e.target.select();
});
document.addEventListener("keydown", (e) => {
  if (e.target.classList && e.target.classList.contains("stepper-val") && e.key === "Enter") {
    e.preventDefault();
    e.target.blur();
  }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains("stepper-val")) return;
  const raw = String(el.value).trim().replace(",", ".");
  if (raw === "" || raw === "-" || raw === ".") return;
  const val = parseFloat(raw);
  if (!isFinite(val)) return;
  const action = el.dataset.action, field = el.dataset.field;
  // "5 דקות 75 שניות" MEANS 6:15, and used to save as 5:59.
  //
  // Live bug hunt, fresh round 3 (2026-09-15) - silent data corruption.
  // clampField() pinned seconds to LIMITS.seconds (59) in STATE on every
  // keystroke, but nothing wrote that back into the input until blur - so the
  // field went on showing "75" right up to save, and the entry stored 5:59.
  // No warning, no rejection, a benchmark time permanently wrong by up to
  // sixteen seconds. Writing "75 seconds" is a normal way to think for anyone
  // who counts intervals, so this is an ordinary input, not an abuse case.
  //
  // Carried rather than clamped, and rather than written back mid-keystroke:
  // clamping visibly as someone types turns "7" then "5" into "59" under the
  // caret, which is its own defect. Carrying keeps exactly what they meant
  // and loses nothing.
  if (field === "wodSeconds" && val >= 60) {
    const carry = Math.floor(val / 60);
    const secs = val % 60;
    setFieldState(action, "wodMinutes", clampField(action, "wodMinutes", (Number(wodMinutes) || 0) + carry, 0));
    setFieldState(action, "wodSeconds", clampField(action, "wodSeconds", secs, 0));
    const cfg = FIELD_ACTIONS[action];
    if (cfg) { cfg.sync("wodMinutes", wodMinutes); cfg.sync("wodSeconds", wodSeconds); }
    return;
  }
  setFieldState(action, field, clampField(action, field, val, +el.dataset.min));
  if (action === "step" && field === "weight" && logEntryType === "reps") {
    const bv = document.getElementById("barbellVisual");
    if (bv) bv.innerHTML = renderBarbell(weight);
  }
  if (action === "step") {
    if (logEntryType === "reps") {
      const estEl = document.getElementById("estLineValue");
      if (estEl) estEl.textContent = estimate1RM(weight, reps) + ' ק״ג';
    } else if (field === "durationSeconds") {
      const durEl = document.getElementById("durationLineValue");
      if (durEl) durEl.textContent = formatDuration(durationSeconds);
    }
  }
});
document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains("stepper-val")) return;
  const action = el.dataset.action, field = el.dataset.field, min = +el.dataset.min;
  const current = getFieldValue(action, field);
  const safe = (typeof current === "number" && isFinite(current)) ? current : 0;
  applyFieldValue(action, field, clampField(action, field, +safe.toFixed(2), min));
});
document.getElementById("wodPickerSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (!q) return;
  const exact = allWods().find((w) => w.name.toLowerCase() === q.toLowerCase());
  if (exact) { choosePickedWod(exact.id); closeWodPicker(); renderWodContent(); }
  else openWodBuilder(q);
});

// ---------- Init ----------
async function init() {
  loadThemePref();
  applyThemePref();
  loadTextScalePref();
  applyTextScalePref();
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (themePref === "auto") syncThemeColorMeta();
    });
  }
  document.getElementById("dateLabel").textContent = new Date().toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "short" });
  await reloadFromDb();
  await loadUserName();
  await loadLastExport();
  await loadBarWeight();
  await loadPctIncrement();
  await loadWodRxDefault();
  await loadBoxStartDate();
  await loadSeenAchievements();
  await loadLastSeenVersion();
  await loadOnboardedFlag();
  await loadFirstOpenDate();
  await loadFirstLogCelebrated();
  await loadEditionMarker();
  // Bootstrap flags that predate this device ever tracking them. A device
  // with real data/a name already existed before update-notifications and
  // onboarding shipped — it must never see either retroactively. A device
  // with nothing at all is a genuinely fresh install: it gets the welcome
  // sheet (below) and then the tour CARD on the logging screen, and there's
  // no changelog worth showing someone who's never used the app.
  //
  // MOVED ABOVE THE FIRST render(). It used to run after it, which was
  // harmless while every flag here only gated a modal opened further down.
  // It is not harmless now: hasOnboarded gates the tour card, which render()
  // draws — so an existing member whose flag had not been bootstrapped yet
  // would have been shown a first-run tour card on their own logging screen,
  // for one frame or until something re-rendered. Establish the facts, then
  // paint once from them.
  // Every kind of record counts: a member whose only data is measurements or
  // a custom WOD is not a first run.
  const isFreshInstall = userName === null && entries.length === 0 && wodEntries.length === 0
    && customMovements.length === 0 && bodyweightEntries.length === 0 && measureTypes.length === 0
    && measureEntries.length === 0 && customWods.length === 0;
  if (editionMarker === null) {
    if (isFreshInstall) markEditionSeen();
    else upgradeBackupOffered = true;
  }
  if (lastSeenVersion === null) {
    lastSeenVersion = isFreshInstall ? APP_VERSION : "0.0.0";
    dbSetSetting(LAST_SEEN_VERSION_KEY, lastSeenVersion).catch(() => {});
  }
  if (!hasOnboarded && !isFreshInstall) {
    hasOnboarded = true;
    dbSetSetting(HAS_ONBOARDED_KEY, true).catch(() => {});
  }
  // Same rule, for the three flags the first-run sequence adds (§1.2):
  //  - firstOpenDate: stamped now if this device has never recorded one. On
  //    an existing device that is a lie about history, so it is stamped only
  //    for a fresh install; an unknown date is read by installGateOpen() as
  //    "long past day one", which is true of exactly those devices.
  //  - firstLogCelebrated: a member with a log behind them has long since
  //    had their first entry; the arrival card is for arrivals.
  if (firstOpenDate === null && isFreshInstall) {
    firstOpenDate = todayISO();
    dbSetSetting(FIRST_OPEN_DATE_KEY, firstOpenDate).catch(() => {});
  }
  if (!firstLogCelebrated && !isFreshInstall) {
    firstLogCelebrated = true;
    dbSetSetting(FIRST_LOG_CELEBRATED_KEY, true).catch(() => {});
  }

  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "block";
  // The settings sheet starts closed, so it starts inert - established before
  // the first render() populates #settingsBody, so there is no window in
  // which a duplicate credential field is live in the document.
  setSettingsInert(true);
  renderUserGreeting();
  countUsage("app_open");
  render();
  maybeShowIOSInstallBanner();

  // No hard guarantee, but real-world reports say it measurably reduces
  // iOS's odds of evicting IndexedDB under storage pressure. Best-effort:
  // some browsers/contexts don't expose this at all.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // render() above already calls updateNotificationsBadge() on every pass
  // (fresh-eyes audit) - no separate call needed here any more.
  //
  // Live bug hunt, round 9 (2026-09-11): this checked only userName ===
  // null, not isFreshInstall - unlike every other first-run flag bootstrapped
  // above, which all correctly grandfather a device with real history. A
  // returning member with years of real entries but no stored name (a
  // device that predates the naming step) got the exact same "welcome, new
  // user" sheet a brand-new install gets, and - because of the
  // if/else-if - the release-notes catch-up was silently skipped for that
  // boot too. isFreshInstall already excludes anyone with real data; a
  // grandfathered member can still set a name any time via Settings' edit
  // icon (openWelcomeModal(true)).
  if (userName === null && isFreshInstall) openWelcomeModal();
  else openNotifications({ onlyIfUnseen: true });

  if ("serviceWorker" in navigator) {
    // The SW no longer calls skipWaiting() on install, so a new version parks
    // in "waiting" until offerUpdate() applies it (see the update handshake
    // above) — either right away if the page isn't currently visible, or via
    // the banner/next visibility-regain otherwise. That keeps the running
    // page and its cached assets on the same version until it's safe to swap.
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) offerUpdate(nw);
        });
      });
      // Nothing above ever asks the browser to re-check sw.js for a new
      // version - updatefound only fires off the browser's OWN automatic
      // check, which most browsers throttle to about once per 24h. A member
      // who reopens the installed app daily could go a long time without
      // ever being offered a real release. Forcing a check on every
      // foreground regain closes that gap without changing the "never swap
      // out from under an active session" handshake above at all.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch((e) => console.warn("sw registration failed:", e));

    let reloading = false;
    // Whether this tab was ALREADY under a service worker when it booted.
    // Read once, before any controllerchange can fire.
    const hadControllerAtBoot = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // ANOTHER TAB APPLIED THE UPDATE. Live bug hunt, fresh round 5
      // (2026-09-15). sw.js's activate handler calls self.clients.claim(),
      // which reassigns the controller of EVERY open tab - not just the one
      // that tapped the banner. So this fires here with swapRequested still
      // false, and returning was right (we must not reload out from under an
      // active session) but INCOMPLETE: the swap had already happened, and
      // nothing recorded that.
      //
      // The consequence was a permanently dead control. This tab's own banner
      // stayed up, and tapping it posted SKIP_WAITING to a worker that had
      // already activated - a no-op - and then waited for a controllerchange
      // that could never fire again, because the controller had already
      // changed once, here, silently. The banner could not be applied or
      // dismissed for the life of the tab, while the tab ran old app.js code
      // against the new worker's cache: precisely the inconsistent state the
      // "never swap out from under an active session" rule exists to avoid.
      // ONLY a genuine swap, never the first-ever claim. A page with no prior
      // controller gets one controllerchange the moment the first worker
      // claims it; treating that as "already swapped" made applyUpdate()
      // reload WITHOUT posting SKIP_WAITING, so the waiting worker never
      // activated and the reload served the old version again - caught
      // immediately by update-flow.mjs's "banner does NOT show while hidden".
      // hadControllerAtBoot is what tells the two apart.
      if (hadControllerAtBoot) controllerAlreadySwapped = true;
      if (!swapRequested) return; // e.g. the first-ever clients.claim() — nothing to reload for
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }
}
init();
