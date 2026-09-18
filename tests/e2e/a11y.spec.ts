/**
 * DESIGN §12.8 — accessibility.
 *
 * Settings use native radio controls in a modal; the writing toolbar stays
 * compact. Keyboard operation, names, target sizes and contrast remain covered.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { CORPUS, chooseFont, chooseMode, open, setText, settle } from "./helpers.js";

/** Exercise the safety dialog only when a recoverable draft cannot be stored. */
async function blockDraftStorage(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("cleanpage:draft:")) throw new DOMException("Full", "QuotaExceededError");
      write.call(this, key, value);
    };
  });
}

/** Toolbar arrow stops, followed by the writing area's separate Tab stop. */
const STOPS = [
  { id: "btnNew", name: "New" },
  { id: "btnOpen", name: "Open" },
  { id: "btnSave", name: "Download" },
  { id: "btnPrint", name: "Print" },
  { id: "btnUndo", name: "Undo" },
  { id: "btnRedo", name: "Redo" },
  { id: "btnSettings", name: "Settings" },
  { id: "ta", name: "Your writing" },
];

const focused = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    return {
      id: el.id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      text: (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/[✓ ]/g, "").trim(),
    };
  });

/** The conformance target DESIGN §15 commits to, in axe's tag vocabulary. */
const WCAG_21_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Best-practice findings that are not WCAG failures and that this design makes
 * deliberately. Listed, not silenced: a NEW best-practice finding fails the
 * test, so nobody can add one without saying so here.
 *
 *   page-has-heading-one — the page is one writing surface and a small toolbar.
 *     It has no headings at all, by design (DESIGN §10); the document's name is
 *     in the browser tab. Adding a hidden <h1> to satisfy a linter would put a
 *     string in front of a screen-reader user that no other user has.
 */
const KNOWN_BEST_PRACTICE = ["page-has-heading-one"];

const report = (r: { violations: { id: string; nodes: unknown[] }[] }): string[] =>
  r.violations.map((v) => `${v.id} (${v.nodes.length})`);

for (const mode of ["reg", "hc"] as const) {
  const label = mode === "reg" ? "Black on white" : "White on black";

  test(`axe is clean in ${label}, with the dialog closed and open`, async ({ page }) => {
    await blockDraftStorage(page);
    await open(page);
    if (mode === "hc") {
      await chooseMode(page, "hc");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "hc");
    }
    await setText(page, "Some writing by a nine year old.\nIt has two lines.\n");

    const build = () => new AxeBuilder({ page });

    expect(report(await build().withTags(WCAG_21_AA).analyze()), `${label}, dialog closed`).toEqual(
      [],
    );
    expect(
      (await build().analyze()).violations.map((v) => v.id).sort(),
      `${label}: no NEW best-practice finding`,
    ).toEqual(KNOWN_BEST_PRACTICE);

    // The New dialog protects writing when local recovery is unavailable.
    await page.locator("#btnNew").click();
    await expect(page.locator("#dlg")).toBeVisible();
    expect(report(await build().withTags(WCAG_21_AA).analyze()), `${label}, dialog open`).toEqual(
      [],
    );
    expect(report(await build().analyze()), `${label}, dialog open, all rules`).toEqual([]);

    await page.locator("#dlgKeep").click();
    await expect(page.locator("#dlg")).toBeHidden();

    await page.locator("#btnSettings").click();
    await expect(page.locator("#settingsDlg")).toBeVisible();
    expect(report(await build().withTags(WCAG_21_AA).analyze()), `${label}, settings open`).toEqual([]);
    await page.locator("#settingsCancel").click();
  });
}

test("the toolbar's accessibility tree matches the golden snapshot", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await open(page);
  expect(await page.locator("#bar").ariaSnapshot()).toBe(
    `- banner:
  - toolbar "Writing tools":
    - group "File":
      - button "New"
      - button "Open"
      - button "Download"
      - button "Print"
    - group "Edit":
      - button "Undo" [disabled]
      - button "Redo" [disabled]
    - button "Settings"`,
  );
});

test("the toolbar is one Tab stop with arrow navigation and Escape returns to writing", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await open(page);
  await expect(page.locator("#ta")).toBeFocused();

  await page.keyboard.press("Alt+f");

  for (const stop of STOPS) {
    const f = await focused(page);
    expect(f, `stop for ${stop.name}`).not.toBeNull();
    expect(f!.text, `accessible name at this stop`).toBe(stop.name);
    if (stop.id) expect(f!.id).toBe(stop.id);
    if (stop.id === "btnSettings") await page.keyboard.press("Tab");
    else if (stop.id !== "ta") await page.keyboard.press("ArrowRight");
  }

  // The toolbar's single Tab stop returns to the writing surface.
  await expect(page.locator("#ta")).toBeFocused();

  // Shift+Tab out of the page lands on the last toolbar control used.
  await page.keyboard.press("Shift+Tab");
  expect((await focused(page))!.text).toBe("Settings");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeFocused();
  await expect(page.locator('#toolbar button[tabindex="0"]')).toHaveCount(1);
});

