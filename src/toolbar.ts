export function initToolbar(
  root: HTMLElement,
  editor: HTMLTextAreaElement,
  dialogOpen: () => boolean,
): { refresh: () => void; focus: (button?: HTMLButtonElement) => void } {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  const menu = root.querySelector<HTMLElement>("[popover]");
  const opener = root.querySelector<HTMLButtonElement>("[popovertarget]");
  let current = buttons[0];
  const shown = (button: HTMLButtonElement) => button.getClientRects().length > 0;
  const available = () => buttons.filter((button) => !button.disabled && shown(button));
  const refresh = () => {
    if (!current || !available().includes(current)) current = available()[0];
    for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
  };
  const focus = (button?: HTMLButtonElement) => {
    if (button && !button.disabled) {
      if (!shown(button)) menu?.showPopover();
      current = button;
    }
    refresh();
    current?.focus({ focusVisible: true } as FocusOptions);
  };
  root.addEventListener("focusin", (event) => {
    if (buttons.includes(event.target as HTMLButtonElement)) {
      current = event.target as HTMLButtonElement;
      refresh();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      editor.focus({ preventScroll: true });
      return;
    }
    const choices = available();
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = choices[(index + 1) % choices.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = choices[(index + choices.length - 1) % choices.length];
    else if (event.key === "Home") next = choices[0];
    else if (event.key === "End") next = choices[choices.length - 1];
    if (next) {
      event.preventDefault();
      focus(next);
    }
  });
  menu?.addEventListener("toggle", () => {
    if (menu.matches(":popover-open") && document.activeElement === opener) focus(available().find((button) => menu.contains(button)));
    else refresh();
  });
  menu?.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button, a")) menu.hidePopover();
  });
  editor.addEventListener("focus", () => menu?.hidePopover());
  addEventListener("resize", () => {
    if (menu?.matches(":popover-open") && !(opener && shown(opener))) menu.hidePopover();
    refresh();
  });
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  addEventListener("keydown", (event) => {
    if (event.isComposing || event.defaultPrevented || dialogOpen()) return;
    const key = event.key.toLowerCase();
    if (event.altKey && event.shiftKey && (apple ? event.metaKey : event.ctrlKey) && key === "m") {
      event.preventDefault();
      focus();
      return;
    }
    const menuModifiers = event.altKey && !event.metaKey && (apple ? event.ctrlKey : !event.ctrlKey);
    if (menuModifiers && ["f", "e", "t"].includes(key)) {
      event.preventDefault();
      const id = key === "f" ? "btnNew" : key === "e" ? "btnUndo" : "btnSettings";
      const target = buttons.find((button) => button.id === id);
      if (key === "t") target?.click();
      else focus(target);
      return;
    }
    const landmarkModifiers = apple
      ? event.metaKey && event.altKey && !event.ctrlKey
      : event.altKey && ((event.shiftKey && !event.ctrlKey) || (event.ctrlKey && !event.shiftKey));
    if (landmarkModifiers && (event.code === "Period" || event.code === "Comma")) {
      event.preventDefault();
      if (root.contains(document.activeElement)) editor.focus({ preventScroll: true });
      else focus();
    }
  });
  refresh();
  return { refresh, focus };
}
