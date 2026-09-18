import { expect, test } from "@playwright/test";
import { open, setText } from "./helpers.js";

test("a storage abort after choosing a save file reports failure and keeps the writing", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)["showSaveFilePicker"] = async () => ({
      name: "story.txt",
      createWritable: async () => ({
        write: async () => { throw new DOMException("The disk write was aborted", "AbortError"); },
        close: async () => undefined,
      }),
    });
  });
  await open(page);
  await setText(page, "My story remains unsaved.");
  await page.locator("#btnSave").click();
  await expect(page.locator("#say")).toBeVisible();
  await expect(page.locator("#sayBody")).toHaveText("Sorry, that did not save. Try again.");
  await expect(page.locator("#ta")).toHaveValue("My story remains unsaved.");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
});

test("a storage abort after choosing an open file reports failure", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [{
      name: "story.txt",
      getFile: async () => { throw new DOMException("The disk read was aborted", "AbortError"); },
    }];
  });
  await open(page);
  await page.locator("#btnOpen").click();
  await expect(page.locator("#say")).toBeVisible();
  await expect(page.locator("#sayBody")).toHaveText("Sorry, that file did not open. Try again.");
  await expect(page.locator("#ta")).toHaveValue("");
});

test("cancelling either native picker stays quiet and preserves the document", async ({ page }) => {
  await page.addInitScript(() => {
    const cancel = async () => { throw new DOMException("Picker cancelled", "AbortError"); };
    window.showOpenFilePicker = cancel;
    window.showSaveFilePicker = cancel;
  });
  await open(page);
  await page.locator("#btnOpen").click();
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("#say")).toBeHidden();
  await setText(page, "Keep my draft.");
  await page.locator("#btnSave").click();
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("#say")).toBeHidden();
  await expect(page.locator("#ta")).toHaveValue("Keep my draft.");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
});
