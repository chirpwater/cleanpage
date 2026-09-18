/**
 * A static server that serves `dist/` AND applies `dist/_headers`.
 *
 * `vite preview` sends no response headers of its own, so until this existed
 * nothing in the suite had ever exercised the configuration that actually
 * ships. That mattered: a service worker inherits the CSP of its own script
 * response, so one token in `_headers` decided whether the precache installed
 * at all, and the suite was green either way.
 *
 * Deliberately tiny and dependency-free — it is a test fixture, not a host.
 * `Vary: Origin` is sent because real static hosts do, and the service worker's
 * `ignoreVary: true` lookups exist precisely because of that.
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
const PORT = Number(process.env.TP_HEADERS_PORT ?? 4174);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Parse a Cloudflare/Netlify `_headers` file into [pattern, {name: value}] rules. */
function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    const line = raw.trim();
    const i = line.indexOf(":");
    if (i > 0 && current) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}

/** `/*` and `/fonts/*` are the only shapes this project uses. */
const matches = (pattern, path) =>
  pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

function headersFor(rules, path) {
  const out = {};
  for (const r of rules) if (matches(r.pattern, path)) Object.assign(out, r.headers);
  return out;
}

/**
 * `dist/` is produced by the other `webServer` entry (`npm run build`), and
 * Playwright makes no promise about the order the two are started in. Read the
 * rules lazily, and re-read them whenever the file changes, so this server is
 * correct whether it starts before or after the build.
 */
let rules = [];
let stamp = -1;
function currentRules() {
  const f = join(ROOT, "_headers");
  try {
    const m = statSync(f).mtimeMs;
    if (m !== stamp) {
      rules = parseHeaders(readFileSync(f, "utf8"));
      stamp = m;
    }
  } catch {
    /* the build has not run yet; serve nothing until it has */
  }
  return rules;
}

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.includes("..")) {
    res.writeHead(403).end();
    return;
  }
  const file = join(ROOT, path === "/" ? "index.html" : path);
  let body;
  try {
    if (statSync(file).isDirectory()) throw new Error("dir");
    body = readFileSync(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }
  res.writeHead(200, {
    ...headersFor(currentRules(), path),
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": body.length,
    Vary: "Origin",
  });
  res.end(req.method === "HEAD" ? undefined : body);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`headers-server: dist/ + dist/_headers on http://127.0.0.1:${PORT}/\n`);
});