test("toolbar controls show visible keyboard focus without a coloured paper halo", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Alt+f");

  for (let i = 0; i < STOPS.length - 1; i++) {
    if (i > 0) await page.keyboard.press("ArrowRight");
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        who: el.id || el.textContent?.trim(),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
      };
    });
    expect(ring.outlineStyle, `${ring.who}: outline style`).not.toBe("none");
    expect(parseFloat(ring.outlineWidth), `${ring.who}: outline width`).toBeGreaterThanOrEqual(2);
  }
  const sheetEdge = () => page.locator("#sheet").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.outlineColor, width: cs.outlineWidth, shadow: cs.boxShadow };
  });
  const unfocused = await sheetEdge();
  await page.keyboard.press("Tab");
  await expect(page.locator("#ta")).toBeFocused();
  expect(await sheetEdge(), "the page edge does not change when the caret enters").toEqual(unfocused);
});

test("without recovery, the unsaved-changes dialog focuses the safe choice", async ({ page }) => {
  await blockDraftStorage(page);
  await open(page);
  await setText(page, "words a child would hate to lose");

  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await expect(page.locator("#dlgKeep")).toBeFocused();
  await expect(page.locator("#dlgKeep")).toHaveText("Keep writing");

  // Escape means Keep writing, and focus returns to the page.
  await page.keyboard.press("Escape");
  await expect(page.locator("#dlg")).toBeHidden();
  await expect(page.locator("#ta")).toBeFocused();
  expect(await page.inputValue("#ta")).toBe("words a child would hate to lose");
});

test("a multi-page document fits 1366x768 with no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page);
  await setText(page, CORPUS);
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    sheet: document.getElementById("sheet")!.getBoundingClientRect().width,
    bar: document.getElementById("bar")!.getBoundingClientRect().height,
  }));
  expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
  expect(m.sheet).toBe(816);
  // The bar must stay one row at 1366: a second row costs the student ~2 lines.
  expect(m.bar).toBeLessThan(90);
});

test("every control clears the 44x44 target size", async ({ page }) => {
  await open(page);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("#bar button"))
      .map((b) => ({ name: b.textContent?.trim() ?? "", ...b.getBoundingClientRect().toJSON() }))
      .filter((r) => r.width < 44 || r.height < 44)
      .map((r) => `${r.name}: ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
  await page.locator("#btnSettings").click();
  const smallSettings = await page.locator("#settingsDlg").evaluate((dialog) =>
    Array.from(dialog.querySelectorAll<HTMLElement>("button, label"))
      .map((control) => ({
        name: control.textContent?.trim(),
        width: control.getBoundingClientRect().width,
        height: control.getBoundingClientRect().height,
      }))
      .filter(({ width, height }) => width < 44 || height < 44),
  );
  expect(smallSettings, "radio labels are the full clickable target").toEqual([]);
});


/** WCAG 2.x relative luminance, from an `rgb(...)`/`rgba(...)` computed value. */
function ratio(a: string, b: string): number {
  const lum = (c: string): number => {
    const [r, g, bl] = (/rgba?\(([^)]+)\)/.exec(c)?.[1] ?? "0,0,0")
      .split(",")
      .slice(0, 3)
      .map((n) => {
        const v = parseFloat(n) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * SC 1.4.10 reflow. The bar is `position: sticky; top: 0` and wraps to two or
 * three rows as the viewport narrows; pinned at y = 0 and taller than the
 * scrollport, it hid 100 % of the writing surface at every scroll position —
 * measured 0 px visible at 320x256 (the SC's reference viewport, 1280x1024 at
 * 400 %) and at 341x192 (a 1366x768 Chromebook at 400 %).
 *
 * The two-dimensional-layout exception DESIGN §15 relies on covers the
 * HORIZONTAL scroll of the fixed 816 px sheet. It does not license the toolbar
 * covering the paper vertically at every scroll position.
 */
for (const vp of [
  { width: 320, height: 256, why: "1280x1024 at 400 % — the SC 1.4.10 reference viewport" },
  { width: 341, height: 192, why: "a 1366x768 Chromebook at 400 %" },
  { width: 455, height: 256, why: "a 1366x768 Chromebook at 300 %" },
]) {
  test(`the toolbar never hides the writing surface at ${vp.width}x${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page);
    await setText(page, Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));

    let best = 0;
    for (const y of [0, 100, 300, 800, 1500, 3000]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      best = Math.max(
        best,
        await page.evaluate(() => {
          const ta = document.getElementById("ta")!.getBoundingClientRect();
          const bar = document.getElementById("bar")!.getBoundingClientRect();
          const top = getComputedStyle(document.getElementById("bar")!).position === "sticky"
            ? Math.max(ta.top, bar.bottom)
            : ta.top;
          return Math.max(0, Math.min(ta.bottom, window.innerHeight) - top);
        }),
      );
    }
    expect(best, `${vp.why}: at least two line boxes of the child's writing`).toBeGreaterThanOrEqual(
      64,
    );
  });
}

