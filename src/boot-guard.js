// BOOT GUARD (audit 2026-11, findings 4 and 6). Loaded first of the deferred
// scripts so it is listening before any of them runs.
//
// Before this, an exception anywhere in boot - a script that threw at load,
// init() rejecting, IndexedDB refusing to open - left "טוען את היומן שלך…" on
// screen forever with no way out but force-closing the app. And a database
// that failed to load was read as "no data", so a member with a full log got
// the fresh-install welcome sheet asking for their name.
//
// Now any failure before boot finishes replaces the loading screen with a
// short message and one "reload" button. Nothing reloads by itself, so a
// failure that repeats can never become a reload loop; the member decides.
// Errors AFTER boot are left to the app's own handling - a working screen is
// never torn down for a stray exception.
let bootGuardFinished = false;
let bootGuardShown = false;

const BOOT_ERROR_TEXT = {
  storage: {
    title: "לא הצלחנו לפתוח את היומן",
    body: "האימונים שלך לא נמחקו - הם עדיין במכשיר. סגרו לשונית אחרת של האפליקציה אם פתוחה, ונסו שוב.",
  },
  crash: {
    title: "משהו השתבש בטעינה",
    body: "האימונים שלך שמורים במכשיר ולא נפגעו. נסו לטעון שוב.",
  },
  slow: {
    title: "הטעינה לוקחת יותר מהרגיל",
    body: "האימונים שלך שמורים במכשיר. אפשר לחכות עוד רגע, או לטעון שוב.",
  },
};

function showBootError(kind) {
  if (bootGuardFinished && kind !== "storage") return;
  const text = BOOT_ERROR_TEXT[kind] || BOOT_ERROR_TEXT.crash;
  let box = document.getElementById("bootError");
  if (!box) {
    box = document.createElement("div");
    box.id = "bootError";
    box.setAttribute("role", "alert");
    box.style.cssText = "min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;";
    const h = document.createElement("h1");
    h.id = "bootErrorTitle";
    h.style.cssText = "margin:0;font-size:18px;font-weight:800;color:var(--chalk);";
    const p = document.createElement("p");
    p.id = "bootErrorBody";
    p.style.cssText = "margin:0;max-width:320px;font-size:14px;line-height:1.6;color:var(--steel);";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "bootErrorReload";
    btn.className = "save-btn";
    btn.textContent = "לטעון שוב";
    btn.style.cssText = "max-width:280px;min-height:48px;";
    btn.addEventListener("click", () => { try { location.reload(); } catch (e) {} });
    box.append(h, p, btn);
    const loading = document.getElementById("loading");
    if (loading && loading.parentNode) loading.parentNode.insertBefore(box, loading.nextSibling);
    else document.body.appendChild(box);
  }
  box.querySelector("#bootErrorTitle").textContent = text.title;
  box.querySelector("#bootErrorBody").textContent = text.body;
  box.style.display = "flex";
  bootGuardShown = true;
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  // A storage failure stops boot for good; the app shell stays hidden so no
  // screen can treat the member as having no data.
  if (kind === "storage") {
    bootGuardFinished = true;
    const app = document.getElementById("app");
    if (app) app.style.display = "none";
  }
}

// Called by init() once the first render is on screen. If the slow-boot
// notice went up in the meantime, it comes down again.
function bootGuardDone() {
  bootGuardFinished = true;
  clearTimeout(bootGuardTimer);
  if (bootGuardShown) {
    const box = document.getElementById("bootError");
    if (box) box.style.display = "none";
  }
}

window.addEventListener("error", (e) => {
  // Resource load errors (an <img> 404) do not bubble to window; only
  // script errors arrive here.
  if (!bootGuardFinished) showBootError("crash");
});
window.addEventListener("unhandledrejection", () => {
  if (!bootGuardFinished) showBootError("crash");
});
// A boot that never finishes and never throws (an IndexedDB open held
// blocked by another tab) gets the same way out after 15 seconds.
const bootGuardTimer = setTimeout(() => { if (!bootGuardFinished) showBootError("slow"); }, 15000);
