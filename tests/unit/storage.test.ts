import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY, readSettings, writeSettings } from "../../src/storage.js";

describe("settings storage", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists only font, size, and color choices", () => {
    const settings = { font: "sans", size: "large", theme: "dark", text: "Private writing" } as const;
    expect(writeSettings(settings)).toBe(true);
    expect(readSettings()).toEqual({ font: "sans", size: "large", theme: "dark" });
    expect([...values.keys()]).toEqual([SETTINGS_KEY]);
    expect(JSON.parse(values.get(SETTINGS_KEY)!)).toEqual({ font: "sans", size: "large", theme: "dark" });
  });

  it("migrates earlier sizes and a missing theme to the new defaults", () => {
    values.set(SETTINGS_KEY, JSON.stringify({ font: "dys", size: "small" }));
    expect(readSettings()).toEqual({ font: "sans", size: "regular", theme: "light" });
    values.set(SETTINGS_KEY, JSON.stringify({ font: "serif", size: "medium", theme: "system" }));
    expect(readSettings()).toEqual({ font: "serif", size: "regular", theme: "light" });
  });

  it.each(["{", "null", "[]", "{}",
    '{"font":"serif"}',
    '{"font":"comic","size":"medium"}',
    '{"font":"serif","size":20}',
    '{"font":"serif","size":"medium","theme":"sepia"}',
  ])("ignores malformed or unknown settings: %s", (value) => {
    values.set(SETTINGS_KEY, value);
    expect(readSettings()).toBeNull();
  });

  it("handles storage access denied without breaking reads or writes", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("Blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("Blocked", "SecurityError"); },
    });
    expect(readSettings()).toBeNull();
    expect(writeSettings({ font: "serif", size: "regular", theme: "light" })).toBe(false);
  });

  it("reports quota failure without replacing saved settings", () => {
    const settings = { font: "sans", size: "large", theme: "dark" } as const;
    writeSettings(settings);
    localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(writeSettings({ font: "serif", size: "regular", theme: "light" })).toBe(false);
    expect(readSettings()).toEqual(settings);
  });

  it("survives missing storage or absent settings", () => {
    expect(readSettings()).toBeNull();
    vi.stubGlobal("localStorage", undefined);
    expect(readSettings()).toBeNull();
    expect(writeSettings({ font: "serif", size: "regular", theme: "light" })).toBe(false);
  });
});
