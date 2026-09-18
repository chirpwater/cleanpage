/**
 * What this run could and could not cover.
 *
 * DESIGN §12 pins the Playwright version deliberately, because every spike in
 * this project hit browser-build drift. This environment ships a fixed browser
 * cache and forbids downloads, so a project whose build is absent is skipped —
 * and a skip that says nothing is indistinguishable from a pass. This test
 * prints the reason, once, in the run log.
 */
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
