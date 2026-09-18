/**
 * The configuration that actually ships (DESIGN §8, DECISIONS 6.11/6.12).
 *
 * Every other spec runs against `vite preview`, which sends no response
 * headers at all, so `public/_headers` had never been exercised by anything.
 * It needed to be: a service worker inherits the CSP of its own script
 * response, and with `connect-src 'none'` the fetches inside `cache.addAll`
 * were blocked, `install` rejected, the precache was created empty, no
 * controller was ever installed, and an offline reload died with
 * ERR_INTERNET_DISCONNECTED — on the preferred host, silently, with the whole
 * suite green.
 *
 * This project runs against `tests/server/headers-server.mjs`, which serves
 * `dist/` with `dist/_headers` applied the way Cloudflare Pages does.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, chooseFont, chooseMode, open, settle, setText } from "./helpers.js";

const headersText = (): string => readFileSync(join(REPO, "public", "_headers"), "utf8");

/** The precache list the build actually emitted, read out of `dist/sw.js`. */
function emittedAssets(): string[] {
  const src = readFileSync(join(REPO, "dist", "sw.js"), "utf8");
  const m = /const ASSETS = (\[[\s\S]*?\]);/.exec(src);
  if (!m) throw new Error("dist/sw.js has no ASSETS list");
  return JSON.parse(m[1]!) as string[];
}

/** `public/_headers` as [pattern, {name: value}] blocks. */
function blocks(): { pattern: string; headers: Record<string, string> }[] {
  const out: { pattern: string; headers: Record<string, string> }[] = [];
  for (const raw of headersText().split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      out.push({ pattern: raw.trim(), headers: {} });
      continue;
    }
    const line = raw.trim();
    const i = line.indexOf(":");
    const b = out[out.length - 1];
    if (i > 0 && b) b.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

test("the real response headers arrive, and the CSP is the one in public/_headers", async ({
  request,
}) => {
  const rules = blocks();
  expect(rules.map((r) => r.pattern)).toEqual(["/*", "/fonts/*"]);

  const cases: [string, string][] = [
    ["/*", "/"],
    ["/*", "/sw.js"],
    ["/*", "/app.js"],
    ["/fonts/*", "/fonts/LiberationSerif-Regular.woff2"],
  ];
  for (const [pattern, path] of cases) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const got = res.headers();
    for (const r of rules) {
      if (!path.startsWith(r.pattern.slice(0, -1))) continue;
      for (const [name, value] of Object.entries(r.headers)) {
        expect(got[name], `${path} (${pattern}): ${name}`).toBe(value);
      }
    }
  }

  // The worker's own script response carries the policy that governs its
  // `cache.addAll`. `connect-src 'none'` there is what broke offline.
  const csp = (await request.get("/sw.js")).headers()["content-security-policy"] ?? "";
  expect(csp, "the worker may re-fetch our own files, and nothing else").toContain(
    "connect-src 'self'",
  );
  expect(csp).toContain("default-src 'none'");
});

test("the built page carries the same policy as a meta tag, for a host that cannot send headers", () => {
  const header = /content-security-policy:\s*(.+)/i.exec(headersText())?.[1]!.trim() ?? "";
  const meta =
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
      readFileSync(join(REPO, "dist", "index.html"), "utf8"),
    )?.[1] ?? "";
  expect(meta, "dist/index.html ships the policy too").not.toBe("");

  // A <meta> CSP ignores exactly these; everything else must match the header,
  // so the two copies of the policy cannot drift apart.
  const IGNORED = new Set(["frame-ancestors", "report-uri", "sandbox"]);
  const split = (p: string) =>
    p
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
  expect(split(meta)).toEqual(split(header).filter((d) => !IGNORED.has(d.split(/\s+/)[0]!)));
  expect(split(header).some((d) => d.startsWith("frame-ancestors"))).toBe(true);
});

