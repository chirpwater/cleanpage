import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORPUS,
  LINES_PER_PAGE,
  NO_POPPLER,
  OUT,
  firstWord,
  havePoppler,
  lastWord,
  numberedLines,
  numberedWords,
  open,
  screenPages,
  setText,
  words,
} from "./helpers.js";

test.skip(!havePoppler(), NO_POPPLER);

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

interface PdfOpts {
  scale?: number;
  margin?: string;
  format?: "Letter" | "A4";
  inject?: string;
}

const DANGEROUS_PAGE_SHAPE = "@media print { #printdoc .page { height: 960px; overflow: hidden } }";

async function printToPdf(
  page: import("@playwright/test").Page,
  name: string,
  opts: PdfOpts = {},
): Promise<string> {
  const path = join(OUT, name);
  const css = [
    opts.margin === undefined ? "" : `@media print { @page { size: letter; margin: ${opts.margin} } }`,
    opts.inject ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  if (css) {
    await page.evaluate((c) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(c);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, css);
  }
  // `beforeprint` is what a real Ctrl+P fires; go through the same door.
  await page.evaluate(() => {
    dispatchEvent(new Event("beforeprint"));
  });
  const m = "0.5in";
  const buf = await page.pdf({
    format: opts.format ?? "Letter",
    // Used only when `preferCSSPageSize` is false, i.e. the A4 case.
    margin: { top: m, right: m, bottom: m, left: m },
    preferCSSPageSize: opts.format ? false : true,
    printBackground: false,
    ...(opts.scale === undefined ? {} : { scale: opts.scale }),
  });
  writeFileSync(path, buf);
  return path;
}

/** The box of the first word on page 1, in PostScript points. */
function firstWordBox(path: string): { xMin: number; yMin: number; word: string } {
  const xml = execFileSync("pdftotext", ["-bbox", "-f", "1", "-l", "1", path, "-"], {
    encoding: "utf8",
  });
  const m = /<word xMin="([\d.-]+)" yMin="([\d.-]+)"[^>]*>([^<]*)<\/word>/.exec(xml);
  if (!m) throw new Error("no words on page 1 of " + path);
  return { xMin: Number(m[1]), yMin: Number(m[2]), word: m[3]! };
}

const pdfPageCount = (path: string): number =>
  Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path], { encoding: "utf8" }))?.[1]);

const pdfPageText = (path: string, p: number): string =>
  execFileSync("pdftotext", ["-f", String(p), "-l", String(p), path, "-"], { encoding: "utf8" });

test("a numbered document prints one sheet per screen page, holding lines 30n..30n+29", async ({
  page,
}) => {
  await open(page);
  const N = 95;
  await setText(page, numberedLines(N));

  const slices = await screenPages(page);
  expect(slices).toHaveLength(Math.ceil(N / LINES_PER_PAGE));

  const path = await printToPdf(page, "numbered-95.pdf");
  expect(pdfPageCount(path), "PDF sheets == screen pages").toBe(slices.length);

  const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  expect(info).toMatch(/Page size:\s+612 x 792 pts \(letter\)/);

  for (let p = 1; p <= slices.length; p++) {
    const got = words(pdfPageText(path, p)).filter((w) => /^L\d{3}$/.test(w));
    const from = (p - 1) * LINES_PER_PAGE + 1;
    const to = Math.min(p * LINES_PER_PAGE, N);
    const want = Array.from({ length: to - from + 1 }, (_, i) => "L" + String(from + i).padStart(3, "0"));
    expect(got, `PDF page ${p}`).toEqual(want);
  }
});

test("wrapped prose: every PDF page opens and closes on the same word as the screen page", async ({
  page,
}) => {
  await open(page);
  // A single long paragraph of unique ASCII tokens: it wraps like real writing,
  // and every first/last word is unambiguous in both instruments.
  await setText(page, numberedWords(2400));

  const slices = await screenPages(page);
  expect(slices.length).toBeGreaterThanOrEqual(4);

  const path = await printToPdf(page, "wrapped-prose.pdf");
  expect(pdfPageCount(path)).toBe(slices.length);

  for (let p = 1; p <= slices.length; p++) {
    const text = pdfPageText(path, p);
    expect(firstWord(text), `first word of PDF page ${p}`).toBe(firstWord(slices[p - 1]!));
    expect(lastWord(text), `last word of PDF page ${p}`).toBe(lastWord(slices[p - 1]!));
  }
});

test("the hostile corpus prints exactly as many sheets as the screen shows", async ({ page }) => {
  await open(page);
  await setText(page, CORPUS);
  const slices = await screenPages(page);
  const path = await printToPdf(page, "corpus.pdf");
  expect(pdfPageCount(path)).toBe(slices.length);
});

/**
 * The trap this project exists to avoid. A `height: 960px; overflow: hidden`
 * page shape silently DELETES the 30th line of every page. Extra paper is
 * recoverable; deleted words are not. The same applies to a wider margin, which
 * Chrome answers by scaling the whole page down uniformly.
 *
 * **Where the trap bites moved in review round 2, and this guard had to move
 * with it.** DESIGN §6 measured the loss at scale 1.25 against the original
 * `@page { margin: 0.5in }`. Round 2 (DECISIONS 10.3) made the page box
 * `margin: 0` and drew the half inch as `.page` padding, so a sheet is now a
 * full-bleed 816 px = 612 pt — exactly the paper — and Chrome answers any
 * `scale` above 1 with shrink-to-fit. Measured net scale (first word's xMin /
 * 36): 1.0000 at 1.5, 1.0003 at 1.25, 1.0667 at 1.6, 1.1667 at 1.75. So the
 * 1.25 case re-ran the default configuration and asserted nothing: it passed
 * identically with and without the dangerous shape. The threshold is now 1.75
 * (8 sheets, `L030`/`L060`/`L090` absent, against the shipped shape's 7 sheets
 * and all 95 lines), which is the row that actually re-detects the trap.
 *
 * Every scale row therefore also asserts the net scale it produces, so that a
 * future geometry change which makes a case stop moving the text fails loudly
 * instead of going quietly vacuous — and `the guard itself still discriminates`
 * below proves the instrument can still fail.
 */
