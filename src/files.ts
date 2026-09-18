/**
 * File I/O (DESIGN §7).
 *
 * On Chrome/ChromeOS the File System Access picker *is* the Files app, which
 * already mounts the student's Google Drive: that is the whole "saves to
 * Drive" story, with no Drive API, no OAuth and no integration on our side.
 * Elsewhere (Firefox, Safari, or where district policy blocks the API) Save
 * falls back to `<a download>` into Downloads.
 *
 * Local draft recovery lives in storage.ts; file handles stay in memory.
 */

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}
interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
}
type PermissionDescriptor = { mode: "read" | "readwrite" };
interface TPFileHandle extends FileSystemFileHandle {
  queryPermission?: (d: PermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (d: PermissionDescriptor) => Promise<PermissionState>;
}
declare global {
  interface Window {
    showSaveFilePicker?: (o?: SaveFilePickerOptions) => Promise<TPFileHandle>;
    showOpenFilePicker?: (o?: OpenFilePickerOptions) => Promise<TPFileHandle[]>;
  }
}

const TXT_TYPES: FilePickerAcceptType[] = [
  { description: "Plain text", accept: { "text/plain": [".txt"] } },
];

let handle: TPFileHandle | null = null;
let fileName: string | null = null;

export const currentFileName = (): string | null => fileName;

export const canSaveToFile = (): boolean => typeof window.showSaveFilePicker === "function";

/** Recover the name, never a stale permission or handle, after reopening. */
export function restoreFileName(name: string | null): void {
  handle = null;
  fileName = name;
}

export function downloadName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "").trim().slice(0, 180).trim();
  const base = clean.replace(/\.+$/, "") || "My writing";
  return /\.txt$/i.test(base) ? base : base + ".txt";
}

export function forgetFile(): void {
  handle = null;
  fileName = null;
}

/** A filename a nine-year-old recognises: the first line of their own writing. */
export function suggestName(text: string): string {
  const first = text.split("\n").find((l) => l.trim().length) ?? "";
  const cleaned = first
    .normalize("NFC")
    // \s, not a literal space: the allowed class must admit the TAB a child
    // gets from the Tab key (DECISIONS 5.9), or "Tide\tPool\tStory" is offered
    // as "TidePoolStory.txt". Stripping first and collapsing second is what
    // keeps a removed character between two spaces from leaving a double space.
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return (cleaned || "My writing") + ".txt";
}

/** UTF-8, no BOM, LF only, no NULs. */
export const normaliseIncoming = (s: string): string =>
  s.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\0/g, "");

/** Too many replacement characters means it was not plain writing to begin with. */
export const looksBinary = (s: string): boolean => {
  if (!s.length) return false;
  let bad = 0;
  for (const ch of s) if (ch === "�") bad++;
  return bad / s.length > 0.01;
};

/**
 * Returns the name written, or null if the child cancelled.
 *
 * MUST be reached with no preceding `await` in the click-handler chain, or the
 * transient user activation is gone and the picker throws.
 */
export async function save(text: string, chosenName?: string): Promise<string | null> {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  if (window.showSaveFilePicker) {
    let target = handle;
    try {
      if (!target) {
        try {
          target = await window.showSaveFilePicker({
            suggestedName: fileName ?? suggestName(text),
            types: TXT_TYPES,
          });
          handle = target;
        } catch (e) {
          // Only the picker reports the child's cancellation. An AbortError
          // while writing is a save failure and must reach the error dialog.
          if (e instanceof DOMException && e.name === "AbortError") return null;
          throw e;
        }
      } else if (target.queryPermission && target.requestPermission) {
        if ((await target.queryPermission({ mode: "readwrite" })) !== "granted") {
          if ((await target.requestPermission({ mode: "readwrite" })) !== "granted") return null;
        }
      }
      const w = await target.createWritable();
      await w.write(blob);
      await w.close();
      return (fileName = target.name);
    } catch (e) {
      handle = null;
      throw e;
    }
  }
  const name = downloadName(chosenName ?? suggestName(text));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return (fileName = name);
}

/**
 * A file that has been READ but not yet accepted.
 *
 * `handle` is a candidate binding, not an installed one: merely looking at a
 * PNG must not destroy the child's binding to the .txt they are working in.
 * Only `adopt()` installs it, and only the caller — after it has seen the
 * bytes and decided they are plain writing — may call that.
 */
export interface OpenedFile {
  name: string;
  text: string;
  handle: TPFileHandle | null;
}

/** Bind the document to a file that has been read AND accepted. */
export function adopt(o: OpenedFile): void {
  handle = o.handle;
  fileName = o.name;
}

async function decode(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // fatal: false so a mis-encoded file degrades to replacement characters
  // instead of throwing; `looksBinary` then decides what to tell the student.
  return normaliseIncoming(new TextDecoder("utf-8", { fatal: false }).decode(buf));
}

/** Returns null if the child cancelled the picker. */
export async function open(): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    let picked: TPFileHandle[];
    try {
      picked = await window.showOpenFilePicker({ types: TXT_TYPES, multiple: false });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
    const [h] = picked;
    if (!h) return null;
    const file = await h.getFile();
    const text = await decode(file);
    // The handle travels with the bytes and is installed by adopt() only if
    // the caller accepts them; the next Save then writes back to this file.
    return { name: h.name, text, handle: h };
  }
  return openViaInput();
}

/** How long after the window comes back we wait for `change` or `cancel`. */
const FALLBACK_SETTLE_MS = 400;

function openViaInput(): Promise<OpenedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      removeEventListener("focus", onWindowFocus);
      input.remove();
    };
    const done = (v: OpenedFile | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(v);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    };

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return done(null);
      // The picker has delivered a file. Its cancellation grace period must
      // not discard a read that takes longer (for example from a cloud drive).
      clearTimeout(timer);
      removeEventListener("focus", onWindowFocus);
      decode(file).then((text) => {
        done({ name: file.name, text, handle: null });
      }, fail);
    });
    input.addEventListener("cancel", () => done(null));

    /**
     * The belt-and-braces settle, for a browser that delivers no `cancel`.
     *
     * Without it the promise never resolves: `doOpen()` never returns, so the
     * cursor never goes back to the field, and one dead node was left in the
     * body per cancelled Open. `cancel` on a file input is Chrome 113, Firefox
     * 109 and Safari 16.4, so this only ever fires on something older.
     *
     * Not a bare focus handler: `change` is dispatched AFTER the window regains
     * focus, so resolving on `focus` itself would silently throw away the file
     * a child had just chosen — the worst possible outcome here. Wait a beat,
     * and let a `change` that lands first win through `settled`.
     */
    function onWindowFocus(): void {
      timer = window.setTimeout(() => done(null), FALLBACK_SETTLE_MS);
    }
    addEventListener("focus", onWindowFocus, { once: true });

    input.click();
    // A detached input still fires `change` and still exposes `input.files`, so
    // the node can go as soon as it has been clicked and nothing can leak.
    setTimeout(() => input.remove(), 0);
  });
}

/** A .txt dropped anywhere on the page, read through the identical guarded path. */
export async function readDropped(file: File): Promise<OpenedFile> {
  return { name: file.name, text: await decode(file), handle: null };
}
