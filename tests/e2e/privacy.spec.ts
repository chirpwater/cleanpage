import { expect, test } from "@playwright/test";
import { CORPUS, ready, setText, settle } from "./helpers.js";
import { SETTINGS_KEY } from "../../src/storage.js";

const SECRET = "Zoltan-the-marmot-ate-my-homework";

async function swSettled(page: import("@playwright/test").Page): Promise<void> {
  await page
    .evaluate(() => navigator.serviceWorker?.ready.then(() => undefined))
    .catch(() => undefined);
  await page.waitForTimeout(1000);
}

test("nothing goes over the wire once the page is open", async ({ page, context }) => {
  await page.goto("./");
  await ready(page);
  await swSettled(page);

  const seen: string[] = [];
  page.on("request", (r) => seen.push(`page ${r.method()} ${r.url()}`));
  context.on("request", (r) => seen.push(`ctx ${r.method()} ${r.url()}`));

  // Everything a student does in a lesson.
  await page.locator("#ta").click();
  await page.keyboard.type(SECRET);
  await setText(page, CORPUS);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters" }).click();
  await page.getByRole("radio", { name: "Book letters" }).click();
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: null });
  await page.locator("#btnNew").click();
  await expect(page.locator("#dlg")).toBeVisible();
  await page.locator("#dlgGo").click();
  await expect(page.locator("#ta")).toHaveValue("");
  await expect(page.locator("#dlg")).toBeHidden();
  await settle(page);
  await page.waitForTimeout(1500);

  expect(seen, "zero requests to any origin after load").toEqual([]);
});

test("only settings persist; writing stays out of browser storage and caches", async ({ page }) => {
  await page.goto("./");
  await ready(page);
  await swSettled(page);

  await page.locator("#ta").click();
  await page.keyboard.type(SECRET);
  await setText(page, CORPUS + "\n" + SECRET + "\n");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Round letters" }).click();
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await settle(page);

  const storage = await page.evaluate(async (secret) => {
    const dump: Record<string, unknown> = {};
    const read = (s: Storage) => {
      const o: Record<string, string> = {};
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)!;
        o[k] = s.getItem(k) ?? "";
      }
      return o;
    };
    dump["localStorage"] = read(localStorage);
    dump["sessionStorage"] = read(sessionStorage);
    dump["cookie"] = document.cookie;
    dump["idb"] = (await (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> })
      .databases?.())?.map((d) => d.name ?? "?") ?? [];

    const names = "caches" in self ? await caches.keys() : [];
    const cached: string[] = [];
    let leak = false;
    for (const n of names) {
      const c = await caches.open(n);
      for (const req of await c.keys()) {
        cached.push(new URL(req.url).pathname);
        const body = await (await c.match(req, { ignoreVary: true }))?.text().catch(() => "");
        if (body && body.includes(secret)) leak = true;
      }
    }
    dump["cacheNames"] = names;
    dump["cached"] = cached.sort();
    dump["leak"] = leak;
    return dump;
  }, SECRET);

  const local = storage["localStorage"] as Record<string, string>;
  const session = storage["sessionStorage"] as Record<string, string>;
  expect(session).toEqual({});
  expect(Object.keys(local)).toEqual([SETTINGS_KEY]);
  expect(JSON.parse(local[SETTINGS_KEY]!)).toEqual({ font: "dys", size: "large", theme: "light" });
  expect(JSON.stringify(storage), "browser storage never contains writing").not.toContain(SECRET);
  expect(storage["cookie"]).toBe("");
  expect(storage["idb"]).toEqual([]);

  // Exactly one cache, named for this build, holding only our own static files.
  expect((storage["cacheNames"] as string[]).every((n) => /^cleanpage-/.test(n))).toBe(true);
  expect(storage["leak"], "no cached response contains the child's writing").toBe(false);
  for (const p of storage["cached"] as string[]) {
    expect(p, "only the application's own files are cached").toMatch(
      // The published statements and the font licences are precached like
      // everything else, so a reviewer can still read them with the network off.
      /(\/|index\.html|privacy\.html|accessibility\.html|app\.js|app\.css|doc\.css|favicon\.svg|manifest\.webmanifest|\.woff2|\.png|\.txt)$/,
    );
  }
});

test("the page declares no third-party anything", async ({ page }) => {
  await page.goto("./");
  await ready(page);
  const externals = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("script[src], link[href], img[src], iframe"))
      .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
      .filter((u) => /^[a-z]+:\/\//i.test(u) && !u.startsWith(location.origin)),
  );
  expect(externals, "no CDN, no analytics, no web font service").toEqual([]);
});

test("the authorship logo loads from this application without contacting ChirpWater", async ({ page, context }) => {
  const requested: string[] = [];
  context.on("request", (request) => requested.push(request.url()));
  await page.goto("./");
  await ready(page);
  await swSettled(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const origin = new URL(page.url()).origin;
  expect(requested.some((url) => new URL(url).pathname.endsWith("/chirpwater-logo.png"))).toBe(true);
  expect(requested.filter((url) => new URL(url).origin !== origin), "the logo is bundled, not hotlinked").toEqual([]);
});
