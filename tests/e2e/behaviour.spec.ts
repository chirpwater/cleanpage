import { expect, test } from "@playwright/test";
import { CORPUS, chooseFont, geometry, open, setText, settle } from "./helpers.js";

const chip = (page: import("@playwright/test").Page) =>
  page.locator("#status").innerText();

test("the saved indicator stays quiet while editing and follows edit and undo", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator("#status")).toHaveAttribute("data-empty", "true");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");

  await page.locator("#ta").click();
  await page.keyboard.type("Once upon a time");
  await settle(page);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");

  for (let i = 0; i < 12 && (await page.inputValue("#ta")) !== ""; i++) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  await settle(page);
  expect(await page.inputValue("#ta")).toBe("");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");
  await expect(page.locator("#status")).toHaveAttribute("data-empty", "true");
});

test("New asks first and Keep writing keeps every word", async ({ page }) => {
  await open(page);
  await setText(page, "There are very few good tragedies\nsome are idylls in dialogue, well written and well rhymed.");

  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await expect(page.locator("#dlgKeep")).toBeFocused();

  await page.locator("#dlgKeep").click();
  await expect(page.locator("#dlg")).toBeHidden();
  expect(await page.inputValue("#ta")).toContain("good tragedies");
  await expect(page.locator("#ta")).toBeFocused();

  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#dlg")).toBeHidden();
  expect(await page.inputValue("#ta")).toContain("good tragedies");

  await page.locator("#btnNew").click();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#dlg")).toBeHidden();
  await settle(page);
  expect(await page.inputValue("#ta")).toBe("");
  await expect(page.locator("#ta")).toBeFocused();
});

test("New on a clean page clears at once, with no dialog", async ({ page }) => {
  await open(page);
  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeHidden();
  expect(await page.inputValue("#ta")).toBe("");
});

test("New treats whitespace as a blank page", async ({ page }) => {
  await open(page);
  await page.locator("#ta").fill(" \n\t  ");
  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeHidden();
  await expect(page.locator("#ta")).toHaveValue("");
});

test("New asks before clearing a nonblank page even after it was saved", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [{
      name: "saved-story.txt",
      getFile: async () => new File(["A saved story"], "saved-story.txt", { type: "text/plain" }),
    }];
  });
  await open(page);
  await page.locator("#btnOpen").click();
  await expect(page.locator("#ta")).toHaveValue("A saved story");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");

  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
});

test("Tab types a tab, keeps focus, and is undoable", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.type("ab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("cd");
  await settle(page);

  expect(await page.inputValue("#ta")).toBe("ab\tcd");
  await expect(page.locator("#ta"), "Tab must not move focus out of the page").toBeFocused();

  for (let step = 0; step < 10 && (await page.inputValue("#ta")).includes("\t"); step += 1) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  expect(await page.inputValue("#ta"), "the tab is undoable").not.toContain("\t");
});

test("pasting rich HTML puts plain text in the document", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const src = document.createElement("div");
    src.id = "__rich";
    src.contentEditable = "true";
    src.innerHTML = "<h1>Big</h1><b>bold</b> <i>it</i>";
    document.body.appendChild(src);
    const r = document.createRange();
    r.selectNodeContents(src);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.press("ControlOrMeta+c");
  await page.evaluate(() => document.getElementById("__rich")!.remove());

  await page.locator("#ta").click();
  await page.keyboard.press("ControlOrMeta+v");
  await settle(page);

  const v = await page.inputValue("#ta");
  expect(v, "no markup survives a paste into a textarea").not.toMatch(/[<>]/);
  expect(v.replace(/\s+/gu, " ").trim()).toBe("Big bold it");
});

test("closing the tab warns about unsaved writing", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.type("words worth keeping");
  await settle(page);

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1500));
  expect(dialogs, "beforeunload protects unsaved writing").toContain("beforeunload");
});

for (const lead of [
  { name: "a tab", key: "Tab" },
  { name: "a space", key: "Space" },
  { name: "a new line", key: "Enter" },
]) {
  test(`writing beginning with ${lead.name} warns on close`, async ({
    page,
  }) => {
    await open(page);
    await page.locator("#ta").click();
    await page.keyboard.press(lead.key);
    await page.keyboard.type("Once upon a time there was a crab");
    await settle(page);
    await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");

    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await new Promise((r) => setTimeout(r, 1500));
    expect(dialogs, "a story that opens with whitespace is still a story").toContain(
      "beforeunload",
    );
  });
}

/**
 * The same mechanism on the other realistic path: open the teacher's starter
 * file, clear it, write your own. The Delete flips `dirty` while the field is
 * empty, and the guard never armed for the rest of the lesson.
 */
test("replacing opened text still warns before the tab closes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const name = "starter.txt";
    const text = "Write about your favourite animal.\n";
    (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [
      {
        kind: "file",
        name,
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
        getFile: async () => new File([text], name, { type: "text/plain" }),
      },
    ];
  });
  await open(page);
  await page.locator("#btnOpen").click();
  await settle(page);
  expect(await chip(page)).toContain("starter.txt");

  await page.locator("#ta").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type("My very own brand new story about a sea otter.");
  await settle(page);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1500));
  expect(dialogs).toContain("beforeunload");
});