/**
 * In High contrast `--paper` and `--desk` are both #000000, and the only other
 * separator was a black drop shadow on black: the page vanished entirely
 * whenever the field was not focused — after a click beside the paper, or
 * after tabbing to any toolbar button. On an empty document there was then
 * nothing on the screen at all.
 */
for (const mode of ["reg", "hc"] as const) {
  test(`the sheet has a visible edge in ${mode === "reg" ? "Black on white" : "White on black"}, focused or not`, async ({
    page,
  }) => {
    await open(page);
    if (mode === "hc") {
      await chooseMode(page, "hc");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "hc");
    }
    // Exactly the state a child reaches by clicking on the desk beside the page.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const m = await page.evaluate(() => {
      const sheet = document.getElementById("sheet")!;
      const cs = getComputedStyle(sheet);
      return {
        focusVisible: sheet.matches(":has(#ta:focus-visible)"),
        edge: cs.outlineColor,
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        paper: cs.backgroundColor,
        desk: getComputedStyle(document.getElementById("desk")!).backgroundColor,
      };
    });
    expect(m.focusVisible, "this is the unfocused state").toBe(false);
    expect(m.outlineStyle).not.toBe("none");
    expect(parseFloat(m.outlineWidth)).toBeGreaterThanOrEqual(1);
    // The rim has to read against the paper it encloses...
    expect(ratio(m.edge, m.paper), "the edge against the paper").toBeGreaterThanOrEqual(3);
    // ...and the page has to read against the desk by SOME channel. In Regular
    // that is the paper itself (5.94:1, the pairing DESIGN §9 lists); in High
    // contrast paper and desk are both #000000 and 1.00:1, so only the edge can
    // carry it, which is exactly the gap this token closes.
    expect(
      Math.max(ratio(m.edge, m.desk), ratio(m.paper, m.desk)),
      "the page against the desk",
    ).toBeGreaterThanOrEqual(3);
  });
}

/**
 * The saved chip carries the filename, and the filename is the child's own
 * first line: `suggestName` slices it to 40 characters, so the worst case is a
 * 44-character name. Unbounded, that chip took the bar from 65 px to 119 px at
 * 1366 — a second row, 54 px of paper lost, and the Colours control moving —
 * at the exact moment the child was watching for the save to land.
 */
test("saving a long filename does not push the toolbar onto a second row", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await open(page);
  const before = await page.locator("#bar").boundingBox();
  expect(before!.height).toBeLessThan(90);

  await setText(page, "The Crab That Lived In Our Tide Pool And Ate My Sandwich\nIt was orange.");
  await page.locator("#btnSave").click();
  await expect(page.locator("#downloadDlg")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadGo").click(),
  ]);
  expect(download.suggestedFilename().length, "the worst case suggestName can produce").toBe(44);
  await settle(page);

  const m = await page.evaluate(() => ({
    bar: document.getElementById("bar")!.getBoundingClientRect().height,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    // role="status" reads the DOM text, so the announcement stays complete;
    // only the visible tail is clipped.
    announced: document.getElementById("status")!.textContent ?? "",
  }));
  expect(m.bar, "still one row after the save").toBeLessThan(90);
  expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
  expect(m.announced).toContain(download.suggestedFilename());
});

/**
 * DESIGN §10 prescribes `btnKeep.focus({ focusVisible: true })`, but Chromium
 * ignores that option and programmatic focus after a mouse click does not set
 * `:focus-visible`. The dialog that decides whether a child's writing is
 * deleted therefore showed no indicator at all on the likeliest input path.
 */
for (const mode of ["reg", "hc"] as const) {
  test(`the dialog shows its focus ring when opened with the mouse (${mode})`, async ({ page }) => {
    await blockDraftStorage(page);
    await open(page);
    if (mode === "hc") await chooseMode(page, "hc");
    await setText(page, "words a child would hate to lose");

    await page.locator("#btnNew").click();
    await expect(page.locator("#dlgKeep")).toBeFocused();
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById("dlgKeep")!);
      return { style: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow };
    });
    expect(ring.style, "the safe choice is ringed on the pointer path too").not.toBe("none");
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(3);
    expect(ring.shadow).not.toBe("none");

    await page.keyboard.press("Escape");
    // The same holds for the one-sentence dialog.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }));
      document.getElementById("sheet")!.dispatchEvent(
        new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    });
    await expect(page.locator("#say")).toBeVisible();
    const ok = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById("sayOk")!);
      return { style: cs.outlineStyle, width: cs.outlineWidth };
    });
    expect(ok.style).not.toBe("none");
    expect(parseFloat(ok.width)).toBeGreaterThanOrEqual(3);
  });
}

