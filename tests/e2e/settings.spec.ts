import { expect, test } from "@playwright/test";
import { DRAFT_LOCK_PREFIX, DRAFT_SESSION_KEY } from "../../src/drafts.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#ta")).toBeFocused();
});

test("settings are drafts until Apply, including Reset all settings to default", async ({ page }) => {
  const root = page.locator("html");
  await expect(page.locator("#bar input[type=radio]")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters" }).check();
  await page.getByRole("radio", { name: "White on black" }).check();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await expect(root).toHaveAttribute("data-font", "serif");
  await expect(root).toHaveAttribute("data-mode", "reg");
  await expect(root).toHaveAttribute("data-size", "medium");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#settingsDlg")).not.toBeVisible();
  await expect(root).toHaveAttribute("data-font", "dys");
  await expect(root).toHaveAttribute("data-mode", "hc");
  await expect(root).toHaveAttribute("data-size", "large");
  await expect(page.locator("#ta")).toBeFocused();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset all settings to default" }).click();
  await expect(page.getByRole("radio", { name: "Book letters" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Black on white" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Medium", exact: true })).toBeChecked();
  await expect(root).toHaveAttribute("data-font", "dys");
  await expect(root).toHaveAttribute("data-mode", "hc");
  await expect(root).toHaveAttribute("data-size", "large");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(root).toHaveAttribute("data-font", "serif");
  await expect(root).toHaveAttribute("data-mode", "reg");
  await expect(root).toHaveAttribute("data-size", "medium");
});

test("Cancel and Escape discard choices and return to the writing selection", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.fill("A place to keep my writing.");
  await ta.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 7));
  for (const dismiss of ["cancel", "escape"] as const) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radio", { name: "Round letters" }).check();
    await page.getByRole("radio", { name: "Small", exact: true }).check();
    if (dismiss === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(page.locator("#settingsDlg")).not.toBeVisible();
    await expect(ta).toBeFocused();
    expect(await ta.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 7]);
    await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
    await expect(page.locator("html")).toHaveAttribute("data-size", "medium");
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Book letters" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Medium", exact: true })).toBeChecked();
});

test("applied choices survive closing the tab and opening another", async ({ page, context }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters" }).check();
  await page.getByRole("radio", { name: "White on black" }).check();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.locator("html")).toHaveAttribute("data-font", "dys");
  await expect(reopened.locator("html")).toHaveAttribute("data-mode", "hc");
  await expect(reopened.locator("html")).toHaveAttribute("data-size", "large");
  await reopened.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(reopened.getByRole("radio", { name: "Round letters" })).toBeChecked();
  await expect(reopened.getByRole("radio", { name: "White on black" })).toBeChecked();
  await expect(reopened.getByRole("radio", { name: "Large", exact: true })).toBeChecked();
});

