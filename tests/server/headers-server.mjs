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

const matches = (pattern, path) =>
  pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

function headersFor(rules, path) {
  const out = {};
  for (const r of rules) if (matches(r.pattern, path)) Object.assign(out, r.headers);
  return out;
}

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
