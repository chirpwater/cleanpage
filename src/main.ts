/**
 * Wiring: dirty state, keyboard, focus, files, fonts, service worker.
 *
 * The one idea (DESIGN §0): the student types into one plain <textarea>, sized
 * to the whole document so the window scrolls rather than the field.
 * Everything else — the paper, the page-break rules, the printed sheets — is
 * computed around that textarea and never touches it.
 */
import "./styles.css";
import "./typography.css";

import { lineHeightOf, linesPerPage, mirrorText } from "./metrics.js";
import { clearCache, lineStarts, pagesOf } from "./paginate.js";
import { PrintDoc } from "./printdoc.js";
import * as files from "./files.js";
import { S } from "./strings.js";
import { confirmDiscard, promptDownloadName, renderBreaks, say, type Guard } from "./ui.js";
import { applySettings, DEFAULT_SETTINGS, initSettings } from "./settings.js";
import { readSettings, writeSettings, type Draft } from "./storage.js";
import { startDraftSession, type DraftSession } from "./drafts.js";
import { initToolbar } from "./toolbar.js";
import { initHistory } from "./history.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error("missing element: " + id);
  return el as T;
};

const ta = $<HTMLTextAreaElement>("ta");
ta.readOnly = true;
if (/Mac|iPhone|iPad|iPod/.test(navigator.platform)) $("tabhint").textContent = S.tabHintMac;
const bar = $("bar");
const sheet = $("sheet");
const mirror = $<HTMLPreElement>("mirror");
const breaks = $("breaks");
const printHost = $("printdoc");
const status = $("status");
const statusWord = $("statusWord");
const statusName = $("statusName");
const statusGlyph = status.querySelector<HTMLElement>(".gl")!;
const pagecount = $("pagecount");

const btnNew = $<HTMLButtonElement>("btnNew");
const btnOpen = $<HTMLButtonElement>("btnOpen");
const btnSave = $<HTMLButtonElement>("btnSave");
const btnPrint = $<HTMLButtonElement>("btnPrint");
const btnSettings = $<HTMLButtonElement>("btnSettings");
const settingsDlg = $<HTMLDialogElement>("settingsDlg");
const downloadDlg = $<HTMLDialogElement>("downloadDlg");
btnSave.textContent = files.canSaveToFile() ? S.save : S.download;

const dlg = $<HTMLDialogElement>("dlg");
const dlgTitle = $("dlgTitle");
const dlgBody = $("dlgBody");
const dlgKeep = $<HTMLButtonElement>("dlgKeep");
const dlgGo = $<HTMLButtonElement>("dlgGo");

const sayDlg = $<HTMLDialogElement>("say");
const sayBody = $("sayBody");
const sayOk = $<HTMLButtonElement>("sayOk");

const printDoc = new PrintDoc(printHost, mirror, () => ta.value);

/* ------------------------------------------------------------------ layout */

let announcedPages = 0;
let announceTimer = 0;
let seeded = false;

function announcePages(pages: number): void {
  // The very first layout SEEDS the count, synchronously and silently. On a
  // fresh load nothing has changed and nobody has typed, so writing "Now 1
  // page." into an already-live region while a screen reader is still reading
  // the page is contrary to this region's own rule. Seeding outside the timer
  // (rather than swallowing the first timer pass) matters: the first edit can
  // arrive well inside the 300 ms window and must still be announced.
  if (!seeded) {
    seeded = true;
    announcedPages = pages;
    return;
  }
  // After that: only when it changes, and only after typing has paused.
  // Announcing every transition makes ChromeVox chatter over a child's
  // dictation when they are editing near a page boundary.
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    if (pages === announcedPages) return;
    announcedPages = pages;
    pagecount.textContent = S.pageCount(pages);
  }, 300);
}

