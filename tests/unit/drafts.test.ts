import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_LOCK_PREFIX, DRAFT_SESSION_KEY, startDraftSession } from "../../src/drafts.js";
import type { DraftSession } from "../../src/drafts.js";
import { DRAFT_KEY, listDraftRecords, readDraftRecord, writeDraft, writeDraftRecord } from "../../src/storage.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

function lockManager(): LockManager {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  return {
    query: async () => ({ held: [...held].map((name) => ({ name, mode: "exclusive" as const })), pending: [] }),
    request(name: string, optionsOrCallback: LockOptions | LockGrantedCallback<unknown>, callback?: LockGrantedCallback<unknown>) {
      const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
      const run = typeof optionsOrCallback === "function" ? optionsOrCallback : callback!;
      return new Promise<unknown>((resolve, reject) => {
        const take = () => {
          if (held.has(name)) {
            if (options.ifAvailable) {
              Promise.resolve(run(null)).then(resolve, reject);
              return;
            }
            const queue = waiters.get(name) ?? [];
            queue.push(take);
            waiters.set(name, queue);
            return;
          }
          held.add(name);
          Promise.resolve(run({ name, mode: "exclusive" } as Lock)).then(resolve, reject).finally(() => {
            held.delete(name);
            waiters.get(name)?.shift()?.();
          });
        };
        take();
      });
    },
  } as LockManager;
}

const draft = (text: string, lastSavedText = "") => ({ text, lastSavedText, fileName: null });
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

