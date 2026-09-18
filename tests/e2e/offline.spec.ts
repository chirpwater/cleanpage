import { expect, test } from "@playwright/test";
import { open, ready, setText, settle } from "./helpers.js";

test("offline caches are isolated from other applications and installation paths", async ({ page, context }) => {
  await page.goto("/privacy.html");
  const seeded = await page.evaluate(async () => {
    const scope = new URL("./", location.href).href;
    const foreign = "another-app-offline";
    const sibling = `cleanpage-${encodeURIComponent(new URL("sibling/", scope).href)}:old`;
    const obsolete = `cleanpage-${encodeURIComponent(scope)}:old`;
    const unrelated = await caches.open(foreign);
    await unrelated.put(new URL("app.css", scope), new Response("#sheet { width: 1px !important; }", {
      headers: { "Content-Type": "text/css" },
    }));
    await unrelated.put(new URL("index.html", scope), new Response("Unrelated cached document", {
      headers: { "Content-Type": "text/html" },
    }));
    await caches.open(sibling);
    await caches.open(obsolete);
    return { foreign, sibling, obsolete };
  });

  await open(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => caches.keys())).toContain(seeded.foreign);
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain(seeded.sibling);
  expect(names).not.toContain(seeded.obsolete);

  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  // Both an exact document request and the app-shell fallback must come from
  // this installation's cache, even if another cache has matching URLs.
  const failed: string[] = [];
  page.on("requestfailed", (request) => failed.push(request.url()));
  for (const path of ["/index.html", "/offline-deep-link", "/deep/link/that/does/not/exist"]) {
    await page.goto(path);
    await ready(page);
    await expect(page.locator("#ta")).toBeVisible();
    // Opening Settings pulls in the bundled logo; if the offline cache were
    // missing it, the request would show up in `failed` below.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(failed, "the shell fallback loads all of its assets offline").toEqual([]);
  await context.setOffline(false);
});

test("after one visit the page loads and works with the network off", async ({ page, context }) => {
  await open(page);

  const reg = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return "unsupported";
    const r = await navigator.serviceWorker.ready;
    return r.active ? "active" : "waiting";
  });
  test.skip(reg === "unsupported", "this browser has no service worker");
  expect(reg).toBe("active");

  // No skipWaiting() and no clients.claim(), deliberately: a new version must
  // never activate under a child who is mid-sentence. So the FIRST load is
  // uncontrolled by design, and the worker takes over on the next cold start.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ""}`));

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.fonts.status === "loaded");

  // It is not enough that the document came back: the field has to be there
  // and the real faces have to be usable, or wrap and lines-per-page change
  // silently. Opening Settings then has to pull the bundled logo from the
  // cache rather than failing to load it.
  const state = await page.evaluate(() => ({
    hasField: !!document.getElementById("ta"),
    serifLoaded: document.fonts.check('16px "Liberation Serif"'),
    dysLoaded: document.fonts.check('16px "OpenDyslexic"'),
  }));
  expect(state.hasField).toBe(true);
  expect(state.serifLoaded, "the real font, not a substitute").toBe(true);
  expect(state.dysLoaded).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(failed, "nothing failed to load offline").toEqual([]);

  // And it is a working editor, not a cached picture of one.
  // Exactly 60 short lines and no trailing newline: two full pages.
  await setText(page, Array.from({ length: 60 }, () => "I can still write on the bus.").join("\n"));
  await settle(page);
  const pages = await page.evaluate(() =>
    Math.round(document.getElementById("ta")!.getBoundingClientRect().height / 960),
  );
  expect(pages).toBe(2);
  expect(await page.locator("#printdoc .page").count()).toBe(2);

  await context.setOffline(false);
});