function layout(): void {
  const text = mirrorText(ta.value);
  // Read the chosen size and any user stylesheet spacing back from the shared
  // text style. Screen breaks and printed cuts must use the same line height.
  const lineH = lineHeightOf(mirror);
  const lpp = linesPerPage(lineH);
  const pageH = lpp * lineH;
  const starts = lineStarts(mirror, text);
  const pages = pagesOf(starts, lpp);
  ta.style.height = pages * pageH + "px";
  renderBreaks(breaks, pages, pageH);
  printDoc.schedule();
  announcePages(pages);
}

/* ------------------------------------------------- the sticky bar's height */

/**
 * `scroll-padding-top` has to be the bar's REAL height, not the 66 px of its
 * one-row case.
 *
 * The bar wraps as the viewport narrows — and with the status chip's text, not
 * only with the width: measured 65 px at 1366, 119 px from about 1355 px down,
 * 173 px at 690, 227 px at 533, 261 px at 344. Against a hard 66 px pad, the
 * browser's own caret-reveal scroll parked the line being typed at y = 66,
 * entirely behind a 119 px bar: at 1200x900, at 1024x600 and at 960x540 — a
 * 1920x1080 screen at 200 % zoom, which is a first-line low-vision
 * accommodation — the character the child had just typed was nowhere on the
 * screen.
 *
 * A `ResizeObserver` on one element, not the window resize listener DECISIONS
 * 9.7 rules out, and the only mechanism that survives a wrap point which
 * depends on the chip's wording.
 */
const publishBarHeight = (): void => {
  document.documentElement.style.setProperty("--bar-h", bar.offsetHeight + "px");
};
publishBarHeight(); // correct before the observer's first callback
new ResizeObserver(publishBarHeight).observe(bar);

/* ------------------------------------------------- the paper's own margin */

/**
 * The 48 px white band around the text column belongs to `#sheet`, and it used
 * to swallow the click: measured at 1366x768, clicking the paper's left margin
 * at (290, 400) left `document.activeElement` on BODY, the sheet's focus ring
 * went out, and typing "HELLO" put nothing in the document. A child aiming at
 * the start of a line lands there.
 *
 * This is NOT the global click-to-focus handler DECISIONS 5.16 rejects, and
 * the rejection's own reasons do not reach it: `e.target === sheet` fires only
 * on the margin band, which contains no content, so a Select-to-speak drag or
 * a magnifier pan that begins over words is untouched.
 */
sheet.addEventListener("pointerdown", (e) => {
  if (e.target !== sheet) return;
  e.preventDefault(); // keep the field's current caret; do not blur it first
  ta.focus();
});

/* ------------------------------------------------------------ dirty state */

let lastSavedText = "";
let closeWarningArmed = false;
let draftStored = false;
let lastStatus = "";
let draftSession: DraftSession | null = null;
let appReady = false;

const currentDraft = (): Draft => ({ text: ta.value, lastSavedText, fileName: files.currentFileName() });

function persistDraft(): void {
  draftStored = draftSession?.persist(currentDraft()) ?? false;
}

const isDirty = (): boolean => ta.value !== lastSavedText;
const hasWriting = (): boolean => ta.value.trim().length > 0;

const onBeforeUnload = (e: BeforeUnloadEvent): void => {
  e.preventDefault();
};

/**
 * Local recovery and the external file are separate states. Dirty tracks the
 * last exported text; background recovery does not make a document "Saved".
 */