test("under the shipped CSP the worker precaches every emitted file and the page works offline", async ({
  page,
  context,
}) => {
  const want = emittedAssets();
  expect(want.length, "the build emitted a precache list").toBeGreaterThan(5);

  await open(page);

  const reg = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return "unsupported";
    const r = await navigator.serviceWorker.ready;
    return r.active ? "active" : "waiting";
  });
  test.skip(reg === "unsupported", "this browser has no service worker");
  expect(reg, "install must not be rejected by the CSP").toBe("active");

  // An empty-but-present cache used to pass for "offline works": name the
  // entries, or the next CSP change breaks this silently all over again.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const out: string[] = [];
    for (const n of names) {
      const c = await caches.open(n);
      for (const req of await c.keys()) out.push(new URL(req.url).pathname);
    }
    return out.sort();
  });
  const wantPaths = want.map((a) => new URL(a, "http://127.0.0.1/").pathname).sort();
  expect(cached, "every emitted asset is in the precache").toEqual(wantPaths);

  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ""}`));

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.fonts.status === "loaded");

  const state = await page.evaluate(() => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement | null;
    return {
      hasField: !!ta,
      width: ta ? getComputedStyle(ta).width : null,
      lineHeight: ta ? getComputedStyle(ta).lineHeight : null,
      sheet: getComputedStyle(document.getElementById("sheet")!).width,
      serifLoaded: document.fonts.check('16px "Liberation Serif"'),
    };
  });
  expect(state.hasField).toBe(true);
  expect(state.width).toBe("720px");
  expect(state.lineHeight).toBe("32px");
  expect(state.sheet).toBe("816px");
  expect(state.serifLoaded, "the real font, from the precache").toBe(true);
  expect(failed, "nothing failed to load offline").toEqual([]);

  // And still a working editor under the CSP, not a cached picture of one.
  await setText(page, Array.from({ length: 60 }, () => "I can still write on the bus.").join("\n"));
  await settle(page);
  expect(await page.locator("#printdoc .page").count()).toBe(2);

  await context.setOffline(false);
});

/**
 * PROPOSAL requires the privacy statement to be published "with the site AND in
 * the repository", and the accessibility statement "with the site". Only the
 * repository half was ever met: `dist/` shipped neither file and the page
 * linked to neither, so a district reviewer handed the URL found no statement
 * at all. They are generated into the build from the repository copies now —
 * and they have to survive the same policy the app does, which is why this
 * test lives here and not in a spec that runs under `vite preview`: an inline
 * `<style>` block in a generated page would be refused by `style-src 'self'`
 * on the real host while looking perfect locally.
 */
for (const path of ["/privacy.html", "/accessibility.html"] as const) {
  test(`${path} is published with the site, styled, under the real policy`, async ({
    page,
    context,
  }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    const failed: string[] = [];
    page.on("requestfailed", (r) => failed.push(r.url()));

    const res = await page.goto(path);
    expect(res?.status(), `${path} is served`).toBe(200);
    expect(violations, "no CSP violation on the statement page").toEqual([]);
    expect(failed, "the statement's own stylesheet loads").toEqual([]);

    // The external stylesheet really applied — an unstyled statement is what a
    // refused inline <style> would look like.
    const styled = await page.evaluate(() => ({
      main: getComputedStyle(document.querySelector("main")!).maxWidth,
      back: document.querySelector("a.back")?.getAttribute("href"),
    }));
    expect(styled.main, "doc.css was applied").not.toBe("none");
    expect(styled.back, "and there is a way back to the writing").toBe("./");

    /*
     * Everything above is the FIRST visit, with no worker in control — which is
     * all this test used to exercise, and it is the one visit that was never
     * broken. From the second visit on, the worker answered every navigation
     * from the cached app shell whatever URL was asked for, so the reviewer who
     * had already opened the tool once got the typewriter under
     * /privacy.html — online as well as offline, with `document.title`
     * "Clean Page", no `h1` at all and `#ta` present. Only a hard reload,
     * which bypasses the worker, brought the statement back.
     *
     * So: take control, and ask again.
     */
    await page.goto("/");
    const reg = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return "unsupported";
      await navigator.serviceWorker.ready;
      return "ready";
    });
    test.skip(reg === "unsupported", "this browser has no service worker");
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    for (const offline of [false, true]) {
      await context.setOffline(offline);
      const where = offline ? "offline" : "online";
      const res2 = await page.goto(path);
      expect(res2?.status(), `${path} under the worker, ${where}`).toBe(200);
      const seen = await page.evaluate(() => ({
        controller: !!navigator.serviceWorker.controller,
        // What makes it a statement page is its shape, not its wording: a
        // heading and the link back to the writing, which the app shell has
        // neither of.
        statement:
          !!document.querySelector("h1") && !!document.querySelector("a.back[href='./']"),
        typewriter: !!document.getElementById("ta"),
      }));
      expect(seen.controller, `${where}: the worker really is in control`).toBe(true);
      expect(seen.statement, `${where}: the statement, not the writing app`).toBe(true);
      expect(seen.typewriter, `${where}: this must not be the typewriter`).toBe(false);
    }

    // And the shell fallback that §8 exists for is still there: a URL the build
    // never emitted must still open the app, offline.
    await page.goto("/deep/link/that/does/not/exist");
    expect(
      await page.evaluate(() => !!document.getElementById("ta")),
      "an unknown path still falls back to the app shell",
    ).toBe(true);
    await context.setOffline(false);
  });
}

