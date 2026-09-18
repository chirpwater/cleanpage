import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import {
  CONTENT_W,
  CORPUS,
  LINE_H,
  OUT,
  chooseFont,
  engineUnavailable,
  open,
  setText,
} from "./helpers.js";

test.skip(({ browserName }) => engineUnavailable(browserName) !== null, "browser build not cached");

function crop(png: PNG, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
  return out;
}

for (const font of ["serif", "dys"] as const) {
  test(`wrap parity, ${font}: the textarea and the mirror contract render identical pixels`, async ({
    page,
  }, testInfo) => {
    await open(page);
    await chooseFont(page, font);
    await setText(page, CORPUS);

    expect(await page.evaluate(() => getComputedStyle(document.getElementById("ta")!).width)).toBe(
      CONTENT_W + "px",
    );

    // Two things would otherwise land inside an element screenshot of the field
    // and have nothing to do with wrapping:
    //   - the break overlay, drawn BEHIND the transparent textarea;
    //   - the sticky toolbar. Firefox composites an element screenshot through
    //     the viewport, so the bar prints across whichever band of a 4096 px
    //     tall field happens to be scrolled under it (measured: 3 of 128 lines).
    // `visibility: hidden` rather than `display: none`, so nothing reflows.
    await page.evaluate(() => {
      document.getElementById("breaks")!.style.display = "none";
      document.getElementById("bar")!.style.visibility = "hidden";
      (document.activeElement as HTMLElement | null)?.blur();
    });

    const taShot = await page.locator("#ta").screenshot({ caret: "hide" });

    // A <pre> with the same metrics contract, holding the same text, parked
    // below the document so it can never overlap the field it is compared to.
    await page.evaluate((text) => {
      const pre = document.createElement("pre");
      pre.id = "__probe";
      pre.className = "tp-text";
      // DESIGN §3: a <pre> lays out no line box for a trailing forced break.
      pre.textContent = text.endsWith("\n") ? text + " " : text;
      pre.style.position = "absolute";
      pre.style.left = "0px";
      pre.style.top = document.documentElement.scrollHeight + 200 + "px";
      pre.style.background = "var(--paper)";
      pre.style.color = "var(--ink)";
      document.body.appendChild(pre);
    }, CORPUS);

    const preShot = await page.locator("#__probe").screenshot({ caret: "hide" });
    await page.evaluate(() => {
      document.getElementById("__probe")!.remove();
      document.getElementById("breaks")!.style.display = "";
      document.getElementById("bar")!.style.visibility = "";
    });

    const A = PNG.sync.read(taShot);
    const B = PNG.sync.read(preShot);
    expect(A.width, "both text elements are one 720 px column").toBe(B.width);

    const h = Math.min(A.height, B.height);
    // The field is grown to whole pages, so it is always the taller of the two;
    // the <pre> must not be shorter than the text it holds.
    expect(B.height, "the mirror holds at least as many line boxes as the text").toBeGreaterThan(
      h - LINE_H,
    );

    const a = crop(A, A.width, h);
    const b = crop(B, B.width, h);
    const diff = new PNG({ width: A.width, height: h });
    const n = pixelmatch(a.data, b.data, diff.data, A.width, h, { threshold: 0.1 });

    if (n !== 0) {
      mkdirSync(OUT, { recursive: true });
      const tag = `${testInfo.project.name}-${font}`;
      writeFileSync(join(OUT, `wrap-ta-${tag}.png`), PNG.sync.write(a));
      writeFileSync(join(OUT, `wrap-pre-${tag}.png`), PNG.sync.write(b));
      writeFileSync(join(OUT, `wrap-diff-${tag}.png`), PNG.sync.write(diff));
    }
    expect(n, `differing pixels over ${A.width}x${h}`).toBe(0);
  });

  test(`wrap parity, ${font}: the paginator agrees with the field's own caret`, async ({
    page,
    browserName,
  }) => {
    await open(page);
    await chooseFont(page, font);
    await setText(page, CORPUS);

    const probe = await page.evaluate(() => {
      const ta = document.getElementById("ta") as HTMLTextAreaElement;
      const starts = (window as unknown as { __tpLineStarts: () => number[] }).__tpLineStarts();

      const keep = ta.style.height;
      ta.style.height = "0px";
      const taLines = Math.round(ta.scrollHeight / 32);
      const scrollHeight = ta.scrollHeight;
      ta.style.height = keep;

      const caret: (number | null)[] = [];
      for (let k = 0; k < starts.length; k++) {
        const docTop = ta.getBoundingClientRect().top + scrollY + k * 32;
        scrollTo(0, Math.max(0, Math.round(docTop - innerHeight / 2)));
        const r = ta.getBoundingClientRect();
        const y = r.top + k * 32 + 16;
        const x = r.left + 0.5;
        let idx: number | null = null;
        if (y >= 0 && y <= innerHeight - 1) {
          const cpfp = (
            document as Document & {
              caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
            }
          ).caretPositionFromPoint;
          if (cpfp) {
            const q = cpfp.call(document, x, y);
            if (q && q.offsetNode === ta) idx = q.offset;
          }
          if (idx === null && document.caretRangeFromPoint) {
            const q = document.caretRangeFromPoint(x, y);
            if (q && q.startContainer === ta) idx = q.startOffset;
          }
        }
        caret.push(idx);
      }
      scrollTo(0, 0);
      return { starts, caret, taLines, scrollHeight, value: ta.value };
    });

    expect(probe.starts.length, "the paginator and the field count the same lines").toBe(
      probe.taLines,
    );

    expect(probe.scrollHeight).toBeGreaterThanOrEqual(probe.starts.length * LINE_H);
    expect(probe.scrollHeight).toBeLessThanOrEqual(probe.starts.length * LINE_H + 6);

    const supported = probe.caret.every((c) => c !== null);
    expect(supported, "caretPositionFromPoint over a textarea is the instrument").toBe(true);

    const artefact = (i: number, want: number, got: number | null): string | null => {
      if (browserName === "firefox" && probe.value[want] === "\t" && got === want + 1) {
        return "firefox: leading tab";
      }
      if (got === want + 1 && /\p{M}/u.test(probe.value[want] ?? "")) {
        return "leading combining mark";
      }
      if (browserName !== "chromium" && i === probe.starts.length - 1 && want === probe.value.length) {
        return `${browserName}: empty final line`;
      }
      return null;
    };

    const bad: { line: number; caret: number | null; computed: number; head: string }[] = [];
    const allowed: string[] = [];
    for (let i = 0; i < probe.starts.length; i++) {
      const want = probe.starts[i]!;
      const got = probe.caret[i];
      if (got === want) continue;
      const why = artefact(i, want, got ?? null);
      if (why) {
        allowed.push(`line ${i}: ${why}`);
        continue;
      }
      bad.push({ line: i, caret: got, computed: want, head: JSON.stringify(probe.value.slice(want, want + 16)) });
    }
    if (allowed.length) test.info().annotations.push({ type: "probe artefact", description: allowed.join("; ") });
    expect(allowed.length, "no more than a handful of probe artefacts").toBeLessThanOrEqual(3);
    expect(bad, `line-start mismatches over ${probe.starts.length} lines`).toEqual([]);

    if (probe.value.endsWith("\n")) {
      const point = await page.evaluate((line) => {
        const ta = document.getElementById("ta") as HTMLTextAreaElement;
        ta.focus();
        ta.setSelectionRange(0, 0);
        const top = ta.getBoundingClientRect().top + scrollY + line * 32;
        scrollTo(0, Math.max(0, Math.round(top - innerHeight / 2)));
        const r = ta.getBoundingClientRect();
        return { x: r.left + 0.5, y: r.top + line * 32 + 16 };
      }, probe.starts.length - 1);
      await page.mouse.click(point.x, point.y);
      expect(
        await page.locator("#ta").evaluate((ta: HTMLTextAreaElement) => ta.selectionStart),
        "clicking the final blank line places the caret after the trailing newline",
      ).toBe(probe.value.length);
    }
  });
}
