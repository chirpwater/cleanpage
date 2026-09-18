import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LINES_PER_PAGE,
  NO_POPPLER,
  OUT,
  havePoppler,
  numberedLines,
  open,
  screenPages,
  setText,
  words,
} from "./helpers.js";

test.skip(!havePoppler(), NO_POPPLER);

test("exactly 31 lines print as 30 + 1, with line 30 on page 1", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await open(page);
  await setText(page, numberedLines(31));

  const slices = await screenPages(page);
  expect(slices, "31 visual lines are two screen pages").toHaveLength(2);
  expect(words(slices[0]!)).toHaveLength(LINES_PER_PAGE);
  expect(words(slices[1]!)).toEqual(["L031"]);

  await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
  const path = join(OUT, "thirty-one-lines.pdf");
  writeFileSync(
    path,
    await page.pdf({
      format: "Letter",
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      preferCSSPageSize: true,
    }),
  );

  const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  expect(Number(/Pages:\s+(\d+)/.exec(info)?.[1]), "two sheets, not three").toBe(2);

  const pageText = (p: number): string[] =>
    words(execFileSync("pdftotext", ["-f", String(p), "-l", String(p), path, "-"], { encoding: "utf8" }));

  const one = pageText(1);
  expect(one, "page 1 is L001..L030 — the widow rule must not push L030 over").toEqual(
    Array.from({ length: 30 }, (_, i) => "L" + String(i + 1).padStart(3, "0")),
  );
  expect(one).toContain("L030");
  expect(pageText(2)).toEqual(["L031"]);
});
