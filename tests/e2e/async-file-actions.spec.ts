import { expect, test, type Page } from "@playwright/test";
import { open, setText } from "./helpers.js";

test("a pending save keeps its document bound and later typing outside the exported snapshot", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      finishSave: () => void;
      saveStarted: boolean;
      pickerCalls: number;
      savedText: string;
    };
    state.pickerCalls = 0;
    (window as unknown as Record<string, unknown>)["showSaveFilePicker"] = async () => {
      state.pickerCalls++;
      return {
        name: "first-story.txt",
        createWritable: async () => ({
          write: async (blob: Blob) => { state.savedText = await blob.text(); },
          close: () => new Promise<void>((resolve) => {
            state.finishSave = resolve;
            state.saveStarted = true;
          }),
        }),
      };
    };
  });
  await open(page);
  await setText(page, "First story");
  await page.locator("#btnSave").click();
  await page.waitForFunction(() => (window as unknown as { saveStarted: boolean }).saveStarted);
  for (const id of ["btnNew", "btnOpen", "btnSave"]) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await page.locator("#ta").focus();
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Control+o");
  await page.keyboard.press("Alt+f");
  await expect(page.locator("#btnPrint")).toBeFocused();
  await page.locator("#ta").focus();
  await page.keyboard.type(" continues");
  await page.evaluate(() => (window as unknown as { finishSave: () => void }).finishSave());
  await expect(page.locator("#btnNew")).toBeEnabled();
  await expect(page.locator("#ta")).toHaveValue("First story continues");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
  await expect(page.locator("#statusWord")).toBeEmpty();
  await expect(page.locator("#say")).toBeHidden();
  expect(await page.evaluate(() => {
    const state = window as unknown as { pickerCalls: number; savedText: string };
    return { calls: state.pickerCalls, text: state.savedText };
  })).toEqual({ calls: 1, text: "First story" });

  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await expect(page.locator("#status")).toHaveAttribute("data-empty", "true");
});

for (const source of ["open", "drop"] as const) {
  for (const replace of [false, true]) {
    const result = replace ? "replaced only after confirmation" : "kept on cancellation";
    test(`writing added during a slow ${source} is ${result}`, async ({ page }) => {
      await page.addInitScript(() => {
        const state = window as unknown as { finishRead: () => void; readStarted: boolean };
        const read = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          const bytes = await read.call(this);
          await new Promise<void>((resolve) => {
            state.finishRead = resolve;
            state.readStarted = true;
          });
          return bytes;
        };
        (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [{
          name: "teacher.txt",
          getFile: async () => new File(["Teacher instructions"], "teacher.txt", { type: "text/plain" }),
        }];
      });
      await open(page);
      if (source === "open") {
        await page.locator("#btnOpen").click();
      } else {
        await page.evaluate(() => {
          const data = new DataTransfer();
          data.items.add(new File(["Teacher instructions"], "teacher.txt", { type: "text/plain" }));
          document.getElementById("sheet")!.dispatchEvent(
            new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }),
          );
        });
      }
      await page.waitForFunction(() => (window as unknown as { readStarted: boolean }).readStarted);
      await page.locator("#ta").fill("New words written while the file loads.");
      await page.evaluate(() => (window as unknown as { finishRead: () => void }).finishRead());
      await expect(page.locator("#dlg")).toBeVisible();
      await page.locator(replace ? "#dlgGo" : "#dlgKeep").click();
      await expect(page.locator("#ta")).toHaveValue(
        replace ? "Teacher instructions" : "New words written while the file loads.",
      );
      await expect(page.locator("#status")).toHaveAttribute("data-state", replace ? "clean" : "dirty");
      await expect(page.locator("#btnOpen")).toBeEnabled();
      await expect(page.locator("#ta")).toBeFocused();
      if (replace) await expect(page.locator("#status")).toContainText("teacher.txt");
    });
  }
}

async function delayIncomingFile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { finishRead: () => void; readStarted: boolean; discardPrompts: number };
    state.readStarted = false;
    state.discardPrompts = 0;
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      await new Promise<void>((resolve) => {
        state.finishRead = resolve;
        state.readStarted = true;
      });
      return bytes;
    };
    (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [{
      name: "teacher.txt",
      getFile: async () => new File(["Teacher instructions"], "teacher.txt", { type: "text/plain" }),
    }];
  });
}

async function startIncomingFile(page: Page, source: "open" | "drop"): Promise<void> {
  if (source === "open") {
    await page.locator("#btnOpen").click();
  } else {
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["Teacher instructions"], "teacher.txt", { type: "text/plain" }));
      document.getElementById("sheet")!.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }),
      );
    });
  }
}

for (const source of ["open", "drop"] as const) {
  test(`cancelling guarded ${source} keeps writing and does not start the slow read`, async ({ page }) => {
    await delayIncomingFile(page);
    await open(page);
    const original = "These words do not change while the incoming file loads.";
    await page.locator("#ta").fill(original);

    await startIncomingFile(page, source);
    await expect(page.locator("#dlg")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { readStarted: boolean }).readStarted)).toBe(false);
    await expect(page.locator("#ta")).toHaveValue(original);
    await page.locator("#dlgKeep").click();
    await expect(page.locator("#dlg")).toBeHidden();
    await expect(page.locator("#btnOpen")).toBeEnabled();
    await expect(page.locator("#ta")).toHaveValue(original);
    await expect(page.locator("#ta")).toBeFocused();
    await expect(page.locator("#statusWord")).toBeEmpty();
    expect(await page.evaluate(() => (window as unknown as { readStarted: boolean }).readStarted)).toBe(false);
  });

  test(`an explicit discard approval before a slow ${source} is not asked again for the same writing`, async ({ page }) => {
    await delayIncomingFile(page);
    await open(page);
    const original = "I approve replacing exactly these words.";
    await page.locator("#ta").fill(original);
    await page.evaluate(() => {
      const state = window as unknown as { discardPrompts: number };
      new MutationObserver((records) => {
        state.discardPrompts += records.filter((record) => record.oldValue === null).length;
      }).observe(document.getElementById("dlg")!, {
        attributes: true, attributeFilter: ["open"], attributeOldValue: true,
      });
    });

    await startIncomingFile(page, source);
    await expect(page.locator("#dlg")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { readStarted: boolean }).readStarted)).toBe(false);
    await page.locator("#dlgGo").click();
    await page.waitForFunction(() => (window as unknown as { readStarted: boolean }).readStarted);
    await expect(page.locator("#dlg")).toBeHidden();
    await expect(page.locator("#ta")).toHaveValue(original);
    await page.evaluate(() => (window as unknown as { finishRead: () => void }).finishRead());

    await expect(page.locator("#ta")).toHaveValue("Teacher instructions");
    await expect(page.locator("#btnOpen")).toBeEnabled();
    await expect(page.locator("#dlg")).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { discardPrompts: number }).discardPrompts)).toBe(1);
    await expect(page.locator("#ta")).toBeFocused();
  });
}
