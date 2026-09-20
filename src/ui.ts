import { MARGIN, PAGE_BODY_H } from "./metrics.js";
import { S } from "./strings.js";
import { cleanName } from "./files.js";

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

  const select = (r: HTMLElement, src: ActivationSource) => {
    paint(r);
    r.focus();
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

  return (value: string) => {
    const r = radios.find((x) => x.dataset.value === value);
    if (r) paint(r);
  };
}

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

export type Guard = "new" | "open";

export function promptDownloadName(suggested: string, restoreFocusTo: HTMLElement): Promise<string | null> {
  const dlg = document.getElementById("downloadDlg") as HTMLDialogElement;
  const form = document.getElementById("downloadForm") as HTMLFormElement;
  const input = document.getElementById("downloadName") as HTMLInputElement;
  const cancel = document.getElementById("downloadCancel") as HTMLButtonElement;
  const go = document.getElementById("downloadGo") as HTMLButtonElement;
  const error = document.getElementById("downloadNameError")!;
  const complain = (message: string) => {
    input.setCustomValidity(message);
    input.setAttribute("aria-invalid", String(message !== ""));
    error.textContent = message;
  };
  return new Promise((resolve) => {
    let answer: string | null = null;
    input.value = suggested;
    const untrap = trapTab(dlg, [input, cancel, go]);
    const onSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const problem = !input.value.trim() ? S.downloadNameRequired : !cleanName(input.value) ? S.downloadNameInvalid : "";
      if (problem) {
        complain(problem);
        input.reportValidity();
        return;
      }
      answer = input.value;
      dlg.close();
    };
    const onInput = () => complain("");
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
    complain("");
    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInput);
    cancel.addEventListener("click", onCancel);
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    input.focus();
    input.setSelectionRange(0, suggested.replace(/\.txt$/i, "").length);
  });
}

function trapTab(dlg: HTMLDialogElement, stops: HTMLElement[]): () => void {
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Tab" || e.isComposing) return;
    e.preventDefault();
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const next =
      i < 0
        ? (e.shiftKey ? stops[stops.length - 1] : stops[0])
        : stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length];
    next?.focus({ focusVisible: true } as FocusOptions);
  };
  dlg.addEventListener("keydown", onKeydown);
  return () => dlg.removeEventListener("keydown", onKeydown);
}

export function confirmDiscard(kind: Guard, restoreFocusTo: HTMLElement): Promise<boolean> {
  return ask(
    {
      title: kind === "new" ? S.dlgNewTitle : S.dlgOpenTitle,
      body: kind === "new" ? S.dlgNewBody : S.dlgOpenBody,
      keep: S.dlgKeep,
      go: kind === "new" ? S.dlgNewGo : S.dlgOpenGo,
    },
    restoreFocusTo,
  );
}

export function ask(
  labels: { title: string; body: string; keep: string; go: string },
  restoreFocusTo: HTMLElement,
): Promise<boolean> {
  const dlg = document.getElementById("dlg") as HTMLDialogElement;
  const title = document.getElementById("dlgTitle")!;
  const body = document.getElementById("dlgBody")!;
  const keep = document.getElementById("dlgKeep") as HTMLButtonElement;
  const go = document.getElementById("dlgGo") as HTMLButtonElement;
  title.textContent = labels.title;
  body.textContent = labels.body;
  keep.textContent = labels.keep;
  go.textContent = labels.go;

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
