import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { OUT } from "./tests/e2e/helpers.js";

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
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      testIgnore: /(headers|print-firefox)\.spec\.ts/,
    },
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
      command: "node tests/server/headers-server.mjs",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
  ],
});
