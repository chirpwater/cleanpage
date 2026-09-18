/**
 * DESIGN §12.4 — the end-to-end pixel proof, and the only instrument that
 * covers CJK, Hangul, Japanese, emoji, tabs and space runs.
 *
 * Text extraction cannot check any of those: `pdftotext` will happily agree
 * with itself about an emoji it dropped. So render each PDF page back to
 * 1632x2112 px with `pdftoppm -r 192` and compare it, line band by line band,
 * against a deviceScaleFactor-2 screenshot of the corresponding on-screen page
 * body: same bands inked, same ink starting and ending at the same x.
 *
 * Chromium only (page.pdf), and skipped if poppler is not installed.
 */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  CONTENT_W,
  CORPUS,
  LINE_H,
  LINES_PER_PAGE,
  MARGIN,
  NO_POPPLER,
  OUT,
  PAGE_BODY_H,
  chooseFont,
  chooseMode,
  havePoppler,
  open,
  setText,
} from "./helpers.js";

// The normalized round face is 12.8px at the small writing size. Comparing two
// independently hinted 96dpi rasters quantizes its stem edges by up to 2px.
// Capture both surfaces at 2x and express extents back in CSS pixels below;
// the geometry thresholds remain unchanged, not relaxed for the smaller face.
const RASTER_SCALE = 2;
test.use({ deviceScaleFactor: RASTER_SCALE });

/**
 * What counts as ink, and how far the two rasterizers are allowed to disagree.
 *
 * Screen ink is #1A1A1A on #FDFDFB and print ink is #000 on #fff. A mid
 * threshold classifies their solid stems alike; independent antialiasing can
 * still move an edge. The original 96dpi threshold sweep over 60..200 found
 * identical band occupancy in both faces. The normalized round face needs
 * the finer raster above to compare its smaller stems accurately. Keep the
 * same CSS-pixel tolerances and the same 97% near-exact share for BOTH fonts.
 */
const INK_THRESHOLD = 100;
const EXTENT_TOLERANCE = 3;
const EXTENT_EXACT_SHARE = 0.97;

interface Band {
  ink: number;
  minX: number;
  maxX: number;
}

/** Measure physical pixels, reporting x extents in the shared CSS-pixel space. */
function bands(png: PNG, x0: number, y0: number, count: number): Band[] {
  const out: Band[] = [];
  for (let k = 0; k < count; k++) {
    let ink = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let dy = 0; dy < LINE_H * RASTER_SCALE; dy++) {
      const y = y0 + k * LINE_H * RASTER_SCALE + dy;
      if (y < 0 || y >= png.height) continue;
      for (let dx = 0; dx < CONTENT_W * RASTER_SCALE; dx++) {
        const x = x0 + dx;
        if (x < 0 || x >= png.width) continue;
        const i = (y * png.width + x) * 4;
        const r = png.data[i]!;
        const g = png.data[i + 1]!;
        const b = png.data[i + 2]!;
        // Perceptual luminance against INK_THRESHOLD (see its comment).
        if (0.2126 * r + 0.7152 * g + 0.0722 * b < INK_THRESHOLD) {
          ink++;
          if (dx < minX) minX = dx;
          if (dx > maxX) maxX = dx;
        }
      }
    }
    out.push({ ink, minX: ink ? minX / RASTER_SCALE : -1, maxX: ink ? maxX / RASTER_SCALE : -1 });
  }
  return out;
}

