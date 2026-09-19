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
  "lettersPlain",
  "fontSize",
  "sizeRegular",
  "sizeLarge",
  "onScreenColors",
  "colorsLight",
  "colorsDark",
  "resetSettings",
  "applySettings",
  "cancel",
  "previewLetters",
  "previewSize",
  "about",
  "website",
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
  "errNew",
  "errOpen",
  "errNotText",
  "errOk",
  "settingsStorageError",
  "downloadNameRequired",
  "resetTitle",
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

  it("keeps the chip's two halves joining into one sentence", () => {
    // The chip renders `savedPrefix` and the filename in two spans so that only
    // the filename can be elided; concatenated they are what role="status"
    // announces, and the two halves must not run together.
    expect(S.savedPrefix.endsWith(" "), "the two halves need the space").toBe(true);
  });

});
