import type { Settings } from "./settings.js";

export const SETTINGS_KEY = "cleanpage:settings:v1";

function read(key: string): unknown {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function write(key: string, value: Settings): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readSettings(): Settings | null {
  const settings = read(SETTINGS_KEY);
  if (!isRecord(settings) ||
      (settings.font !== "serif" && settings.font !== "dys") ||
      (settings.size !== "regular" && settings.size !== "small" && settings.size !== "medium" && settings.size !== "large") ||
      (settings.theme !== undefined && settings.theme !== "system" && settings.theme !== "light" && settings.theme !== "dark")) {
    return null;
  }
  return {
    font: settings.font,
    size: settings.size === "large" ? "large" : "regular",
    theme: settings.theme === "dark" ? "dark" : "light",
  };
}

export function writeSettings(settings: Settings): boolean {
  return write(SETTINGS_KEY, { font: settings.font, size: settings.size, theme: settings.theme });
}