describe("independent tab drafts", () => {
  let sessions: DraftSession[];
  let store: Storage;
  let locks: LockManager;

  async function tab(pointer?: string, tabStore = memoryStorage()) {
    const events = new EventTarget();
    if (pointer) tabStore.setItem(DRAFT_SESSION_KEY, pointer);
    vi.stubGlobal("sessionStorage", tabStore);
    vi.stubGlobal("window", events);
    const session = await startDraftSession();
    sessions.push(session);
    return { session, events, tabStore };
  }

  beforeEach(() => {
    sessions = [];
    store = memoryStorage();
    locks = lockManager();
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("navigator", { locks });
  });

  afterEach(async () => {
    sessions.forEach((session) => session.dispose());
    await settle();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reopens the most recently edited writing without changing its timestamp", async () => {
    writeDraftRecord({ ...draft("Old"), id: "old", updatedAt: 10 });
    writeDraftRecord({ ...draft("Recent", "Recent"), id: "recent", updatedAt: 20 });
    writeDraftRecord({ ...draft(" \n\t"), id: "empty", updatedAt: 100 });
    const { session } = await tab();
    expect(session.currentId()).toBe("recent");
    expect(session.initial).toEqual(draft("Recent", "Recent"));
    expect(session.persist(session.initial)).toBe(true);
    expect(readDraftRecord("recent")?.updatedAt).toBe(20);
    expect(session.listPrevious().map((record) => record.id)).toEqual(["old"]);
  });

  it("starts a second tab blank and isolates writing in each tab", async () => {
    const first = await tab();
    first.session.persist(draft("First story"));
    const second = await tab();
    expect(second.session.initial).toEqual(draft(""));
    expect(second.session.currentId()).not.toBe(first.session.currentId());
    second.session.persist(draft("Second story"));
    first.session.persist(draft("First story continued"));
    expect(readDraftRecord(second.session.currentId())?.text).toBe("Second story");
    expect(readDraftRecord(first.session.currentId())?.text).toBe("First story continued");
    expect(second.session.listPrevious()).toHaveLength(1);
  });

  it("serializes simultaneous startup so only one tab auto-resumes", async () => {
    writeDraftRecord({ ...draft("Existing"), id: "existing", updatedAt: 10 });
    const [first, second] = await Promise.all([tab(), tab()]);
    expect([first.session.initial.text, second.session.initial.text].sort()).toEqual(["", "Existing"]);
    expect(first.session.currentId()).not.toBe(second.session.currentId());
  });

  it("resumes a reloaded tab, including an intentionally blank document", async () => {
    const first = await tab();
    first.session.persist(draft("Retained story"));
    await first.session.newDocument(draft(""));
    const blankId = first.session.currentId();
    first.session.dispose();
    await settle();
    const reload = await tab(undefined, first.tabStore);
    expect(reload.session.currentId()).toBe(blankId);
    expect(reload.session.initial.text).toBe("");
    expect(reload.session.listPrevious()[0].text).toBe("Retained story");
  });

  it("duplicates a live tab as an independent copy including its save checkpoint", async () => {
    const first = await tab();
    first.session.persist(draft("Draft", "Saved version"));
    const copy = await tab(first.session.currentId());
    expect(copy.session.currentId()).not.toBe(first.session.currentId());
    expect(copy.session.initial).toEqual(draft("Draft", "Saved version"));
    copy.session.persist(draft("Copy edited"));
    expect(readDraftRecord(first.session.currentId())?.text).toBe("Draft");
  });

  it("new writing retains the previous draft and recovery claims it without replacing other records", async () => {
    const { session } = await tab();
    session.persist(draft("First", "First"));
    const firstId = session.currentId();
    await session.newDocument(draft("Second"));
    const secondId = session.currentId();
    expect(await session.recover(firstId)).toEqual(draft("First", "First"));
    expect(session.currentId()).toBe(firstId);
    expect(readDraftRecord(secondId)?.text).toBe("Second");
    expect(session.listPrevious().map((record) => record.id)).toEqual([secondId]);
  });

  it("recovering a draft already open elsewhere creates a copy", async () => {
    const first = await tab();
    first.session.persist(draft("Shared starting point"));
    const second = await tab();
    expect(await second.session.recover(first.session.currentId())).toEqual(draft("Shared starting point"));
    expect(second.session.currentId()).not.toBe(first.session.currentId());
    second.session.persist(draft("Independent"));
    expect(readDraftRecord(first.session.currentId())?.text).toBe("Shared starting point");
  });

  it("migrates legacy writing and retains it in memory when storage is full", async () => {
    writeDraft(draft("Legacy", "Exported"));
    const first = await tab();
    expect(first.session.initial).toEqual(draft("Legacy", "Exported"));
    expect(store.getItem(DRAFT_KEY)).toBeNull();
    first.session.dispose();
    await settle();
    store.clear();
    writeDraft(draft("Only legacy copy"));
    store.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    const second = await tab();
    expect(second.session.initial).toEqual(draft("Only legacy copy"));
    expect(second.session.persist(second.session.initial)).toBe(false);
    expect(JSON.parse(store.getItem(DRAFT_KEY)!)).toEqual(draft("Only legacy copy"));
  });

  it("does not change edit timestamps for file-save checkpoints, but does for typing", async () => {
    writeDraftRecord({ ...draft("Words"), id: "story", updatedAt: 10 });
    const { session } = await tab();
    session.persist(draft("Words", "Words"));
    expect(readDraftRecord("story")?.updatedAt).toBe(10);
    session.persist(draft("Words added", "Words"));
    expect(readDraftRecord("story")!.updatedAt).toBeGreaterThan(10);
  });

  it("rechecks unchanged writing so clearing browser storage cannot create a false safety claim", async () => {
    const { session } = await tab();
    const writing = draft("Only copy");
    expect(session.persist(writing)).toBe(true);
    store.clear();
    expect(session.persist(writing)).toBe(true);
    expect(readDraftRecord(session.currentId())?.text).toBe("Only copy");
    store.clear();
    store.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(session.persist(writing)).toBe(false);
  });

  it("blocks writes while suspended and reacquires the original unchanged draft", async () => {
    const first = await tab();
    first.session.persist(draft("Story"));
    const id = first.session.currentId();
    first.events.dispatchEvent(new Event("pagehide"));
    expect(first.session.persist(draft("Unsaved memory"))).toBe(false);
    await settle();
    await first.session.ready();
    expect(first.session.currentId()).toBe(id);
    expect(first.session.persist(draft("Unsaved memory"))).toBe(true);
    expect(readDraftRecord(id)?.text).toBe("Unsaved memory");
  });

  it("copies a bfcache-returning tab if another owner edited and released its old draft", async () => {
    const first = await tab();
    first.session.persist(draft("Before leaving"));
    const oldId = first.session.currentId();
    first.events.dispatchEvent(new Event("pagehide"));
    await settle();
    const second = await tab();
    expect(second.session.currentId()).toBe(oldId);
    second.session.persist(draft("Edited elsewhere"));
    second.session.dispose();
    await settle();
    await first.session.ready();
    expect(first.session.currentId()).not.toBe(oldId);
    expect(first.session.persist(draft("Before leaving"))).toBe(true);
    expect(readDraftRecord(oldId)?.text).toBe("Edited elsewhere");
    expect(readDraftRecord(first.session.currentId())?.text).toBe("Before leaving");
  });

  it("does not overwrite the previous record if navigation interrupts starting a new document", async () => {
    const first = await tab();
    first.session.persist(draft("Keep the old story"));
    const oldId = first.session.currentId();
    const switching = first.session.newDocument(draft("New story"));
    first.events.dispatchEvent(new Event("pagehide"));
    await switching;
    expect(first.session.currentId()).not.toBe(oldId);
    expect(first.session.persist(draft("New story"))).toBe(false);
    await settle();
    await first.session.ready();
    expect(first.session.persist(draft("New story"))).toBe(true);
    expect(readDraftRecord(oldId)?.text).toBe("Keep the old story");
    expect(readDraftRecord(first.session.currentId())?.text).toBe("New story");
  });

  it("serializes resumption behind an interrupted New so its lease matches the new document ID", async () => {
    const first = await tab();
    first.session.persist(draft("Original"));
    const originalId = first.session.currentId();
    const switching = first.session.newDocument(draft("New story"));
    await Promise.resolve();
    first.events.dispatchEvent(new Event("pagehide"));
    const resuming = first.session.ready();
    await Promise.all([switching, resuming]);
    expect(first.session.currentId()).not.toBe(originalId);
    expect(first.session.persist(draft("New story"))).toBe(true);
    const heldNames = (await locks.query()).held!.map((lock) => lock.name);
    expect(heldNames).toContain(DRAFT_LOCK_PREFIX + first.session.currentId());
    expect(heldNames).not.toContain(DRAFT_LOCK_PREFIX + originalId);
    const duplicate = await tab(first.session.currentId());
    expect(duplicate.session.currentId()).not.toBe(first.session.currentId());
    expect(duplicate.session.initial.text).toBe("New story");
    expect(readDraftRecord(originalId)?.text).toBe("Original");
  });

  it("queues recovery and resumption after an interrupted new document without leaking leases", async () => {
    const first = await tab();
    first.session.persist(draft("Recover me", "Saved checkpoint"));
    const originalId = first.session.currentId();
    const switching = first.session.newDocument(draft("Next"));
    await Promise.resolve();
    first.events.dispatchEvent(new Event("pagehide"));
    const recovering = first.session.recover(originalId);
    const resuming = first.session.ready();
    await switching;
    expect(await recovering).toEqual(draft("Recover me", "Saved checkpoint"));
    await resuming;
    expect(first.session.persist(draft("Recovered edit", "Saved checkpoint"))).toBe(true);
    const heldNames = (await locks.query()).held!.map((lock) => lock.name);
    expect(heldNames).toEqual([DRAFT_LOCK_PREFIX + first.session.currentId()]);
    expect(readDraftRecord(originalId)?.text).toBe("Recover me");
  });

  it("copy-only fallback never overwrites an existing draft without Web Locks", async () => {
    vi.stubGlobal("navigator", {});
    writeDraftRecord({ ...draft("Original"), id: "original", updatedAt: 10 });
    const first = await tab("original");
    const second = await tab("original");
    expect(first.session.initial.text).toBe("Original");
    first.session.persist(draft("First"));
    second.session.persist(draft("Second"));
    expect(first.session.currentId()).not.toBe(second.session.currentId());
    expect(readDraftRecord("original")?.text).toBe("Original");
    expect(listDraftRecords()).toHaveLength(3);
  });

  it("continues without throwing when all browser storage and locking are denied", async () => {
    const denied = () => { throw new DOMException("Denied", "SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: denied, setItem: denied, get length() { return denied(); } });
    vi.stubGlobal("navigator", { locks: { request: denied, query: denied } });
    const { session } = await tab(undefined, { getItem: denied, setItem: denied } as unknown as Storage);
    expect(session.initial.text).toBe("");
    expect(session.persist(draft("Keep typing"))).toBe(false);
    expect(session.listPrevious()).toEqual([]);
    await session.newDocument(draft("Next"));
    expect(await session.recover("missing")).toBeNull();
  });
});
