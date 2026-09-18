import { expect, test, type Page } from "@playwright/test";
import { engineUnavailable, ready, settle } from "./helpers.js";

test.beforeEach(({ browserName }) => {
  const unavailable = engineUnavailable(browserName);
  test.skip(!!unavailable, unavailable ?? "");
});

async function undoToBoundary(page: Page): Promise<number> {
  let steps = 0;
  while (await page.locator("#btnUndo").getAttribute("aria-disabled") === "false") {
    expect(steps, "native typing should remain grouped, not one step per character").toBeLessThan(10);
    await page.locator("#btnUndo").click();
    steps += 1;
  }
  return steps;
}

async function redoSteps(page: Page, steps: number): Promise<void> {
  for (let i = 0; i < steps; i += 1) await page.locator("#btnRedo").click();
}

async function savedText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const id = sessionStorage.getItem("cleanpage:document:v2");
    const raw = id ? localStorage.getItem(`cleanpage:draft:v2:${id}`) : null;
    return raw ? (JSON.parse(raw) as { text: string }).text : null;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await ready(page);
});

test("Undo and Redo use native typing groups and keep the writer in the page", async ({ page }) => {
  const ta = page.locator("#ta");
  const undo = page.locator("#btnUndo");
  const redo = page.locator("#btnRedo");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  await ta.focus();
  await page.keyboard.type("A little story");
  await expect(undo).toHaveAttribute("aria-disabled", "false");
  // Native grouping differs across engines: the status change after the first
  // character, and further status changes during typing, can start extra
  // groups in Chromium. Do not invent our own transaction boundaries simply
  // to make the test's typing one Undo step.
  const steps = await undoToBoundary(page);
  expect(steps).toBeLessThanOrEqual(3);
  await expect(ta).toHaveValue("");
  await expect(ta).toBeFocused();
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await redoSteps(page, steps);
  await expect(ta).toHaveValue("A little story");
  await expect(ta).toBeFocused();
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.type(" continues");
  await expect(ta).toHaveValue("A little story continues");
});

test("keyboard shortcuts and toolbar buttons share one native history", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("Keyboard and buttons");
  await page.keyboard.press("Control+z");
  await expect(ta).not.toHaveValue("Keyboard and buttons");
  await page.locator("#btnRedo").click();
  await expect(ta).toHaveValue("Keyboard and buttons");
  await page.locator("#btnUndo").click();
  await page.keyboard.press("Control+Shift+z");
  await expect(ta).toHaveValue("Keyboard and buttons");
});

test("keyboard activation keeps toolbar focus even when the action becomes unavailable", async ({ page }) => {
  const ta = page.locator("#ta");
  const undo = page.locator("#btnUndo");
  await ta.focus();
  await page.keyboard.type("X");
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(ta).toHaveValue("");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ta).toHaveValue("");
  await expect(undo).toBeFocused();
  await page.locator("#btnRedo").focus();
  await page.keyboard.press("Space");
  await expect(ta).toHaveValue("X");
  await expect(page.locator("#btnRedo")).toBeFocused();
  await undo.click();
  await expect(ta).toHaveValue("");
  await expect(ta).toBeFocused();
});

test("replacement, deletion back to an empty page, and fresh edits remain undoable", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("A cat");
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 5));
  await page.keyboard.type("dog");
  await expect(ta).toHaveValue("A dog");
  await page.locator("#btnUndo").click();
  await expect(ta).toHaveValue("A cat");
  await page.locator("#btnRedo").click();
  await expect(ta).toHaveValue("A dog");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await expect(ta).toHaveValue("");
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#btnUndo").click();
  await expect(ta).toHaveValue("A dog");
  await page.keyboard.press("End");
  await page.keyboard.type(" runs");
  await expect(ta).toHaveValue("A dog runs");
  await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
});

test("Undo persists the resulting draft and does not rewind applied settings", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("Words to undo");
  await page.locator("#btnSettings").click();
  await page.locator('input[name="size"][value="large"]').check();
  await page.locator("#settingsApply").click();
  await undoToBoundary(page);
  await expect(ta).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("data-size", "large");
  expect(await savedText(page)).toBe("");
  await page.reload();
  await ready(page);
  await expect(ta).toHaveValue("");
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
});

for (const action of ["new", "open"] as const) {
  test(`${action} starts a new history that cannot restore the previous document`, async ({ page }) => {
    if (action === "open") {
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [{
          name: "new-story.txt",
          getFile: async () => new File(["New story"], "new-story.txt", { type: "text/plain" }),
        }];
      });
    }
    const ta = page.locator("#ta");
    await ta.focus();
    await page.keyboard.type("OLD DOCUMENT");
    const previousId = await page.evaluate(() => sessionStorage.getItem("cleanpage:document:v2"));
    await page.locator(action === "new" ? "#btnNew" : "#btnOpen").click();
    await expect(page.locator("#dlg")).toBeVisible();
    await page.locator("#dlgGo").click();
    const baseline = action === "new" ? "" : "New story";
    await expect(ta).toHaveValue(baseline);
    await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+Shift+z");
    await expect(ta).toHaveValue(baseline);
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" added");
    const steps = await undoToBoundary(page);
    await expect(ta).toHaveValue(baseline);
    await page.keyboard.press("Control+z");
    await expect(ta).toHaveValue(baseline);
    await redoSteps(page, steps);
    await expect(ta).toHaveValue(baseline + " added");
    await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Control+Shift+z");
    await expect(ta).toHaveValue(baseline + " added");
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`cleanpage:draft:v2:${id}`)!).text, previousId))
      .toBe("OLD DOCUMENT");
  });
}

