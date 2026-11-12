// Boots the real app (index.html + every script it loads, byte-for-byte off
// disk) inside a jsdom window backed by a fresh, isolated in-memory IndexedDB
// per call - so tests exercise the actual production code path, not a
// reimplementation of it, with no state leaking between tests.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import FDBFactory from "fake-indexeddb/lib/FDBFactory";
import FDBKeyRange from "fake-indexeddb/lib/FDBKeyRange";
import os from "node:os";

const testDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(testDir);
const htmlPath = path.join(root, "index.html");

// Every script index.html loads, in its order, read off index.html itself so
// the two cannot drift. Real browsers share one global lexical environment
// across classic <script> tags; jsdom's separate window.eval() calls do not
// (a later call's `let X` from an earlier one throws), so the files are
// concatenated into ONE eval - which is exactly the shared scope the browser
// gives them.
const SCRIPT_FILES = [...readFileSync(htmlPath, "utf8").matchAll(/<script defer src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
export { SCRIPT_FILES };
function readAppSrc() {
  return SCRIPT_FILES.map((f) => readFileSync(path.join(root, f), "utf8")).join("\n");
}

function newDom(url, opts = {}) {
  const html = readFileSync(htmlPath, "utf8");
  const dom = new JSDOM(html, {
    // COMM-229. Overridable so a test can boot with a ?notif=... query
    // string (app.js reads it at its own top-level, before any script
    // below runs) - every other caller keeps the plain origin default.
    url: url || "https://example.test/",
    // "outside-only" parses the document but does NOT auto-run its <script>
    // tags (no network/file fetch needed for ./app.js or ./theme-init.js);
    // it still exposes window.eval so we can run app.js ourselves below.
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.indexedDB = new FDBFactory();
  window.IDBKeyRange = FDBKeyRange;

  // jsdom implements neither matchMedia nor a full randomUUID-capable crypto.
  //
  // The default answers false to every query, which is what every test
  // written before this seam existed assumes - jsdom has no layout, so
  // "false to everything" is the only honest default and it keeps every
  // existing test on the phone layout. A test that is ABOUT a media query
  // passes `matchMedia: (q) => ...` and gets a real, listenable
  // MediaQueryList back; window.__setMediaMatcher(fn) then swaps the
  // predicate and fires `change` at every live list, which is how a layout
  // that switches on resize can be exercised without a browser.
  let mediaMatcher = typeof opts.matchMedia === "function" ? opts.matchMedia : () => false;
  const mediaLists = [];
  window.matchMedia = (media) => {
    const handlers = [];
    const mql = {
      media: String(media || ""),
      get matches() { return !!mediaMatcher(String(media || "")); },
      addEventListener(type, fn) { if (type === "change") handlers.push(fn); },
      removeEventListener(type, fn) {
        if (type !== "change") return;
        const i = handlers.indexOf(fn);
        if (i >= 0) handlers.splice(i, 1);
      },
      addListener(fn) { handlers.push(fn); },
      removeListener(fn) { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); },
      __fire() { for (const fn of handlers.slice()) fn({ matches: mql.matches, media: mql.media }); },
    };
    mediaLists.push(mql);
    return mql;
  };
  window.__setMediaMatcher = (fn) => {
    mediaMatcher = typeof fn === "function" ? fn : () => false;
    for (const mql of mediaLists) mql.__fire();
  };
  // defineProperty rather than assignment: jsdom 30 made window.crypto an
  // accessor with no setter, so `window.crypto = ...` throws "Cannot set
  // property crypto of [object Window] which has only a getter" and takes
  // every test that boots the app down with it. Assignment worked on 25.
  Object.defineProperty(window, "crypto", {
    value: globalThis.crypto, configurable: true, writable: true,
  });

  // window.confirm has no jsdom implementation; default to "yes" for tests
  // that go through confirmation flows (e.g. import merge).
  window.confirm = () => true;
  window.alert = () => {};
  return window;
}

export async function bootApp(opts = {}) {
  const window = newDom(opts.url, opts);
  if (opts.localStorage) {
    for (const [key, value] of Object.entries(opts.localStorage)) window.localStorage.setItem(key, value);
  }
  // Seeds IndexedDB BEFORE the app opens it - the shape of a member's phone
  // on the first open of this edition. opts.seed(indexedDB) gets the raw
  // factory and must resolve once its writes have committed.
  if (typeof opts.seed === "function") await opts.seed(window.indexedDB, window);
  if (opts.serviceWorkerStub) window.navigator.serviceWorker = opts.serviceWorkerStub;
  if (typeof opts.beforeScripts === "function") opts.beforeScripts(window);
  window.eval(readAppSrc());

  await waitFor(() => window.document.getElementById("loading").style.display === "none", 5000);
  return window;
}

// Design spec §3.6 removed the Rx default: `let wodRx = true` silently filed
// a beginner's session as "at the full prescribed weights", which is a
// data-integrity bug rather than a copy one. There is now a real third state
// - unanswered - and saveWod() refuses it outright, the same way saveSet()
// refuses a set with no movement chosen.
//
// Scenarios whose subject is something else entirely (EMOM shapes, the
// edit-navigation guard, the club catalogue) answer the question the way a
// member would and carry on. Rx=true is deliberate: it is what the removed
// default used to record, so every assertion those scenarios make about the
// stored entry keeps describing exactly the same data as before.
//
// A test that is ABOUT the choice itself should not use this - see
// test/wod-rx-choice.test.mjs, which drives the real toggle.
export function answerWodRx(window, rx = true) {
  window.setWodRx(rx);
}

// EVERY waitFor DEADLINE IS WALL-CLOCK, AND THAT MAKES IT LOAD SENSITIVE.
//
// 1,982 call sites across 103 files poll a predicate against a real timeout.
// jsdom boots the whole app per test, so the work behind a predicate is real;
// when this machine is busy - two agent sessions and a Supabase stack is the
// normal case here - the event loop starves, the deadline passes, and a test
// whose CODE IS CORRECT fails. Six did exactly that on 2026-09-23, all five
// files passing in isolation immediately afterwards.
//
// A flake is worse than a failure: it teaches whoever sees red to shrug. So
// two changes, neither of which weakens a real assertion.
//
// NOT A CAUSE, checked and ruled out: a condition coming true "between polls"
// was never lost. The loop evaluates check() BEFORE it tests the deadline, so
// a predicate that turns true while the machine was starved is seen by the
// next poll whenever that poll happens, however late. A post-deadline recheck
// was written here first and removed after a negative test showed removing it
// changed nothing - it could only ever have covered the microseconds between
// two adjacent lines. The ordering is the property that matters and it is
// pinned by waitfor-helper.test.mjs.
//
// (a) A SCALE FACTOR, so a loaded or slow machine can buy headroom without
//     editing 1,982 numbers. HAIMUNIA_TEST_TIMEOUT_SCALE=4 quadruples every
//     deadline. Default 1, so nothing changes unless someone asks.
//
// (b) AN ERROR THAT SAYS WHICH KIND OF RED THIS IS. The old message was
//     "waitFor timed out" - indistinguishable from a genuine hang. The new
//     one carries the elapsed time, the deadline, how many times it actually
//     polled, and the 1-minute load average, plus the sentence that tells a
//     reader what to do. A poll count far below elapsed/interval IS the
//     starvation signature: the loop wanted to run every 5ms and could not.
const TIMEOUT_SCALE = (() => {
  const raw = Number(process.env.HAIMUNIA_TEST_TIMEOUT_SCALE);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

export function waitFor(check, timeoutMs = 2000, intervalMs = 5, label = "") {
  const budget = timeoutMs * TIMEOUT_SCALE;
  const start = Date.now();
  let polls = 0;
  return new Promise((resolve, reject) => {
    (function poll() {
      let result;
      polls += 1;
      try { result = check(); } catch (e) { return reject(e); }
      if (result) return resolve(result);
      if (Date.now() - start > budget) {
        const elapsed = Date.now() - start;
        const wanted = Math.max(1, Math.round(elapsed / intervalMs));
        const load = os.loadavg()[0].toFixed(2);
        return reject(new Error(
          `waitFor timed out${label ? ` waiting for ${label}` : ""} after ${elapsed}ms `
          + `(deadline ${budget}ms${TIMEOUT_SCALE === 1 ? "" : `, scaled x${TIMEOUT_SCALE}`}); `
          + `polled ${polls}/${wanted} times; loadavg ${load}. `
          + "This deadline is WALL-CLOCK and therefore load sensitive: a poll count well "
          + "below the wanted count means the event loop was starved, not that the app is "
          + "broken. Re-run the file on its own before believing it; if it passes, the "
          + "machine was busy. HAIMUNIA_TEST_TIMEOUT_SCALE=4 buys headroom everywhere."));
      }
      setTimeout(poll, intervalMs);
    })();
  });
}