function refreshDirty(): void {
  const dirty = isDirty();

  // A recovery draft is a fallback, not permission to close the tab and throw
  // away unsaved work. Whitespace alone is not writing worth interrupting.
  const warnOnClose = dirty && hasWriting();
  if (warnOnClose !== closeWarningArmed) {
    closeWarningArmed = warnOnClose;
    if (warnOnClose) addEventListener("beforeunload", onBeforeUnload);
    else removeEventListener("beforeunload", onBeforeUnload);
  }

  const name = files.currentFileName();
  const warnAboutStorage = !draftStored && warnOnClose;
  // Replacing live-region text on every key splits Chromium's native undo
  // groups, even if the words did not change. Only repaint a changed state.
  const empty = !hasWriting() && !name;
  const statusKey = JSON.stringify([dirty, empty, name, warnOnClose, warnAboutStorage]);
  if (statusKey === lastStatus) return;
  lastStatus = statusKey;
  // The state words and the filename go into two different spans on purpose:
  // only the filename may be elided, and the words must survive a user's own
  // text spacing (src/styles.css, #statusWord / #statusName).
  // While the document is dirty the chip is empty and hidden. Restoring the
  // positive text on save also gives the live region a real change to announce.
  statusGlyph.textContent = dirty ? "" : "✓";
  statusWord.textContent = dirty ? "" : S.saved;
  statusName.textContent = !dirty && name ? " — " + name : "";
  status.dataset.empty = String(empty);
  status.dataset.state = dirty ? "dirty" : "clean";
  status.dataset.storage = draftStored ? "saved" : "unavailable";
  $("storageWarning").hidden = !warnAboutStorage;
}

ta.addEventListener("input", () => {
  persistDraft();
  refreshDirty();
  requestAnimationFrame(layout);
});

/* ----------------------------------------------------------------- guards */

const askingSomething = (): boolean => dlg.open || sayDlg.open || settingsDlg.open || downloadDlg.open;
const toolbar = initToolbar($("toolbar"), ta, askingSomething);

type ReplaceApproval = { discardText: string | null };

async function guard(kind: Guard): Promise<ReplaceApproval | null> {
  // Never stack two questions on one dialog. A second call re-writes the title
  // and the buttons of the dialog already on the screen — measured: pressing
  // Ctrl+O while "Start a new page?" was up turned it into "Open another
  // file?", and the single click that followed both cleared the document and
  // opened the picker. Answer nothing on the child's behalf: just decline.
  if (!appReady || askingSomething()) return null;
  persistDraft();
  refreshDirty();
  // New always confirms before clearing real writing, even after a save. Open
  // confirms when it would replace unsaved writing. A recovery draft is a
  // fallback, not consent to replace the page.
  const needsConfirmation = hasWriting() && (kind === "new" || isDirty());
  if (!needsConfirmation) return { discardText: null };
  const confirmed = await confirmDiscard(dlg, dlgTitle, dlgBody, dlgKeep, dlgGo, kind, ta);
  return confirmed ? { discardText: ta.value } : null;
}

// The two dialogs are already driven from `strings.ts` (confirmDiscard writes
// the title, the body and the Go button; `tell` writes the body), and these
// were the two labels left behind as literals in the markup. strings.ts says it
// is the single source of the wording, so the components it owns take all of
// theirs from it. The other fourteen keys belong to static markup and are
// checked against index.html by a unit test instead, rather than paying for
// fourteen DOM writes on every load.
dlgKeep.textContent = S.dlgKeep;
sayOk.textContent = S.errOk;

const tell = (message: string): void => say(sayDlg, sayBody, sayOk, message, ta);

