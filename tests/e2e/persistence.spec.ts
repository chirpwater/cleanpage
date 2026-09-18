import { expect, test } from "@playwright/test";
import { DRAFT_KEY, SETTINGS_KEY } from "../../src/storage.js";
import { ready, storedDraft } from "./helpers.js";

const STORY = "The next chapter\n猫 and a space traveller 👩🏽‍🚀\nTo be continued…\n";

test("the current draft returns after reload and after closing and reopening its tab", async ({ page, context }) => {
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");

  // No debounce or unload callback may be needed for the last input to survive.
  await page.reload();
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue(STORY);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("./");
  await ready(reopened);
  await expect(reopened.locator("#ta")).toHaveValue(STORY);
  await expect(reopened.locator("#status")).toHaveAttribute("data-state", "dirty");
});

test("only applied settings survive tab closure, and resetting settings preserves writing", async ({ page, context }) => {
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters" }).click();
  await page.getByRole("radio", { name: "White on black" }).click();
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-size", "medium");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-size", "large");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Small", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto("./");
  await ready(reopened);
  await expect(reopened.locator("#ta")).toHaveValue(STORY);
  await expect(reopened.locator("html")).toHaveAttribute("data-size", "large");
  await reopened.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(reopened.getByRole("radio", { name: "Round letters" })).toBeChecked();
  await expect(reopened.getByRole("radio", { name: "White on black" })).toBeChecked();
  await expect(reopened.getByRole("radio", { name: "Large", exact: true })).toBeChecked();
  await reopened.getByRole("button", { name: "Reset all settings to default", exact: true }).click();
  await expect(reopened.locator("html")).toHaveAttribute("data-size", "large");
  await reopened.getByRole("button", { name: "Apply", exact: true }).click();
  await reopened.reload();
  await ready(reopened);
  await expect(reopened.locator("#ta")).toHaveValue(STORY);
  await expect(reopened.locator("html")).toHaveAttribute("data-size", "medium");
  expect(await reopened.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY))
    .toEqual({ font: "serif", mode: "reg", size: "medium" });
});

test("malformed stored data does not prevent editing or saving a replacement draft", async ({ page }) => {
  await page.addInitScript(({ draftKey, settingsKey }) => {
    localStorage.setItem(draftKey, '{"text":');
    localStorage.setItem(settingsKey, JSON.stringify({ font: "comic", mode: "reg", size: 999 }));
  }, { draftKey: DRAFT_KEY, settingsKey: SETTINGS_KEY });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("data-size", "medium");
  await page.locator("#ta").fill(STORY);
  expect((await storedDraft(page))?.text).toBe(STORY);
  expect(errors).toEqual([]);
});

test("denied storage keeps the editor usable and warns instead of claiming recovery", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => { throw new DOMException("Disabled by policy", "SecurityError"); },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
  await expect(page.locator("#storageWarning")).toBeVisible();
  await expect(page.locator("#ta")).toHaveValue(STORY);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  expect(errors).toEqual([]);
});

test("quota failure leaves the previous draft intact and does not claim the new text was saved", async ({ page }) => {
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill("Earlier recoverable writing");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  });
  await page.locator("#ta").fill(STORY);
  await expect(page.locator("#storageWarning")).toBeVisible();
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
  expect((await storedDraft(page))?.text)
    .toBe("Earlier recoverable writing");
});

test("confirmed New retains the previous draft, and the new blank page stays blank on reload", async ({ page }) => {
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  await page.reload();
  await ready(page);
  const previous = await storedDraft(page);
  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem("cleanpage:draft:v2:" + id)!).text, previous!.id))
    .toBe(STORY);
  await page.reload();
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue("");
});
