import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#ta")).toBeFocused();
});

test("settings are pending until Apply, and Reset stages the defaults", async ({ page }) => {
  const root = page.locator("html");
  await expect(page.locator("#bar input[type=radio]")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Sans-serif" }).check();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await expect(root).toHaveAttribute("data-font", "serif");
  await expect(root).toHaveAttribute("data-size", "regular");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#settingsDlg")).not.toBeVisible();
  await expect(root).toHaveAttribute("data-font", "sans");
  await expect(root).toHaveAttribute("data-size", "large");
  await expect(page.locator("#ta")).toBeFocused();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#settingsReset").click();
  await expect(page.locator("#settingsDlg")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Serif", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Regular", exact: true })).toBeChecked();
  await expect(root).toHaveAttribute("data-font", "sans");
  await expect(root).toHaveAttribute("data-size", "large");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Sans-serif" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Large", exact: true })).toBeChecked();
  await page.locator("#settingsReset").click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#settingsDlg")).not.toBeVisible();
  await expect(root).toHaveAttribute("data-font", "serif");
  await expect(root).toHaveAttribute("data-size", "regular");
});

test("Cancel and Escape discard choices and return to the writing selection", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.fill("A place to keep my writing.");
  await ta.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 7));
  for (const dismiss of ["cancel", "escape"] as const) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name: "Sans-serif" }).check();
    await page.getByRole("radio", { name: "Regular", exact: true }).check();
    if (dismiss === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(page.locator("#settingsDlg")).not.toBeVisible();
    await expect(ta).toBeFocused();
    expect(await ta.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
    await expect(page.locator("html")).toHaveAttribute("data-size", "regular");
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Serif", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Regular", exact: true })).toBeChecked();
});

test("applied choices survive closing the tab and opening another", async ({ page, context }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Sans-serif" }).check();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.locator("html")).toHaveAttribute("data-font", "sans");
  await expect(reopened.locator("html")).toHaveAttribute("data-size", "large");
  await expect(reopened.locator("html")).toHaveAttribute("data-theme", "dark");
  await reopened.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(reopened.getByRole("radio", { name: "Sans-serif" })).toBeChecked();
  await expect(reopened.getByRole("radio", { name: "Large", exact: true })).toBeChecked();
  await expect(reopened.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
});

test("each size shares metrics between writing, measurement, and printed pages", async ({ page }) => {
  await page.locator("#ta").fill(Array.from({ length: 25 }, (_, index) => `Line ${index + 1}`).join("\n"));
  for (const [name, fontSize, lineHeight, pageCount] of [
    ["Regular", "16px", "32px", 1],
    ["Large", "24px", "48px", 2],
  ] as const) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name, exact: true }).check();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(page.locator("#printdoc .page")).toHaveCount(pageCount);
    for (const selector of ["#ta", "#mirror", "#printdoc .page pre"]) {
      await expect(page.locator(selector).first()).toHaveCSS("font-size", fontSize);
      await expect(page.locator(selector).first()).toHaveCSS("line-height", lineHeight);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  }
});

test("the compact toolbar and settings remain usable in a small zoomed viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 256 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(320);
  expect(box!.height).toBeLessThanOrEqual(256);
  const applyBox = await page.getByRole("button", { name: "Apply", exact: true }).boundingBox();
  expect(applyBox!.y).toBeGreaterThanOrEqual(0);
  expect(applyBox!.y + applyBox!.height, "actions stay on screen without scrolling").toBeLessThanOrEqual(256);
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-size", "large");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#ta")).toBeFocused();
});

test("keyboard focus cycles within settings", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const firstChoice = page.getByRole("radio", { name: "Serif", exact: true });
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await apply.focus();
  await page.keyboard.press("Tab");
  await expect(firstChoice).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(apply).toBeFocused();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      document.getElementById("settingsDlg")!.contains(document.activeElement),
    );
    expect(inside).toBe(true);
  }
});