/** The one place clearing the native undo stack is correct. */
function loadDocument(text: string, savedText = text): void {
  ta.value = text;
  lastSavedText = savedText;
  history.reset();
  persistDraft();
  layout();
  ta.setSelectionRange(0, 0);
  refreshDirty();
  settings.refreshRecovery();
  ta.focus();
  // `focus()` cannot reveal offset 0 when the field is ALREADY the active
  // element, and after the unsaved-changes dialog it always is: the dialog
  // restores focus to the page before this runs. Measured: Open from a
  // scrolled 150-line document landed at scrollY 4651 with the caret 4514 px
  // above the scrollport, and New landed at the bottom of a blank sheet. Own
  // the viewport explicitly instead — the top of the new document is where the
  // caret is, and it is what the unguarded path already produced.
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ files */

let fileBusy = false;
let documentChanges = 0;

/** A resumed page and an in-flight document switch must both finish before editing. */
function lockDocument(): () => void {
  documentChanges += 1;
  ta.readOnly = true;
  return () => {
    documentChanges -= 1;
    ta.readOnly = !appReady || documentChanges > 0;
  };
}

// File I/O can continue after the picker closes. Keep its document binding
// stable until completion while leaving the writing area editable.
function beginFileAction(): boolean {
  if (!appReady || fileBusy || askingSomething()) return false;
  fileBusy = true;
  for (const button of [btnNew, btnOpen, btnSave, btnSettings]) button.disabled = true;
  toolbar.refresh();
  return true;
}

function endFileAction(): void {
  fileBusy = false;
  for (const button of [btnNew, btnOpen, btnSave, btnSettings]) button.disabled = false;
  toolbar.refresh();
}

btnNew.addEventListener("click", () => {
  void (async () => {
    if (fileBusy || !(await guard("new"))) return;
    if (!beginFileAction()) return;
    const unlock = lockDocument();
    try {
      await draftSession!.newDocument({ text: "", lastSavedText: "", fileName: null });
      files.forgetFile();
      loadDocument("");
    } catch {
      tell(S.errOpen);
    } finally {
      unlock();
      endFileAction();
    }
  })();
});

btnOpen.addEventListener("click", () => {
  void doOpen();
});

async function doOpen(): Promise<void> {
  if (fileBusy) return;
  const approval = await guard("open");
  if (!approval) return;
  if (!beginFileAction()) return;
  try {
    const opened = await files.open();
    if (!opened) {
      ta.focus(); // cancelled
      return;
    }
    await acceptOpened(opened, approval.discardText);
  } catch {
    tell(S.errOpen);
  } finally {
    endFileAction();
  }
}

async function acceptOpened(opened: files.OpenedFile, approvedDiscard: string | null): Promise<void> {
  if (files.looksBinary(opened.text)) {
    // Leave the document alone means ALL of it: the text, the file it is bound
    // to, and the chip that names that file. Forgetting the binding here threw
    // away the handle of the .txt the child was working in, and the next Save
    // silently wrote a second file while the chip still named the first.
    tell(S.errNotText);
    return;
  }
  // Recheck the live page after a slow read: the child may have typed while the
  // file was loading. An explicit discard approval covers only the exact text
  // the child approved.
  persistDraft();
  refreshDirty();
  if (isDirty() && hasWriting() && ta.value !== approvedDiscard && !(await guard("open"))) return;
  const unlock = lockDocument();
  try {
    await draftSession!.newDocument({ text: opened.text, lastSavedText: opened.text, fileName: opened.name });
    files.adopt(opened);
    loadDocument(opened.text);
  } finally {
    unlock();
  }
}

btnSave.addEventListener("click", () => {
  void doSave();
});

async function doSave(): Promise<void> {
  if (!beginFileAction()) return;
  // No await may precede the picker call inside files.save(), or the transient
  // user activation is gone and the picker throws.
  const text = ta.value;
  try {
    let name: string | null;
    if (files.canSaveToFile()) {
      name = await files.save(text);
    } else {
      const chosen = await promptDownloadName(files.currentFileName() ?? files.suggestName(text), ta);
      if (chosen === null) return;
      name = await files.save(text, chosen);
    }
    // The student should never have to hunt for the cursor after a file action.
    ta.focus();
    if (name === null) return; // the child pressed Cancel: stay dirty, say nothing
    lastSavedText = text;
    persistDraft();
    refreshDirty();
  } catch {
    tell(S.errSave);
  } finally {
    endFileAction();
  }
}

btnPrint.addEventListener("click", () => {
  printDoc.buildIfStale();
  window.print();
  ta.focus();
});
addEventListener("beforeprint", () => printDoc.buildIfStale());
addEventListener("afterprint", () => ta.focus());

/* ------------------------------------------------------- drag and drop .txt */

const isTextFile = (f: File): boolean => f.type === "text/plain" || /\.txt$/i.test(f.name);

addEventListener("dragover", (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
});

addEventListener("drop", (e) => {
  // A drag carrying no file is text dragged inside the document: leave it to
  // the field, which handles it natively and undoably.
  if (!e.dataTransfer || e.dataTransfer.files.length === 0) return;
  // `dragover` has already accepted this drag, so NOT preventing the default
  // here hands the file to the browser, which navigates away from the page and
  // takes the child's unsaved writing with it. Accept the drop either way, and
  // then say plainly when it was not writing.
  e.preventDefault();
  if (fileBusy || askingSomething()) return;
  const file = Array.from(e.dataTransfer.files).find(isTextFile);
  if (!file) {
    tell(S.errNotText);
    return;
  }
  void (async () => {
    if (fileBusy) return;
    const approval = await guard("open");
    if (!approval) return;
    if (!beginFileAction()) return;
    try {
      await acceptOpened(await files.readDropped(file), approval.discardText);
    } catch {
      tell(S.errOpen);
    } finally {
      endFileAction();
    }
  })();
});

/* --------------------------------------------------------------- keyboard */

ta.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.isComposing) return; // never interrupt an IME composition
  if (e.shiftKey) {
    // A simple additional exit for switch/keyboard users. No two-key mode.
    e.preventDefault();
    toolbar.focus();
    return;
  }
  // Keep the word-processor indentation convention, without a pop-up hint.
  e.preventDefault();
  // Startup and document transitions temporarily lock the field. The fallback
  // below is programmatic, so it must respect readOnly just like native typing.
  if (ta.readOnly) return;
  // execCommand is required, not stylistic: after a setRangeText the native
  // undo stack is truncated and Ctrl+Z stops working past that point in all
  // three engines. execCommand keeps the stack alive and fires
  // beforeinput/input itself.
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, "\t");
  } catch {
    ok = false;
  }
  if (!ok) {
    ta.setRangeText("\t", ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
  // While a dialog is up it owns the keyboard: the child has been asked a
  // question and should answer it before anything else happens.
  if (askingSomething()) return;
  const k = e.key.toLowerCase();
  if (k === "s") {
    e.preventDefault();
    void doSave();
  } else if (k === "o") {
    e.preventDefault();
    void doOpen();
  }
  // Ctrl+P is left to the browser; `beforeprint` refreshes the print DOM.
  // Ctrl+N is not interceptable in Chrome, so New stays button-only.
});

