import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_POPPLER, havePoppler, open } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const CORPUS = readFileSync(join(repo, "tests", "fixtures", "corpus.txt"), "utf8");

const OUT =
  process.env["CP_ARTIFACTS"] ??
  "/tmp/claude-1000/-mnt-fast-git-cleanpage/0d261fa4-f1cc-411e-ae2f-dd8c17c61c21/scratchpad";

const LINES_PER_PAGE = 30;
const PAGE_BODY_H = 960;
const MARGIN = 48;

/** Set the document without going through 9000 synthetic key events. */
async function setText(page: import("@playwright/test").Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    ta.focus();
    ta.setRangeText(t, 0, ta.value.length, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  // layout() runs in a rAF, and the print doc is built on a 300 ms idle timer.
  await page.waitForTimeout(600);
}

test("a three-page corpus lays out, fits 1366x768, and prints the same pages", async ({ page }) => {
  await open(page);

  // The corpus alone is about six pages; typing enough of it to make three is
  // what the requirement is about, so use the whole thing and assert against
  // what the paginator actually measured.
  await expect(page.locator("#ta")).toBeFocused();
  await setText(page, CORPUS);

  // --- the metrics contract, which fails invisibly when it fails ------------
  const width = await page.evaluate(() => getComputedStyle(document.getElementById("ta")!).width);
  expect(width).toBe("720px");

  // --- page geometry --------------------------------------------------------
  const geom = await page.evaluate(() => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    const sheet = document.getElementById("sheet")!;
    const rules = Array.from(document.querySelectorAll<HTMLElement>("#breaks .rule"));
    return {
      taHeight: ta.getBoundingClientRect().height,
      sheetHeight: sheet.getBoundingClientRect().height,
      sheetWidth: sheet.getBoundingClientRect().width,
      ruleTops: rules.map((r) => parseFloat(r.style.top)),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      printPages: document.querySelectorAll("#printdoc .page").length,
    };
  });

  const pages = Math.round(geom.taHeight / PAGE_BODY_H);
  expect(pages).toBeGreaterThanOrEqual(3);
  expect(geom.taHeight).toBe(pages * PAGE_BODY_H);
  expect(geom.sheetHeight).toBe(pages * PAGE_BODY_H + 2 * MARGIN);
  expect(geom.sheetWidth).toBe(816);

  // One rule per page boundary, at 48 + k*960, numbered with the page it opens.
  expect(geom.ruleTops).toEqual(
    Array.from({ length: pages - 1 }, (_, i) => MARGIN + (i + 1) * PAGE_BODY_H),
  );

  // No horizontal scrollbar at 1366x768.
  expect(geom.scrollWidth).toBeLessThanOrEqual(geom.clientWidth);

  // The print DOM is one section per screen page.
  expect(geom.printPages).toBe(pages);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, "core-smoke.png") });

  // --- print media: the sheet count must not change -------------------------
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => {
    document.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("beforeprint"));
  });
  await page.waitForTimeout(100);
  const printPagesInPrintMedia = await page.locator("#printdoc .page").count();
  expect(printPagesInPrintMedia).toBe(pages);

  // The first word of each on-screen page, from the paginator's own slices.
  const firstWords: string[] = await page.evaluate((n) => {
    const secs = Array.from(document.querySelectorAll("#printdoc .page pre"));
    return secs.slice(0, n).map((s) => (s.textContent ?? "").trimStart().split(/\s+/)[0] ?? "");
  }, pages);
  expect(firstWords).toHaveLength(pages);

  // Each full page holds exactly 30 line boxes.
  const lineCounts = await page.evaluate((lpp) => {
    const secs = Array.from(document.querySelectorAll<HTMLElement>("#printdoc .page pre"));
    return secs.map((pre) => {
      const r = document.createRange();
      r.selectNodeContents(pre);
      const tops = new Set<number>();
      for (const rect of Array.from(r.getClientRects())) tops.add(Math.round(rect.top * 4) / 4);
      // adjacent fragments of one line share a top
      return { boxes: tops.size, lpp };
    });
  }, LINES_PER_PAGE);
  for (const c of lineCounts.slice(0, -1)) expect(c.boxes).toBe(LINES_PER_PAGE);
  expect(lineCounts[lineCounts.length - 1]!.boxes).toBeLessThanOrEqual(LINES_PER_PAGE);

  // --- the PDF ---------------------------------------------------------------
  // DECISIONS 7.9: the PDF half shells out to poppler. The layout half above
  // needs nothing, so record the thinner run and stop rather than skipping the
  // whole test.
  if (!havePoppler()) {
    test.info().annotations.push({ type: "poppler", description: NO_POPPLER });
    return;
  }
  const pdfPath = join(OUT, "core-smoke.pdf");
  const pdf = await page.pdf({
    format: "Letter",
    margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    preferCSSPageSize: true,
    printBackground: false,
  });
  writeFileSync(pdfPath, pdf);
  await page.emulateMedia({ media: null });

  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pdfPages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
  expect(pdfPages).toBe(pages);
  expect(info).toMatch(/Page size:\s+612 x 792 pts \(letter\)/);

  for (let p = 1; p <= pages; p++) {
    const text = execFileSync("pdftotext", ["-f", String(p), "-l", String(p), pdfPath, "-"], {
      encoding: "utf8",
    });
    const first = text.trimStart().split(/\s+/)[0] ?? "";
    expect(first, `first word of PDF page ${p}`).toBe(firstWords[p - 1]);
  }

});