/**
 * SC 3.2.2. `select()` focused the radio and then the onChange callback called
 * `ta.focus()`, which won: one ArrowRight moved the choice AND threw focus into
 * the textarea, so ArrowLeft was a dead key, the child could not arrow back to
 * compare the two typefaces, and a screen reader announced "Your writing"
 * instead of "Round letters, radio button, selected".
 */
for (const g of [
  { group: "Letters", from: "Book letters", to: "Round letters", attr: "data-font", a: "serif", b: "dys" },
  { group: "Colors", from: "Black on white", to: "White on black", attr: "data-mode", a: "reg", b: "hc" },
]) {
  test(`arrow keys in ${g.group} keep focus and wait for Apply`, async ({ page }) => {
    await open(page);
    const html = page.locator("html");
    await page.locator("#btnSettings").click();
    await page.getByRole("radio", { name: g.from }).focus();

    await page.keyboard.press("ArrowRight");
    await expect(html).toHaveAttribute(g.attr, g.a);
    await expect(page.getByRole("radio", { name: g.to })).toBeFocused();
    await expect(page.getByRole("radio", { name: g.to })).toBeChecked();

    // Arrowing back is the whole point of a radio group, and it was dead.
    await page.keyboard.press("ArrowLeft");
    await expect(html).toHaveAttribute(g.attr, g.a);
    await expect(page.getByRole("radio", { name: g.from })).toBeFocused();

    // Pointer choices also stay in the dialog until explicitly applied.
    await page.getByRole("radio", { name: g.to }).click();
    await expect(page.getByRole("radio", { name: g.to })).toBeFocused();
    await expect(html).toHaveAttribute(g.attr, g.a);
    await page.locator("#settingsApply").click();
    await expect(page.locator("#ta")).toBeFocused();
    await expect(html).toHaveAttribute(g.attr, g.b);
  });
}

/**
 * DESIGN §10: the count is announced "only when it changes and only after
 * typing has paused". On a fresh load nothing has changed and nobody has
 * typed, yet the live region was written ~350 ms after load, over a screen
 * reader still reading the page.
 */
test("the page-count live region says nothing on a fresh load", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => {
    (window as unknown as { __muts: string[] }).__muts = [];
    const el = document.getElementById("pagecount")!;
    new MutationObserver(() => {
      (window as unknown as { __muts: string[] }).__muts.push(el.textContent ?? "");
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { __muts: string[] }).__muts)).toEqual([]);
  expect(await page.locator("#pagecount").textContent()).toBe("");

  // But a real change still speaks.
  await setText(page, Array.from({ length: 34 }, (_, i) => `line ${i + 1}`).join("\n"));
  await settle(page);
  expect(await page.locator("#pagecount").innerText()).toBe("Now 2 pages.");
});

/**
 * Windows/system High Contrast, measured in PIXELS.
 *
 * `getComputedStyle` reports a passing pair here — white on Highlight — while
 * the paint is white on white: Chromium draws a forced-colors text backplate
 * in Canvas behind the label, and HighlightText ink disappears into it. So the
 * selected typeface, the selected colour mode and the dialog's "Keep writing"
 * button rendered as blank filled pills, and the only readable button in the
 * dialog that deletes a child's writing was "Start new page". Nothing short of
 * counting pixels can see this, which is why the whole suite missed it.
 */
