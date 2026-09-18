import type { Settings } from "./settings.js";

export interface Draft {
  text: string;
  lastSavedText: string;
  fileName: string | null;
}

export interface DraftRecord extends Draft {
  id: string;
  updatedAt: number;
}

export const DRAFT_KEY = "cleanpage:draft:v1";
export const DRAFT_RECORD_PREFIX = "cleanpage:draft:v2:";
export const SETTINGS_KEY = "cleanpage:settings:v1";

function read(key: string): unknown {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function write(key: string, value: Draft | DraftRecord | Settings): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDraft(value: unknown): value is Draft {
  return isRecord(value) && typeof value.text === "string" &&
    typeof value.lastSavedText === "string" &&
    (value.fileName === null || typeof value.fileName === "string");
}

export function validDraftId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function readDraftRecord(id: string): DraftRecord | null {
  if (!validDraftId(id)) return null;
  const record = read(DRAFT_RECORD_PREFIX + id);
  if (!isDraft(record) || !isRecord(record) || record.id !== id ||
      typeof record.updatedAt !== "number" || !Number.isSafeInteger(record.updatedAt) ||
      record.updatedAt < 0) return null;
  return {
    id, text: record.text, lastSavedText: record.lastSavedText,
    fileName: record.fileName, updatedAt: record.updatedAt,
  };
}

export function writeDraftRecord(record: DraftRecord): boolean {
  if (!isDraft(record) || !validDraftId(record.id) || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0) return false;
  return write(DRAFT_RECORD_PREFIX + record.id, {
    id: record.id, text: record.text, lastSavedText: record.lastSavedText,
    fileName: record.fileName, updatedAt: record.updatedAt,
  });
}

export function listDraftRecords(): DraftRecord[] {
  const records: DraftRecord[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(DRAFT_RECORD_PREFIX)) continue;
      const record = readDraftRecord(key.slice(DRAFT_RECORD_PREFIX.length));
      if (record) records.push(record);
    }
  } catch {
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function migrateLegacyDraft(id: string): DraftRecord | null {
  const legacy = readDraft();
  if (!legacy) return null;
  const existing = listDraftRecords().find((record) => record.text === legacy.text &&
    record.lastSavedText === legacy.lastSavedText && record.fileName === legacy.fileName);
  const record: DraftRecord = existing ?? { ...legacy, id, updatedAt: legacy.text.trim() ? Date.now() : 0 };
  if (!existing && !writeDraftRecord(record)) return record;
  const stored = readDraftRecord(record.id);
  if (stored && stored.text === record.text && stored.lastSavedText === record.lastSavedText &&
      stored.fileName === record.fileName && stored.updatedAt === record.updatedAt) {
    const remaining = readDraft();
    if (remaining?.text === legacy.text && remaining.lastSavedText === legacy.lastSavedText &&
        remaining.fileName === legacy.fileName) {
      try { localStorage.removeItem(DRAFT_KEY); } catch { }
    }
  }
  return record;
}

export function readDraft(): Draft | null {
  const draft = read(DRAFT_KEY);
  if (!isDraft(draft)) return null;
  return { text: draft.text, lastSavedText: draft.lastSavedText, fileName: draft.fileName };
}

export function writeDraft(draft: Draft): boolean {
  return write(DRAFT_KEY, {
    text: draft.text,
    lastSavedText: draft.lastSavedText,
    fileName: draft.fileName,
  });
}

export function readSettings(): Settings | null {
  const settings = read(SETTINGS_KEY);
  if (!isRecord(settings) ||
      (settings.font !== "serif" && settings.font !== "dys") ||
      (settings.mode !== "reg" && settings.mode !== "hc") ||
      (settings.size !== "small" && settings.size !== "medium" && settings.size !== "large")) {
    return null;
  }
  return { font: settings.font, mode: settings.mode, size: settings.size };
}

export function writeSettings(settings: Settings): boolean {
  return write(SETTINGS_KEY, { font: settings.font, mode: settings.mode, size: settings.size });
}
