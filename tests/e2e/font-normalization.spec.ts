import { expect, test } from "@playwright/test";
import { engineUnavailable, ready } from "./helpers.js";

test.skip(({ browserName }) => engineUnavailable(browserName) !== null, "browser build not cached");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

test("Round letters match Book letters' optical size without oversized gaps", async ({ page }) => {
  const measurements = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('100px "Liberation Serif"'),
      document.fonts.load('100px "OpenDyslexic"'),
    ]);
    const ctx = document.createElement("canvas").getContext("2d")!;
    const probe = document.createElement("span");
    probe.className = "font-preview";
    probe.style.cssText = "position:absolute;display:inline-block;min-width:0;white-space:pre;font-size:20px;font-weight:400";
    document.body.append(probe);
    const result = (["serif", "dys"] as const).map((font) => {
      probe.dataset["previewFont"] = font;
      const style = getComputedStyle(probe);
      const widths = [" ", "abcdefghijklmnopqrstuvwxyz", "The quick brown fox jumps over the lazy dog."].map((text) => {
        probe.textContent = text;
        return probe.getBoundingClientRect().width;
      });
      // At 100px raster hinting has less influence than at the writing sizes.
      ctx.font = `100px ${style.fontFamily}`;
      return {
        widths,
        xHeight: ctx.measureText("x").actualBoundingBoxAscent,
        capHeight: ctx.measureText("H").actualBoundingBoxAscent,
        transform: style.transform,
      };
    });
    probe.remove();
    return result;
  });
  const [book, round] = measurements;
  expect(round!.xHeight / book!.xHeight).toBeGreaterThan(0.94);
  expect(round!.xHeight / book!.xHeight).toBeLessThan(1.06);
  expect(round!.capHeight / book!.capHeight).toBeGreaterThan(0.94);
  expect(round!.capHeight / book!.capHeight).toBeLessThan(1.06);
  // Preserve the round face's character, rather than squeezing it to exact
  // book widths. Its former space and phrase advances were 3.39x / 1.91x.
  expect(round!.widths[0]! / book!.widths[0]!).toBeGreaterThan(0.95);
  expect(round!.widths[0]! / book!.widths[0]!).toBeLessThan(1.2);
  expect(round!.widths[1]! / book!.widths[1]!).toBeGreaterThan(1.1);
  expect(round!.widths[1]! / book!.widths[1]!).toBeLessThan(1.3);
  expect(round!.widths[2]! / book!.widths[2]!).toBeGreaterThan(1.1);
  expect(round!.widths[2]! / book!.widths[2]!).toBeLessThan(1.3);
  expect(round!.transform).toBe("none");
});

test("all Round letter sizes keep editor, mirror, print, and previews in agreement", async ({ page }) => {
  const text = "A little story: café, naïve, jalapeño, École, Ångström.\nCombining marks: a\u0301 e\u0308 i\u0301 o\u0308 u\u0301.\n";
  await page.locator("#ta").fill(text);
  for (const [size, fontSize, lineHeight] of [
    ["small", "16px", "32px"],
    ["medium", "20px", "40px"],
    ["large", "24px", "48px"],
  ] as const) {
    await page.locator("#btnSettings").click();
    await page.locator('input[name="font"][value="dys"]').check();
    await page.locator(`input[name="size"][value="${size}"]`).check();
    const preview = page.locator(`.size-preview[data-preview-size="${size}"]`);
    await expect(preview).toHaveAttribute("data-preview-font", "dys");
    const previewStyle = await preview.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.fontFamily, style.fontSize, style.letterSpacing, style.wordSpacing];
    });
    await page.locator("#settingsApply").click();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));

    for (const selector of ["#ta", "#mirror", "#printdoc .page pre"]) {
      const el = page.locator(selector).first();
      await expect(el).toHaveCSS("font-size", fontSize);
      await expect(el).toHaveCSS("line-height", lineHeight);
      const style = await el.evaluate((node) => {
        const css = getComputedStyle(node);
        return [css.fontFamily, css.fontSize, css.letterSpacing, css.wordSpacing];
      });
      expect(style).toEqual(previewStyle);
    }
    await expect(page.locator("#ta")).toHaveValue(text);
    expect((await page.locator("#printdoc .page pre").allTextContents()).join("")).toContain("a\u0301 e\u0308 i\u0301 o\u0308 u\u0301");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  }
});
