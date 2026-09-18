import {
  listDraftRecords, migrateLegacyDraft, readDraftRecord, removeDraftRecord, validDraftId, writeDraftRecord,
} from "./storage.js";
import type { Draft, DraftRecord } from "./storage.js";

export type { DraftRecord } from "./storage.js";
export const DRAFT_SESSION_KEY = "cleanpage:document:v2";
export const DRAFT_LOCK_PREFIX = "cleanpage:document:";
const STARTUP_LOCK = "cleanpage:startup:v2";
const KEEP_DRAFTS = 10;
const blank = (): Draft => ({ text: "", lastSavedText: "", fileName: null });

export interface DraftSession {
  initial: Draft;
  currentId(): string;
  listPrevious(): DraftRecord[];
  persist(draft: Draft): boolean;
  newDocument(draft: Draft): Promise<void>;
  recover(id: string): Promise<Draft | null>;
  ready(): Promise<void>;
  dispose(): void;
}

interface Lease { release(): void; closed: Promise<void>; }

function newId(): string {
  try { return crypto.randomUUID(); } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

function storedSessionId(tabStorage: Storage | null): string | null {
  try {
    const id = tabStorage?.getItem(DRAFT_SESSION_KEY);
    return id && validDraftId(id) ? id : null;
  } catch { return null; }
}

function remember(id: string, tabStorage: Storage | null): void {
  try { tabStorage?.setItem(DRAFT_SESSION_KEY, id); } catch { /* Recovery still works via stored records. */ }
}

function sameRecord(a: DraftRecord | null, b: DraftRecord | null): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.text === b.text &&
    a.lastSavedText === b.lastSavedText && a.fileName === b.fileName && a.updatedAt === b.updatedAt);
}

/** The held callback promise is the lease: the browser releases it when its tab is destroyed. */
function acquire(locks: LockManager, id: string): Promise<Lease | null> {
  return new Promise((resolve) => {
    let markClosed!: () => void;
    const closed = new Promise<void>((finish) => { markClosed = finish; });
    try {
      void locks.request(DRAFT_LOCK_PREFIX + id, { ifAvailable: true }, async (lock) => {
        if (!lock) { resolve(null); return; }
        await new Promise<void>((release) => resolve({ release, closed }));
      }).then(markClosed, () => { markClosed(); resolve(null); });
    } catch { markClosed(); resolve(null); }
  });
}

