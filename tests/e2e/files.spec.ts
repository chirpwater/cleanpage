import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, open, setText, settle } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
  });
});

const STORY = "My Tide Pool Story\n\nWe saw a crab. It was orange.\n\tIt hid under a rock.\n";

async function downloadWriting(page: import("@playwright/test").Page) {
  await page.locator("#btnSave").click();
  await expect(page.locator("#downloadDlg")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadGo").click(),
  ]);
  return download;
}

test("Download confirms a .txt name from the first line and writes exact bytes", async ({ page }) => {
  await open(page);
  await setText(page, STORY);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");

  const download = await downloadWriting(page);
  expect(download.suggestedFilename()).toBe("My Tide Pool Story.txt");

  const path = join(OUT, "saved-by-the-fallback.txt");
  await download.saveAs(path);
  expect(readFileSync(path, "utf8"), "exactly what the child typed").toBe(STORY);
  const raw = readFileSync(path);
  expect(raw[0]).not.toBe(0xef);
  expect(raw.includes(0x0d)).toBe(false);

  await settle(page);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");
  expect(await page.locator("#status").innerText()).toContain("My Tide Pool Story.txt");
  await expect(page.locator("#ta"), "the cursor comes straight back").toBeFocused();
});

test("after a download, edits mark writing unsaved and undo restores the exported snapshot", async ({ page }) => {
  await open(page);
  await setText(page, STORY);
  await downloadWriting(page);
  await settle(page);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");

  await page.locator("#ta").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("A pelican flew over.");
  await settle(page);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
  await expect(page.locator("#statusWord")).toBeEmpty();

  for (let i = 0; i < 30 && (await page.inputValue("#ta")) !== STORY; i++) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  await settle(page);
  expect(await page.inputValue("#ta")).toBe(STORY);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");
  expect(await page.locator("#status").innerText()).toContain("My Tide Pool Story.txt");
});

test("Ctrl+S asks for a filename and downloads using only the keyboard", async ({ page }) => {
  await open(page);
  await setText(page, STORY);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator("#downloadDlg")).toBeVisible();
  await expect(page.locator("#downloadName")).toBeFocused();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  expect(download.suggestedFilename()).toBe("My Tide Pool Story.txt");
});

test("Download waits for a chosen filename and remembers the edited name", async ({ page }) => {
  await open(page);
  await setText(page, STORY);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.locator("#btnSave").click();
  await expect(page.locator("#downloadDlg")).toBeVisible();
  await expect(page.locator("#downloadName")).toHaveValue("My Tide Pool Story.txt");
  await expect(page.locator("#downloadName")).toBeFocused();
  expect(downloads, "opening the dialog does not download anything").toEqual([]);

  await page.locator("#downloadName").fill("My weekend at the beach");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadGo").click(),
  ]);
  expect(download.suggestedFilename()).toBe("My weekend at the beach.txt");
  await expect(page.locator("#ta")).toHaveValue(STORY);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");
  await page.locator("#btnSave").click();
  await expect(page.locator("#downloadName")).toHaveValue("My weekend at the beach.txt");
  await page.locator("#downloadCancel").click();
  expect(downloads).toEqual(["My weekend at the beach.txt"]);
});

for (const cancel of ["button", "escape"] as const) {
  test(`cancelling the filename dialog by ${cancel} preserves writing and export state`, async ({ page }) => {
    await open(page);
    await setText(page, STORY);
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.locator("#btnSave").click();
    await page.locator("#downloadName").fill("A cancelled choice");
    if (cancel === "button") await page.locator("#downloadCancel").click();
    else await page.keyboard.press("Escape");
    await expect(page.locator("#downloadDlg")).toBeHidden();
    await expect(page.locator("#ta")).toBeFocused();
    await expect(page.locator("#ta")).toHaveValue(STORY);
    await expect(page.locator("#status")).toHaveAttribute("data-state", "dirty");
    await expect(page.locator("#btnSave")).toBeEnabled();
    expect(downloads).toEqual([]);
    await page.locator("#btnNew").click();
    await expect(page.locator("#dlg")).toBeVisible();
    await page.locator("#dlgKeep").click();
  });
}

test("a blank filename keeps the dialog open until corrected", async ({ page }) => {
  await open(page);
  await setText(page, STORY);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.locator("#btnSave").click();
  for (const name of ["", "   "]) {
    await page.locator("#downloadName").fill(name);
    await page.locator("#downloadGo").click();
    await expect(page.locator("#downloadDlg")).toBeVisible();
    expect(await page.locator("#downloadName").evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
    expect(downloads).toEqual([]);
  }
  await page.locator("#downloadName").fill("A name I chose.txt");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadGo").click(),
  ]);
  expect(download.suggestedFilename()).toBe("A name I chose.txt");
  await expect(page.locator("#downloadDlg")).toBeHidden();
});

