import { expect, test } from "@playwright/test";
import { CORPUS, contrast, luminance, open, setText } from "./helpers.js";

const surface = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const read = (id: string) => getComputedStyle(document.getElementById(id)!);
    const probe = document.body.appendChild(document.createElement("span"));
    probe.style.color = "var(--focus)";
    const focus = getComputedStyle(probe).color;
    probe.remove();
    return {
      paper: read("sheet").backgroundColor,
      ink: read("ta").color,
      bar: read("bar").backgroundColor,
      focus,
    };
  });

test("the operating system's dark mode darkens the page but never the print", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await open(page);
  await setText(page, CORPUS);
  const light = await surface(page);
  expect(luminance(light.paper), "light: the paper is the bright surface").toBeGreaterThan(
    luminance(light.ink),
  );

  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await surface(page);
  expect(dark.paper, "dark: the paper is repainted").not.toBe(light.paper);
  expect(dark.bar, "dark: the toolbar is repainted").not.toBe(light.bar);
  expect(luminance(dark.paper), "dark: the paper is the dim surface").toBeLessThan(
    luminance(dark.ink),
  );
  expect(luminance(dark.paper), "dark: a grey sheet, not a black one").toBeGreaterThan(0);
  expect(contrast(dark.ink, dark.paper), "dark: the writing still reads").toBeGreaterThanOrEqual(
    4.5,
  );
  expect(contrast(dark.focus, dark.paper), "dark: the focus ring stays visible").toBeGreaterThan(3);
  expect(contrast(dark.focus, dark.bar), "dark: on the toolbar too").toBeGreaterThan(3);

  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  const printed = await page.evaluate(() => {
    const pre = document.querySelector("#printdoc .page pre")!;
    const cs = getComputedStyle(pre);
    return {
      body: getComputedStyle(document.body).backgroundColor,
      ink: cs.color,
      paper: cs.backgroundColor,
    };
  });
  expect(printed.body, "print: white paper whatever the screen does").toBe("rgb(255, 255, 255)");
  expect(printed.paper).toBe("rgb(255, 255, 255)");
  expect(printed.ink, "print: black ink, no toner burned on a dark theme").toBe("rgb(0, 0, 0)");
});
