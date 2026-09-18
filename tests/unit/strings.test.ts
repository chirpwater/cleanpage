import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { S } from "../../src/strings.js";

const HTML = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");

const IN_MARKUP = [
  "appName",
  "fileGroup",
  "toolbar",
  "editGroup",
  "newDoc",
  "open",
  "save",
  "download",
  "print",
  "undo",
  "redo",
  "settings",
  "letters",
  "lettersBook",
  "lettersRound",
  "colours",
  "colourBlackOnWhite",
  "colourWhiteOnBlack",
  "fontSize",
  "sizeSmall",
  "sizeMedium",
  "sizeLarge",
  "resetSettings",
  "applySettings",
  "cancel",
  "previewLetters",
  "previewSize",
  "draftRecovery",
  "previousDrafts",
  "recoveryEmpty",
  "about",
  "authorship",
  "authorName",
  "authorSite",
  "freeForever",
  "sourcePlaceholder",
  "downloadTitle",
  "downloadName",
  "pageLabel",
  "tabHint",
  "saved",
] as const;

const IN_CODE = [
  "tabHintMac",
  "saved",
  "savedPrefix",
  "pageCount",
  "dlgNewTitle",
  "dlgNewBody",
  "dlgNewGo",
  "dlgOpenTitle",
  "dlgOpenBody",
  "dlgOpenGo",
  "dlgKeep",
  "errSave",
  "errOpen",
  "errNotText",
  "errOk",
  "storageError",
  "settingsStorageError",
  "downloadNameRequired",
  "version",
  "recoverPreviousDrafts",
  "recoveryUntitled",
  "recoverDraft",
  "recoveryEdited",
  "recoveryOpening",
  "recoveryError",
  "recoverySaveFirst",
] as const;

describe("strings.ts is the single source of the wording", () => {
  it.each(IN_MARKUP)("index.html renders S.%s verbatim", (key) => {
    const value = S[key];
    expect(typeof value, `${key} is a plain string`).toBe("string");
    expect(HTML, `index.html must contain S.${key}`).toContain(value as string);
  });

  it("accounts for every exported key: markup or code, nothing orphaned", () => {
    const covered = new Set<string>([...IN_MARKUP, ...IN_CODE]);
    const orphans = Object.keys(S).filter((k) => !covered.has(k));
    expect(orphans, "a new string must be wired up, not just declared").toEqual([]);
  });

  it("the recovery action remains visible even when there are no previous drafts", () => {
    expect(HTML).toContain(S.recoverPreviousDrafts(0));
  });

  it("keeps the chip's two halves joining into one sentence", () => {
    // The chip renders `savedPrefix` and the filename in two spans so that only
    // the filename can be elided; concatenated they are what role="status"
    // announces, and the two halves must not run together.
    expect(S.savedPrefix.endsWith(" "), "the two halves need the space").toBe(true);
  });

  it("speaks to a nine-year-old: no string is a wall of text", () => {
    for (const [key, value] of Object.entries(S)) {
      if (typeof value !== "string") continue;
      expect(value.length, `${key} is short enough to read at a glance`).toBeLessThanOrEqual(80);
    }
  });
});
