/**
 * Every user-visible string in the application (DESIGN §10, DECISIONS 5.20).
 *
 * The readers are nine years old. Keep every sentence at or below a
 * second-grade reading level so a teacher can review the whole vocabulary of
 * the interface in thirty seconds. Do not add a string anywhere else.
 */
export const S = {
  appName: "Clean Page",

  // Toolbar
  fileGroup: "File",
  toolbar: "Writing tools",
  editGroup: "Edit",
  newDoc: "New",
  open: "Open",
  save: "Save",
  download: "Download",
  print: "Print",
  undo: "Undo",
  redo: "Redo",
  settings: "Settings",

  letters: "Letters",
  lettersBook: "Book letters",
  lettersRound: "Round letters",

  colours: "Colors",
  colourBlackOnWhite: "Black on white",
  colourWhiteOnBlack: "White on black",
  fontSize: "Font size",
  sizeSmall: "Small",
  sizeMedium: "Medium",
  sizeLarge: "Large",
  resetSettings: "Reset all settings to default",
  applySettings: "Apply",
  cancel: "Cancel",
  previewLetters: "Aa Bb",
  previewSize: "Aa",
  draftRecovery: "Draft recovery",
  previousDrafts: "Previous drafts",
  recoverPreviousDrafts: (count: number) => `Recover previous draft (${count})`,
  recoveryEmpty: "No previous drafts.",
  recoveryUntitled: "Untitled draft",
  recoverDraft: "Recover",
  recoveryEdited: (date: string) => `Last edited ${date}`,
  recoveryOpening: "Opening draft…",
  recoveryError: "Sorry, that draft could not be opened.",
  recoverySaveFirst: "Save or download your writing before opening another draft.",

  about: "About",
  authorship: "Created by",
  authorName: "ChirpWater, LLC",
  authorSite: "chirpwater.com",
  freeForever: "Clean Page is free for everyone, forever.",
  sourcePlaceholder: "GitHub: repository address coming soon.",
  version: (version: string) => `Version ${version}`,

  downloadTitle: "Download your writing",
  downloadName: "File name",
  downloadNameRequired: "Enter a file name.",

  // The writing surface
  pageLabel: "Your writing",
  tabHint: "To reach the buttons, press Alt and F. Escape returns to writing.",
  tabHintMac: "To reach the buttons, press Control, Option and F. Escape returns to writing.",

  // Saved indicator
  saved: "Changes saved",
  // The chip renders the words and the filename in two separate spans, so the
  // prefix is a string and not a template: `savedPrefix + name` is what the
  // child reads and what `role="status"` announces.
  savedPrefix: "Changes saved — ",

  // Page count, announced to screen readers only
  pageCount: (n: number) => (n === 1 ? "Now 1 page." : `Now ${n} pages.`),

  // New / Open confirmation dialog
  dlgNewTitle: "Start a new page?",
  dlgNewBody: "This clears this page. Changes you have not saved will be gone.",
  dlgNewGo: "Start new page",
  dlgOpenTitle: "Open another file?",
  dlgOpenBody: "This opens another file. Changes you have not saved will be gone.",
  dlgOpenGo: "Open the file",
  dlgKeep: "Keep writing",

  // Problems, in plain words
  errSave: "Sorry, that did not save. Try again.",
  errOpen: "Sorry, that file did not open. Try again.",
  errNotText: "That file isn't plain writing.",
  errOk: "OK",
  storageError: "Could not save on this device. Download your writing to keep it.",
  settingsStorageError: "Could not keep your settings on this device.",
} as const;