/* --------------------------------------------------------------- settings */

/**
 * Put the cursor back in the field without moving the child's view of their
 * own story.
 *
 * A bare `ta.focus()` triggers Chromium's caret-reveal scroll, amplified by
 * `scroll-padding-bottom: 30vh`: measured on an 80-line story with the caret at
 * the end (where it always is after typing) and the window scrolled back to the
 * top to re-read, one click on "White on black" threw the page from scrollY 0
 * to 2379 — a different part of the story, with no explanation. The reverse
 * happened too: caret at 0, scrolled down to read page 2, one click on "Round
 * letters" and the page snapped back to 0.
 *
 * `preventScroll` alone is not enough to rely on (the reveal can also be
 * scheduled after focus returns), so the offset is restored explicitly. The
 * Letters toggle also changes the document's height — 3161 -> 6041 px for the
 * same story — so the raw pixel offset is not the same place in the story;
 * rescaling it proportionally keeps the same part on the screen.
 */
function refocusInPlace(yBefore: number, hBefore: number): void {
  const h = document.documentElement.scrollHeight;
  ta.focus({ preventScroll: true });
  window.scrollTo(0, hBefore > 0 ? Math.round(yBefore * (h / hBefore)) : yBefore);
}

const initialSettings = readSettings() ?? {
  ...DEFAULT_SETTINGS,
  mode: matchMedia("(prefers-contrast: more)").matches ? "hc" as const : "reg" as const,
};
applySettings(initialSettings);
let settingsScroll = { y: 0, h: 0 };
let settingsStored = true;
const settings = initSettings(initialSettings, (value) => {
  applySettings(value);
  clearCache();
  layout();
  settingsStored = writeSettings(value);
}, () => {
  refocusInPlace(settingsScroll.y, settingsScroll.h);
  if (!settingsStored) tell(S.settingsStorageError);
}, {
  list: () => draftSession?.listPrevious() ?? [],
  recover: async (id) => {
    if (!appReady || fileBusy || !draftSession) return false;
    persistDraft();
    refreshDirty();
    if (!draftStored && isDirty()) throw new Error(S.recoverySaveFirst);
    fileBusy = true;
    const unlock = lockDocument();
    try {
      const draft = await draftSession.recover(id);
      if (!draft) return false;
      files.restoreFileName(draft.fileName);
      loadDocument(draft.text, draft.lastSavedText);
      settingsScroll = { y: 0, h: document.documentElement.scrollHeight };
      return true;
    } finally {
      unlock();
      endFileAction();
    }
  },
});
btnSettings.addEventListener("click", () => {
  if (!appReady || fileBusy || askingSomething()) return;
  settingsScroll = { y: window.scrollY, h: document.documentElement.scrollHeight };
  settingsStored = true;
  settings.open();
});

