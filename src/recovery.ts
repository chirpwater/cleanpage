import { S } from "./strings.js";

export type RecoveryItem = { id: string; text: string; updatedAt: number };
export type RecoveryOptions = {
  list: () => RecoveryItem[];
  confirm: (restoreFocusTo: HTMLElement) => Promise<boolean>;
  recover: (id: string) => Promise<boolean>;
};

export function initRecovery(
  form: HTMLFormElement,
  options: RecoveryOptions | undefined,
  onRecovered: () => void,
): { refresh: () => void; reset: () => void; isBusy: () => boolean } {
  const section = document.getElementById("settingsRecovery")!;
  const list = document.getElementById("recoveryList")!;
  const empty = document.getElementById("recoveryEmpty")!;
  const message = document.getElementById("recoveryMessage")!;
  let busy = false;
  let rendered = "";

  function showMessage(text: string): void {
    message.textContent = text;
    message.hidden = !text;
  }

  function rowTitle(text: string): string {
    const first = text.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? "";
    if (!first) return S.recoveryUntitled;
    return first.length > 120 ? first.slice(0, 119) + "…" : first;
  }

  function focusRow(id: string): void {
    const button = Array.from(list.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.dataset.draftId === id);
    (button ?? message).focus({ preventScroll: true });
  }

  async function recover(id: string, source: HTMLElement): Promise<void> {
    if (busy || !options) return;
    busy = true;
    if (!(await options.confirm(source))) {
      busy = false;
      return;
    }
    const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button"));
    const disabled = controls.map((control) => control.disabled);
    for (const control of controls) control.disabled = true;
    section.setAttribute("aria-busy", "true");
    showMessage(S.recoveryOpening);
    message.focus({ preventScroll: true });
    let recovered = false;
    let failure = S.recoveryError as string;
    try {
      recovered = await options.recover(id);
    } catch (error) {
      recovered = false;
      if (error instanceof Error && error.message) failure = error.message;
    } finally {
      busy = false;
      for (const [index, control] of controls.entries()) control.disabled = disabled[index];
      section.removeAttribute("aria-busy");
    }
    if (recovered) {
      showMessage("");
      onRecovered();
    } else {
      refresh();
      showMessage(failure);
      focusRow(id);
    }
  }

  function refresh(): void {
    if (busy) return;
    let items: RecoveryItem[];
    try {
      items = options?.list() ?? [];
    } catch {
      items = [];
      showMessage(S.recoveryError);
    }
    const rows = items.map((item) => ({ ...item, title: rowTitle(item.text) }));
    const signature = JSON.stringify(rows.map(({ id, title, updatedAt }) => [id, title, updatedAt]));
    if (rendered === signature) return;
    rendered = signature;
    const focusedId = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement.dataset.draftId
      : undefined;
    list.replaceChildren();
    empty.hidden = rows.length > 0;
    for (const [index, item] of rows.entries()) {
      const row = document.createElement("li");
      row.className = "recovery-item";
      const description = document.createElement("div");
      const title = document.createElement("p");
      title.id = `recovery-title-${index}`;
      title.className = "recovery-title";
      title.textContent = item.title;
      const time = document.createElement("time");
      time.id = `recovery-time-${index}`;
      const date = new Date(item.updatedAt);
      if (Number.isFinite(date.getTime())) {
        time.dateTime = date.toISOString();
        time.textContent = S.recoveryEdited(date.toLocaleString(undefined, {
          dateStyle: "medium", timeStyle: "short",
        }));
      }
      description.append(title, time);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = S.recoverDraft;
      button.dataset.draftId = item.id;
      button.setAttribute("aria-describedby", `${title.id} ${time.id}`);
      button.addEventListener("click", () => { void recover(item.id, button); });
      row.append(description, button);
      list.append(row);
    }
    if (focusedId !== undefined) focusRow(focusedId);
  }

  return {
    refresh,
    reset: () => {
      showMessage("");
      refresh();
    },
    isBusy: () => busy,
  };
}