test("each size shares metrics between writing, measurement, and printed pages", async ({ page }) => {
  await page.locator("#ta").fill(Array.from({ length: 25 }, (_, index) => `Line ${index + 1}`).join("\n"));
  for (const [name, fontSize, lineHeight, pageCount] of [
    ["Small", "16px", "32px", 1],
    ["Medium", "20px", "40px", 2],
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
  const firstChoice = page.getByRole("radio", { name: "Book letters", exact: true });
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

test("About has no navigable links and its logo is a decorative, same-origin image", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const about = page.getByRole("region", { name: "About", exact: true });
  await expect(about.getByRole("link")).toHaveCount(0);
  const logo = about.locator("img.authorship-mark");
  await expect(logo).toHaveAttribute("alt", "");
  await expect(logo).toHaveAttribute("aria-hidden", "true");
  const image = await logo.evaluate((element: HTMLImageElement) => ({
    local: new URL(element.currentSrc).origin === location.origin,
    path: new URL(element.currentSrc).pathname,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }));
  expect(image.local).toBe(true);
  expect(image.path).toMatch(/\/chirpwater-logo\.png$/);
  expect(image.width).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(0);
});

test("recovery is always available at zero and browsing does not apply settings", async ({ page }) => {
  await expect(page.locator("#settingsDlg")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters", exact: true }).check();
  const recovery = page.getByRole("button", { name: "Recover previous draft (0)", exact: true });
  await expect(recovery).toBeEnabled();
  await recovery.click();
  await expect(recovery).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("radio", { name: "Round letters", exact: true })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
  await recovery.click();
  await expect(page.locator("#recoveryPanel")).toBeHidden();
  await expect(page.getByRole("radio", { name: "Round letters", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
});

test("recovering a listed draft keeps its text literal and does not apply pending choices", async ({ page }) => {
  const previous = '<img src="bad" onerror="alert(1)">\nMy earlier story.';
  await page.locator("#ta").fill(previous);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await page.locator("#ta").fill("My current story.");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByRole("button", { name: "Recover previous draft (1)", exact: true }).click();
  const row = page.locator("#recoveryList .recovery-item");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".recovery-title")).toHaveText(previous.split("\n")[0]);
  await expect(row.locator("img, script")).toHaveCount(0);
  await expect(row.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await row.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.locator("#settingsDlg")).toBeHidden();
  await expect(page.locator("#ta")).toHaveValue(previous);
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-size", "medium");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Medium", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Recover previous draft (1)", exact: true }).click();
  await expect(page.locator("#recoveryList .recovery-title")).toHaveText("My current story.");
});

test("pending recovery blocks Escape, Cancel, and Apply until the ownership lock completes", async ({ page }) => {
  await page.locator("#ta").fill("The story to recover.");
  const previousId = await page.evaluate((key) => sessionStorage.getItem(key), DRAFT_SESSION_KEY);
  expect(previousId).not.toBeNull();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await page.locator("#ta").fill("The writing that stays while recovery waits.");

  // Delay just the archived document's ownership request. Startup and the
  // current document's lease remain real browser locks throughout this test.
  await page.evaluate((lockName) => {
    const locks = navigator.locks;
    const request = locks.request;
    const state = window as unknown as { recoveryWaiting: boolean; releaseRecovery: () => void };
    state.recoveryWaiting = false;
    locks.request = function (this: LockManager, ...args: Parameters<LockManager["request"]>) {
      const forward = () => Reflect.apply(request, this, args) as Promise<unknown>;
      if (args[0] !== lockName) return forward();
      state.recoveryWaiting = true;
      return new Promise<unknown>((resolve, reject) => {
        state.releaseRecovery = () => {
          locks.request = request;
          void forward().then(resolve, reject);
        };
      });
    } as LockManager["request"];
  }, DRAFT_LOCK_PREFIX + previousId);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters", exact: true }).check();
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  await page.getByRole("button", { name: "Recover previous draft (1)", exact: true }).click();
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { recoveryWaiting: boolean }).recoveryWaiting);
  await expect(page.locator("#recoveryMessage")).toBeFocused();
  await expect(page.locator("#recoveryPanel")).toHaveAttribute("aria-busy", "true");

  try {
    for (const selector of ["#settingsCancel", "#settingsApply"]) {
      const button = page.locator(selector);
      await expect(button).toBeDisabled();
      const box = (await button.boundingBox())!;
      // Real pointer input does not use Playwright's enabled-control retry.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator("#settingsDlg")).toBeVisible();
    }
    for (const key of ["Escape", "Tab", "Shift+Tab", "Enter"]) {
      await page.keyboard.press(key);
      await expect(page.locator("#settingsDlg")).toBeVisible();
    }
    expect(await page.locator("#settingsDlg").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await expect(page.locator("#ta")).toHaveValue("The writing that stays while recovery waits.");
    await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
    await expect(page.locator("html")).toHaveAttribute("data-size", "medium");
  } finally {
    await page.evaluate(() => (window as unknown as { releaseRecovery: () => void }).releaseRecovery());
  }

  await expect(page.locator("#settingsDlg")).toBeHidden();
  await expect(page.locator("#ta")).toHaveValue("The story to recover.");
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-font", "serif");
  await expect(page.locator("html")).toHaveAttribute("data-size", "medium");
});
