
export const PX_PER_IN = 96;

export const PAGE_H = 11 * PX_PER_IN;
export const MARGIN = 0.5 * PX_PER_IN;

export const PAGE_BODY_H = PAGE_H - 2 * MARGIN;

export const LINE_H = 32;

export const LINES_PER_PAGE = PAGE_BODY_H / LINE_H;

if ((PAGE_H - 2 * MARGIN) % LINE_H !== 0) {
  throw new Error("page body must be a whole number of line boxes");
}

export const mirrorText = (t: string): string => (t.endsWith("\n") ? t + " " : t);

export function lineHeightOf(el: Element): number {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(lh) && lh > 0 ? lh : LINE_H;
}

export const linesPerPage = (lineH: number): number =>
  Math.max(1, Math.floor(PAGE_BODY_H / lineH));
