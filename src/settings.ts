import { version } from "../package.json";
import { S } from "./strings.js";
import { initRecovery, type RecoveryOptions } from "./recovery.js";
export type { RecoveryItem, RecoveryOptions } from "./recovery.js";

export type Settings = {
  font: "serif" | "dys";
  mode: "reg" | "hc";
  size: "small" | "medium" | "large";
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  font: "serif",
  mode: "reg",
  size: "medium",
});

export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.font = settings.font;
  root.dataset.mode = settings.mode;
  root.dataset.size = settings.size;
}

export function initSettings(
  initial: Settings,
  onApply: (settings: Settings) => void,
  onClose?: () => void,
  recoveryOptions?: RecoveryOptions,
): { open: () => void; isOpen: () => boolean; refreshRecovery: () => void } {
  const dialog = document.getElementById("settingsDlg") as HTMLDialogElement;
  const form = document.getElementById("settingsForm") as HTMLFormElement;
  document.getElementById("appVersion")!.textContent = S.version(version);
  let committed = { ...initial };
  const recovery = initRecovery(form, recoveryOptions, () => dialog.close());

  function updatePreviews(): void {
    const font = new FormData(form).get("font") === "dys" ? "dys" : "serif";
    for (const sample of form.querySelectorAll<HTMLElement>(".size-preview")) {
      sample.dataset.previewFont = font;
    }
  }

  function setDraft(settings: Settings): void {
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      input.checked = settings[input.name as keyof Settings] === input.value;
    }
    updatePreviews();
  }

  form.addEventListener("change", updatePreviews);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (recovery.isBusy()) return;
    const values = new FormData(form);
    committed = {
      font: values.get("font") === "dys" ? "dys" : "serif",
      mode: values.get("mode") === "hc" ? "hc" : "reg",
      size: values.get("size") === "small" ? "small" : values.get("size") === "large" ? "large" : "medium",
    };
    onApply({ ...committed });
    dialog.close();
  });
  document.getElementById("settingsCancel")!.addEventListener("click", () => {
    if (!recovery.isBusy()) dialog.close();
  });
  document.getElementById("settingsReset")!.addEventListener("click", () => {
    if (!recovery.isBusy()) setDraft(DEFAULT_SETTINGS);
  });
  dialog.addEventListener("cancel", (event) => {
    if (recovery.isBusy()) event.preventDefault();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.isComposing) return;
    if (recovery.isBusy()) {
      event.preventDefault();
      return;
    }
    const stops = Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type="radio"]:checked, button'))
      .filter((control) => !control.disabled && control.getClientRects().length > 0);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  dialog.addEventListener("close", () => onClose?.());

  return {
    open: () => {
      if (dialog.open) return;
      setDraft(committed);
      recovery.reset();
      dialog.showModal();
    },
    isOpen: () => dialog.open,
    refreshRecovery: recovery.refresh,
  };
}
