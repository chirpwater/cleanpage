/**
 * SC 1.4.12 text spacing — a user stylesheet must not desynchronise the screen
 * from the paper, and must never hide a word.
 *
 * `.tp-text` pins `line-height: 32px` without `!important`, so any user or
 * `!important` declaration wins. The layout used to derive the page from the
 * compile-time LINE_H instead of the spacing actually in effect, and:
 *
 *  - at the guideline's own canonical override (line-height 1.5) the on-screen
 *    break rules stayed at 48 + k*960 while 40 lines now fit above each one, so
 *    the screen broke after line 40 and the printout after line 30 — ten lines
 *    of disagreement, plus ~1.5 sheets of blank paper;
 *  - above 2.0x the field was allocated less height than its own content and
 *    `overflow: hidden` silently clipped the tail: six of thirty lines were in
 *    `ta.value`, were saved and were printed, and could not be seen.
 *
 * The rules are injected through the CSSOM, not an injected `<style>`: the
 * built page ships a `<meta>` CSP whose `style-src 'self'` blocks an inline
 * stylesheet, and the CSSOM is not restricted by CSP.
 */
import { expect, test } from "@playwright/test";
import { MARGIN, PAGE_BODY_H, numberedLines, open, screenPages, setText, settle } from "./helpers.js";

async function forceSpacing(page: import("@playwright/test").Page, css: string): Promise<void> {
  await page.evaluate((c) => {
    const s = new CSSStyleSheet();
    s.replaceSync(c);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  }, css);
}

/** The canonical SC 1.4.12 bookmarklet, plus the wider variants it permits. */
const SPACING = (lh: string) =>
  `* { line-height: ${lh} !important; letter-spacing: 0.12em !important; ` +
  `word-spacing: 0.16em !important; }`;

for (const c of [
  { name: "the design default", css: null, lineH: 32, lpp: 30, lines: 95 },
  { name: "a forced 1.5x (the SC's own value)", css: SPACING("1.5"), lineH: 24, lpp: 40, lines: 95 },
  { name: "a forced 2.5x", css: SPACING("2.5"), lineH: 40, lpp: 24, lines: 30 },
]) {
  test(`screen and print agree, and nothing is clipped, under ${c.name}`, async ({ page }) => {
    await open(page);
    if (c.css) await forceSpacing(page, c.css);
    // Hard lines only: what is under test is the page geometry, not wrapping,
    // and short lines wrap the same at any letter spacing.
    await setText(page, numberedLines(c.lines));
    await settle(page);

    const pages = Math.ceil(c.lines / c.lpp);
    const pageH = c.lpp * c.lineH;

    const m = await page.evaluate(() => {
      const ta = document.getElementById("ta") as HTMLTextAreaElement;
      return {
        lineHeight: getComputedStyle(ta).lineHeight,
        allocated: ta.getBoundingClientRect().height,
        content: ta.scrollHeight,
        sheet: document.getElementById("sheet")!.getBoundingClientRect().height,
        ruleTops: Array.from(document.querySelectorAll<HTMLElement>("#breaks .rule")).map((r) =>
          parseFloat(r.style.top),
        ),
      };
    });

    expect(m.lineHeight, "the spacing actually in effect").toBe(`${c.lineH}px`);
    expect(m.allocated, "the sheet is sized from that spacing").toBe(pages * pageH);
    expect(m.sheet).toBe(pages * pageH + 2 * MARGIN);
    // The field never scrolls (DECISIONS 2.7) — which is only safe while its
    // box is never smaller than its own content. This is that guarantee.
    expect(m.content, "no line is clipped out of view").toBeLessThanOrEqual(m.allocated + 6);
    expect(m.ruleTops).toEqual(
      Array.from({ length: pages - 1 }, (_, k) => MARGIN + (k + 1) * pageH),
    );
    // Whole line boxes only: a rule must never cut one in half.
    expect(pageH).toBeLessThanOrEqual(PAGE_BODY_H);
    expect(pageH % c.lineH).toBe(0);

    // The printed sheets are the pages the rules drew, line for line.
    const slices = await screenPages(page);
    expect(slices).toHaveLength(pages);
    const seen: string[] = [];
    slices.forEach((s, i) => {
      const got = s.split("\n").filter((l) => /^L\d{3}$/.test(l));
      expect(got.length, `printed sheet ${i + 1}`).toBe(
        Math.min(c.lpp, c.lines - i * c.lpp),
      );
      seen.push(...got);
    });
    expect(seen).toEqual(
      Array.from({ length: c.lines }, (_, i) => "L" + String(i + 1).padStart(3, "0")),
    );
  });
}

/**
 * SC 1.4.12 reaches the toolbar too, and the saved indicator is the one thing
 * PROPOSAL "Loss prevention" requires to be on the screen ("The page shows
 * whether the current text has been saved since it was last changed").
 *
 * It was pinned at `min-width: 22ch; max-width: 22ch; overflow: hidden` with
 * `text-overflow: ellipsis` on its only text span. `ch` is the zero glyph's
 * advance, which letter-spacing and word-spacing do not inflate, so under the
 * guideline's own values the box stayed frozen at 201 px while the text inside
 * it grew: measured scrollWidth 201 against clientWidth 156, i.e. 45 px of
 * "Nothing to save yet" clipped away, rendering as "Nothing to sa…", with no
 * `title` and no second copy anywhere on the screen. After a real save it was
 * 230 against 156.
 *
 * The state words now live in their own span and are never clipped; only the
 * filename is elidable, which is all DECISIONS 9.8 ever meant to truncate.
 */