test("the page itself points at both statements on its own origin", async ({ page }) => {
  await page.goto("/");
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLLinkElement>("head link[rel]")).map(
      (l) => `${l.rel} ${l.getAttribute("href")}`,
    ),
  );
  expect(links).toContain("privacy-policy ./privacy.html");
  expect(links).toContain("help ./accessibility.html");
});

test("the policy grants nothing the build does not use", async ({ page }) => {
  // `img-src 'self' data:` was a vestige of an inline data-URI favicon that
  // never shipped (DECISIONS 5.18): `assetsInlineLimit: 0` means Vite cannot
  // emit a data: URI, and the built CSS and HTML contain none.
  const policy = /content-security-policy:\s*(.+)/i.exec(headersText())?.[1]!.trim() ?? "";
  expect(policy).toContain("img-src 'self';");
  expect(policy, "no data: images anywhere in the build").not.toContain("data:");

  // The one relaxation in the whole policy, and it is scoped to style
  // ATTRIBUTES, which WebKit's own editing code writes when Tab runs
  // `execCommand("insertText", …)`. Nothing in this build ships a style
  // attribute (DECISIONS 11.8).
  expect(policy).toContain("style-src-attr 'unsafe-inline'");
  // `style-src-elem` is deliberately absent, so an injected <style> element
  // still falls back to `style-src 'self'` and is still refused — which is what
  // DECISIONS 9.16 and the CSSOM-only test overrides depend on.
  expect(policy, "a <style> element stays refused").not.toContain("style-src-elem");
  expect(policy).toContain("style-src 'self'");
  for (const f of ["index.html", "privacy.html", "accessibility.html"]) {
    expect(
      readFileSync(join(REPO, "dist", f), "utf8"),
      `${f} ships no style attribute of its own`,
    ).not.toMatch(/\sstyle="/);
  }
  for (const f of ["index.html", "app.css", "app.js", "privacy.html", "accessibility.html"]) {
    expect(readFileSync(join(REPO, "dist", f), "utf8"), `${f} uses no data: URI`).not.toMatch(
      /url\(\s*["']?data:/,
    );
  }
  await page.goto("/");
});

test("the CSP does not block anything the page actually does", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await open(page);
  await setText(page, Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
  await chooseFont(page, "dys");
  await chooseMode(page, "hc");
  // Tab is the one gesture that makes the ENGINE write style of its own:
  // `document.execCommand("insertText", …)` (DECISIONS 5.9) makes WebKit apply
  // a style attribute, and under a policy with no `style-src-attr` that is a
  // red "Refused to apply a stylesheet" on the shipped page in Safari. Chromium
  // does not report it, so this assertion is a floor, not the proof; the policy
  // line itself is asserted below (DECISIONS 11.8).
  await page.locator("#ta").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Tab");
  await settle(page);
  expect(await page.inputValue("#ta"), "Tab still types a tab").toContain("\t");

  // The layout writes `ta.style.height` and the rule tops through the CSSOM,
  // which `style-src 'self'` does not restrict. Prove it, rather than assume.
  const laid = await page.evaluate(() => ({
    height: document.getElementById("ta")!.style.height,
    rules: document.querySelectorAll("#breaks .rule").length,
  }));
  expect(laid.height).toBe("1920px");
  expect(laid.rules).toBe(1);
  expect(violations, "no CSP violation in the console").toEqual([]);
});
