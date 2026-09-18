
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

export function suggestName(text: string): string {
  const first = text.split("\n").find((l) => l.trim().length) ?? "";
  const cleaned = first
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return (cleaned || "My writing") + ".txt";
}

export const normaliseIncoming = (s: string): string =>
  s.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\0/g, "");

export const looksBinary = (s: string): boolean => {
  if (!s.length) return false;
  let bad = 0;
  for (const ch of s) if (ch === "�") bad++;
  return bad / s.length > 0.01;
};

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

export interface OpenedFile {
  name: string;
  text: string;
  handle: TPFileHandle | null;
}

export function adopt(o: OpenedFile): void {
  handle = o.handle;
  fileName = o.name;
}

async function decode(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return normaliseIncoming(new TextDecoder("utf-8", { fatal: false }).decode(buf));
}

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
    return { name: h.name, text, handle: h };
  }
  return openViaInput();
}

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
      clearTimeout(timer);
      removeEventListener("focus", onWindowFocus);
      decode(file).then((text) => {
        done({ name: file.name, text, handle: null });
      }, fail);
    });
    input.addEventListener("cancel", () => done(null));

    function onWindowFocus(): void {
      timer = window.setTimeout(() => done(null), FALLBACK_SETTLE_MS);
    }
    addEventListener("focus", onWindowFocus, { once: true });

    input.click();
    setTimeout(() => input.remove(), 0);
  });
}

export async function readDropped(file: File): Promise<OpenedFile> {
  return { name: file.name, text: await decode(file), handle: null };
}
