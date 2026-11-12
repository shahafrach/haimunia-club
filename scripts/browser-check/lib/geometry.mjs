// Measurements that only exist in a real engine.
//
// The bugs these serve share a property that makes them invisible to the
// node suite: nothing about the DOM is wrong. `textContent` is byte-for-byte
// correct, the right elements exist, the right classes are on them. What is
// wrong is where the pixels land. jsdom has no layout — every rect it
// reports is 0×0 at (0,0) — so a unit test cannot fail on any of this, and
// the only honest place to assert it is Chromium.

// Reads the VISUAL (painted) order of the characters inside an element, as
// opposed to the logical order `textContent` returns.
//
// Why this is the only way to see a bidi reordering bug: the Unicode
// bidirectional algorithm never touches the DOM. A rep scheme written
// "21-15-9" is still the string "21-15-9" in the text node after the engine
// has decided to paint it as "9-15-21" at the far end of an RTL line.
// Logical order is preserved by definition; only geometry disagrees.
//
// Method: a Range over one character at a time, per text node, taking that
// character's painted rect. Characters are grouped into visual lines by the
// vertical midpoint of their rects (wrapping is normal here), and each line
// is sorted left-to-right by `rect.left`. The result is what a person
// looking at the screen actually reads, left to right, top to bottom.
//
// Zero-width and collapsed characters report empty rects and are skipped:
// they are exactly the isolation marks and whitespace collapses that carry
// no visual position, so including them would add characters a reader never
// sees. <bdi> itself contributes no characters at all.
export async function paintedText(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`paintedText: no element matches ${sel}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const chars = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        // A collapsed rect means the character occupies no painted space.
        if (r.width === 0 && r.height === 0) continue;
        chars.push({ ch: text[i], left: r.left, mid: r.top + r.height / 2 });
      }
    }
    if (!chars.length) return "";
    // Group into visual lines: a character belongs to the current line if
    // its vertical midpoint sits within half a line-box of that line's.
    chars.sort((a, b) => a.mid - b.mid);
    const lines = [];
    for (const c of chars) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(c.mid - line.mid) < 6) line.chars.push(c);
      else lines.push({ mid: c.mid, chars: [c] });
    }
    return lines
      .map((l) => l.chars.sort((a, b) => a.left - b.left).map((c) => c.ch).join(""))
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  }, selector);
}

// Builds the PRE-FIX version of a node as a sibling of the real one, so the
// two are measured under an identical computed style, identical width and
// identical inherited direction — then returns its painted text and removes
// it again.
//
// This exists because a geometry assertion with no control is worth very
// little. "The painted order matches the typed order" can be true for a
// string that would never have reordered in the first place, on a surface
// that was already LTR, in a container that never inherited `dir=rtl`. In
// all three cases the check passes just as happily against the bug it is
// supposed to be guarding, and nobody finds out until a coach's workout
// reaches a member as a different workout.
//
// So every bidi check here asserts two things: the real node reads
// correctly, AND a control built the old way (raw text, no <bdi>) in the
// same place reads INCORRECTLY. The second half is what proves the first
// half is load-bearing rather than a coincidence of the sample string.
export async function paintedTextOfUnisolatedControl(page, selector, text) {
  const painted = await page.evaluate(
    ({ sel, txt }) => {
      const real = document.querySelector(sel);
      if (!real) throw new Error(`control: no element matches ${sel}`);
      const control = real.cloneNode(false);
      control.id = "__bidiControl";
      // The pre-fix render path: the text interpolated straight in, escaped
      // but not isolated. textContent is the exact equivalent of esc() here
      // and cannot inject markup.
      control.textContent = txt;
      real.after(control);
      return true;
    },
    { sel: selector, txt: text },
  );
  if (!painted) throw new Error("control node was not inserted");
  const result = await paintedText(page, "#__bidiControl");
  await page.evaluate(() => document.getElementById("__bidiControl")?.remove());
  return result;
}

// Measures an arbitrary HTML fragment as a sibling of a real rendered node, so
// it inherits that node's computed style, width and inherited direction — then
// removes it again.
//
// This is what makes a RUN-level bidi check possible at all. The line-level
// bug could be measured on whatever the app happened to render; the run-level
// one has to be measured against MUTANTS of the same string — the pre-fix
// build, an over-isolating build, a build with the whole line forced LTR —
// and none of those exist in the app to point a selector at. Building them
// beside the real node is the only way to compare them under identical
// layout, which is the entire reason the control in
// `paintedTextOfUnisolatedControl` is trustworthy.
//
// `html` is inserted as innerHTML on purpose: these fragments ARE markup
// (<bdi>, <bdi dir="ltr" lang="en">), and every one of them is built in this repo from
// literals or from the shipped helper's own output. No untrusted value
// reaches it.
export async function paintedTextOfHtmlSibling(page, selector, html) {
  const inserted = await page.evaluate(
    ({ sel, h }) => {
      const real = document.querySelector(sel);
      if (!real) throw new Error(`html sibling: no element matches ${sel}`);
      const probe = real.cloneNode(false);
      probe.id = "__bidiHtmlProbe";
      probe.innerHTML = h;
      real.after(probe);
      return true;
    },
    { sel: selector, h: html },
  );
  if (!inserted) throw new Error("html probe was not inserted");
  const result = await paintedText(page, "#__bidiHtmlProbe");
  await page.evaluate(() => document.getElementById("__bidiHtmlProbe")?.remove());
  return result;
}

// Asks the engine which element would receive a tap at a point — the same
// question the browser asks on a real touch, and the only one that accounts
// for stacking contexts, transforms, and fixed-position elements parked on
// top of each other. `getBoundingClientRect()` cannot answer it: two
// elements can have perfectly sensible rects and still have the wrong one
// on top.
//
// Returns a short description of the topmost element and, importantly, of
// which ancestor of interest it belongs to — an overlay usually intercepts
// a tap through some inner child of itself, not the overlay node directly.
export async function hitTest(page, selector, ancestorIds = []) {
  return page.evaluate(
    ({ sel, ids }) => {
      const el = document.querySelector(sel);
      if (!el) return { error: `no element matches ${sel}` };
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { error: `${sel} has no painted box` };
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      if (!top) return { error: `nothing at (${Math.round(x)}, ${Math.round(y)})` };
      const owner = ids.find((id) => document.getElementById(id)?.contains(top)) || null;
      return {
        reachable: el === top || el.contains(top),
        // What is actually on top, for a failure message someone can act on.
        // className on an SVG element is an SVGAnimatedString, not a string,
        // and stringifies to "[object SVGAnimatedString]" — the icons inside
        // the tab buttons are exactly that, so unwrap baseVal first.
        topDesc: top.id
          ? `#${top.id}`
          : `${top.tagName.toLowerCase()}${(typeof top.className === "string" ? top.className : top.className?.baseVal || "") ? "." + (typeof top.className === "string" ? top.className : top.className.baseVal) : ""}`,
        interceptedBy: owner,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
      };
    },
    { sel: selector, ids: ancestorIds },
  );
}