/** Every active editor owns one independent record; fallback browsers only write newly created IDs. */
export async function startDraftSession(): Promise<DraftSession> {
  const tabWindow = window;
  let tabStorage: Storage | null = null;
  try { tabStorage = sessionStorage; } catch { /* A tab pointer is optional. */ }
  let locks: LockManager | null = null;
  try { locks = navigator.locks ?? null; } catch { /* Copy-only fallback below. */ }
  let id = "";
  let lease: Lease | null = null;
  let latest: Draft = blank();
  let stored: DraftRecord | null = null;
  let suspended = false;
  let disposed = false;
  let generation = 0;
  let pendingReady: Promise<void> | null = null;
  let transition: Promise<void> = Promise.resolve();

  // A bfcache pageshow can arrive while an earlier file action is still
  // awaiting its document lock. Never let it acquire an old ID's lease while
  // that action publishes a new ID. Synchronous input persistence stays outside
  // this queue; the caller keeps the editor read-only during transitions.
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = transition.then(operation);
    transition = result.then(() => {}, () => {});
    return result;
  }

  async function fresh(draft: Draft, editedAt?: number, resuming = false): Promise<void> {
    const stamp = generation;
    const previous = lease;
    let nextId = newId();
    while (readDraftRecord(nextId)) nextId = newId();
    if (suspended && !resuming) {
      id = nextId;
      latest = { text: draft.text, lastSavedText: draft.lastSavedText, fileName: draft.fileName };
      stored = null;
      remember(id, tabStorage);
      return;
    }
    let nextLease: Lease | null = null;
    if (locks) {
      nextLease = await acquire(locks, nextId);
      // A rejected Lock API must degrade to unique-ID writes, never shared-ID writes.
      if (!nextLease) { locks = null; nextId = newId(); }
    }
    if (disposed) { nextLease?.release(); return; }
    // A navigation can suspend the page while it waits for the new lock. Keep the
    // intended document identity, but never write it until pageshow reacquires it.
    if (stamp !== generation) {
      nextLease?.release();
      id = nextId;
      latest = { text: draft.text, lastSavedText: draft.lastSavedText, fileName: draft.fileName };
      stored = null;
      remember(id, tabStorage);
      return;
    }
    id = nextId;
    lease = nextLease ?? { release() {}, closed: Promise.resolve() };
    previous?.release();
    await previous?.closed;
    latest = { text: draft.text, lastSavedText: draft.lastSavedText, fileName: draft.fileName };
    stored = null;
    remember(id, tabStorage);
    if (disposed || stamp !== generation) return;
    const record: DraftRecord = { ...latest, id, updatedAt: editedAt ?? (draft.text.trim() ? Date.now() : 0) };
    if (writeDraftRecord(record)) stored = record;
    await prune();
  }

  async function openIds(): Promise<Set<string>> {
    const open = new Set([id]);
    try {
      for (const lock of (await locks?.query())?.held ?? []) {
        if (lock.name?.startsWith(DRAFT_LOCK_PREFIX)) open.add(lock.name.slice(DRAFT_LOCK_PREFIX.length));
      }
    } catch { /* Without ownership information, only this editor's record is spared. */ }
    return open;
  }

  // Editors clone their document under a new id whenever a lease cannot be
  // reclaimed — a bfcache restore, a recovery that loses the race. Nothing ever
  // deleted the copy, so the recovery list grew without bound. Without the Lock
  // API there is no way to tell a stale copy from another tab's live document,
  // so those browsers keep every record.
  async function prune(): Promise<void> {
    if (!locks) return;
    const open = await openIds();
    const seen = new Set<string>();
    let kept = 0;
    for (const record of listDraftRecords()) {
      if (!open.has(record.id) && (!record.text.trim() || seen.has(record.text) || kept >= KEEP_DRAFTS)) {
        removeDraftRecord(record.id);
        continue;
      }
      if (record.text.trim()) {
        seen.add(record.text);
        kept++;
      }
    }
  }

  async function claim(record: DraftRecord | null, requestedId: string): Promise<boolean> {
    if (!locks || suspended) return false;
    const stamp = generation;
    const next = await acquire(locks, requestedId);
    if (!next) return false;
    if (disposed || stamp !== generation) { next.release(); return false; }
    // Read again after acquisition: a previously open owner may have just finished saving.
    const current = readDraftRecord(requestedId);
    record = current ?? record;
    const previous = lease;
    previous?.release();
    lease = next;
    id = requestedId;
    latest = record ? { text: record.text, lastSavedText: record.lastSavedText, fileName: record.fileName } : blank();
    stored = current;
    remember(id, tabStorage);
    await previous?.closed;
    return true;
  }

  async function initialize(): Promise<void> {
    const remembered = storedSessionId(tabStorage);
    const migrated = migrateLegacyDraft(newId());
    if (remembered) {
      const record = readDraftRecord(remembered);
      if (!await claim(record, remembered)) await fresh(record ?? blank(), record?.updatedAt);
      return;
    }
    let anotherOpen = false;
    if (locks) {
      try {
        const state = await locks.query();
        anotherOpen = state.held?.some((lock) => lock.name?.startsWith(DRAFT_LOCK_PREFIX)) ?? false;
      } catch {
        // Without reliable ownership information, existing records are never edited in place.
        locks = null;
      }
    }
    const recent = listDraftRecords().find((record) => record.text.trim()) ??
      (migrated?.text.trim() ? migrated : null);
    if (!anotherOpen && recent) {
      if (!await claim(recent, recent.id)) await fresh(recent, recent.updatedAt);
    } else {
      await fresh(blank());
    }
  }

  try {
    if (locks) await locks.request(STARTUP_LOCK, initialize);
    else await initialize();
  } catch {
    // Browser policy can reject lock requests, just as it can reject storage access.
    locks = null;
    await initialize();
  }

  await prune();
  const initial = { ...latest };
  function persist(draft: Draft): boolean {
    latest = { text: draft.text, lastSavedText: draft.lastSavedText, fileName: draft.fileName };
    if (!lease || suspended || disposed) return false;
    if (stored && stored.text === latest.text && stored.lastSavedText === latest.lastSavedText &&
        stored.fileName === latest.fileName && sameRecord(readDraftRecord(id), stored)) return true;
    const updatedAt = stored?.text === latest.text ? stored.updatedAt :
      Math.max(Date.now(), (stored?.updatedAt ?? 0) + 1);
    const record = { ...latest, id, updatedAt };
    if (!writeDraftRecord(record)) return false;
    stored = record;
    return true;
  }

  function pagehide(): void {
    suspended = true;
    generation++;
    lease?.release();
    lease = null;
  }
  tabWindow.addEventListener("pagehide", pagehide);

  async function reacquire(): Promise<void> {
    const stamp = generation;
    const current = readDraftRecord(id);
    const currentDraft = { ...latest };
    let next: Lease | null = null;
    if (locks && sameRecord(current, stored)) {
      next = await acquire(locks, id);
      if (next && !sameRecord(readDraftRecord(id), stored)) { next.release(); next = null; }
    }
    if (disposed || stamp !== generation) { next?.release(); return; }
    if (next) lease = next;
    else await fresh(currentDraft, stored?.updatedAt, true);
    if (disposed || stamp !== generation) { lease?.release(); lease = null; return; }
    suspended = false;
  }

  return {
    initial,
    currentId: () => id,
    listPrevious: () => listDraftRecords().filter((record) => record.id !== id && !!record.text.trim()),
    persist,
    newDocument(draft) {
      return enqueue(async () => {
        if (disposed) return;
        await fresh(draft);
      });
    },
    recover(previousId) {
      return enqueue(async () => {
        if (disposed || previousId === id) return null;
        const record = readDraftRecord(previousId);
        if (!record) return null;
        if (!await claim(record, previousId)) await fresh(record, record.updatedAt);
        else await prune();
        return { ...latest };
      });
    },
    ready() {
      if (disposed) return Promise.resolve();
      if (!pendingReady) pendingReady = enqueue(async () => {
        if (!suspended && lease) return;
        await reacquire();
      }).finally(() => { pendingReady = null; });
      return pendingReady;
    },
    dispose() {
      disposed = true;
      pagehide();
      tabWindow.removeEventListener("pagehide", pagehide);
    },
  };
}
