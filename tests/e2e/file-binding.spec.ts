/**
 * DESIGN §7 — "the second Save and every Ctrl+S write back to the same file
 * silently", and a file that is not plain writing must "leave the document
 * alone".
 *
 * These run on the File System Access path (the Chrome/ChromeOS path, where
 * the picker IS the Files app and the handle is what makes Save-to-Drive work),
 * with the two pickers mocked over an in-memory disk. That is the only way to
 * see the binding at all: on the download fallback there is no handle to lose.
 *
 * The defect: `files.open()` installed the handle and the filename before the
 * caller had seen the bytes, and the binary branch then called `forgetFile()`,
 * which cleared the binding of the file the child was ALREADY working in.
 * Merely looking at a PNG orphaned story.txt; the chip went on naming it; and
 * the next Save re-opened the picker and wrote a second file, leaving the one
 * the teacher collects stale.
 */
import { expect, test } from "@playwright/test";
import { open, settle, setText } from "./helpers.js";

interface Disk {
  files: Record<string, string>;
  savePicks: number;
  openPicks: number;
  nextSaveName: string;
  nextOpen: { name: string; text: string } | null;
}

declare global {
  interface Window {
    __disk: Disk;
  }
}

/** A minimal in-memory showSaveFilePicker / showOpenFilePicker. */
async function mockPickers(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const disk: Disk = {
      files: {},
      savePicks: 0,
      openPicks: 0,
      nextSaveName: "story.txt",
      nextOpen: null,
    };
    window.__disk = disk;

    const handleFor = (name: string) => ({
      kind: "file" as const,
      name,
      queryPermission: async () => "granted" as PermissionState,
      requestPermission: async () => "granted" as PermissionState,
      getFile: async () => new File([disk.files[name] ?? ""], name, { type: "text/plain" }),
      createWritable: async () => ({
        write: async (b: Blob | string) => {
          disk.files[name] = typeof b === "string" ? b : await (b as Blob).text();
        },
        close: async () => undefined,
      }),
    });

    (window as unknown as Record<string, unknown>)["showSaveFilePicker"] = async () => {
      disk.savePicks++;
      return handleFor(disk.nextSaveName);
    };
    (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => {
      disk.openPicks++;
      const o = disk.nextOpen;
      if (!o) throw new DOMException("cancelled", "AbortError");
      disk.files[o.name] = o.text;
      return [handleFor(o.name)];
    };
  });
}

const disk = (page: import("@playwright/test").Page) => page.evaluate(() => window.__disk);

test("refusing a file that is not plain writing keeps the document bound to its own file", async ({
  page,
}) => {
  await mockPickers(page);
  await open(page);

  // A1: write and save. One picker call.
  await setText(page, "My tide pool story");
  await page.locator("#btnSave").click();
  await settle(page);
  await expect(page.locator("#status")).toContainText(/Changes saved\s*— story\.txt/);
  expect((await disk(page)).savePicks).toBe(1);

  // A2: edit and save again — silently, back into the same file.
  await setText(page, "My tide pool story and more");
  await page.locator("#btnSave").click();
  await settle(page);
  let d = await disk(page);
  expect(d.savePicks, "the child is never asked where twice").toBe(1);
  expect(d.files["story.txt"]).toBe("My tide pool story and more");

  // A3: open a PNG. It is refused, as DESIGN §7 requires.
  await page.evaluate(() => {
    window.__disk.nextOpen = { name: "photo.png", text: "�".repeat(400) };
  });
  await page.locator("#btnOpen").click();
  await expect(page.locator("#say")).toBeVisible();
  await expect(page.locator("#sayBody")).toHaveText("That file isn't plain writing.");
  await page.locator("#sayOk").click();
  await expect(page.locator("#say")).toBeHidden();
  await settle(page);

  // A4: "leave the document alone" means the binding and the chip too.
  expect(await page.inputValue("#ta")).toBe("My tide pool story and more");
  await expect(page.locator("#status")).toContainText(/Changes saved\s*— story\.txt/);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "clean");

  // A5/A6: and the next Save still writes back to story.txt, silently.
  await setText(page, "My tide pool story and more and more");
  await page.locator("#btnSave").click();
  await settle(page);
  d = await disk(page);
  expect(d.savePicks, "no second file, no second question").toBe(1);
  expect(Object.keys(d.files).sort()).toEqual(["photo.png", "story.txt"]);
  expect(d.files["story.txt"], "the file the teacher collects is the current one").toBe(
    "My tide pool story and more and more",
  );
  await expect(page.locator("#status")).toContainText(/Changes saved\s*— story\.txt/);
});

test("opening a real .txt rebinds the document to it, and Save writes back there", async ({
  page,
}) => {
  await mockPickers(page);
  await open(page);

  await setText(page, "first document");
  await page.locator("#btnSave").click();
  await settle(page);
  expect(await page.locator("#status").innerText()).toContain("story.txt");

  // The document is clean now, so Open goes straight to the picker.
  await page.evaluate(() => {
    window.__disk.nextOpen = { name: "from-the-teacher.txt", text: "write about your weekend\n" };
  });
  await page.locator("#btnOpen").click();
  await settle(page);
  expect(await page.inputValue("#ta")).toBe("write about your weekend\n");
  expect(await page.locator("#status").innerText()).toContain("from-the-teacher.txt");

  // Save now writes back to the file that was opened, with no further question.
  await setText(page, "write about your weekend\nWe went to the beach.\n");
  await page.locator("#btnSave").click();
  await settle(page);
  const d = await disk(page);
  expect(d.savePicks, "the opened file's handle was adopted").toBe(1);
  expect(d.files["from-the-teacher.txt"]).toBe("write about your weekend\nWe went to the beach.\n");
  expect(d.files["story.txt"], "the first file is untouched").toBe("first document");
});