for (const font of ["serif", "dys"] as const) {
  test(`printed pages are pixel-for-pixel the pages on screen, ${font}`, async ({ page }) => {
    test.skip(!havePoppler(), NO_POPPLER);
    mkdirSync(OUT, { recursive: true });

    await open(page);
    await chooseFont(page, font);
    await setText(page, CORPUS);

    const pages = await page.locator("#printdoc .page").count();
    expect(pages).toBeGreaterThanOrEqual(4);

    // One screenshot of the whole field, sliced per page in Node. The break
    // overlay and the sticky bar are chrome, not words.
    await page.evaluate(() => {
      document.getElementById("breaks")!.style.display = "none";
      document.getElementById("bar")!.style.visibility = "hidden";
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const captureOrigin = await page.locator("#ta").evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, scrollX, scrollY, dpr: devicePixelRatio };
    });
    const screen = PNG.sync.read(await page.locator("#ta").screenshot({ caret: "hide" }));
    expect(screen.width).toBe(CONTENT_W * RASTER_SCALE);
    expect(screen.height).toBe(pages * PAGE_BODY_H * RASTER_SCALE);
    await page.evaluate(() => {
      document.getElementById("breaks")!.style.display = "";
      document.getElementById("bar")!.style.visibility = "";
    });

    const pdfPath = join(OUT, `fidelity-${font}.pdf`);
    await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
    writeFileSync(
      pdfPath,
      await page.pdf({
        format: "Letter",
        margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
        preferCSSPageSize: true,
      }),
    );

    const stem = join(OUT, `fidelity-${font}`);
    execFileSync("pdftoppm", ["-r", String(96 * RASTER_SCALE), "-png", pdfPath, stem]);

    let compared = 0;
    let withinOnePixel = 0;
    let inked = 0;
    const failures: string[] = [];
    const extents: { page: number; line: number; screen: Band; paper: Band }[] = [];

    for (let p = 1; p <= pages; p++) {
      const pad = pages >= 10 ? String(p).padStart(2, "0") : String(p);
      const file = `${stem}-${pad}.png`;
      expect(existsSync(file), `pdftoppm produced page ${p}`).toBe(true);
      const paper = PNG.sync.read(readFileSync(file));
      expect(paper.width).toBe(816 * RASTER_SCALE);
      expect(paper.height).toBe(1056 * RASTER_SCALE);

      // Screen: the field's own content origin. Paper: inside the 0.5 in margin.
      const onScreen = bands(screen, 0, (p - 1) * PAGE_BODY_H * RASTER_SCALE, LINES_PER_PAGE);
      const onPaper = bands(paper, MARGIN * RASTER_SCALE, MARGIN * RASTER_SCALE, LINES_PER_PAGE);

      for (let k = 0; k < LINES_PER_PAGE; k++) {
        const a = onScreen[k]!;
        const b = onPaper[k]!;
        compared++;
        const where = `page ${p} line ${k + 1}`;
        // A band that carries ink on one surface and none on the other means a
        // line moved, and that is the failure this whole design exists to
        // prevent.
        if (!!a.ink !== !!b.ink) {
          failures.push(`${where}: inked on screen=${a.ink} paper=${b.ink}`);
          continue;
        }
        if (!a.ink) continue;
        inked++;
        const dMin = Math.abs(a.minX - b.minX);
        const dMax = Math.abs(a.maxX - b.maxX);
        extents.push({ page: p, line: k + 1, screen: a, paper: b });
        if (dMin <= 1 && dMax <= 1) withinOnePixel++;
        if (dMin > EXTENT_TOLERANCE || dMax > EXTENT_TOLERANCE) {
          failures.push(
            `${where}: x extent screen ${a.minX}-${a.maxX} vs paper ${b.minX}-${b.maxX}`,
          );
        }
      }
    }

    test.info().annotations.push({
      type: "bands",
      description:
        `${font}: ${compared} bands, ${inked} inked, ` +
        `${withinOnePixel} within 1 px, ${failures.length} beyond ${EXTENT_TOLERANCE} px`,
    });
    if (failures.length || withinOnePixel / inked < EXTENT_EXACT_SHARE) {
      writeFileSync(join(OUT, `fidelity-${font}-screen.png`), PNG.sync.write(screen));
      writeFileSync(join(OUT, `fidelity-${font}-extents.json`), JSON.stringify(extents, null, 2));
      writeFileSync(join(OUT, `fidelity-${font}-origin.json`), JSON.stringify(captureOrigin, null, 2));
    }
    expect(failures.slice(0, 10), `${compared} bands compared`).toEqual([]);
    expect(
      withinOnePixel / inked,
      `share of inked bands whose ink starts and ends within 1 px of the screen's`,
    ).toBeGreaterThanOrEqual(EXTENT_EXACT_SHARE);
  });
}

test("print is black on white even when the screen is White on black", async ({ page }) => {
  test.skip(!havePoppler(), NO_POPPLER);
  mkdirSync(OUT, { recursive: true });

  await open(page);
  await chooseMode(page, "hc");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "hc");
  await setText(page, CORPUS);
  const pages = await page.locator("#printdoc .page").count();

  const pdfPath = join(OUT, "high-contrast.pdf");
  await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
  writeFileSync(
    pdfPath,
    await page.pdf({
      format: "Letter",
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      preferCSSPageSize: true,
      printBackground: true, // the strictest case: even asked for, no black page
    }),
  );

  const stem = join(OUT, "high-contrast");
  execFileSync("pdftoppm", ["-r", String(96 * RASTER_SCALE), "-png", "-f", "1", "-l", "1", pdfPath, stem]);
  const paper = PNG.sync.read(readFileSync(`${stem}-1.png`));

  // Sample the paper well clear of any glyph: the top margin band.
  let dark = 0;
  for (let y = 4 * RASTER_SCALE; y < 40 * RASTER_SCALE; y++) {
    for (let x = 4 * RASTER_SCALE; x < 812 * RASTER_SCALE; x++) {
      const i = (y * paper.width + x) * 4;
      if (paper.data[i]! < 128) dark++;
    }
  }
  expect(dark, "the printed sheet is white paper, not a black rectangle").toBe(0);

  // And the words are still all there, in the same number of sheets.
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  expect(Number(/Pages:\s+(\d+)/.exec(info)?.[1])).toBe(pages);
});
