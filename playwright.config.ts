import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { OUT } from "./tests/e2e/helpers.js";

/**
 * The version is pinned in package.json (DECISIONS 7.8): every spike in this
 * project hit Playwright/browser-build drift.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4173/",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  },
  // Playwright's own bundled chromium, not the system channel: the cached
  // build is the one this environment has.
  //
  // Chromium runs the whole suite and is required. Firefox and WebKit run only
  // wrap, typography, navigation, history and draft-session specs when their pinned build is in the
  // browser cache — this environment forbids downloads, so a missing build is
  // reported as a skip with its revision numbers (see `engineUnavailable`).
  // The broader suite remains Chromium-first; PDF specs need `page.pdf`, which
  // Playwright cannot emit from Gecko or WebKit.
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      // Two specs belong to other projects: the header spec needs a server
      // that applies `public/_headers` (which `vite preview` does not), and
      // the Gecko print spec needs a Firefox launched to print to a file.
      testIgnore: /(headers|print-firefox)\.spec\.ts/,
    },
    // The one configuration that actually ships. `baseURL` is per-project, so
    // this cannot be folded into the chromium project above.
    {
      name: "headers",
      use: { browserName: "chromium", baseURL: "http://127.0.0.1:4174/" },
      testMatch: /headers\.spec\.ts/,
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
      testMatch: /(wrap-equivalence|history|draft-sessions)\.spec\.ts/,
    },
    // Gecko's REAL printed output, which nothing had ever measured: Playwright
    // has no `page.pdf()` for Firefox, but Firefox will print silently to a
    // file if it is told to at launch. The filename is a launch preference, so
    // it is fixed here and the spec deletes it before each print.
    {
      name: "firefox-print",
      testMatch: /print-firefox\.spec\.ts/,
      use: {
        browserName: "firefox",
        launchOptions: {
          firefoxUserPrefs: {
            "print.always_print_silent": true,
            print_printer: "Mozilla Save to PDF",
            "print.printer_Mozilla_Save_to_PDF.print_to_file": true,
            "print.printer_Mozilla_Save_to_PDF.print_to_filename": join(OUT, "firefox-print.pdf"),
            // Gecko reads ID, unit, width and height as one group. Supplying
            // only the ID leaves the locale's default paper in effect (A4 on
            // this host), which scales Letter output down to 596 / 612.
            "print.printer_Mozilla_Save_to_PDF.print_paper_id": "na_letter",
            "print.printer_Mozilla_Save_to_PDF.print_paper_size_unit": 0,
            "print.printer_Mozilla_Save_to_PDF.print_paper_width": "8.5",
            "print.printer_Mozilla_Save_to_PDF.print_paper_height": "11",
          },
        },
      },
    },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testMatch: /(wrap-equivalence|history|draft-sessions)\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npm run build && npm run preview",
      url: "http://127.0.0.1:4173/",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
    {
      // Serves the same `dist/` WITH `dist/_headers` applied, the way
      // Cloudflare Pages does. Started after the build above has run.
      command: "node tests/server/headers-server.mjs",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
  ],
});
