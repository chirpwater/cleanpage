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
    if (button.getAttribute("aria-disabled") !== value) {
      button.setAttribute("aria-disabled", value);
    }
  }

  function refresh(): void {
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
    const before = editorInputs;
    running = true;
    try {
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
    button.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    button.addEventListener("click", (event) => run(command, button, event.detail === 0));
  }

  ta.addEventListener("input", (event) => {
    editorInputs += 1;
    const type = (event as InputEvent).inputType;
    if (type === "historyUndo") {
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
    queueMicrotask(refresh);
  });

  document.addEventListener("beforeinput", (event) => {
    const type = (event as InputEvent).inputType;
    const command = type === "historyUndo" ? "undo" : type === "historyRedo" ? "redo" : null;
    if (!command || running || !event.cancelable || (document.activeElement !== ta && event.target !== ta)) return;
    event.preventDefault();
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
      event.stopImmediatePropagation();
    };

    document.addEventListener("input", suppressResetInput, true);
    running = true;
    try {
      ta.readOnly = false;
      ta.focus({ preventScroll: true });
      for (let step = 0; step < 1000 && document.queryCommandEnabled("undo"); step += 1) {
        const before = resetInputs;
        ta.focus({ preventScroll: true });
        if (!document.execCommand("undo")) break;
        if (resetInputs === before && document.queryCommandEnabled("undo")) break;
      }
      if (!document.queryCommandEnabled("undo")) {
        ta.focus({ preventScroll: true });
        ta.value = baseline;
        ta.setSelectionRange(baseline.length, baseline.length);
        if (document.execCommand("insertText", false, "\u200b")) {
          cleared = document.execCommand("undo") && !document.queryCommandEnabled("undo");
        }
      }
    } catch {
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