const history = initHistory(ta, $<HTMLButtonElement>("btnUndo"), $<HTMLButtonElement>("btnRedo"));

// Counts include other retained documents, not this tab's current document.
addEventListener("storage", () => {
  if (settings.isOpen()) settings.refreshRecovery();
});
addEventListener("pageshow", (event) => {
  if (!event.persisted || !draftSession) return;
  appReady = false;
  ta.readOnly = true;
  void draftSession.ready().then(() => {
    persistDraft();
    refreshDirty();
    settings.refreshRecovery();
  }).finally(() => {
    appReady = true;
    ta.readOnly = documentChanges > 0;
  });
});

/* ------------------------------------------------------------------ fonts */

async function boot(): Promise<void> {
  draftSession = await startDraftSession();
  const recovered = draftSession.initial;
  ta.value = recovered.text;
  lastSavedText = recovered.lastSavedText;
  files.restoreFileName(recovered.fileName);
  history.reset();
  persistDraft();
  settings.refreshRecovery();
  layout();
  refreshDirty();
  try {
    await Promise.all([
      document.fonts.load('16px "Liberation Serif"'),
      document.fonts.load('16px "OpenDyslexic"'),
    ]);
    await document.fonts.ready;
  } catch {
    /* a blocked or missing font must not stop the page working */
  }
  clearCache();
  layout(); // the first real layout
  printDoc.build();
  appReady = true;
  ta.readOnly = documentChanges > 0;
  ta.focus();
}

document.fonts.addEventListener("loadingdone", () => {
  clearCache();
  layout();
});

void boot();

/* ------------------------------------------------- measurement hook (tests) */

/**
 * The wrap-equivalence spec (DESIGN §12.1) compares the paginator's visual line
 * starts against the textarea's own caret-probed line starts. That comparison
 * needs the app's real numbers, from the app's real mirror, in the built page —
 * a reimplementation inside the test would only test itself.
 *
 * Read-only: it computes and returns, writes no state, and nothing in the
 * application calls it. It touches no storage and makes no request.
 */
(window as unknown as { __tpLineStarts?: () => number[] }).__tpLineStarts = () =>
  lineStarts(mirror, mirrorText(ta.value));

/* --------------------------------------------------------- service worker */

addEventListener("load", () => {
  if (!import.meta.env.PROD) return; // the dev server's sw.js is still a template
  try {
    void navigator.serviceWorker?.register("./sw.js", { updateViaCache: "all" }).catch(() => {
      /* blocked or unavailable offline support must not interrupt writing */
    });
  } catch {
    /* the app is fully functional if registration fails or policy blocks it */
  }
});
