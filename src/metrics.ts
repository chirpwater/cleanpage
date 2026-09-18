/**
 * Page geometry and the one invariant the whole design rests on (DESIGN §2).
 *
 * 1 CSS px = 1/96 in by definition, in print as well as on screen, so every
 * number here is an exact integer and nothing accumulates over ten pages.
 */

export const PX_PER_IN = 96;

export const PAGE_H = 11 * PX_PER_IN; // 1056
export const MARGIN = 0.5 * PX_PER_IN; // 48

export const PAGE_BODY_H = PAGE_H - 2 * MARGIN; // 960

// PAGE_W (816) and CONTENT_W (720) are deliberately absent. Nothing imported
// them — the sheet's 816 px and the column's 720 px live in src/styles.css, and
// the e2e suite transcribes them from DESIGN §2 as its own literals so that the
// rendered page is checked against the specification rather than against the
// app's own arithmetic. Exported constants nothing reads are the same dead
// weight DECISIONS 9.15 swept out of this file.

export const LINE_H = 32; // 24 pt = 1/3 in

export const LINES_PER_PAGE = PAGE_BODY_H / LINE_H; // 30

/**
 * The load-bearing invariant. If the page body is ever not a whole number of
 * line boxes, page breaks start cutting line boxes in half and the screen and
 * the printout drift apart silently. Fail loudly at module load instead.
 */
if ((PAGE_H - 2 * MARGIN) % LINE_H !== 0) {
  throw new Error("page body must be a whole number of line boxes");
}

/**
 * A `<pre>` lays out no line box for a trailing forced break; a `<textarea>`
 * does. A trailing space hangs under `pre-wrap` and never wraps, so it adds
 * the one missing line box and nothing else (DESIGN §3, DECISIONS 2.10).
 *
 * The per-paragraph cache does not need this: a paragraph never ends in "\n".
 */
export const mirrorText = (t: string): string => (t.endsWith("\n") ? t + " " : t);

/**
 * The line height actually in effect on the element that measures the text.
 *
 * `.tp-text` pins `line-height: 32px` without `!important`, so a user
 * stylesheet — which SC 1.4.12 entitles a student to — wins. Reading it back
 * instead of trusting LINE_H is what keeps the sheet, the page-break rules and
 * the printed sheets agreeing with each other under one: at 32 px every number
 * is bit-identical to the design default.
 */
export function lineHeightOf(el: Element): number {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(lh) && lh > 0 ? lh : LINE_H;
}

/**
 * How many whole line boxes fit in the 960 px page body at that line height.
 * 30 at the design default; 40 under a forced 1.5x; 24 under a forced 2.5x.
 */
export const linesPerPage = (lineH: number): number =>
  Math.max(1, Math.floor(PAGE_BODY_H / lineH));