for (const cfg of [
  { name: "scale 1.25", file: "scale-125.pdf", opts: { scale: 1.25 }, netScale: 1.0003 },
  // The documented upper bound of invariance: 1.5 is a byte-for-byte no-op,
  // because shrink-to-fit cancels it entirely (DECISIONS 11.7).
  { name: "scale 1.5", file: "scale-150.pdf", opts: { scale: 1.5 }, netScale: 1 },
  // Above the clamp at last: this is the case that catches a fixed height.
  { name: "scale 1.75", file: "scale-175.pdf", opts: { scale: 1.75 }, netScale: 1.1667 },
  // The shipped `@page` margin is 0 and the 0.5 in margin is padding on the
  // sheet itself (see the print CSS: Gecko has no slack otherwise). So a
  // dialog margin override moves the paper's edge, and the sheet's own 36 pt
  // of padding rides inside it — uniformly scaled by Chrome when the 8.5 in
  // sheet no longer fits the narrower page box, exactly as the type is:
  //   0.5in -> 36 + 36 x 540/612 = 67.76;  1in -> 72 + 36 x 468/612 = 99.53.
  { name: "margin 0.5in", file: "margin-05in.pdf", opts: { margin: "0.5in" }, xMin: 67.76 },
  { name: "margin 1in", file: "margin-1in.pdf", opts: { margin: "1in" }, xMin: 99.53 },
  { name: "margin 0", file: "margin-0.pdf", opts: { margin: "0" }, xMin: 36 },
  { name: "scale 0.8", file: "scale-080.pdf", opts: { scale: 0.8 }, netScale: 0.8 },
  { name: "A4", file: "a4.pdf", opts: { format: "A4" as const } },
] as { name: string; file: string; opts: PdfOpts; xMin?: number; netScale?: number }[]) {
  test(`no numbered line is lost at ${cfg.name}`, async ({ page }) => {
    await open(page);
    const N = 95;
    await setText(page, numberedLines(N));
    const path = await printToPdf(page, cfg.file, cfg.opts);

    const pages = pdfPageCount(path);
    const seen: string[] = [];
    for (let p = 1; p <= pages; p++) {
      seen.push(...words(pdfPageText(path, p)).filter((w) => /^L\d{3}$/.test(w)));
    }
    const want = Array.from({ length: N }, (_, i) => "L" + String(i + 1).padStart(3, "0"));
    // In order, none missing, none duplicated across a sheet boundary.
    expect(seen, `${cfg.name}: every line present, in order`).toEqual(want);

    // A scale case that did not actually move the text is a scale case that
    // tested nothing — which is exactly what "scale 1.25" had silently become.
    // Net scale is the first word's own origin: 36 pt is the unscaled 0.5 in.
    if (cfg.netScale !== undefined) {
      const box = firstWordBox(path);
      expect(box.word, `${cfg.name}: page 1 opens on L001`).toBe("L001");
      expect(
        box.xMin / 36,
        `${cfg.name}: the net scale Chrome actually applied, after shrink-to-fit`,
      ).toBeCloseTo(cfg.netScale, 3);
    }

    // A margin case that did not actually move the text is a margin case that
    // tested nothing. Measured: 67.76 / 99.53 / 36 pt for 0.5in / 1in / 0.
    if (cfg.xMin !== undefined) {
      const box = firstWordBox(path);
      expect(box.word, `${cfg.name}: page 1 opens on L001`).toBe("L001");
      expect(box.xMin, `${cfg.name}: the margin really is ${cfg.opts.margin}`).toBeCloseTo(
        cfg.xMin,
        1,
      );
    }
  });
}

/**
 * The guard above is an instrument, and an instrument that cannot fail is not
 * measuring anything. This test proves it still discriminates: it reintroduces
 * the exact shape DESIGN §6 forbids — through the CSSOM, the same door the
 * margin overrides use — and asserts that the words really do go missing.
 *
 * If a later geometry change absorbs scale 1.75 the way round 2's `@page
 * { margin: 0 }` absorbed 1.25, this test fails and points straight at the
 * guard, instead of leaving `no numbered line is lost at scale 1.75` passing
 * against a page shape that deletes a line from every sheet.
 */
test("the guard itself still discriminates: the forbidden .page shape does lose lines", async ({
  page,
}) => {
  await open(page);
  const N = 95;
  await setText(page, numberedLines(N));
  const path = await printToPdf(page, "clipped-shape-175.pdf", {
    scale: 1.75,
    inject: DANGEROUS_PAGE_SHAPE,
  });

  const pages = pdfPageCount(path);
  const seen = new Set<string>();
  for (let p = 1; p <= pages; p++) {
    for (const w of words(pdfPageText(path, p))) if (/^L\d{3}$/.test(w)) seen.add(w);
  }
  // Measured: 8 sheets against the shipped shape's 7, with the 30th line of
  // each full page clipped away entirely.
  expect(pages, "the clipped shape needs an extra sheet").toBe(8);
  for (const lost of ["L030", "L060", "L090"]) {
    expect(seen.has(lost), `${lost} must be MISSING with height+overflow:hidden`).toBe(false);
  }
  expect(seen.has("L029"), "and its neighbours must still be there").toBe(true);
  expect(seen.has("L095")).toBe(true);
});
