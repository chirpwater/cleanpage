import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function swBuildId(): Plugin {
  const EXCLUDE = new Set(["sw.js", "_headers", ".nojekyll"]);
  const EXCLUDE_EXT = [".ttf", ".map"];
  let out = "dist";
  let root = process.cwd();
  return {
    name: "tp-sw-build-id",
    apply: "build",
    configResolved(cfg) {
      root = cfg.root;
      out = resolve(root, cfg.build.outDir);
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

export function buildVersion(ref = "main"): string {
  if (ref === "main") return "development edition";
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(ref)) {
    throw new Error(`Expected main or a v-prefixed semver release tag, got ${ref}`);
  }
  return ref;
}

const tls = process.env.CP_HTTPS === "1" ? { https: {
  key: readFileSync(process.env.CP_TLS_KEY ?? ".certs/dev-key.pem"),
  cert: readFileSync(process.env.CP_TLS_CERT ?? ".certs/dev-cert.pem"),
} } : {};

export default defineConfig({
  base: "./",
  define: { "import.meta.env.CP_VERSION": JSON.stringify(buildVersion(process.env.CP_BUILD_REF)) },
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
  plugins: [cspMeta(), swBuildId()],
});
