/**
 * Shared measurement helpers for the e2e suite.
 *
 * The caret probe and the pixel comparison are lifted from the design spikes
 * (`scratchpad/design-native-first/cross.mjs`,
 * `scratchpad/design-kid-and-a11y-first/run-wrap.mjs`) rather than re-derived.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "..", "..");

export const CORPUS = readFileSync(join(REPO, "tests", "fixtures", "corpus.txt"), "utf8");

/** Where PDFs, PNGs and other evidence land. Never inside the repo tree. */
export const OUT =
  process.env["CP_ARTIFACTS"] ??
  "/tmp/claude-1000/-mnt-fast-git-cleanpage/0d261fa4-f1cc-411e-ae2f-dd8c17c61c21/scratchpad/qa";

export const LINE_H = 32;
export const LINES_PER_PAGE = 30;
export const PAGE_BODY_H = 960;
export const MARGIN = 48;
export const CONTENT_W = 720;

/**
 * Why a browser project cannot run here, or null if it can.
 *
 * This environment ships a fixed browser cache and forbids downloads, so a
 * Playwright version whose pinned revision is not in that cache must be
 * reported as skipped with the revision numbers, not left to fail at launch.
 */
export function engineUnavailable(name: string): string | null {
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? join(homedir(), ".cache", "ms-playwright");
  const meta = JSON.parse(
    readFileSync(join(REPO, "node_modules", "playwright-core", "browsers.json"), "utf8"),
  ) as { browsers: { name: string; revision: string; browserVersion?: string }[] };
  const pw = JSON.parse(
    readFileSync(join(REPO, "node_modules", "playwright-core", "package.json"), "utf8"),
  ) as { version: string };
  const entry = meta.browsers.find((b) => b.name === name);
  if (!entry) return `playwright-core ${pw.version} knows no browser called "${name}"`;
  if (existsSync(join(root, `${name}-${entry.revision}`))) return null;
  return (
    `Playwright ${pw.version} requires ${name} build ${entry.revision} ` +
    `(${entry.browserVersion ?? "?"}), which is not in ${root}; ` +
    `run \`npx playwright install ${name}\` (in a sandbox that forbids ` +
    `browser downloads, this project reports it as a skip)`
  );
}

let popplerProbe: boolean | null = null;

/**
 * Is poppler-utils on PATH? The PDF assertions shell out to `pdfinfo`,
 * `pdftotext` and `pdftoppm`; DECISIONS 7.9 and 7.4 require them to SKIP when
 * poppler is absent rather than fail, so CI needs no system packages. Probed
 * once per worker.
 */
export function havePoppler(): boolean {
  if (popplerProbe === null) {
    try {
      execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
      popplerProbe = true;
    } catch {
      popplerProbe = false;
    }
  }
  return popplerProbe;
}

/** The one reason string every poppler-gated test skips with. */
export const NO_POPPLER = "poppler-utils (pdfinfo/pdftotext/pdftoppm) is not installed";

/** Wait until the fonts are in and boot()'s first real layout has run. */
export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement | null;
    return document.fonts.status === "loaded" && !!ta && !ta.readOnly && ta.style.height !== "";
  });
}

/** Read the current tab's recovery record, never another tab's global draft. */
export async function storedDraft(page: Page): Promise<{
  id: string; text: string; lastSavedText: string; fileName: string | null; updatedAt: number;
} | null> {
  return page.evaluate(() => {
    const id = sessionStorage.getItem("cleanpage:document:v2");
    const raw = id && localStorage.getItem("cleanpage:draft:v2:" + id);
    return raw ? JSON.parse(raw) : null;
  });
}

/**
 * Open the historical print reference: small type is 16px with 32px line boxes.
 * The application default is medium. Tests of defaults/persistence should use
 * page.goto() + ready() instead of this explicit geometry baseline.
 */
export async function open(page: Page): Promise<void> {
  await page.goto("./");
  await ready(page);
  await chooseSize(page, "small");
}

/**
 * Put a whole document in the field without 9000 synthetic key events.
 *
 * `setRangeText` + a synthetic `input` is exactly the path the application's
 * own Tab fallback uses, so it exercises the real listener chain.
 */
export async function setText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    ta.focus();
    ta.setRangeText(t, 0, ta.value.length, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await settle(page);
}

/** layout() runs in a rAF; the print doc and the page announcement on a 300 ms idle timer. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

export async function chooseFont(page: Page, font: "serif" | "dys"): Promise<void> {
  await page.locator("#btnSettings").click();
  await page.locator(`input[name="font"][value="${font}"]`).check();
  await page.locator("#settingsApply").click();
  await settle(page);
}

export async function chooseMode(page: Page, mode: "reg" | "hc"): Promise<void> {
  await page.locator("#btnSettings").click();
  await page.locator(`input[name="mode"][value="${mode}"]`).check();
  await page.locator("#settingsApply").click();
  await settle(page);
}

export async function chooseSize(page: Page, size: "small" | "medium" | "large"): Promise<void> {
  await page.locator("#btnSettings").click();
  await page.locator(`input[name="size"][value="${size}"]`).check();
  await page.locator("#settingsApply").click();
  await settle(page);
}

export interface Geometry {
  pages: number;
  taHeight: number;
  taWidth: string;
  sheetHeight: number;
  sheetWidth: number;
  ruleTops: number[];
  scrollWidth: number;
  clientWidth: number;
  printPages: number;
}

export async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    const sheet = document.getElementById("sheet")!;
    const rules = Array.from(document.querySelectorAll<HTMLElement>("#breaks .rule"));
    const h = ta.getBoundingClientRect().height;
    return {
      pages: Math.round(h / 960),
      taHeight: h,
      taWidth: getComputedStyle(ta).width,
      sheetHeight: sheet.getBoundingClientRect().height,
      sheetWidth: sheet.getBoundingClientRect().width,
      ruleTops: rules.map((r) => parseFloat(r.style.top)),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      printPages: document.querySelectorAll("#printdoc .page").length,
    };
  });
}

/** The text of each constructed print sheet, i.e. the paginator's own page slices. */
export async function screenPages(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#printdoc .page pre")).map((p) => p.textContent ?? ""),
  );
}

export const words = (s: string): string[] => s.split(/\s+/u).filter(Boolean);
export const firstWord = (s: string): string => words(s)[0] ?? "";
export const lastWord = (s: string): string => {
  const w = words(s);
  return w.length ? w[w.length - 1]! : "";
};

/** A stream of uniquely numbered ASCII tokens: wraps naturally, extracts cleanly. */
export const numberedWords = (n: number): string =>
  Array.from({ length: n }, (_, i) => "w" + String(i + 1).padStart(4, "0")).join(" ");

/** One numbered hard line per visual line: `L001` ... `Lnnn`. */
export const numberedLines = (n: number): string =>
  Array.from({ length: n }, (_, i) => "L" + String(i + 1).padStart(3, "0")).join("\n");
