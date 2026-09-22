export type Settings = {
  font: "serif" | "sans";
  size: "regular" | "large";
  theme: "light" | "dark";
  spell: "off" | "on";
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  font: "serif",
  size: "regular",
  theme: "light",
  spell: "on",
});

export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.font = settings.font;
  root.dataset.size = settings.size;
  root.dataset.theme = settings.theme;
  (document.getElementById("ta") as HTMLTextAreaElement).spellcheck = settings.spell === "on";
}

export function initSettings(
  initial: Settings,
  onApply: (settings: Settings) => void,
  onClose?: () => void,
): { open: () => void } {
  const dialog = document.getElementById("settingsDlg") as HTMLDialogElement;
  const form = document.getElementById("settingsForm") as HTMLFormElement;
  const resetButton = document.getElementById("settingsReset") as HTMLButtonElement;
  document.getElementById("appVersion")!.textContent = import.meta.env.CP_VERSION;
  let committed = { ...initial };

  function updatePreviews(): void {
    const font = new FormData(form).get("font") === "sans" ? "sans" : "serif";
    for (const sample of form.querySelectorAll<HTMLElement>(".size-preview")) {
      sample.dataset.previewFont = font;
    }
  }

  function setChoices(settings: Settings): void {
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      input.checked = settings[input.name as keyof Settings] === input.value;
    }
    updatePreviews();
  }

  form.addEventListener("change", updatePreviews);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    committed = {
      font: values.get("font") === "sans" ? "sans" : "serif",
      size: values.get("size") === "large" ? "large" : "regular",
      theme: values.get("theme") === "dark" ? "dark" : "light",
      spell: values.get("spell") === "off" ? "off" : "on",
    };
    onApply({ ...committed });
    dialog.close();
  });
  document.getElementById("settingsCancel")!.addEventListener("click", () => {
    dialog.close();
  });
  resetButton.addEventListener("click", () => setChoices(DEFAULT_SETTINGS));
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.isComposing) return;
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
      setChoices(committed);
      dialog.showModal();
    },
  };
}
