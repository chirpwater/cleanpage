import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_KEY, DRAFT_RECORD_PREFIX, SETTINGS_KEY, readDraft, readSettings, writeDraft, writeSettings,
  listDraftRecords, migrateLegacyDraft, readDraftRecord, writeDraftRecord,
} from "../../src/storage.js";

describe("local recovery storage", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("round-trips Unicode writing, its export baseline and optional filename", () => {
    const draft = { text: "A story\n猫 👩🏽‍🚀\tend\n", lastSavedText: "A story", fileName: "Story.txt" };
    expect(writeDraft(draft)).toBe(true);
    expect(readDraft()).toEqual(draft);
    expect(writeDraft({ text: "", lastSavedText: "", fileName: null })).toBe(true);
    expect(readDraft()).toEqual({ text: "", lastSavedText: "", fileName: null });
  });

  it("keeps writing and display settings independent", () => {
    const draft = { text: "Keep my story", lastSavedText: "", fileName: null };
    const settings = { font: "dys", size: "large" } as const;
    writeDraft(draft);
    writeSettings(settings);
    expect(readDraft()).toEqual(draft);
    expect(readSettings()).toEqual(settings);
    expect([...values.keys()]).toEqual([DRAFT_KEY, SETTINGS_KEY]);
    writeSettings({ font: "serif", size: "medium" });
    expect(readDraft()).toEqual(draft);
  });

  it("does not persist an incidental file handle or other extra fields", () => {
    const draft = { text: "Words", lastSavedText: "", fileName: "Words.txt", handle: { secret: true } };
    writeDraft(draft);
    expect(JSON.parse(values.get(DRAFT_KEY)!)).toEqual({ text: "Words", lastSavedText: "", fileName: "Words.txt" });
  });

  it("treats absent data and earlier schema keys as no saved state", () => {
    values.set("cleanpage:draft:v0", JSON.stringify({ text: "old" }));
    expect(readDraft()).toBeNull();
    expect(readSettings()).toBeNull();
  });

  it.each(["{", "null", "[]", '"text"', "17", "{}",
    '{"text":"Story","lastSavedText":""}',
    '{"text":1,"lastSavedText":"","fileName":null}',
    '{"text":"Story","lastSavedText":null,"fileName":null}',
    '{"text":"Story","lastSavedText":"","fileName":{}}',
  ])("ignores a malformed draft: %s", (value) => {
    values.set(DRAFT_KEY, value);
    expect(readDraft()).toBeNull();
  });

  it.each(["{", "null", "[]", "{}",
    '{"font":"serif"}',
    '{"font":"comic","size":"medium"}',
    '{"font":"serif","size":20}',
  ])("ignores malformed or unknown settings: %s", (value) => {
    values.set(SETTINGS_KEY, value);
    expect(readSettings()).toBeNull();
  });

  it("handles storage access denied without breaking reads or writes", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("Blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("Blocked", "SecurityError"); },
    });
    expect(readDraft()).toBeNull();
    expect(readSettings()).toBeNull();
    expect(writeDraft({ text: "Unsaved", lastSavedText: "", fileName: null })).toBe(false);
    expect(writeSettings({ font: "serif", size: "medium" })).toBe(false);
  });

  it("reports quota failure without replacing the last recoverable draft", () => {
    const draft = { text: "Earlier story", lastSavedText: "", fileName: null };
    writeDraft(draft);
    localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(writeDraft({ ...draft, text: "New writing" })).toBe(false);
    expect(readDraft()).toEqual(draft);
  });

  it("survives an unavailable storage global", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readDraft()).toBeNull();
    expect(readSettings()).toBeNull();
    expect(writeDraft({ text: "Words", lastSavedText: "", fileName: null })).toBe(false);
  });

  it("stores independent records and sorts by edit time, ignoring corrupt entries", () => {
    const draft = { text: "Words", lastSavedText: "", fileName: null };
    expect(writeDraftRecord({ ...draft, id: "older", updatedAt: 10 })).toBe(true);
    expect(writeDraftRecord({ ...draft, id: "newer", updatedAt: 20 })).toBe(true);
    values.set(DRAFT_RECORD_PREFIX + "broken", "{");
    values.set(DRAFT_RECORD_PREFIX + "mismatch", JSON.stringify({ ...draft, id: "other", updatedAt: 30 }));
    values.set(DRAFT_RECORD_PREFIX + "badtime", JSON.stringify({ ...draft, id: "badtime", updatedAt: -1 }));
    expect(listDraftRecords().map((record) => record.id)).toEqual(["newer", "older"]);
    expect(readDraftRecord("older")?.text).toBe("Words");
    expect(writeDraftRecord({ ...draft, id: "../bad", updatedAt: 1 })).toBe(false);
    expect(readDraftRecord("../bad")).toBeNull();
  });

  it("migrates the legacy draft and saved checkpoint only after verifying the new record", () => {
    const draft = { text: "New paragraph", lastSavedText: "Saved paragraph", fileName: "Story.txt" };
    writeDraft(draft);
    const migrated = migrateLegacyDraft("migrated")!;
    expect(migrated).toMatchObject(draft);
    expect(readDraftRecord("migrated")).toEqual(migrated);
    expect(values.has(DRAFT_KEY)).toBe(false);
  });

  it("preserves the legacy entry on quota failure or silently ignored writes", () => {
    const draft = { text: "Only copy", lastSavedText: "", fileName: null };
    writeDraft(draft);
    localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(migrateLegacyDraft("no-room")).toMatchObject(draft);
    expect(readDraft()).toEqual(draft);
    localStorage.setItem = () => {};
    expect(migrateLegacyDraft("ignored-write")).toMatchObject(draft);
    expect(readDraft()).toEqual(draft);
    expect(readDraftRecord("ignored-write")).toBeNull();
  });

  it("leaves a previous per-document record intact when an update exceeds quota", () => {
    const record = { id: "draft", text: "Original", lastSavedText: "", fileName: null, updatedAt: 100 };
    writeDraftRecord(record);
    localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(writeDraftRecord({ ...record, text: "New text", updatedAt: 101 })).toBe(false);
    expect(readDraftRecord("draft")).toEqual(record);
  });

  it("does not create duplicate migrated records if legacy removal is blocked", () => {
    writeDraft({ text: "Legacy story", lastSavedText: "", fileName: null });
    localStorage.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    const first = migrateLegacyDraft("first")!;
    expect(migrateLegacyDraft("second")).toEqual(first);
    expect(listDraftRecords()).toHaveLength(1);
    expect(values.has(DRAFT_KEY)).toBe(true);
  });
});
