import { expect, test } from "@playwright/test";
import { engineUnavailable, open } from "./helpers.js";

test.skip(({ browserName }) => engineUnavailable(browserName) !== null, "browser build not cached");

test("Mac navigation uses Control+Option and announces the matching shortcut", async ({ page }) => {
  // Verify platform routing, not a claim of hardware/VoiceOver validation.
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  await open(page);
  await expect(page.locator("#tabhint")).toContainText("Control, Option and F");
  await page.keyboard.press("Alt+f");
  await expect(page.locator("#ta")).toBeFocused();
  await page.keyboard.press("Control+Alt+f");
  await expect(page.locator("#btnNew")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeFocused();
  await page.keyboard.press("Control+Alt+t");
  await expect(page.locator("#settingsDlg")).toBeVisible();
});

test("ChromeOS Docs File/Edit/Tools shortcuts and compatibility variants reach the controls", async ({ page }) => {
  await open(page);
  await page.locator("#ta").fill("Keep this writing.");
  for (const modifier of ["Alt", "Alt+Shift"]) {
    await page.keyboard.press(`${modifier}+f`);
    await expect(page.locator("#btnNew")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ta")).toBeFocused();
    await page.keyboard.press(`${modifier}+e`);
    await expect(page.locator("#btnUndo")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press(`${modifier}+t`);
    await expect(page.locator("#settingsDlg")).toBeVisible();
    // Modal keys must not accidentally activate a background file action.
    await page.keyboard.press("Alt+f");
    await expect(page.locator("#settingsDlg")).toBeVisible();
    await expect(page.locator("#dlg")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ta")).toBeFocused();
  }
  await expect(page.locator("#ta")).toHaveValue("Keep this writing.");
});

test("toolbar arrow keys wrap, Home/End work, and Tab returns to writing", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Alt+f");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#btnSettings")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#btnNew")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("#btnSettings")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#btnNew")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator('#toolbar button[tabindex="0"]')).toHaveCount(1);
});

test("Docs move-out and ChromeOS landmark shortcuts preserve writing selection", async ({ page }) => {
  await open(page);
  await page.locator("#ta").fill("My next sentence.");
  await page.locator("#ta").evaluate((ta: HTMLTextAreaElement) => ta.setSelectionRange(3, 7));
  for (const shortcut of ["Control+Alt+Shift+m", "Alt+Shift+Period", "Alt+Shift+Comma"]) {
    await page.keyboard.press(shortcut);
    expect(await page.locator("#toolbar").evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("#ta")).toBeFocused();
    expect(await page.locator("#ta").evaluate((ta: HTMLTextAreaElement) => [ta.selectionStart, ta.selectionEnd])).toEqual([3, 7]);
  }
});
