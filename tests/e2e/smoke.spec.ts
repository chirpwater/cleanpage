import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORPUS, MARGIN, NO_POPPLER, OUT, PAGE_BODY_H, geometry, havePoppler, open, pdfInfo, pdfPageCount, setText,
} from "./helpers.js";

test("a three-page corpus lays out, fits 1366x768, and prints the same pages", async ({ page }) => {
  await open(page);

  await expect(page.locator("#ta")).toBeFocused();
  await setText(page, CORPUS);

  const width = await page.evaluate(() => getComputedStyle(document.getElementById("ta")!).width);
  expect(width).toBe("720px");

  const geom = await geometry(page);

  const pages = geom.pages;
  expect(pages).toBeGreaterThanOrEqual(3);
  expect(geom.taHeight).toBe(pages * PAGE_BODY_H);
  expect(geom.sheetHeight).toBe(pages * PAGE_BODY_H + 2 * MARGIN);
  expect(geom.sheetWidth).toBe(816);

  expect(geom.ruleTops).toEqual(
    Array.from({ length: pages - 1 }, (_, i) => MARGIN + (i + 1) * PAGE_BODY_H),
  );

  expect(geom.scrollWidth).toBeLessThanOrEqual(geom.clientWidth);

  expect(geom.printPages).toBe(pages);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, "core-smoke.png") });

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => {
    document.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("beforeprint"));
  });
  await page.waitForTimeout(100);
  const printPagesInPrintMedia = await page.locator("#printdoc .page").count();
  expect(printPagesInPrintMedia).toBe(pages);

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

  expect(pdfPageCount(pdfPath)).toBe(pages);
  expect(pdfInfo(pdfPath)).toMatch(/Page size:\s+612 x 792 pts \(letter\)/);
});
