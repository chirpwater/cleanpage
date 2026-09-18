/**
 * `src/strings.ts` says of itself: "Every user-visible string in the
 * application... Do not add a string anywhere else." DECISIONS 5.20 repeats the
 * claim. Half of it was not true: sixteen of the thirty exported keys were
 * referenced nowhere, and every one of their values was hard-coded a second
 * time in `index.html` — including the 74-character Tab hint, written out in
 * full in both files. Editing the file the project tells a maintainer to edit
 * changed nothing a child reads, and nothing in the suite noticed.
 *
 * Two of the sixteen were unwired strays inside components strings.ts already
 * owns (`confirmDiscard` writes the dialog's title, body and Go button from S;
 * `tell` writes the body from S), and those are now assigned in `main.ts`. The
 * rest belong to static markup, where writing them into the DOM at boot would
 * buy nothing and cost first-paint work the measured layout does not budget
 * for. So strings.ts stays the authoritative wording and this test is the thing
 * that stops the two copies drifting: a rewording in strings.ts that is not
 * carried into index.html is a red test, not a silent no-op.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { S } from "../../src/strings.js";

const HTML = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");

/** Keys whose wording index.html must render verbatim. */
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
  // The chip's load-time state is in the markup too, so the page reads
  // correctly before boot() has run.
  "saved",
] as const;

/** Keys written into the DOM by the application at run time. */
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
    // announces, and it has to read as one phrase.
    expect(S.savedPrefix + "tide-pools.txt").toBe("Changes saved — tide-pools.txt");
    expect(S.savedPrefix.endsWith(" "), "the two halves need the space").toBe(true);
  });

  it("speaks to a nine-year-old: no string is a wall of text", () => {
    for (const [key, value] of Object.entries(S)) {
      if (typeof value !== "string") continue;
      expect(value.length, `${key} is short enough to read at a glance`).toBeLessThanOrEqual(80);
    }
  });
});
