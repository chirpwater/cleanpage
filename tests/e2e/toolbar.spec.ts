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

test("on a phone undo and redo stay in the bar and the rest fold into one menu", async ({ page }) => {
  await open(page);
  const toolbar = page.locator("#toolbar");
  const menu = toolbar.getByRole("button", { name: "Menu", exact: true });

  for (const name of TOOLS) {
    const button = toolbar.getByRole("button", { name, exact: true });
    if (name === "Undo" || name === "Redo") await expect(button).toBeVisible();
    else await expect(button).toBeHidden();
  }
  const bar = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      height: document.getElementById("bar")!.getBoundingClientRect().height,
      sideways: root.scrollWidth > root.clientWidth,
    };
  });
  expect(bar.height, "one row of buttons, not a slab").toBeLessThanOrEqual(44 + 16);
  expect(bar.sideways, "nothing is pushed off the side").toBe(false);

  await menu.tap();
  const rows = await page.locator("#tools .btn").evaluateAll((buttons) =>
    new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size,
  );
  expect(rows, "the menu is a short grid, not a long list").toBeLessThanOrEqual(2);
  for (const name of TOOLS) {
    const button = toolbar.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height, "a fingertip still gets 44 px").toBeGreaterThanOrEqual(44);
  }

  await toolbar.getByRole("button", { name: "Copy", exact: true }).tap();
  await expect(toolbar.getByRole("button", { name: "Copy", exact: true }), "the menu closes once a tool is used").toBeHidden();
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
  await page.locator("#btnMenu").click();
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
