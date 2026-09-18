/**
 * DESIGN §12.7 — the paper is always 816 CSS px, and the geometry is integers.
 *
 * No shrink-to-fit transform: it would cancel the student's own browser zoom,
 * and Chromium has had bugs positioning IME candidate windows inside
 * transformed subtrees. A fixed paper page is content that requires
 * two-dimensional layout, which SC 1.4.10 exempts.
 */
import { expect, test } from "@playwright/test";
import { CORPUS, MARGIN, PAGE_BODY_H, geometry, open, setText } from "./helpers.js";

for (const width of [1366, 1093, 911]) {
  test(`no horizontal scroll at ${width}px with a multi-page document`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await open(page);
    await setText(page, CORPUS);
    const g = await geometry(page);
    expect(g.scrollWidth, `${width}px viewport`).toBeLessThanOrEqual(g.clientWidth);
    expect(g.sheetWidth).toBe(816);
    expect(g.taWidth).toBe("720px");
  });
}

/**
 * 820 px is where DESIGN contradicts itself. §4 states, from measurement, that
 * "no horizontal scroll appears until an 820 px viewport"; §12.7 then asks for
 * no horizontal scroll AT 820 px. With an 816 px sheet and a ~15 px vertical
 * scrollbar that is arithmetically impossible, and the answer §15 gives for
 * SC 1.4.10 is the two-dimensional-layout exception, not a narrower sheet.
 *
 * So this test pins what the design actually decided: at 820 px the paper is
 * still whole and still 816 px, and the desk has already given up its own side
 * margin for it. A horizontal scrollbar here is the documented fallback.
 */
test("at 820px the paper is still whole, and the desk gives up its margin first", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 768 });
  await open(page);
  await setText(page, CORPUS);
  const m = await page.evaluate(() => {
    const desk = getComputedStyle(document.getElementById("desk")!);
    const sheet = document.getElementById("sheet")!.getBoundingClientRect();
    return {
      deskPadLeft: desk.paddingLeft,
      deskPadRight: desk.paddingRight,
      sheetWidth: sheet.width,
      sheetLeft: sheet.left,
    };
  });
  expect(m.sheetWidth, "never scaled, never clipped").toBe(816);
  expect(m.deskPadLeft).toBe("0px");
  expect(m.deskPadRight).toBe("0px");
  expect(m.sheetLeft).toBeGreaterThanOrEqual(0);
});

test("the page geometry is exact integers: rules at 48 + k*960, sheet at pages*960 + 96", async ({
  page,
}) => {
  await open(page);
  await setText(page, CORPUS);
  const g = await geometry(page);

  expect(g.pages).toBeGreaterThanOrEqual(4);
  expect(g.taHeight).toBe(g.pages * PAGE_BODY_H);
  expect(g.sheetHeight).toBe(g.pages * PAGE_BODY_H + 2 * MARGIN);
  expect(g.ruleTops).toEqual(
    Array.from({ length: g.pages - 1 }, (_, k) => MARGIN + (k + 1) * PAGE_BODY_H),
  );
  expect(g.printPages).toBe(g.pages);
});

test("browser zoom does not desynchronise the screen from the print", async ({ browser }) => {
  // Line breaking must be DPR-invariant, or zooming would repaginate.
  const seen: number[][] = [];
  for (const deviceScaleFactor of [1, 1.25, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor,
    });
    const page = await context.newPage();
    await open(page);
    await setText(page, CORPUS);
    seen.push(
      await page.evaluate(() =>
        (window as unknown as { __tpLineStarts: () => number[] }).__tpLineStarts(),
      ),
    );
    await context.close();
  }
  expect(seen[1], "line starts at DPR 1.25 match DPR 1").toEqual(seen[0]);
  expect(seen[2], "line starts at DPR 2 match DPR 1").toEqual(seen[0]);
});
