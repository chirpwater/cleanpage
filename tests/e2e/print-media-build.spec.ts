/**
 * DESIGN §12.5 — the hidden-mirror regression.
 *
 * `#mcage` must never be named in a media query and must never be
 * `display: none` or `content-visibility: hidden`: it has to lay out in EVERY
 * medium. When the print stylesheet hid the mirror, the Range walk returned no
 * rects, line starts collapsed to hard newlines only, and a 4-page document
 * printed as 2 pages of 70 and 52 lines.
 *
 * So: switch to the print medium, rebuild the print DOM from scratch there, and
 * assert the sheet count and every sheet's line-box count are unchanged.
 */
import { expect, test } from "@playwright/test";
import { CORPUS, LINES_PER_PAGE, open, screenPages, setText, settle } from "./helpers.js";

test("building the print DOM under print media gives the same sheets as the screen", async ({
  page,
}) => {
  await open(page);
  await setText(page, CORPUS);
  const onScreen = await screenPages(page);
  expect(onScreen.length).toBeGreaterThanOrEqual(3);

  await page.emulateMedia({ media: "print" });
  // Throw the cached build away, so the rebuild happens with the mirror
  // laying out in the print medium — which is the thing under test.
  await page.evaluate(() => {
    document.getElementById("printdoc")!.replaceChildren();
    dispatchEvent(new Event("beforeprint"));
  });
  await settle(page);

  const inPrint = await screenPages(page);
  expect(inPrint.length, "the mirror still measures under @media print").toBe(onScreen.length);
  expect(inPrint).toEqual(onScreen);

  // The mirror's cage must still have a laid-out box.
  const cage = await page.evaluate(() => {
    const mcage = document.getElementById("mcage")!;
    const mirror = document.getElementById("mirror")!;
    return {
      cageDisplay: getComputedStyle(mcage).display,
      mirrorDisplay: getComputedStyle(mirror).display,
      mirrorRects: mirror.getClientRects().length,
    };
  });
  expect(cage.cageDisplay).not.toBe("none");
  expect(cage.mirrorDisplay).not.toBe("none");
  expect(cage.mirrorRects, "the mirror lays out a box in the print medium").toBeGreaterThan(0);

  // Every full sheet is exactly 30 line boxes; the last one is at most 30.
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("#printdoc .page pre")).map((pre) => {
      const r = document.createRange();
      r.selectNodeContents(pre);
      const tops = new Set<number>();
      for (const rect of Array.from(r.getClientRects())) tops.add(Math.round(rect.top * 4) / 4);
      return tops.size;
    }),
  );
  for (const b of boxes.slice(0, -1)) expect(b).toBe(LINES_PER_PAGE);
  expect(boxes[boxes.length - 1]!).toBeLessThanOrEqual(LINES_PER_PAGE);

  await page.emulateMedia({ media: null });
});
