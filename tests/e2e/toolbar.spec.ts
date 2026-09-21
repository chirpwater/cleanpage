import { expect, test } from "@playwright/test";
import { contrast, open } from "./helpers.js";

const TOOLS = ["New", "Open", "Download", "Print", "Copy", "Undo", "Redo", "Settings"];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// No file picker on the phone, so Save wears its widest label, "Download".
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
});

test("on a phone every tool stays on screen and the bar stays out of the way", async ({ page }) => {
  await open(page);
  const toolbar = page.locator("#toolbar");

  await expect(toolbar.getByRole("button"), "no tool is dropped or hidden away").toHaveCount(
    TOOLS.length,
  );
  for (const name of TOOLS) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
  }

  const bar = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll("#toolbar button")).map((b) =>
      b.getBoundingClientRect(),
    );
    const root = document.documentElement;
    return {
      height: document.getElementById("bar")!.getBoundingClientRect().height,
      rows: new Set(boxes.map((r) => Math.round(r.top))).size,
      shortest: Math.min(...boxes.map((r) => r.height)),
      sideways: root.scrollWidth > root.clientWidth,
    };
  });

  expect(bar.rows, "the file actions on one row, the rest on a second").toBeLessThanOrEqual(2);
  expect(bar.height, "two rows of buttons, not a slab").toBeLessThanOrEqual(2 * 44 + 16);
  expect(bar.shortest, "a fingertip still gets 44 px").toBeGreaterThanOrEqual(44);
  expect(bar.sideways, "nothing is pushed off the side").toBe(false);
});

test("a tool a child cannot use yet is still a tool a child can read", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");

  const paint = await page.evaluate(() => ({
    bar: getComputedStyle(document.getElementById("bar")!).backgroundColor,
    off: getComputedStyle(document.getElementById("btnUndo")!).color,
    on: getComputedStyle(document.getElementById("btnNew")!).color,
  }));
  const quiet = contrast(paint.off, paint.bar);

  expect(quiet, "Undo reads even when it does nothing").toBeGreaterThanOrEqual(4.5);
  expect(quiet, "and still reads as the quieter of the two").toBeLessThan(
    contrast(paint.on, paint.bar),
  );
});

test("Copy copies all writing without moving the caret", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.locator("#ta").fill("First line\nSecond line");
  await page.locator("#ta").evaluate((element) => {
    (element as HTMLTextAreaElement).setSelectionRange(5, 5);
  });
  await page.locator("#btnCopy").click();

  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("#statusWord")).toHaveText("Copied to clipboard");
  expect(await page.locator("#ta").evaluate((element) => {
    const ta = element as HTMLTextAreaElement;
    return { start: ta.selectionStart, end: ta.selectionEnd, length: ta.value.length };
  })).toEqual({ start: 5, end: 5, length: 22 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("First line\nSecond line");
  await expect(page.locator("#statusWord")).toBeEmpty({ timeout: 2500 });
});
