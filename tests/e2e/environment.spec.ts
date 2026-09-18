import { expect, test } from "@playwright/test";
import { engineUnavailable } from "./helpers.js";

test("the browser engines this run could actually use", () => {
  const lines: string[] = [];
  for (const name of ["chromium", "firefox", "webkit"] as const) {
    const why = engineUnavailable(name);
    lines.push(why === null ? `${name}: available` : `${name}: SKIPPED — ${why}`);
  }
  for (const l of lines) {
    console.log(l);
    test.info().annotations.push({ type: "engine", description: l });
  }
  // Chromium is not best-effort: it is the engine the whole print story was
  // measured in, and the only one Playwright can emit a PDF from.
  expect(engineUnavailable("chromium"), "chromium is required").toBeNull();
});
