import { expect, test, type Page } from "@playwright/test";
import { DRAFT_KEY, DRAFT_RECORD_PREFIX } from "../../src/storage.js";
import { DRAFT_SESSION_KEY } from "../../src/drafts.js";
import { engineUnavailable, ready, storedDraft } from "./helpers.js";

test.skip(({ browserName }) => engineUnavailable(browserName) !== null, "browser build not cached");

const first = "The first story\nA bird by the water. 🐦";
const second = "Another adventure\nA little boat sails away.";

async function openPage(page: Page): Promise<void> {
  await page.goto("./");
  await ready(page);
}

async function recovery(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /^Recover previous draft \(/ }).click();
}

test("a second tab starts blank, and both tabs retain independent drafts across reloads", async ({ page, context }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  const one = await storedDraft(page);
  const other = await context.newPage();
  await openPage(other);
  await expect(other.locator("#ta")).toHaveValue("");
  await other.locator("#ta").fill(second);
  const two = await storedDraft(other);
  expect(two!.id).not.toBe(one!.id);
  await page.locator("#ta").fill(first + " One more line.");
  await Promise.all([page.reload(), other.reload()]);
  await Promise.all([ready(page), ready(other)]);
  await expect(page.locator("#ta")).toHaveValue(first + " One more line.");
  await expect(other.locator("#ta")).toHaveValue(second);
  expect((await storedDraft(page))!.id).toBe(one!.id);
  expect((await storedDraft(other))!.id).toBe(two!.id);
});

test("closing all tabs resumes the most recently edited writing, not a newer blank tab", async ({ page, context }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  const other = await context.newPage();
  await openPage(other);
  await other.locator("#ta").fill(second);
  const blank = await context.newPage();
  await openPage(blank);
  await expect(blank.locator("#ta")).toHaveValue("");
  await Promise.all([page.close(), other.close(), blank.close()]);
  const reopened = await context.newPage();
  await openPage(reopened);
  await expect(reopened.locator("#ta")).toHaveValue(second);
  await expect(reopened.locator("dialog[open]")).toHaveCount(0);
});

test("a cold browser context recovers local writing without session storage or a startup dialog", async ({ page, context, browser, baseURL }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  const state = await context.storageState();
  const cold = await browser.newContext({ storageState: state, baseURL: baseURL! });
  try {
    const reopened = await cold.newPage();
    await openPage(reopened);
    await expect(reopened.locator("#ta")).toHaveValue(first);
    await expect(reopened.locator("dialog[open]")).toHaveCount(0);
    await expect(reopened.locator("#statusWord")).toBeEmpty();
    await expect(reopened.locator("#status")).toHaveCSS("visibility", "hidden");
  } finally { await cold.close(); }
});

test("confirmed New retains writing and recovery is always present, including zero", async ({ page }) => {
  await openPage(page);
  await recovery(page);
  await expect(page.getByRole("button", { name: "Recover previous draft (0)", exact: true })).toBeVisible();
  await expect(page.getByText("No previous drafts.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator("#ta").fill(first);
  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await recovery(page);
  await expect(page.getByRole("button", { name: "Recover previous draft (1)", exact: true })).toBeVisible();
  await expect(page.getByText("The first story", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Round letters", exact: true }).check();
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.locator("#settingsDlg")).toBeHidden();
  await expect(page.locator("#ta")).toHaveValue(first);
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
});

test("recovering a draft still open in another tab makes an independent copy", async ({ page, context }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  const original = await storedDraft(page);
  const other = await context.newPage();
  await openPage(other);
  await recovery(other);
  await other.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(other.locator("#ta")).toHaveValue(first);
  expect((await storedDraft(other))!.id).not.toBe(original!.id);
  await other.locator("#ta").fill(second);
  await page.reload();
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue(first);
});

test("an opener-copied tab session forks without stealing the original document", async ({ page, context }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  const original = await storedDraft(page);
  const popupPromise = context.waitForEvent("page");
  await page.evaluate(() => window.open(location.href, "_blank"));
  const duplicate = await popupPromise;
  await ready(duplicate);
  await expect(duplicate.locator("#ta")).toHaveValue(first);
  expect((await storedDraft(duplicate))!.id).not.toBe(original!.id);
  await duplicate.locator("#ta").fill(second);
  expect((await storedDraft(page))!.text).toBe(first);
});

test("simultaneous startups claim the recovered draft only once", async ({ page, context }) => {
  await page.goto("/privacy.html");
  await page.evaluate(({ key, text }) => localStorage.setItem(key, JSON.stringify({ text, lastSavedText: "", fileName: null })),
    { key: DRAFT_KEY, text: first });
  const other = await context.newPage();
  await Promise.all([openPage(page), openPage(other)]);
  const values = await Promise.all([page.locator("#ta").inputValue(), other.locator("#ta").inputValue()]);
  expect(values.sort()).toEqual(["", first].sort());
  const ids = await Promise.all([page, other].map((tab) => tab.evaluate((key) => sessionStorage.getItem(key), DRAFT_SESSION_KEY)));
  expect(ids[0]).not.toBe(ids[1]);
});

test("migration preserves the previous file-save checkpoint and removes the legacy key only after storage succeeds", async ({ page }) => {
  await page.goto("/privacy.html");
  await page.evaluate(({ key, text }) => localStorage.setItem(key, JSON.stringify({ text, lastSavedText: text, fileName: "Bird.txt" })),
    { key: DRAFT_KEY, text: first });
  await openPage(page);
  await expect(page.locator("#ta")).toHaveValue(first);
  await expect(page.locator("#statusWord")).toHaveText("Changes saved");
  expect((await storedDraft(page))!.lastSavedText).toBe(first);
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBeNull();
  await page.locator("#ta").press("End");
  await page.keyboard.type(" More.");
  await expect(page.locator("#statusWord")).toBeEmpty();
  await expect(page.locator("#status")).toHaveCSS("visibility", "hidden");
});

test("recovery cannot replace unsaved writing when its background storage fails", async ({ page }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  await page.locator("#btnNew").click();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await page.evaluate((prefix) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix)) throw new DOMException("Full", "QuotaExceededError");
      set.call(this, key, value);
    };
  }, DRAFT_RECORD_PREFIX);
  await page.locator("#ta").fill(second);
  await recovery(page);
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.locator("#settingsDlg")).toBeVisible();
  await expect(page.locator("#ta")).toHaveValue(second);
  await expect(page.getByText("Save or download your writing before opening another draft.", { exact: true })).toBeVisible();
});

