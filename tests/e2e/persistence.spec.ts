import { expect, test } from "@playwright/test";
import { SETTINGS_KEY } from "../../src/storage.js";
import { engineUnavailable, ready } from "./helpers.js";

const STORY = "The next chapter\n猫 and a space traveller 👩🏽‍🚀\nTo be continued…\n";

test.beforeEach(({ browserName }) => {
  const unavailable = engineUnavailable(browserName);
  test.skip(!!unavailable, unavailable ?? "");
});

test("reload and reopened tabs start blank, while other tabs keep their own writing", async ({ page, context }) => {
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  const other = await context.newPage();
  await other.goto("./");
  await ready(other);
  await expect(other.locator("#ta")).toHaveValue("");
  await other.locator("#ta").fill("Another page");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue("");
  await expect(page.locator("#status")).toHaveAttribute("data-empty", "true");
  await expect(other.locator("#ta")).toHaveValue("Another page");
  await page.locator("#ta").fill(STORY);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("./");
  await ready(reopened);
  await expect(reopened.locator("#ta")).toHaveValue("");
});

test("only applied settings survive tab closure, and resetting settings preserves current writing", async ({ page, context }) => {
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  await page.locator("#btnSettings").click();
  await page.getByRole("radio", { name: "Sans-serif" }).check();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.locator("#settingsApply").click();
  await page.locator("#btnSettings").click();
  await page.getByRole("radio", { name: "Regular", exact: true }).check();
  await page.locator("#settingsCancel").click();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("./");
  await ready(reopened);
  await expect(reopened.locator("#ta")).toHaveValue("");
  await expect(reopened.locator("html")).toHaveAttribute("data-font", "sans");
  await expect(reopened.locator("html")).toHaveAttribute("data-size", "large");
  await expect(reopened.locator("html")).toHaveAttribute("data-theme", "dark");
  await reopened.locator("#ta").fill(STORY);
  await reopened.locator("#btnSettings").click();
  await reopened.locator("#settingsReset").click();
  await reopened.locator("#settingsApply").click();
  await expect(reopened.locator("#settingsDlg")).toBeHidden();
  await expect(reopened.locator("#ta")).toHaveValue(STORY);
  expect(await reopened.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY))
    .toEqual({ font: "serif", size: "regular", theme: "light", spell: "on" });
});

test("previously stored drafts are never restored", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cleanpage:draft:v1", JSON.stringify({ text: "Old writing", lastSavedText: "", fileName: null }));
    localStorage.setItem("cleanpage:draft:v2:old", JSON.stringify({ id: "old", text: "Old writing", lastSavedText: "", fileName: "Old.txt", updatedAt: 1 }));
    sessionStorage.setItem("cleanpage:document:v2", "old");
  });
  await page.goto("./");
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue("");
  await expect(page.locator("#statusName")).toBeEmpty();
});

test("denied storage keeps writing and close protection usable and reports settings save failure", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => { throw new DOMException("Disabled by policy", "SecurityError"); },
    });
  });
  await page.goto("./");
  await ready(page);
  await page.locator("#ta").fill(STORY);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await page.locator("#btnSettings").click();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.locator("#settingsApply").click();
  await expect(page.locator("#sayBody")).toHaveText("Could not keep your settings on this device.");
  await page.locator("#sayOk").click();
  await expect(page.locator("#ta")).toHaveValue(STORY);
  await expect(page.locator("#ta")).toBeEditable();
});