test("recovering an earlier draft starts fresh history without reviving the replaced document", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.insertText("The earlier story");
  await page.locator("#btnNew").click();
  await page.locator("#dlgGo").click();
  await expect(ta).toHaveValue("");
  await page.keyboard.insertText("The current story");
  await page.locator("#btnSettings").click();
  await page.locator("#settingsRecover").click();
  await page.locator("#recoveryList .recovery-item")
    .filter({ hasText: "The earlier story" })
    .getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.locator("#settingsDlg")).toBeHidden();
  await expect(ta).toHaveValue("The earlier story");
  await expect(ta).toBeEditable();
  await expect(ta).toBeFocused();
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect(ta).toHaveValue("The earlier story");
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" continues");
  await expect(ta).toHaveValue("The earlier story continues");
  const steps = await undoToBoundary(page);
  await expect(ta).toHaveValue("The earlier story");
  await redoSteps(page, steps);
  await expect(ta).toHaveValue("The earlier story continues");
  expect(await savedText(page)).toBe("The earlier story continues");
});

test("Tab and multi-line native insertion use the same history and layout path", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("First");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("second\nThird line 🌱");
  await expect(ta).toHaveValue("First\tsecond\nThird line 🌱");
  const steps = await undoToBoundary(page);
  await expect(ta).toHaveValue("");
  await redoSteps(page, steps);
  await expect(ta).toHaveValue("First\tsecond\nThird line 🌱");
  expect(await savedText(page))
    .toBe("First\tsecond\nThird line 🌱");
});

test("native history beforeinput actions are cancelled at the document boundary", async ({ page }) => {
  // Native browser Edit/context-menu actions report these cancelable input
  // intents, even when no keyboard shortcut or app button was used.
  const cancellation = await page.locator("#ta").evaluate((el) => {
    return ["historyUndo", "historyRedo"].map((inputType) => {
      const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(cancellation).toEqual([true, true]);
});

test("returning to the initial text does not erase earlier editing history", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("ABC");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("DEF");
  for (let step = 0; step < 3 && await ta.inputValue() !== "ABC"; step += 1) {
    await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "false");
    await page.locator("#btnUndo").click();
  }
  await expect(ta).toHaveValue("ABC");
});

test("a new document can undo deletion, redo it, retype, then undo beyond the same empty text", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("The replaced story");
  await page.evaluate(() => {
    const state = window as unknown as { resetInputValues: string[]; resetStoredValues: string[] };
    state.resetInputValues = [];
    state.resetStoredValues = [];
    const editor = document.getElementById("ta") as HTMLTextAreaElement;
    editor.addEventListener("input", () => state.resetInputValues.push(editor.value));
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("cleanpage:draft:v2:")) {
        state.resetStoredValues.push((JSON.parse(value) as { text: string }).text);
      }
      write.call(this, key, value);
    };
  });
  await page.locator("#btnNew").click();
  await page.locator("#dlgGo").click();
  await expect(ta).toHaveValue("");
  const reset = await page.evaluate(() => {
    const state = window as unknown as { resetInputValues: string[]; resetStoredValues: string[] };
    return { inputs: state.resetInputValues, stored: state.resetStoredValues };
  });
  expect(reset.inputs, "reset maintenance must not be observed as writing").toEqual([]);
  expect(reset.stored.every((value) => value === "" || value === "The replaced story"), "no temporary reset text reaches persistence").toBe(true);
  await page.keyboard.insertText("ABC");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.locator("#btnUndo").click();
  await expect(ta).toHaveValue("ABC");
  await page.locator("#btnRedo").click();
  await expect(ta).toHaveValue("");
  await page.keyboard.insertText("DEF");
  await page.locator("#btnUndo").click();
  await expect(ta).toHaveValue("");
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#btnUndo").click();
  await expect(ta).toHaveValue("ABC");
  await page.locator("#btnUndo").click();
  await expect(ta).toHaveValue("");
  await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
});

test("toolbar Undo preserves the viewport while restoring the native selection", async ({ page }) => {
  const ta = page.locator("#ta");
  const story = Array.from({ length: 80 }, (_, index) => `Line ${index + 1}: a story continues.`).join("\n");
  await ta.focus();
  await page.keyboard.insertText(story);
  await settle(page);
  await ta.evaluate((el: HTMLTextAreaElement) => {
    const offset = el.value.indexOf("Line 60:");
    el.setSelectionRange(offset, offset);
  });
  await page.keyboard.type("New ");
  await settle(page);
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  // Locator.click scrolls sticky controls before pointerdown in Chromium and
  // WebKit. Click the already-visible control as a real pointer would instead.
  const button = await page.locator("#btnUndo").boundingBox();
  expect(button).not.toBeNull();
  await page.mouse.click(button!.x + button!.width / 2, button!.y + button!.height / 2);
  await expect(ta).toHaveValue(story);
  await settle(page);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scroll);
  expect(await ta.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(story.indexOf("Line 60:"));
});

