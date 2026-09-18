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
  await page.evaluate(() => {
    document.getElementById("printdoc")!.replaceChildren();
    dispatchEvent(new Event("beforeprint"));
  });
  await settle(page);

  const inPrint = await screenPages(page);
  expect(inPrint.length, "the mirror still measures under @media print").toBe(onScreen.length);
  expect(inPrint).toEqual(onScreen);

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

test("the built site serves the privacy statement", async ({ request }) => {
  const res = await request.get("/PRIVACY.txt");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain(
    "We do not collect, receive, store, or otherwise obtain any information about you",
  );
});
