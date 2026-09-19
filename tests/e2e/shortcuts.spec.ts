import { expect, test, type Page } from "@playwright/test";
import { open, settle } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
  });
});

const BROWSER_OWNED = ["btnPrint"];

const acts: Record<string, (page: Page, keys: string) => Promise<void>> = {
  btnNew: async (page, keys) => {
    await page.locator("#ta").click();
    await page.keyboard.type("words in progress");
    await settle(page);
    await page.keyboard.press(keys);
    await expect(page.locator("#btnNew")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#dlg")).toBeVisible();
    await page.locator("#dlgGo").click();
    await expect(page.locator("#ta")).toHaveValue("");
  },
  btnOpen: async (page, keys) => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.keyboard.press(keys),
    ]);
    await chooser.setFiles({
      name: "from-a-friend.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("opened by shortcut\n", "utf8"),
    });
    await expect(page.locator("#ta")).toHaveValue("opened by shortcut\n");
  },
  btnSave: async (page, keys) => {
    await page.locator("#ta").click();
    await page.keyboard.type("worth keeping");
    await settle(page);
    await page.keyboard.press(keys);
    await expect(page.locator("#downloadDlg")).toBeVisible();
  },
  btnUndo: async (page, keys) => {
    await page.locator("#ta").click();
    await page.keyboard.type("a sentence");
    await settle(page);
    await page.keyboard.press(keys);
    await expect(page.locator("#ta")).not.toHaveValue("a sentence");
  },
  btnRedo: async (page, keys) => {
    await page.locator("#ta").click();
    await page.keyboard.type("a sentence");
    await settle(page);
    await page.keyboard.press("Control+Z");
    await expect(page.locator("#ta")).not.toHaveValue("a sentence");
    await page.keyboard.press(keys);
    await expect(page.locator("#ta")).toHaveValue("a sentence");
  },
  btnSettings: async (page, keys) => {
    await page.keyboard.press(keys);
    await expect(page.locator("#settingsDlg")).toBeVisible();
  },
};

test("the toolbar advertises no shortcut that nothing performs", async ({ page }) => {
  await open(page);
  const advertised = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("#toolbar [aria-keyshortcuts]")).map(
      (el) => el.id,
    ),
  );
  expect(advertised.sort()).toEqual([...Object.keys(acts), ...BROWSER_OWNED].sort());
});

for (const [id, act] of Object.entries(acts)) {
  test(`${id} does what its aria-keyshortcuts promises`, async ({ page }) => {
    await open(page);
    const keys = await page.locator(`#${id}`).getAttribute("aria-keyshortcuts");
    await act(page, keys!);
  });
}