test.describe("forced colours", () => {
  /** Pixels that are neither the commonest colour nor a near-neighbour of it. */
  function inkShare(png: PNG): { share: number; colours: number } {
    // The inner 60 % of the control: clear of the border, which is CanvasText
    // in forced colours and would otherwise read as "ink" on a blank button.
    const x0 = Math.floor(png.width * 0.2);
    const x1 = Math.ceil(png.width * 0.8);
    const y0 = Math.floor(png.height * 0.2);
    const y1 = Math.ceil(png.height * 0.8);
    const count = new Map<string, number>();
    let total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * png.width + x) * 4;
        count.set(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`, (count.get(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`) ?? 0) + 1);
        total++;
      }
    }
    const top = Math.max(...count.values());
    return { share: (total - top) / total, colours: count.size };
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`every control the child must read carries visible ink (${scheme})`, async ({ page }) => {
      await blockDraftStorage(page);
      await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
      await open(page);
      await setText(page, "words a child would hate to lose");

      const shot = async (selector: string) => {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        // Radio labels now fill a row; inspect the text itself so whitespace
        // neither dilutes the ink count nor lets the radio dot hide blank text.
        const clip = selector.includes("label") ? await control.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el.querySelector("span:not([aria-hidden])")!);
          const box = range.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }) : undefined;
        const buffer = clip ? await page.screenshot({ clip }) : await control.screenshot();
        return inkShare(PNG.sync.read(buffer));
      };

      await page.locator("#btnSettings").click();
      const unchecked = await shot('#settingsDlg label:has(input[value="dys"])');
      expect(unchecked.share, "baseline: an unchecked radio shows its label").toBeGreaterThan(0.02);

      for (const sel of [
        '#settingsDlg label:has(input[name="font"]:checked)',
        '#settingsDlg label:has(input[name="mode"]:checked)',
        '#settingsDlg label:has(input[name="size"]:checked)',
      ]) {
        const m = await shot(sel);
        expect(m.colours, `${sel}: more than a single flat fill`).toBeGreaterThan(1);
        expect(m.share, `${sel}: the selected control shows its label`).toBeGreaterThan(0.02);
      }
      await page.locator("#settingsCancel").click();

      await page.locator("#btnNew").click();
      await expect(page.locator("#dlg")).toBeVisible();
      const keep = await shot("#dlgKeep");
      expect(keep.share, "the safe choice is readable, not a blank pill").toBeGreaterThan(0.02);
      const go = await shot("#dlgGo");
      expect(go.share).toBeGreaterThan(0.02);
      await page.keyboard.press("Escape");

      // The one-sentence dialog uses the same class.
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(
          new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }),
        );
        document
          .getElementById("sheet")!
          .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await expect(page.locator("#say")).toBeVisible();
      expect((await shot("#sayOk")).share, "OK is readable").toBeGreaterThan(0.02);
    });
  }

  test("native radio selection remains exposed in forced colours", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await open(page);
    await page.locator("#btnSettings").click();
    for (const name of ["Book letters", "Black on white", "Small"]) {
      const radio = page.getByRole("radio", { name, exact: true });
      await expect(radio).toBeChecked();
      expect(await radio.evaluate((el) => getComputedStyle(el).appearance)).toBe("auto");
    }
  });
});

/**
 * After the unsaved-changes dialog, New and Open used to leave the viewport
 * thousands of pixels away from the caret: the dialog restores focus to the
 * page, so `loadDocument`'s own `ta.focus()` was a no-op and the browser never
 * revealed offset 0. Measured: Open from scrollY 3200 ended at 4651 with the
 * caret 4514 px above the window; New ended at the bottom of a blank sheet.
 */
for (const how of ["new", "open"] as const) {
  test(`${how} after the unsaved-changes dialog lands the child at the top of the page`, async ({
    page,
  }) => {
    await blockDraftStorage(page);
    await page.addInitScript(() => {
      const text = Array.from({ length: 160 }, (_, i) => `opened line ${i + 1}`).join("\n");
      (window as unknown as Record<string, unknown>)["showOpenFilePicker"] = async () => [
        {
          kind: "file",
          name: "other.txt",
          queryPermission: async () => "granted",
          requestPermission: async () => "granted",
          getFile: async () => new File([text], "other.txt", { type: "text/plain" }),
        },
      ];
    });
    await open(page);
    await setText(page, Array.from({ length: 150 }, (_, i) => `my line ${i + 1}`).join("\n"));
    await page.evaluate(() => window.scrollTo(0, 3200));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);

    await page.locator(how === "new" ? "#btnNew" : "#btnOpen").click();
    await expect(page.locator("#dlg")).toBeVisible();
    await page.locator("#dlgGo").click();
    await settle(page);

    const m = await page.evaluate(() => ({
      scrollY: window.scrollY,
      taTop: document.getElementById("ta")!.getBoundingClientRect().top,
      focused: document.activeElement?.id,
      innerHeight: window.innerHeight,
    }));
    expect(m.focused, "the caret is in the writing").toBe("ta");
    expect(m.scrollY, "the child is looking at the start of the new document").toBe(0);
    expect(m.taTop).toBeGreaterThanOrEqual(0);
    expect(m.taTop).toBeLessThan(m.innerHeight);
  });
}

test("a dialog that only reports an error leaves the child's place alone", async ({ page }) => {
  await open(page);
  await setText(page, Array.from({ length: 150 }, (_, i) => `my line ${i + 1}`).join("\n"));
  await page.evaluate(() => window.scrollTo(0, 3200));
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }),
    );
    document
      .getElementById("sheet")!
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#say")).toBeVisible();
  await page.locator("#sayOk").click();
  await settle(page);
  expect(await page.evaluate(() => window.scrollY), "nothing was loaded, so nothing moves").toBe(
    3200,
  );
  expect(await page.inputValue("#ta")).toContain("my line 150");
});

/**
 * The sticky bar must never cover the line being typed. `scroll-padding-top`
 * was a hard 66 px matched to the one-row bar, but the bar wraps to 119-261 px
 * — from about 1355 px of width down, and with the status chip's wording as
 * well — so the browser's caret-reveal scroll parked the new character
 * underneath it. 960x540 is a 1920x1080 screen at 200 % zoom.
 */
