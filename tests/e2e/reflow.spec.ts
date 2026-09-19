import { expect, test } from "@playwright/test";
import { CONTENT_W, CORPUS, numberedLines, open, setText, settle } from "./helpers.js";

const surface = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      column: ta.clientWidth,
      content: ta.scrollHeight,
      box: ta.clientHeight,
      printPages: document.querySelectorAll("#printdoc .page").length,
    };
  });

// 683 and 320 CSS px are 200% and 400% browser zoom at this suite's 1366 px viewport.
for (const width of [683, 320]) {
  test(`at ${width} px the writing reflows instead of scrolling sideways`, async ({ page }) => {
    await open(page);
    await setText(page, CORPUS);
    const wide = await surface(page);

    await page.setViewportSize({ width, height: 768 });
    await settle(page);
    const narrow = await surface(page);

    expect(narrow.scrollWidth, "nothing to scroll sideways to").toBeLessThanOrEqual(
      narrow.clientWidth,
    );
    expect(narrow.column, "the column narrows with the viewport").toBeLessThan(CONTENT_W);
    expect(narrow.content, "no line is clipped out of the field").toBeLessThanOrEqual(narrow.box);
    expect(narrow.printPages, "the paper is still paginated at 720 px").toBe(wide.printPages);
  });
}

test("the page says why the break lines are gone, instead of losing them silently", async ({
  page,
}) => {
  await open(page);
  await setText(page, CORPUS);
  const rules = page.locator("#breaks .rule");
  const note = page.locator("#breaknote");

  expect(await rules.count(), "the paper's breaks are drawn at the paper's width").toBeGreaterThan(0);
  await expect(note).toBeHidden();

  await page.setViewportSize({ width: 683, height: 768 });
  await settle(page);
  await expect(rules, "a rule here would mark a place the paper does not break").toHaveCount(0);
  await expect(note, "so the reader is told, not left guessing").toBeVisible();

  await page.setViewportSize({ width: 1366, height: 768 });
  await settle(page);
  await expect(note).toBeHidden();
  expect(await rules.count()).toBeGreaterThan(0);
});

test("the announced page count names the paper once the screen stops matching it", async ({
  page,
}) => {
  await open(page);
  await setText(page, CORPUS);
  const count = page.locator("#pagecount");
  await expect(count).toHaveText(/^Now \d+ pages\.$/);

  await page.setViewportSize({ width: 683, height: 768 });
  await settle(page);
  await expect(count, "same sheets, but the screen no longer shows them").toHaveText(
    /^Now \d+ pages on paper\.$/,
  );

  await page.setViewportSize({ width: 1366, height: 768 });
  await settle(page);
  await expect(count).toHaveText(/^Now \d+ pages\.$/);
});

test("the browser's font-size preference enlarges the writing and repaginates the paper", async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: 24, fixed: 24 } });

  await open(page);
  const type = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("ta")!);
    return {
      root: getComputedStyle(document.documentElement).fontSize,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
    };
  });
  expect(type.root, "the preferred size roots the page").toBe("24px");
  expect(type.fontSize, "small text follows the preference").toBe("24px");
  expect(type.lineHeight).toBe("48px");

  // 960 px of paper body at a 48 px line box is 20 lines to the sheet.
  await setText(page, numberedLines(50));
  await expect(page.locator("#printdoc .page")).toHaveCount(3);
});
