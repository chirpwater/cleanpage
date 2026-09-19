import { expect, test } from "@playwright/test";

test("the background font does not delay the editor", async ({ page }) => {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/fonts/OpenDyslexic-Regular.woff2", async (route) => {
    await held;
    await route.continue();
  });

  const requested = page.waitForRequest("**/fonts/OpenDyslexic-Regular.woff2");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await requested;
  try {
    await expect(page.locator("#ta")).toBeEditable();
    await expect(page.locator("#ta")).toBeFocused();
  } finally {
    release();
  }
});