for (const vp of [
  { width: 1366, height: 768 },
  { width: 1200, height: 900 },
  { width: 1024, height: 600 },
  { width: 960, height: 540 },
  { width: 683, height: 700 },
]) {
  test(`the toolbar never covers the line being typed at ${vp.width}x${vp.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(vp);
    await open(page);
    await setText(page, Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n"));

    // Put the caret on line 20, scroll well past it, then type one character:
    // the browser scrolls the caret back into view FROM ABOVE, which is the
    // case `scroll-padding-top` exists for.
    await page.evaluate(() => {
      const ta = document.getElementById("ta") as HTMLTextAreaElement;
      const at = ta.value.split("\n").slice(0, 19).join("\n").length + 1; // start of line 20
      ta.focus();
      ta.setSelectionRange(at, at);
      window.scrollTo(0, 2200);
    });
    await page.keyboard.type("Z");
    await settle(page);

    const m = await page.evaluate(() => {
      const ta = document.getElementById("ta")!;
      const bar = document.getElementById("bar")!;
      // Line box 20 of the field, and the 16 px of type inside its 32 px box:
      // the half-leading is 8 px top and bottom, and the glyphs are what the
      // child has to be able to see.
      const line = ta.getBoundingClientRect().top + 19 * 32;
      return {
        glyphTop: line + 8,
        glyphBottom: line + 24,
        barBottom: bar.getBoundingClientRect().bottom,
        sticky: getComputedStyle(bar).position !== "static",
        barHeight: bar.getBoundingClientRect().height,
      };
    });
    if (m.sticky) {
      expect(
        m.glyphTop,
        `bar ${m.barHeight} px: the character just typed must not be behind it`,
      ).toBeGreaterThanOrEqual(m.barBottom);
    }
    expect(m.glyphBottom, "and it must be on the screen at all").toBeLessThan(vp.height);
    expect(await page.inputValue("#ta")).toContain("Zline 20");
  });
}

/**
 * The 48 px white band around the text column is `#sheet`, not `#ta`. Clicking
 * it — which is exactly what a child aiming at the start of a line does — left
 * `activeElement` on BODY, took the ring off the paper and swallowed every
 * keystroke that followed.
 */
test("clicking the paper's own margin puts the caret back in the writing", async ({ page }) => {
  await open(page);
  await setText(page, "a line of writing");
  const box = (await page.locator("#sheet").boundingBox())!;
  const bands = [
    { name: "left margin", x: box.x + 24, y: box.y + 400, scroll: 0 },
    { name: "top margin", x: box.x + box.width / 2, y: box.y + 20, scroll: 0 },
    { name: "right margin", x: box.x + box.width - 24, y: box.y + 400, scroll: 0 },
    // The foot of the sheet is below a 768 px window, so scroll to it first
    // rather than clicking a point that is not on the screen.
    { name: "bottom margin", x: box.x + box.width / 2, y: 0, scroll: 600 },
  ];
  for (const b of bands) {
    await page.evaluate((to) => window.scrollTo(0, to), b.scroll);
    if (b.scroll) {
      const now = (await page.locator("#sheet").boundingBox())!;
      b.y = now.y + now.height - 20;
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.click(b.x, b.y);
    const who = await page.evaluate(() => document.activeElement?.id ?? document.body.tagName);
    expect(who, `${b.name}`).toBe("ta");
  }
  await page.keyboard.type("!");
  expect(await page.inputValue("#ta"), "and the keystrokes land").toContain("!");

  // The band focuses the field, so it has to LOOK like writing surface too:
  // it used to show the default arrow while `#ta` two pixels away showed the
  // I-beam, on the exact strip a child aims at to start a line.
  expect(
    await page.evaluate(() => getComputedStyle(document.getElementById("sheet")!).cursor),
    "the margin band reads as writing surface",
  ).toBe("text");

  // A press that begins over the words is the field's own, untouched: this is
  // what DECISIONS 5.16 protects (Select-to-speak drags, magnifier panning).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(box.x + 200, box.y + 60);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("ta");
  expect(await page.evaluate(() => (document.getElementById("ta") as HTMLTextAreaElement).selectionStart)).toBeGreaterThan(0);
});

/**
 * Tab inside a modal used to pass through a stop with no visible ring at all:
 * dlgKeep -> dlgGo -> BODY -> dlgKeep. One press per lap with no indicator
 * anywhere, on the dialog that decides whether a child's writing is deleted.
 */
test("Tab inside the dialogs always lands on a button with a visible ring", async ({ page }) => {
  await blockDraftStorage(page);
  await open(page);
  await setText(page, "words a child would hate to lose");
  await page.locator("#btnNew").click();
  await expect(page.locator("#dlgKeep")).toBeFocused();

  const ringed = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { id: el.id, outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });

  for (const want of ["dlgGo", "dlgKeep", "dlgGo", "dlgKeep"]) {
    await page.keyboard.press("Tab");
    const r = await ringed();
    expect(r.id, "the cycle never leaves the two buttons").toBe(want);
    expect(r.outline).not.toBe("none");
    expect(r.width).toBeGreaterThanOrEqual(3);
  }
  for (const want of ["dlgGo", "dlgKeep"]) {
    await page.keyboard.press("Shift+Tab");
    expect((await ringed()).id, "and backwards too").toBe(want);
  }
  await page.keyboard.press("Escape");

  // The one-button dialog: Tab simply keeps the ring on OK.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }),
    );
    document
      .getElementById("sheet")!
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#say")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    const r = await ringed();
    expect(r.id).toBe("sayOk");
    expect(r.outline).not.toBe("none");
  }
});