for (const action of ["toolbar", "keyboard", "beforeinput"] as const) {
  test(`writing ${action} Undo skips edits in the Download filename`, async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)["showSaveFilePicker"] = undefined;
    });
    // Reload with the native picker unavailable so the visible action is Download.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>)["showSaveFilePicker"] = undefined;
    });
    await page.reload();
    await ready(page);
    const ta = page.locator("#ta");
    await ta.focus();
    await page.keyboard.insertText("The writing stays separate");
    await page.locator("#btnSave").click();
    await page.locator("#downloadName").focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("A chosen filename");
    const downloaded = page.waitForEvent("download");
    await page.locator("#downloadGo").click();
    await downloaded;
    await expect(ta).toBeFocused();
    if (action === "keyboard") await page.keyboard.press("Control+z");
    else if (action === "toolbar") await page.locator("#btnUndo").click();
    else await ta.evaluate((el) => el.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "historyUndo", cancelable: true, bubbles: true,
    })));
    await expect(ta).toHaveValue("");
    if (action === "keyboard") await page.keyboard.press("Control+Shift+z");
    else if (action === "toolbar") await page.locator("#btnRedo").click();
    else await ta.evaluate((el) => el.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "historyRedo", cancelable: true, bubbles: true,
    })));
    await expect(ta).toHaveValue("The writing stays separate");
    await expect(ta).toBeFocused();
    await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
  });
}

for (const failure of ["unsupported", "no-progress", "only-filename-progress"] as const) {
  test(`native history failure ${failure} is bounded and never rewrites the writing`, async ({ page }) => {
    const ta = page.locator("#ta");
    await ta.focus();
    await page.keyboard.insertText("Keep this writing safe");
    await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "false");
    await page.evaluate((mode) => {
      const state = window as unknown as { historyCommandCalls: number };
      state.historyCommandCalls = 0;
      document.queryCommandEnabled = () => true;
      document.execCommand = () => {
        state.historyCommandCalls += 1;
        if (mode === "only-filename-progress") {
          document.getElementById("downloadName")!.dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "historyUndo" }),
          );
        }
        return mode !== "unsupported";
      };
    }, failure);
    await page.locator("#btnUndo").click();
    await expect(ta).toHaveValue("Keep this writing safe");
    await expect(ta).toBeFocused();
    await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
    expect(await page.evaluate(() => (window as unknown as { historyCommandCalls: number }).historyCommandCalls))
      .toBe(failure === "only-filename-progress" ? 100 : 1);
  });
}

for (const failure of ["unsupported", "no-progress", "throws", "never-finishes"] as const) {
  test(`native history reset failure ${failure} restores the new document and releases every lock`, async ({ page }) => {
    const ta = page.locator("#ta");
    await ta.focus();
    await page.keyboard.insertText("The previous document");
    await page.evaluate((mode) => {
      const state = window as unknown as {
        resetCommandCalls: number;
        resetObservedInputs: string[];
        restoreNativeCommands(): void;
      };
      state.resetCommandCalls = 0;
      state.resetObservedInputs = [];
      const editor = document.getElementById("ta") as HTMLTextAreaElement;
      editor.addEventListener("input", () => state.resetObservedInputs.push(editor.value));
      const query = document.queryCommandEnabled;
      const execute = document.execCommand;
      state.restoreNativeCommands = () => {
        document.queryCommandEnabled = query;
        document.execCommand = execute;
      };
      document.queryCommandEnabled = (command) => command === "undo";
      document.execCommand = () => {
        state.resetCommandCalls += 1;
        if (mode === "throws") throw new Error("Native history unavailable");
        if (mode === "never-finishes") {
          editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
        }
        return mode !== "unsupported";
      };
    }, failure);
    await page.locator("#btnNew").click();
    await page.locator("#dlgGo").click();
    await expect(ta).toHaveValue("");
    await expect(ta).toBeEditable();
    await expect(page.locator("#btnUndo")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("#btnRedo")).toHaveAttribute("aria-disabled", "true");
    const result = await page.evaluate(() => {
      const state = window as unknown as {
        resetCommandCalls: number;
        resetObservedInputs: string[];
        restoreNativeCommands(): void;
      };
      state.restoreNativeCommands();
      return { calls: state.resetCommandCalls, inputs: state.resetObservedInputs };
    });
    expect(result.calls).toBe(failure === "never-finishes" ? 1000 : 1);
    expect(result.inputs).toEqual([]);
    await ta.focus();
    await page.keyboard.insertText("New writing");
    expect(await page.evaluate(() => (window as unknown as { resetObservedInputs: string[] }).resetObservedInputs))
      .toEqual(["New writing"]);
    expect(await savedText(page)).toBe("New writing");
  });
}