async function openFile(
  page: import("@playwright/test").Page,
  name: string,
  bytes: Buffer,
  via: "button" | "keyboard" = "button",
): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    via === "button" ? page.locator("#btnOpen").click() : page.keyboard.press("ControlOrMeta+o"),
  ]);
  await chooser.setFiles({ name, mimeType: "text/plain", buffer: bytes });
  await settle(page);
}

test("Open reads a file in, stripping the BOM and normalising CRLF and lone CR", async ({
  page,
}) => {
  await open(page);
  const bytes = Buffer.from("﻿line one\r\nline two\rline three\nend\n", "utf8");
  await openFile(page, "from-the-teacher.txt", bytes);

  expect(await page.inputValue("#ta")).toBe("line one\nline two\nline three\nend\n");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");
  expect(await page.locator("#status").innerText()).toContain("from-the-teacher.txt");
  await expect(page.locator("#ta")).toBeFocused();
  expect(await page.evaluate(() => (document.getElementById("ta") as HTMLTextAreaElement).selectionStart)).toBe(0);
});

test("Ctrl+O opens too", async ({ page }) => {
  await open(page);
  await openFile(page, "keyboard.txt", Buffer.from("opened by keyboard\n", "utf8"), "keyboard");
  expect(await page.inputValue("#ta")).toBe("opened by keyboard\n");
});

test("a selected file can finish reading after the picker cancellation grace period", async ({ page }) => {
  await page.addInitScript(() => {
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await arrayBuffer.call(this);
      // A file on a slow disk or cloud-backed drive may take longer to read
      // than the fallback picker waits for its change/cancel event.
      await new Promise((resolve) => setTimeout(resolve, 700));
      return bytes;
    };
  });
  await open(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#btnOpen").click(),
  ]);
  // Native file choosers restore window focus before delivering change.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await chooser.setFiles({
    name: "slow-drive.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("My file arrived from the cloud.\n"),
  });
  await expect(page.locator("#ta")).toHaveValue("My file arrived from the cloud.\n");
  await expect(page.locator("#status")).toContainText("slow-drive.txt");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");
});

test("Open asks before replacing unsaved writing", async ({ page }) => {
  await open(page);
  await setText(page, "words in progress");

  await page.locator("#btnOpen").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await expect(page.locator("#dlgKeep")).toBeFocused();
  await page.locator("#dlgKeep").click();
  await expect(page.locator("#dlg")).toBeHidden();
  expect(await page.inputValue("#ta")).toBe("words in progress");

  // Saying yes goes on to the picker.
  await page.locator("#btnOpen").click();
  await expect(page.locator("#dlg")).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#dlgGo").click(),
  ]);
  await chooser.setFiles({
    name: "replacement.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("the new words\n", "utf8"),
  });
  await settle(page);
  expect(await page.inputValue("#ta")).toBe("the new words\n");
});

test("a file that is not plain writing is refused, and the document is untouched", async ({
  page,
}) => {
  await open(page);
  await setText(page, "the words already on the page");

  // The child has already said "yes, replace my writing" — and the file still
  // must not be allowed to eat it. This is the worst case, so test this one.
  await page.locator("#btnOpen").click();
  await expect(page.locator("#dlg")).toBeVisible();

  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(400).fill(0xff)]);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#dlgGo").click(),
  ]);
  await chooser.setFiles({ name: "photo.png", mimeType: "text/plain", buffer: binary });
  await settle(page);

  await expect(page.locator("#say")).toBeVisible();
  expect(await page.inputValue("#ta"), "the child's words survive a bad file").toBe(
    "the words already on the page",
  );

  await page.locator("#sayOk").click();
  await expect(page.locator("#say")).toBeHidden();
  await expect(page.locator("#ta")).toBeFocused();
});

test("a dropped .txt goes through the same guarded path", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["dropped words\nsecond line\n"], "dropped.txt", { type: "text/plain" }));
    document.getElementById("sheet")!.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  });
  await settle(page);
  expect(await page.inputValue("#ta")).toBe("dropped words\nsecond line\n");
  expect(await page.locator("#status").innerText()).toContain("dropped.txt");
});

test("dropping something that is not writing is refused, not opened by the browser", async ({
  page,
}) => {
  await open(page);
  await setText(page, "half a story");

  // `dragover` accepts any file drag, so the drop MUST be accepted here too:
  // leaving it to the browser makes it navigate away to the dropped file and
  // take the unsaved writing with it.
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }));
    const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.getElementById("sheet")!.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented, "the page keeps the drop rather than handing it to the browser").toBe(true);
  await settle(page);

  await expect(page.locator("#say")).toBeVisible();
  expect(await page.inputValue("#ta")).toBe("half a story");
  await page.locator("#sayOk").click();
  await expect(page.locator("#say")).toBeHidden();
});
