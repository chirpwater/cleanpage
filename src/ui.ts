/**
 * Toolbar, radio groups, status chip, dialogs and the page-break overlay
 * (DESIGN §10).
 */
import { MARGIN, PAGE_BODY_H } from "./metrics.js";
import { S } from "./strings.js";

/* ------------------------------------------------------------ radio groups */

/**
 * Two radios with roving `tabindex`: one tab stop, arrow keys select.
 *
 * Radio groups, not `aria-pressed` toggles: a toggle button whose label names
 * the *other* state confuses children and screen-reader users alike, while a
 * radio group states the current choice unambiguously.
 *
 * The selected radio is filled AND carries a real checkmark element. Never a
 * CSS `::before` — generated content leaks into the accessible name, and an
 * aria snapshot once caught exactly that.
 */
export type ActivationSource = "pointer" | "key";

export function radioGroup(
  root: HTMLElement,
  onChange: (value: string, src: ActivationSource) => void,
): (v: string) => void {
  const radios = Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]'));

  const paint = (chosen: HTMLElement) => {
    for (const r of radios) {
      const on = r === chosen;
      r.setAttribute("aria-checked", on ? "true" : "false");
      r.tabIndex = on ? 0 : -1;
      const mk = r.querySelector(".mk");
      if (on && !mk) {
        const span = document.createElement("span");
        span.className = "mk";
        span.setAttribute("aria-hidden", "true");
        span.textContent = "✓ ";
        r.insertBefore(span, r.firstChild);
      } else if (!on && mk) {
        mk.remove();
      }
    }
  };

  /**
   * `src` is threaded through to the caller because the two are not the same
   * gesture. After a tap or a click the child should find the cursor back in
   * their writing; after an arrow key they are working inside the group, and
   * moving focus out of it would be a change of context on changing the
   * setting of a control (SC 3.2.2) — and would make ArrowLeft a dead key,
   * since the group is no longer focused to receive it.
   */
  const select = (r: HTMLElement, src: ActivationSource) => {
    paint(r);
    r.focus();
    // Fired on every activation, changed or not, so the two paths cannot
    // disagree: re-clicking the radio that is already on used to be the one
    // gesture that left focus behind. The listener is idempotent.
    onChange(r.dataset.value ?? "", src);
  };

  const step = (from: HTMLElement, delta: number) => {
    const i = radios.indexOf(from);
    const next = radios[(i + delta + radios.length) % radios.length];
    if (next) select(next, "key");
  };

  for (const r of radios) {
    r.addEventListener("click", () => select(r, "pointer"));
    r.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          step(r, 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          step(r, -1);
          break;
        case "Home":
          e.preventDefault();
          if (radios[0]) select(radios[0], "key");
          break;
        case "End":
          e.preventDefault();
          if (radios[radios.length - 1]) select(radios[radios.length - 1] as HTMLElement, "key");
          break;
        case " ":
        case "Enter":
          e.preventDefault();
          select(r, "key");
          break;
        default:
          break;
      }
    });
  }

  // Set the group without firing onChange (used for the initial state).
  return (value: string) => {
    const r = radios.find((x) => x.dataset.value === value);
    if (r) paint(r);
  };
}

/* ---------------------------------------------------------- break overlay */

/**
 * `pages - 1` hairlines. Rule k sits at
 * `48 + k * 960` px inside the sheet: the zero-height space between line box
 * 30k and line box 30k+1, so it can never touch a glyph in either face.
 * Cheap and idempotent.
 */
export function renderBreaks(host: HTMLElement, pages: number, pageH: number = PAGE_BODY_H): void {
  const want = Math.max(0, pages - 1);
  while (host.childElementCount > want) host.lastElementChild?.remove();
  for (let k = host.childElementCount; k < want; k++) {
    const rule = document.createElement("div");
    rule.className = "rule";
    host.append(rule);
  }
  for (let k = 1; k <= want; k++) {
    const rule = host.children[k - 1] as HTMLElement;
    const top = MARGIN + k * pageH;
    rule.style.top = top + "px";
  }
}

/* --------------------------------------------------------------- dialogs */

export type Guard = "new" | "open";