/**
 * The saved chip sized itself to its text — 200 px empty, 120 px dirty, 201 px
 * after a save — and everything to its right moved with it: "Book letters" and
 * "Black on white" slid 80 px left on the first keystroke and 81 px back on
 * the save, in a six-control interface built for nine-year-olds.
 */
test("Settings never moves when the saved indicator changes", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await open(page);

  const xs = () =>
    page.evaluate(() => ({
      settings: Math.round(document.getElementById("btnSettings")!.getBoundingClientRect().x),
      bar: document.getElementById("bar")!.getBoundingClientRect().height,
    }));

  const fresh = await xs();
  await page.locator("#ta").click();
  await page.keyboard.type("Hi");
  await settle(page);
  expect(await xs(), "the first keystroke must move nothing").toEqual(fresh);

  await setText(page, "The Crab That Lived In Our Tide Pool And Ate My Sandwich\nIt was orange.");
  await page.locator("#btnSave").click();
  await expect(page.locator("#downloadDlg")).toBeVisible();
  await Promise.all([page.waitForEvent("download"), page.locator("#downloadGo").click()]);
  await settle(page);
  expect(await xs(), "and neither must the save").toEqual(fresh);
  expect(fresh.bar, "still one row at 1366").toBeLessThan(90);
});

/**
 * Clicking a toggle must not move the child's view of their own story.
 *
 * DESIGN §10 requires pointer activation to put the cursor back in the field
 * ("the student should never have to hunt for the cursor"), and DECISIONS 9.10
 * keeps that to the pointer path. Nothing in either says the page may scroll —
 * but a bare `ta.focus()` triggers Chromium's caret-reveal scroll, amplified by
 * `scroll-padding-bottom: 30vh`. Measured on an 80-line story at 1366x768:
 * caret at the end (where it is after typing) and the window scrolled back to
 * the top to re-read, one click on "White on black" threw scrollY from 0 to
 * 2379 of a 3161 px document — the title and the opening paragraph replaced by
 * the blank tail of the last sheet, with no explanation a nine-year-old could
 * possibly have. The reverse direction moved just as far.
 */
for (const g of [
  { group: "Letters", to: "Round letters", attr: "data-font", value: "dys" },
  { group: "Colours", to: "White on black", attr: "data-mode", value: "hc" },
]) {
  test(`clicking ${g.group} keeps the child's place in the story`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await open(page);
    // Long enough lines to exercise rewrapping when the two differently shaped
    // faces are switched, even after their optical sizes are normalized.
    await setText(
      page,
      Array.from(
        { length: 45 },
        (_, i) => `Thing number ${i + 1}: we went down to the tide pools before lunch and counted every crab.`,
      ).join("\n\n"),
    );
    await settle(page);

    /** Open with a real pointer press, so the trigger cannot scroll the story. */
    const clickToggle = async (): Promise<void> => {
      const b = (await page.locator("#btnSettings").boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.getByRole("radio", { name: g.to }).check();
      await page.locator("#settingsApply").click();
      await settle(page);
    };
    const put = (caret: "start" | "end", y: number) =>
      page.evaluate(
        ([c, top]) => {
          const ta = document.getElementById("ta") as HTMLTextAreaElement;
          ta.focus();
          const at = c === "start" ? 0 : ta.value.length;
          ta.setSelectionRange(at, at);
          window.scrollTo(0, top as number);
        },
        [caret, y] as const,
      );
    const state = () =>
      page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight }));

    // 1. Caret at the end (where it is after typing), scrolled back to the top
    //    to re-read: measured 0 -> 2379 of a 3161 px document before the fix.
    await put("end", 0);
    const a = await state();
    expect(a.h, "a story taller than the window").toBeGreaterThan(2000);
    await clickToggle();
    await expect(page.locator("html")).toHaveAttribute(g.attr, g.value);
    await expect(page.locator("#ta"), "the cursor still comes back").toBeFocused();
    const b = await state();
    expect(b.y, "the top of the story stays on the screen").toBeLessThanOrEqual(8);

    // 2. Caret at offset 0 (a file just opened), scrolled down to read page 2,
    //    then back again. The Letters toggle changes the document's height, so
    //    what has to hold is the same PART of the story, not the same pixel.
    await put("start", 1900);
    const c = await state();
    await clickToggle();
    await expect(page.locator("#ta")).toBeFocused();
    const d = await state();
    const want = Math.round((1900 * d.h) / c.h);
    expect(Math.abs(d.y - want), `page 2 stays on the screen (${d.y} vs ${want})`).toBeLessThanOrEqual(
      32,
    );
    expect(d.y, "and it did NOT snap to the top, which is the old behaviour").toBeGreaterThan(1000);
  });
}

