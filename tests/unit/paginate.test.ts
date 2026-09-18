import { describe, expect, it } from "vitest";
import { LINES_PER_PAGE, mirrorText } from "../../src/metrics.js";
import { pageSlices, pagesOf } from "../../src/paginate.js";

const evenStarts = (n: number, w = 10): number[] =>
  Array.from({ length: n }, (_, i) => i * w);

function hardLineStarts(text: string): number[] {
  const out: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    out.push(at);
    at += line.length + 1;
  }
  return out;
}

describe("pagesOf", () => {
  it("is 1 for an empty document, never 0", () => {
    expect(pagesOf([0])).toBe(1);
    expect(pagesOf([])).toBe(1);
  });

  it("turns over on the 31st line, not the 30th", () => {
    expect(pagesOf(evenStarts(29))).toBe(1);
    expect(pagesOf(evenStarts(30))).toBe(1);
    expect(pagesOf(evenStarts(31))).toBe(2);
    expect(pagesOf(evenStarts(60))).toBe(2);
    expect(pagesOf(evenStarts(61))).toBe(3);
    expect(pagesOf(evenStarts(300))).toBe(10);
    expect(pagesOf(evenStarts(301))).toBe(11);
  });
});

describe("pageSlices", () => {
  it("cuts exactly at line starts and keeps every character", () => {
    const text = "x".repeat(1000);
    const starts = evenStarts(100);
    const slices = pageSlices(text, starts);
    expect(slices).toHaveLength(4);
    expect(slices.join(""), "nothing lost, nothing duplicated").toBe(text);
    expect(slices[0]).toHaveLength(300);
    expect(slices[1]).toHaveLength(300);
    expect(slices[2]).toHaveLength(300);
    expect(slices[3]).toHaveLength(100);
  });

  it("is lossless for every line count from 1 to 200", () => {
    for (let n = 1; n <= 200; n++) {
      const text = "y".repeat(n * 7 + 3);
      const slices = pageSlices(text, evenStarts(n, 7));
      expect(slices.join(""), `${n} lines`).toBe(text);
      expect(slices.length, `${n} lines`).toBe(pagesOf(evenStarts(n, 7)));
    }
  });

  it("gives every full page exactly 30 lines and the last one the remainder", () => {
    for (const n of [31, 59, 60, 61, 90, 137]) {
      const starts = evenStarts(n);
      const slices = pageSlices("z".repeat(n * 10), starts);
      const linesIn = (s: string, i: number) =>
        i < slices.length - 1 ? s.length / 10 : Math.ceil(s.length / 10);
      slices.forEach((s, i) => {
        expect(linesIn(s, i), `page ${i + 1} of a ${n}-line document`).toBe(
          i < slices.length - 1 ? LINES_PER_PAGE : n - i * LINES_PER_PAGE,
        );
      });
    }
  });

  it("puts one line on page 2 for a 31-line document, never two", () => {
    // The widow regression. Chromium's default `widows: 2` would break 29 + 2.
    const text = Array.from({ length: 31 }, (_, i) => `L${String(i + 1).padStart(3, "0")}`).join("\n");
    const slices = pageSlices(text, hardLineStarts(text));
    expect(slices).toHaveLength(2);
    expect(slices[0]!.split("\n").filter(Boolean)).toHaveLength(30);
    expect(slices[0]).toContain("L030");
    expect(slices[1]!.trim()).toBe("L031");
  });

  it("carries the newline that ends a page into that page, not the next", () => {
    // A non-final slice ends with the "\n" terminating its 30th line. That
    // newline's own line box belongs to the FIRST line of the next page, which
    // is why `buildPrintDoc` must not re-apply `mirrorText` per slice: doing so
    // adds a spurious 31st line box and spills the sheet.
    const text = Array.from({ length: 31 }, (_, i) => `L${String(i + 1).padStart(3, "0")}`).join("\n");
    const slices = pageSlices(text, hardLineStarts(text));
    expect(slices[0]!.endsWith("\n")).toBe(true);
    expect(mirrorText(slices[0]!), "what the per-slice fix-up would have done").toBe(
      slices[0] + " ",
    );
    expect(slices[1]!.startsWith("L031")).toBe(true);
  });

  it("handles a document of exactly one page and of exactly two", () => {
    const one = Array.from({ length: 30 }, (_, i) => `L${i}`).join("\n");
    expect(pageSlices(one, hardLineStarts(one))).toEqual([one]);

    const two = Array.from({ length: 60 }, (_, i) => `L${i}`).join("\n");
    const slices = pageSlices(two, hardLineStarts(two));
    expect(slices).toHaveLength(2);
    expect(slices.join("")).toBe(two);
    expect(slices[1]!.split("\n")).toHaveLength(30);
  });

  it("returns one empty slice for an empty document", () => {
    expect(pageSlices("", [0])).toEqual([""]);
  });

  it("does not split a surrogate pair when a line starts on one", () => {
    // The paginator's starts always fall on a grapheme boundary; this pins the
    // slicer's half of that contract — it must slice at the given index only.
    const emoji = "👩‍💻";
    const text = ("a".repeat(8) + emoji).repeat(40);
    const unit = 8 + emoji.length;
    const starts = Array.from({ length: 40 }, (_, i) => i * unit);
    const slices = pageSlices(text, starts);
    expect(slices.join("")).toBe(text);
    for (const s of slices) {
      expect(s.codePointAt(0)! >= 0xd800 && s.codePointAt(0)! <= 0xdfff).toBe(false);
    }
  });

  it("keeps the trailing hanging space inside the last slice, never a new page", () => {
    // `mirrorText` adds one space for a document that ends in a newline. That
    // space must not become a page of its own.
    const text = mirrorText("L1\nL2\n");
    const starts = [0, 3, 6];
    const slices = pageSlices(text, starts);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toBe(text);
  });
});