/** Ask before creating a browser download; Escape/Cancel leave writing alone. */
export function promptDownloadName(suggested: string, restoreFocusTo: HTMLElement): Promise<string | null> {
  const dlg = document.getElementById("downloadDlg") as HTMLDialogElement;
  const form = document.getElementById("downloadForm") as HTMLFormElement;
  const input = document.getElementById("downloadName") as HTMLInputElement;
  const cancel = document.getElementById("downloadCancel") as HTMLButtonElement;
  const go = document.getElementById("downloadGo") as HTMLButtonElement;
  return new Promise((resolve) => {
    let answer: string | null = null;
    input.value = suggested;
    const untrap = trapTab(dlg, [input, cancel, go]);
    const onSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      if (!input.value.trim()) {
        input.setCustomValidity(S.downloadNameRequired);
        input.reportValidity();
        return;
      }
      answer = input.value;
      dlg.close();
    };
    const onInput = () => input.setCustomValidity("");
    const onCancel = () => dlg.close();
    const onClose = () => {
      untrap();
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("input", onInput);
      cancel.removeEventListener("click", onCancel);
      dlg.removeEventListener("close", onClose);
      restoreFocusTo.focus({ preventScroll: true });
      resolve(answer);
    };
    input.setCustomValidity("");
    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInput);
    cancel.addEventListener("click", onCancel);
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    input.focus();
    input.setSelectionRange(0, suggested.replace(/\.txt$/i, "").length);
  });
}

/**
 * Tab cycles the dialog's own buttons, and never through a stop with no ring.
 *
 * `showModal()` traps focus inside the dialog, but Chrome's native cycle puts
 * the dialog element itself between the last button and the first: measured,
 * the third Tab left `document.activeElement` on BODY with `outlineStyle:
 * none` on both buttons, so the highlight vanished for one press — on the
 * dialog that decides whether a child's writing is deleted. The one-button
 * `say` dialog did the same. Returns its own teardown, called from `onClose`
 * so nothing leaks across opens.
 */
function trapTab(dlg: HTMLDialogElement, stops: HTMLElement[]): () => void {
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Tab" || e.isComposing) return;
    e.preventDefault();
    const i = stops.indexOf(document.activeElement as HTMLElement);
    // Not one of ours (the BODY stop, or focus restored oddly): re-enter the
    // ring at the end the child was heading for, so the cycle self-heals.
    const next =
      i < 0
        ? (e.shiftKey ? stops[stops.length - 1] : stops[0])
        : stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus({ focusVisible: true } as FocusOptions);
  };
  dlg.addEventListener("keydown", onKeydown);
  return () => dlg.removeEventListener("keydown", onKeydown);
}

/**
 * A native <dialog> opened with showModal(): a real focus trap, Escape and
 * ::backdrop come free. Never window.confirm, whose wording is not ours and
 * which reads badly to a screen reader.
 *
 * Two choices, and the safe one takes initial focus. Escape = Keep writing.
 */
export function confirmDiscard(
  dlg: HTMLDialogElement,
  title: HTMLElement,
  body: HTMLElement,
  keep: HTMLButtonElement,
  go: HTMLButtonElement,
  kind: Guard,
  restoreFocusTo: HTMLElement,
): Promise<boolean> {
  title.textContent = kind === "new" ? S.dlgNewTitle : S.dlgOpenTitle;
  body.textContent = kind === "new" ? S.dlgNewBody : S.dlgOpenBody;
  go.textContent = kind === "new" ? S.dlgNewGo : S.dlgOpenGo;

  return new Promise<boolean>((resolve) => {
    let answer = false;
    const untrap = trapTab(dlg, [keep, go]);
    const onGo = () => {
      answer = true;
      dlg.close();
    };
    const onKeep = () => dlg.close();
    const onClose = () => {
      untrap();
      go.removeEventListener("click", onGo);
      keep.removeEventListener("click", onKeep);
      dlg.removeEventListener("close", onClose);
      restoreFocusTo.focus();
      resolve(answer);
    };
    go.addEventListener("click", onGo);
    keep.addEventListener("click", onKeep);
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    keep.focus({ focusVisible: true } as FocusOptions);
  });
}

/** One sentence and an OK button, for the rare thing that went wrong. */
export function say(
  dlg: HTMLDialogElement,
  body: HTMLElement,
  ok: HTMLButtonElement,
  message: string,
  restoreFocusTo: HTMLElement,
): void {
  body.textContent = message;
  const untrap = trapTab(dlg, [ok]);
  const onClose = () => {
    untrap();
    dlg.removeEventListener("close", onClose);
    ok.removeEventListener("click", onOk);
    restoreFocusTo.focus();
  };
  const onOk = () => dlg.close();
  ok.addEventListener("click", onOk);
  dlg.addEventListener("close", onClose);
  dlg.showModal();
  ok.focus({ focusVisible: true } as FocusOptions);
}
