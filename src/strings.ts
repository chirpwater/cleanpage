export const S = {
  appName: "Clean Page",

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
  lettersSerif: "Serif",
  lettersSansSerif: "Sans-serif",

  fontSize: "Font size",
  sizeRegular: "Regular",
  sizeLarge: "Large",
  onScreenColors: "On-Screen Colors",
  colorsLight: "Light",
  colorsDark: "Dark",
  resetSettings: "Reset",
  resetTitle: "Reset to default settings?",
  applySettings: "Apply",
  cancel: "Cancel",
  previewLetters: "Aa Bb",
  previewSize: "Aa",

  about: "About",
  website: "https://www.cleanpage.org",

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
  errNew: "Sorry, that did not start a new page. Try again.",
  errOpen: "Sorry, that file did not open. Try again.",
  errNotText: "That file isn't plain writing.",
  errOk: "OK",
  settingsStorageError: "Could not keep your settings on this device.",
} as const;