test("recovery snippets render as text rather than executable markup", async ({ page }) => {
  await openPage(page);
  const text = '<img src=x onerror="window.injected=true">';
  await page.locator("#ta").fill(text);
  await page.locator("#btnNew").click();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await recovery(page);
  await expect(page.locator("#recoveryList").getByText(text, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected)).toBeUndefined();
  await expect(page.locator('#settingsDlg img[src="x"]')).toHaveCount(0);
});

test("the recovery count updates while Settings is open in another tab", async ({ page, context }) => {
  await openPage(page);
  await recovery(page);
  await expect(page.locator("#settingsRecover")).toHaveText("Recover previous draft (0)");
  const other = await context.newPage();
  await openPage(other);
  await other.locator("#ta").fill(first);
  await expect(page.locator("#settingsRecover")).toHaveText("Recover previous draft (1)");
  await expect(page.locator("#recoveryList")).toContainText("The first story");
  await other.locator("#ta").fill(second);
  await expect(page.locator("#recoveryList")).toContainText("Another adventure");
});

test("a suspended page reacquires ownership without overwriting a new owner", async ({ page, context }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  const original = await storedDraft(page);
  // Exercise the persisted page lifecycle deterministically; whether a browser
  // elects to use its back/forward cache for a real navigation is discretionary.
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  const other = await context.newPage();
  await openPage(other);
  await expect(other.locator("#ta")).toHaveValue(first);
  expect((await storedDraft(other))!.id).toBe(original!.id);
  await other.locator("#ta").fill(second);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await ready(page);
  await expect(page.locator("#ta")).toHaveValue(first);
  expect((await storedDraft(page))!.id).not.toBe(original!.id);
  await page.locator("#ta").fill(first + " More writing.");
  expect((await storedDraft(other))!.text).toBe(second);
});

test("Tab cannot programmatically change the temporarily read-only editor", async ({ page }) => {
  await openPage(page);
  await page.locator("#ta").fill(first);
  await page.evaluate(() => { (document.getElementById("ta") as HTMLTextAreaElement).readOnly = true; });
  await page.locator("#ta").press("Tab");
  await expect(page.locator("#ta")).toHaveValue(first);
  expect((await storedDraft(page))!.text).toBe(first);
});

test("a storage warning follows writing versus whitespace even when file status stays dirty", async ({ page }) => {
  await openPage(page);
  await page.evaluate((prefix) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix)) throw new DOMException("Full", "QuotaExceededError");
      set.call(this, key, value);
    };
  }, DRAFT_RECORD_PREFIX);
  await page.locator("#ta").fill(" ");
  await expect(page.locator("#storageWarning")).toBeHidden();
  await page.locator("#ta").fill(" A");
  await expect(page.locator("#storageWarning")).toBeVisible();
  await page.locator("#ta").fill("  ");
  await expect(page.locator("#storageWarning")).toBeHidden();
});
