/**
 * Toolbar access to the textarea's native edit history. Keeping the browser's
 * history (rather than storing our own text snapshots) preserves typing groups,
 * selections, paste, IME composition, and the usual keyboard shortcuts.
 */
export function initHistory(
  ta: HTMLTextAreaElement,
  undoButton: HTMLButtonElement,
  redoButton: HTMLButtonElement,
): { refresh(): void; reset(): void } {
  let baseline = ta.value;
  let protectBoundary = false;
  let undoAllowed = false;
  let redoAllowed = false;
  let redoSteps = 0;
  let composing = false;
  let undoAvailable = false;
  let redoAvailable = false;
  let editorInputs = 0;
  let documentInputs = 0;
  let running = false;

  function paint(button: HTMLButtonElement, available: boolean): void {
    const value = String(!available);
    // Do not rewrite unchanged DOM during typing: that can split native undo
    // groups in some engines. aria-disabled also keeps keyboard focus stable
    // when using the last available Undo or Redo action.
    if (button.getAttribute("aria-disabled") !== value) {
      button.setAttribute("aria-disabled", value);
    }
  }

  function refresh(): void {
    // Firefox's query is scoped to the focused editor. Retain the last known
    // editor state while focus is on a toolbar button or in a settings dialog.
    if (document.activeElement === ta) {
      undoAvailable = undoAllowed && document.queryCommandEnabled("undo");
      redoAvailable = redoAllowed && document.queryCommandEnabled("redo");
    } else {
      if (!undoAllowed) undoAvailable = false;
      if (!redoAllowed) redoAvailable = false;
    }
    paint(undoButton, undoAvailable && !composing);
    paint(redoButton, redoAvailable && !composing);
  }

  function permitted(command: "undo" | "redo"): boolean {
    return !composing && (command === "undo" ? undoAvailable : redoAvailable);
  }

  function run(command: "undo" | "redo", button?: HTMLButtonElement, keyboard = false): void {
    if (running || !permitted(command)) return;
    const restoreButton = keyboard && document.activeElement === button;
    const x = window.scrollX;
    const y = window.scrollY;
    const top = ta.scrollTop;
    const left = ta.scrollLeft;
    ta.focus({ preventScroll: true });
    // execCommand is intentionally used here: there is no replacement API for
    // accessing a native textarea's undo buffer. Its input event follows the
    // same persistence/layout path as typing and keyboard Undo/Redo.
    const before = editorInputs;
    running = true;
    try {
      // Chromium and WebKit share document-level edit history with the Download
      // filename input. Skip those transactions, so one writing command never
      // silently edits a now-hidden filename instead. Firefox already scopes
      // the command to the focused field. Every writing edit remains native.
      for (let skipped = 0; skipped < 100 && editorInputs === before; skipped += 1) {
        ta.focus({ preventScroll: true });
        const priorInput = documentInputs;
        if (!document.queryCommandEnabled(command) || !document.execCommand(command)) break;
        if (documentInputs === priorInput) break;
      }
    } finally {
      running = false;
    }
    ta.focus({ preventScroll: true });
    if (editorInputs === before) {
      if (command === "undo") undoAllowed = false;
      else { redoAllowed = false; redoSteps = 0; }
    }
    refresh();
    if (restoreButton) button?.focus({ preventScroll: true });
    const restoreScroll = () => {
      ta.scrollTop = top;
      ta.scrollLeft = left;
      window.scrollTo(x, y);
    };
    restoreScroll();
  }

  for (const [button, command] of [
    [undoButton, "undo"],
    [redoButton, "redo"],
  ] as const) {
    // Mouse/touch activation should edit the current selection and leave the
    // child ready to continue typing, without moving focus out of the page.
    button.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    button.addEventListener("click", (event) => run(command, button, event.detail === 0));
  }

  ta.addEventListener("input", (event) => {
    editorInputs += 1;
    const type = (event as InputEvent).inputType;
    if (type === "historyUndo") {
      // WebKit retains old native transactions after programmatic document
      // replacement. Never let Undo pass the currently loaded document.
      undoAllowed = !protectBoundary || ta.value !== baseline;
      redoSteps += 1;
      redoAllowed = true;
    } else if (type === "historyRedo") {
      undoAllowed = true;
      redoSteps = Math.max(0, redoSteps - 1);
      redoAllowed = redoSteps > 0;
    } else {
      undoAllowed = true;
      redoSteps = 0;
      redoAllowed = false;
    }
    // The native command state is updated after the input listener returns.
    queueMicrotask(refresh);
  });

  document.addEventListener("beforeinput", (event) => {
    const type = (event as InputEvent).inputType;
    const command = type === "historyUndo" ? "undo" : type === "historyRedo" ? "redo" : null;
    if (!command || running || !event.cancelable || (document.activeElement !== ta && event.target !== ta)) return;
    event.preventDefault();
    // Browser Edit/context-menu commands use beforeinput without a keydown.
    // Schedule outside that event; nested execCommand is rejected by Firefox.
    if (permitted(command)) queueMicrotask(() => run(command));
  });
  document.addEventListener("input", () => { documentInputs += 1; }, true);

  ta.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    const command = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
    if (command) {
      event.preventDefault();
      run(command);
    }
  });

  ta.addEventListener("focus", refresh);
  ta.addEventListener("compositionstart", () => { composing = true; refresh(); });
  ta.addEventListener("compositionend", () => { composing = false; queueMicrotask(refresh); });
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === ta) refresh();
  });

  /** Clear WebKit's retained transactions only at an explicit document change. */
  function clearRetainedHistory(): boolean {
    const active = document.activeElement as HTMLElement | null;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const direction = ta.selectionDirection;
    const readOnly = ta.readOnly;
    const top = ta.scrollTop;
    const left = ta.scrollLeft;
    const x = window.scrollX;
    const y = window.scrollY;
    let resetInputs = 0;
    let cleared = false;
    const suppressResetInput = (event: Event) => {
      resetInputs += 1;
      // These synchronous native commands are buffer maintenance, not writing.
      // Do not let their temporary values reach persistence or layout listeners.
      event.stopImmediatePropagation();
    };

    document.addEventListener("input", suppressResetInput, true);
    running = true;
    try {
      // Loading holds a read-only lock. Native buffer commands need an editable
      // target, but no browser task or user input can interleave this block.
      ta.readOnly = false;
      ta.focus({ preventScroll: true });
      for (let step = 0; step < 1000 && document.queryCommandEnabled("undo"); step += 1) {
        const before = resetInputs;
        ta.focus({ preventScroll: true });
        if (!document.execCommand("undo")) break;
        if (resetInputs === before && document.queryCommandEnabled("undo")) break;
      }
      if (!document.queryCommandEnabled("undo")) {
        // A real edit discards the old Redo branch. Immediately undo that edit
        // so the new document has no Undo history. The sole remaining Redo is
        // blocked by redoAllowed until real writing replaces it.
        ta.focus({ preventScroll: true });
        ta.value = baseline;
        ta.setSelectionRange(baseline.length, baseline.length);
        if (document.execCommand("insertText", false, "\u200b")) {
          cleared = document.execCommand("undo") && !document.queryCommandEnabled("undo");
        }
      }
    } catch {
      // Unsupported or failed native commands keep the conservative boundary
      // guard. In particular, never substitute a custom text-history stack.
    } finally {
      try {
        ta.value = baseline;
        ta.setSelectionRange(start, end, direction);
        if (active?.isConnected) active.focus({ preventScroll: true });
        ta.scrollTop = top;
        ta.scrollLeft = left;
        window.scrollTo(x, y);
      } finally {
        ta.readOnly = readOnly;
        running = false;
        document.removeEventListener("input", suppressResetInput, true);
      }
    }
    return cleared;
  }

  function reset(): void {
    baseline = ta.value;
    redoSteps = 0;
    undoAllowed = redoAllowed = undoAvailable = redoAvailable = false;
    // Chromium keeps old textarea transactions after .value assignment. A
    // detach/reinsert clears those transactions without replacing the textarea
    // object or its listeners. Other engines also get the boundary guards above.
    const parent = ta.parentNode;
    const next = ta.nextSibling;
    const focused = document.activeElement === ta;
    if (parent) {
      ta.remove();
      parent.insertBefore(ta, next);
    }
    if (focused) ta.focus({ preventScroll: true });
    const retained = document.queryCommandEnabled("undo") || document.queryCommandEnabled("redo");
    protectBoundary = retained && !clearRetainedHistory();
    refresh();
  }

  refresh();
  return { refresh, reset };
}
