import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CORPUS,
  LINES_PER_PAGE,
  NO_POPPLER,
  OUT,
  engineUnavailable,
  havePoppler,
  numberedLines,
  open,
  screenPages,
  setText,
  words,
} from "./helpers.js";

export const FF_PDF = join(OUT, "firefox-print.pdf");

const reason = engineUnavailable("firefox");
test.skip(!!reason, reason ?? "");
test.skip(!havePoppler(), NO_POPPLER);

async function printToFile(page: import("@playwright/test").Page): Promise<string> {
  rmSync(FF_PDF, { force: true });
  await page.evaluate(() => {
    window.print();
  });
  let size = -1;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(200);
    if (!existsSync(FF_PDF)) continue;
    const now = statSync(FF_PDF).size;
    if (now > 0 && now === size) return FF_PDF;
    size = now;
  }
  throw new Error("Firefox never finished writing " + FF_PDF);
}

const sheets = (path: string): number =>
  Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path], { encoding: "utf8" }))?.[1]);

const sheetWords = (path: string, p: number): string[] =>
  words(
    execFileSync("pdftotext", ["-f", String(p), "-l", String(p), path, "-"], { encoding: "utf8" }),
  );

test("Firefox prints one sheet per screen page, 30 lines to a sheet", async ({ page }) => {
  await open(page);
  const N = 60;
  await setText(page, numberedLines(N));
  const screen = await screenPages(page);
  expect(screen).toHaveLength(2);

  const path = await printToFile(page);
  expect(sheets(path), "2 screen pages, 2 sheets — not 29 + 1 + 29 + 1").toBe(screen.length);

  const seen: string[] = [];
  for (let p = 1; p <= screen.length; p++) {
    const got = sheetWords(path, p).filter((w) => /^L\d{3}$/.test(w));
    expect(got, `sheet ${p} is a whole page`).toHaveLength(LINES_PER_PAGE);
    seen.push(...got);
  }
  expect(seen).toEqual(Array.from({ length: N }, (_, i) => "L" + String(i + 1).padStart(3, "0")));

  // And the ink is where it was: 0.5 in from the left edge and from the top.
  const xml = execFileSync("pdftotext", ["-bbox", "-f", "1", "-l", "1", path, "-"], {
    encoding: "utf8",
  });
  const m = /<word xMin="([\d.-]+)" yMin="([\d.-]+)"[^>]*>([^<]*)<\/word>/.exec(xml)!;
  expect(m[3]).toBe("L001");
  expect(Number(m[1]), "36 pt = 0.5 in from the paper's edge").toBeCloseTo(36, 1);
  expect(Number(m[2])).toBeGreaterThan(36);
  expect(Number(m[2])).toBeLessThan(48);
  expect(execFileSync("pdfinfo", [path], { encoding: "utf8" })).toMatch(
    /Page size:\s+612 x 792 pts \(letter\)/,
  );
});

test("Firefox prints the hostile corpus on exactly the sheets the screen shows", async ({
  page,
}) => {
  await open(page);
  await setText(page, CORPUS);
  const screen = await screenPages(page);
  expect(screen.length).toBeGreaterThanOrEqual(4);

  const path = await printToFile(page);
  expect(sheets(path), "no orphan sheets").toBe(screen.length);
  for (let p = 1; p <= screen.length; p++) {
    expect(sheetWords(path, p).length, `sheet ${p} carries words`).toBeGreaterThan(0);
  }
});
