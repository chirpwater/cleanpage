import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function swBuildId(): Plugin {
  const EXCLUDE = new Set(["sw.js", "_headers", ".nojekyll"]);
  const EXCLUDE_EXT = [".ttf", ".txt", ".map"];
  let out = "dist";
  let root = process.cwd();
  return {
    name: "tp-sw-build-id",
    apply: "build",
    configResolved(cfg) {
      root = cfg.root;
      out = join(root, cfg.build.outDir);
    },
    closeBundle: {
      order: "post" as const,
      sequential: true,
      handler() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const p = join(dir, name);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
      const files = walk(out)
        .map((p) => relative(out, p).split(sep).join("/"))
        .filter((p) => !EXCLUDE.has(p) && !EXCLUDE_EXT.some((e) => p.endsWith(e)))
        .sort();
      const assets = ["./", ...files.map((f) => "./" + f)];
      const swPath = join(out, "sw.js");
      const src = readFileSync(swPath, "utf8");
      const build = createHash("sha256")
        .update(files.map((f) => f + ":" + readFileSync(join(out, f))).join("\n"))
        .digest("hex")
        .slice(0, 12);
      writeFileSync(
        swPath,
        src
          .replace(/__CP_BUILD__/g, build)
          .replace(/\["__CP_ASSETS__"\]/g, JSON.stringify(assets, null, 2)),
      );
      this.info(`sw.js: build ${build}, ${assets.length} precached`);
      },
    },
  };
}

/** Directives a browser ignores when the policy arrives in a `<meta>` element. */
const META_IGNORED = new Set(["frame-ancestors", "report-uri", "sandbox"]);

/** The Content-Security-Policy value out of `public/_headers`, as one line. */
export function cspFromHeaders(headersText: string): string {
  const line = headersText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith("content-security-policy:"));
  if (!line) throw new Error("public/_headers has no Content-Security-Policy line");
  return line.slice(line.indexOf(":") + 1).trim();
}

/** The same policy reduced to what a `<meta http-equiv>` can actually enforce. */
export function metaCsp(policy: string): string {
  return policy
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !META_IGNORED.has(d.split(/\s+/)[0]!.toLowerCase()))
    .join("; ");
}

/**
 * Emits the policy into the built `index.html` as well.
 *
 * `public/_headers` is the real enforcement and stays authoritative — a header
 * is what a district reviewer can check with `curl -I`, and it is the only
 * place `frame-ancestors` means anything (DECISIONS 6.12). But GitHub Pages
 * cannot send response headers at all, and that is the deploy path this
 * repository automates, so on that host the meta tag is what carries the
 * policy. Build only: the dev server needs its own websocket.
 */
function cspMeta(): Plugin {
  let root = process.cwd();
  return {
    name: "tp-csp-meta",
    apply: "build",
    configResolved(cfg) {
      root = cfg.root;
    },
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        const policy = metaCsp(cspFromHeaders(readFileSync(join(root, "public", "_headers"), "utf8")));
        return html.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

/* --------------------------------------------------- published statements */

/** The tiny Markdown subset docs/PRIVACY.md and docs/ACCESSIBILITY.md use. */
const escapeHtml = (t: string): string =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(md: string): { title: string; body: string } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let title = "";
  let para: string[] = [];
  let item: string[] = [];
  let inList = false;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inlineMarkdown(para.join(" "))}</p>`);
    para = [];
  };
  const flushItem = () => {
    if (item.length) out.push(`<li>${inlineMarkdown(item.join(" "))}</li>`);
    item = [];
  };
  const endList = () => {
    if (!inList) return;
    flushItem();
    out.push("</ul>");
    inList = false;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      endList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      endList();
      const level = heading[1]!.length;
      const text = inlineMarkdown(heading[2]!);
      if (level === 1 && !title) title = heading[2]!;
      out.push(`<h${level}>${text}</h${level}>`);
      continue;
    }
    const bullet = /^-\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      flushItem();
      item.push(bullet[1]!);
      continue;
    }
    if (inList) item.push(line.trim());
    else para.push(line.trim());
  }
  flushPara();
  endList();
  return { title, body: out.join("\n") };
}

export function statementPage(md: string, policy: string, source: string): string {
  const { title, body } = renderMarkdown(md);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)} — Clean Page</title>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./doc.css" />
  </head>
  <body>
    <main>
      <a class="back" href="./">&#8592; Back to Clean Page</a>
${body
  .split("\n")
  .map((l) => "      " + l)
  .join("\n")}
      <footer>This statement is published with the site and in the repository, as ${escapeHtml(source)}.</footer>
    </main>
  </body>
</html>
`;
}

/**
 * Publishes the privacy and accessibility statements WITH the site.
 *
 * PROPOSAL "Privacy" requires the privacy statement to be published "with the
 * site AND in the repository", and "Accessibility" requires the accessibility
 * statement to be published with the site. Only the repository half was met:
 * `dist/` shipped neither statement and the built page linked to neither, so a
 * district reviewer handed the URL found no statement at all, and anyone who
 * cloned and deployed published a site with no privacy notice.
 *
 * Generated from the repository copies at build time rather than hand-copied,
 * so the two can never drift; emitted during `generateBundle`, which is before
 * the service worker's precache list is derived from what the build emitted,
 * so the statements work offline like everything else.
 */
function statementPages(): Plugin {
  let root = process.cwd();
  return {
    name: "tp-statement-pages",
    apply: "build",
    configResolved(cfg) {
      root = cfg.root;
    },
    generateBundle() {
      const policy = metaCsp(cspFromHeaders(readFileSync(join(root, "public", "_headers"), "utf8")));
      for (const [fileName, source] of [
        ["privacy.html", "docs/PRIVACY.md"],
        ["accessibility.html", "docs/ACCESSIBILITY.md"],
      ] as const) {
        const md = readFileSync(join(root, source), "utf8");
        this.emitFile({ type: "asset", fileName, source: statementPage(md, policy, source) });
      }
    },
  };
}

const tls = process.env.CP_HTTPS === "1" ? { https: {
  key: readFileSync(process.env.CP_TLS_KEY ?? ".certs/dev-key.pem"),
  cert: readFileSync(process.env.CP_TLS_CERT ?? ".certs/dev-cert.pem"),
} } : {};

export default defineConfig({
  base: "./",
  // Explicit opt-in keeps CI's loopback fixture HTTP while local development
  // uses a real certificate. Never serve private keys from Vite's project root.
  server: {
    host: "0.0.0.0",
    // Tailscale Serve terminates TLS and forwards with the tailnet hostname in
    // the Host header, which Vite rejects unless the name is allowed. Opt-in by
    // env so the default dev server keeps its localhost-only host check.
    allowedHosts: (process.env.CP_ALLOWED_HOSTS ?? "").split(",").filter(Boolean),
    ...tls,
    fs: { deny: [".env", ".env.*", "*.{crt,pem,key}", "**/.git/**", "**/.certs/**"] },
  },
  preview: {
    host: "0.0.0.0",
    ...tls,
  },
  build: {
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "app-[name].js",
        assetFileNames: "app[extname]",
      },
    },
  },
  plugins: [cspMeta(), statementPages(), swBuildId()],
});