/**
 * Regression guard for the removed Escape-then-Tab mode: Escape never arms Tab.
 *
 * `escapeArmed` was cleared only by another keydown inside the field, so an
 * Escape pressed at any earlier point in the session survived arbitrary mouse
 * work: Escape, click in the middle of the text, click back in the field, press
 * Tab — and focus jumped to New instead of typing a tab, contradicting the
 * field's own `aria-describedby`. One more keypress on New, over a SAVED
 * document, then cleared it with no dialog (a clean document needs none) and
 * `loadDocument` is the one place the native undo stack is deliberately
 * destroyed, so the words were unrecoverable in the app.
 */
for (const how of ["a click inside the writing", "a trip out to a button"] as const) {
  test(`Escape does not stay armed across ${how}`, async ({ page }) => {
    await open(page);
    await setText(page, "ab");
    await page.locator("#ta").click();
    await page.keyboard.press("Escape");

    if (how === "a click inside the writing") {
      await page.mouse.click(400, 200);
    } else {
      await page.locator("#btnPrint").focus();
    }
    await page.locator("#ta").click();
    await page.keyboard.press("Tab");
    await settle(page);

    await expect(page.locator("#ta"), "Tab types a tab space, as promised").toBeFocused();
    expect(await page.inputValue("#ta"), "and a real tab went in").toContain("\t");
  });
}

test("the Docs move-out shortcut reaches the toolbar without changing the writing", async ({ page }) => {
  await open(page);
  await page.locator("#ta").click();
  await page.keyboard.press("Control+Alt+Shift+m");
  await expect(page.locator("#toolbar")).toContainText((await focused(page))!.text);
  await expect(page.locator("#ta")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeFocused();
});

/**
 * The other side of the SC 1.4.10 rule above: 999 x 520 reached a case it had
 * no business in. A 1366x768 Chromebook at 150 % browser zoom is a 911x512
 * viewport, and there the bar is 119 px of 512 — pinning it still leaves about
 * twelve lines of paper. Unsticking it put New/Open/Save/Print and the
 * save-state chip completely off the screen after fifteen lines of writing, so
 * a child could neither see whether the work was saved nor reach Save without
 * scrolling away from the caret. The bounds are now 880 x 430.
 */
test("at 911x512 (a 1366x768 Chromebook at 150 %) the toolbar stays pinned", async ({ page }) => {
  await page.setViewportSize({ width: 911, height: 512 });
  await open(page);
  await setText(page, Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n"));
  await page.evaluate(() => window.scrollTo(0, 400));

  const m = await page.evaluate(() => {
    const bar = document.getElementById("bar")!;
    const chip = document.getElementById("status")!.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    const ta = document.getElementById("ta")!.getBoundingClientRect();
    return {
      position: getComputedStyle(bar).position,
      barTop: r.top,
      barBottom: r.bottom,
      chipTop: chip.top,
      chipBottom: chip.bottom,
      paper: Math.max(0, Math.min(ta.bottom, window.innerHeight) - Math.max(ta.top, r.bottom)),
    };
  });
  expect(m.position, "the bar is still sticky at 911x512").toBe("sticky");
  expect(m.barTop, "pinned at the top of the scrollport").toBe(0);
  expect(m.chipTop, "the save-state chip is on the screen").toBeGreaterThanOrEqual(0);
  expect(m.chipBottom).toBeLessThanOrEqual(512);
  expect(m.paper, "and the paper is still writable under it").toBeGreaterThanOrEqual(64);
});

/**
 * DECISIONS 10.10/11.2 removed exactly this jitter from the status chip; the
 * Letters toggle reintroduced it. The tick used to be drawn in the selected
 * label's own typeface, so choosing "Round letters" rendered it in the wider
 * OpenDyslexic face and pushed the whole Colours group 6 px right.
 */
test("choosing Round letters moves nothing else in the toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page);
  const probe = () =>
    page.evaluate(() => {
      const x = (id: string) => document.getElementById(id)!.getBoundingClientRect();
      return {
        settingsWidth: Math.round(x("btnSettings").width),
        settingsLeft: Math.round(x("btnSettings").left),
        barHeight: Math.round(document.getElementById("bar")!.getBoundingClientRect().height),
      };
    });
  const before = await probe();
  await chooseFont(page, "dys");
  await expect(page.locator("html")).toHaveAttribute("data-font", "dys");
  const after = await probe();
  expect(after, "the Letters group is width-neutral across its two states").toEqual(before);
  expect(before.barHeight, "and the bar is still one row at 1366").toBeLessThan(100);
});