/** And the detaching half: back down to whitespace, the warning goes away. */
test("writing taken back down to whitespace stops asking again", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.type("a real sentence");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type("   ");
  await settle(page);
  expect(await page.inputValue("#ta")).toBe("   ");

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1500));
  expect(dialogs, "there is nothing written to lose").toEqual([]);
});

test("a student who has typed nothing is never nagged on the way out", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.type("   ");
  await settle(page);

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1500));
  expect(dialogs, "whitespace alone is not writing worth a warning").toEqual([]);
});

test("a second question never rewrites the one on screen", async ({ page }) => {
  await open(page);
  await setText(page, "precious words");

  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  const dialogTitle = await page.locator("#dlgTitle").innerText();

  // Measured bug: Ctrl+O here used to turn the open dialog into a different
  // dialog under the child's eyes, and the single click that followed both
  // cleared the document and opened the file picker.
  await page.keyboard.press("ControlOrMeta+o");
  await page.keyboard.press("ControlOrMeta+s");
  await settle(page);
  // The dialog must still be the same one, not silently swapped for another.
  await expect(page.locator("#dlgTitle")).toHaveText(dialogTitle);

  await page.locator("#dlgKeep").click();
  await expect(page.locator("#dlg")).toBeHidden();
  expect(await page.inputValue("#ta")).toBe("precious words");
});

test("Tab indents without showing a pop-up or arming a different keyboard mode", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.type("Hello");

  const ring = () =>
    page.evaluate(() => {
      const sheet = document.getElementById("sheet")!;
      return {
        armed: sheet.hasAttribute("data-armed"),
        hintShown: document.getElementById("tabhint")!.hasAttribute("data-shown"),
      };
    });

  const resting = await ring();
  expect(resting.armed).toBe(false);

  // A plain Tab still indents, without interrupting writing with a hint.
  await page.keyboard.press("Tab");
  expect(await page.inputValue("#ta")).toBe("Hello\t");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("ta");
  const afterTab = await ring();
  expect(afterTab.hintShown).toBe(false);

  // Escape no longer changes what the next Tab means.
  await page.keyboard.press("Escape");
  const armed = await ring();
  expect(armed.armed).toBe(false);
  expect(armed.hintShown).toBe(false);

  await page.keyboard.press("Tab");
  await expect(page.locator("#ta")).toHaveValue("Hello\t\t");
  // The Docs File shortcut is the direct way to the controls instead.
  await page.keyboard.press("Alt+f");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("btnNew");
  const left = await ring();
  expect(left.armed).toBe(false);
  expect(left.hintShown, "and it is gone once the child is out of the field").toBe(false);
});

/** Shift+Tab remains an unconditional, single-gesture exit as well. */
test("Shift and Tab together leave the writing area without arming anything", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.type("Hello");
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("ta");
  expect(await page.inputValue("#ta"), "and no tab character is typed").toBe("Hello");
});

test("a tab lands on a real 0.5 in stop, identically in the field and the printed sheet", async ({
  page,
}) => {
  await open(page);
  await setText(page, "\tone\n\t\ttwo\nthree\n");
  const tabs = await page.evaluate(() => {
    const ta = document.getElementById("ta")!;
    const pre = document.querySelector("#printdoc .page pre")!;
    const read = (el: Element) => {
      const cs = getComputedStyle(el);
      return { tabSize: cs.tabSize, fontSize: cs.fontSize, width: cs.width };
    };
    return { ta: read(ta), pre: read(pre), mirror: read(document.getElementById("mirror")!) };
  });
  // The two faces have different space advances, so an integer tab-size cannot
  // express the same stop for both. The LENGTH form can.
  expect(tabs.ta.tabSize).toBe("48px");
  expect(tabs.pre.tabSize).toBe("48px");
  expect(tabs.mirror.tabSize).toBe("48px");

  // The rest of the metrics contract (DESIGN §3) on the same three elements.
  // These values live only in `.tp-text`; nothing in TypeScript mirrors them,
  // so this assertion is the only thing that holds them together.
  for (const [who, m] of Object.entries(tabs)) {
    expect(m.fontSize, `${who}: 12 pt`).toBe("16px");
    expect(m.width, `${who}: the 720 px column`).toBe("720px");
  }
});

test("switching typeface repaginates the document", async ({ page }) => {
  await open(page);
  await setText(page, CORPUS);

  const serif = await geometry(page);

  await chooseFont(page, "dys");
  const dys = await geometry(page);

  // Normalized OpenDyslexic is still a wider face for this corpus, so the
  // rewrap has to change the page count and every sheet has to follow it.
  expect(dys.pages).toBeGreaterThan(serif.pages);
  expect(dys.taHeight).toBe(dys.pages * 960);
  expect(dys.sheetHeight).toBe(dys.pages * 960 + 96);
  expect(dys.ruleTops).toEqual(
    Array.from({ length: dys.pages - 1 }, (_, i) => 48 + (i + 1) * 960),
  );
  expect(dys.printPages).toBe(dys.pages);
  await expect(page.locator("#ta"), "focus comes back to the writing").toBeFocused();

  // And back again: the count returns to exactly what it was.
  await chooseFont(page, "serif");
  expect((await geometry(page)).pages).toBe(serif.pages);
});
