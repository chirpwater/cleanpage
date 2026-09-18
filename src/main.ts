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

let announcedPages = 0;
let announceTimer = 0;
let seeded = false;

function announcePages(pages: number): void {
  if (!seeded) {
    seeded = true;
    announcedPages = pages;
    return;
  }
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    if (pages === announcedPages) return;
    announcedPages = pages;
    pagecount.textContent = S.pageCount(pages);
  }, 300);
}

function layout(): void {
  const text = mirrorText(ta.value);
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

const publishBarHeight = (): void => {
  document.documentElement.style.setProperty("--bar-h", bar.offsetHeight + "px");
};
publishBarHeight();
new ResizeObserver(publishBarHeight).observe(bar);

sheet.addEventListener("pointerdown", (e) => {
  if (e.target !== sheet) return;
  e.preventDefault();
  ta.focus();
});

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

function refreshDirty(): void {
  const dirty = isDirty();

  const warnOnClose = dirty && hasWriting();
  if (warnOnClose !== closeWarningArmed) {
    closeWarningArmed = warnOnClose;
    if (warnOnClose) addEventListener("beforeunload", onBeforeUnload);
    else removeEventListener("beforeunload", onBeforeUnload);
  }

  const name = files.currentFileName();
  const warnAboutStorage = !draftStored && warnOnClose;
  const empty = !hasWriting() && !name;
  const statusKey = JSON.stringify([dirty, empty, name, warnOnClose, warnAboutStorage]);
  if (statusKey === lastStatus) return;
  lastStatus = statusKey;
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

const askingSomething = (): boolean => dlg.open || sayDlg.open || settingsDlg.open || downloadDlg.open;
const toolbar = initToolbar($("toolbar"), ta, askingSomething);

type ReplaceApproval = { discardText: string | null };

async function guard(kind: Guard): Promise<ReplaceApproval | null> {
  if (!appReady || askingSomething()) return null;
  persistDraft();
  refreshDirty();
  const needsConfirmation = hasWriting() && (kind === "new" || isDirty());
  if (!needsConfirmation) return { discardText: null };
  const confirmed = await confirmDiscard(dlg, dlgTitle, dlgBody, dlgKeep, dlgGo, kind, ta);
  return confirmed ? { discardText: ta.value } : null;
}

dlgKeep.textContent = S.dlgKeep;
sayOk.textContent = S.errOk;

const tell = (message: string): void => say(sayDlg, sayBody, sayOk, message, ta);

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
  window.scrollTo(0, 0);
}

let fileBusy = false;
let documentChanges = 0;

function lockDocument(): () => void {
  documentChanges += 1;
  ta.readOnly = true;
  return () => {
    documentChanges -= 1;
    ta.readOnly = !appReady || documentChanges > 0;
  };
}

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
      ta.focus();
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
    tell(S.errNotText);
    return;
  }
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
    ta.focus();
    if (name === null) return;
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

const isTextFile = (f: File): boolean => f.type === "text/plain" || /\.txt$/i.test(f.name);

addEventListener("dragover", (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
});

addEventListener("drop", (e) => {
  if (!e.dataTransfer || e.dataTransfer.files.length === 0) return;
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

ta.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.isComposing) return;
  if (e.shiftKey) {
    e.preventDefault();
    toolbar.focus();
    return;
  }
  e.preventDefault();
  if (ta.readOnly) return;
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
  if (askingSomething()) return;
  const k = e.key.toLowerCase();
  if (k === "s") {
    e.preventDefault();
    void doSave();
  } else if (k === "o") {
    e.preventDefault();
    void doOpen();
  }
});

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
  }
  clearCache();
  layout();
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

(window as unknown as { __tpLineStarts?: () => number[] }).__tpLineStarts = () =>
  lineStarts(mirror, mirrorText(ta.value));

addEventListener("load", () => {
  if (!import.meta.env.PROD) return;
  try {
    void navigator.serviceWorker?.register("./sw.js", { updateViaCache: "all" }).catch(() => {
    });
  } catch {
  }
});