const chipStates: { name: string; words: string; file?: string }[] = [
  { name: "saved", words: "Changes saved" },
  { name: "saved to a named file", words: "Changes saved — ", file: "My Story.txt" },
  { name: "saved, worst-case filename", words: "Changes saved — ", file: "A Very Long Story Name Indeed.txt" },
];

for (const spacing of [null, SPACING("1.5"), SPACING("2.5")]) {
  const label = spacing === null ? "the design default" : `a forced ${/1\.5/.test(spacing) ? "1.5x" : "2.5x"}`;
  test(`the saved indicator never loses a word under ${label}`, async ({ page }) => {
    await open(page);
    if (spacing) await forceSpacing(page, spacing);

    for (const s of chipStates) {
      const m = await page.evaluate((st) => {
        const word = document.getElementById("statusWord")!;
        const nameEl = document.getElementById("statusName")!;
        word.textContent = st.words;
        nameEl.textContent = st.file ?? "";
        const chip = document.getElementById("status")!;
        chip.dataset.empty = "false";
        const cs = getComputedStyle(chip);
        const box = chip.getBoundingClientRect();
        const w = word.getBoundingClientRect();
        return {
          chipWidth: +box.width.toFixed(2),
          // The content box the words have to fit inside.
          left: box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
          right: box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
          wordLeft: w.left,
          wordRight: w.right,
          wordWidth: +w.width.toFixed(2),
          shown: chip.textContent?.replace(/\s+/g, " ").trim(),
        };
      }, s);

      // The words are laid out, and every pixel of them is inside the chip.
      expect(m.wordWidth, `${s.name}: the words are rendered`).toBeGreaterThan(0);
      expect(m.wordLeft, `${s.name}: the words start inside the chip`).toBeGreaterThanOrEqual(
        m.left - 0.5,
      );
      expect(m.wordRight, `${s.name}: the words END inside the chip — no clipped tail`).toBeLessThanOrEqual(
        m.right + 0.5,
      );
      // role="status" still reads the whole thing, filename included.
      expect(m.shown, `${s.name}: announced in full`).toContain(s.words.trim());
      if (s.file) expect(m.shown).toContain(s.file);
    }
  });

  test(`the separate recovery warning keeps all its words under ${label}`, async ({ page }) => {
    await open(page);
    if (spacing) await forceSpacing(page, spacing);
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("cleanpage:draft:")) throw new DOMException("Full", "QuotaExceededError");
        write.call(this, key, value);
      };
    });
    await setText(page, "Words that still need a safe copy");
    const warning = page.locator("#storageWarning");
    await expect(warning).toBeVisible();
    await expect(warning).toHaveText("Could not save on this device. Download your writing to keep it.");
    const box = await warning.evaluate((el: HTMLElement) => ({
      width: el.clientWidth,
      contentWidth: el.scrollWidth,
      height: el.clientHeight,
      contentHeight: el.scrollHeight,
    }));
    expect(box.contentWidth, "warning text wraps instead of clipping").toBeLessThanOrEqual(box.width + 1);
    expect(box.contentHeight, "all warning lines remain visible").toBeLessThanOrEqual(box.height + 1);
    await expect(page.locator("#statusWord")).toBeEmpty();
    await expect(page.locator("#status")).toHaveCSS("visibility", "hidden");
  });
}

/**
 * Settings stays anchored at the right edge while the status fits its words.
 * Reserving a large empty status box would waste room on smaller screens.
 */
test("at the design spacing status changes never move Settings", async ({ page }) => {
  await open(page);
  const positions: Record<string, number> = {};
  for (const s of chipStates) {
    positions[s.name] = await page.evaluate((st) => {
      document.getElementById("statusWord")!.textContent = st.words;
      document.getElementById("statusName")!.textContent = st.file ?? "";
      document.getElementById("status")!.dataset.empty = "false";
      return +document.getElementById("btnSettings")!.getBoundingClientRect().left.toFixed(2);
    }, s);
  }
  expect(new Set(Object.values(positions)).size, JSON.stringify(positions)).toBe(1);
});

/**
 * The filename is the one elidable element, and its own descenders used to be
 * sliced flat by the `16px/1` line box it sits in: clientHeight 16 against
 * scrollHeight 19, so the chip read "Nothinq to save vet" before the child had
 * typed anything. `overflow: clip` with a clip margin lets the ink out while
 * still truncating.
 */
test("the elidable filename clips its box, not its descenders", async ({ page }) => {
  await open(page);
  const m = await page.evaluate(() => {
    document.getElementById("status")!.dataset.empty = "false";
    const n = document.getElementById("statusName")!;
    n.textContent = "gypsy paragraph story that is far too long to fit.txt";
    const cs = getComputedStyle(n);
    return {
      overflow: cs.overflowX,
      clipMargin: cs.overflowClipMargin,
      ellipsis: cs.textOverflow,
      clipped: n.scrollWidth > n.clientWidth,
    };
  });
  expect(m.overflow, "clip, not hidden").toBe("clip");
  expect(parseFloat(m.clipMargin), "room for the descender to ink out").toBeGreaterThanOrEqual(3);
  expect(m.ellipsis).toBe("ellipsis");
  expect(m.clipped, "a long filename is still truncated").toBe(true);
});
