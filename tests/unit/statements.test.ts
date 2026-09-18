/**
 * The build-time renderer behind `dist/privacy.html` and
 * `dist/accessibility.html` (DECISIONS 10.5).
 *
 * The two statements are the documents a district reviewer reads, and they are
 * generated rather than hand-copied so the published copy and the repository
 * copy cannot drift. That only holds if the renderer keeps the whole text: the
 * cases here are the ones the two files actually contain, plus the escaping a
 * generated page must not get wrong.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inlineMarkdown, renderMarkdown, statementPage } from "../../vite.config.js";

const REPO = join(import.meta.dirname, "..", "..");

describe("the statement renderer", () => {
  it("escapes HTML before it does anything else", () => {
    expect(inlineMarkdown("a <textarea> & an \"and\"")).toBe(
      "a &lt;textarea&gt; &amp; an &quot;and&quot;",
    );
    // `<` inside code is still escaped: a statement page may not inject markup.
    expect(inlineMarkdown("`<meta>`")).toBe("<code>&lt;meta&gt;</code>");
  });

  it("renders the inline subset the two statements use", () => {
    expect(inlineMarkdown("**bold** and *soft* and `code`")).toBe(
      "<strong>bold</strong> and <em>soft</em> and <code>code</code>",
    );
    expect(inlineMarkdown("see [the file](docs/PRIVACY.md)")).toBe(
      'see <a href="docs/PRIVACY.md">the file</a>',
    );
  });

  it("joins the wrapped lines of a paragraph and of a list item", () => {
    const { title, body } = renderMarkdown(
      "# Title\n\nOne sentence\nwrapped in the source.\n\n## Part\n\n- an item that\n  wraps too\n- a second item\n",
    );
    expect(title).toBe("Title");
    expect(body).toContain("<h1>Title</h1>");
    expect(body).toContain("<p>One sentence wrapped in the source.</p>");
    expect(body).toContain("<h2>Part</h2>");
    expect(body).toContain("<li>an item that wraps too</li>");
    expect(body).toContain("<li>a second item</li>");
    expect((body.match(/<ul>/g) ?? []).length).toBe(1);
    expect((body.match(/<\/ul>/g) ?? []).length).toBe(1);
  });

  for (const source of ["docs/PRIVACY.md", "docs/ACCESSIBILITY.md"]) {
    it(`loses no sentence of ${source}`, () => {
      const md = readFileSync(join(REPO, source), "utf8");
      const html = statementPage(md, "default-src 'none'", source);
      // Compare prose to prose: tags out, entities back, and angle brackets
      // dropped on BOTH sides (the statements quote `<textarea>` and `<meta>`,
      // which are markup on one side and words on the other).
      const plainOf = (s: string): string =>
        s
          .replace(/<[^>]+>/g, "") // inline tags carry no space of their own
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/[<>]/g, "")
          .replace(/\s+/gu, " ")
          .trim();
      const plain = plainOf(html);
      /** A source line as prose: no markers, no angle brackets, one space. */
      const sourceProse = (line: string): string =>
        line
          .replace(/^[#-]+\s*/, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[*`<>]/g, "")
          .replace(/\s+/gu, " ")
          .trim();
      for (const line of md.split("\n")) {
        const text = sourceProse(line);
        if (text.length < 12) continue;
        expect(plain, `missing from the published page: ${text.slice(0, 40)}`).toContain(text);
      }
      // Linked references must keep their destinations as well as their prose.
      for (const link of md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        expect(html).toContain(`href="${link[2]!.replace(/&/g, "&amp;")}"`);
      }
      // The reviewer needs the contact, the policy, and a way back to the page.
      expect(html).toContain("chirpwater.example");
      expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(html).toContain('<link rel="stylesheet" href="./doc.css" />');
      expect(html).toContain('<a class="back" href="./">');
      expect(html).not.toContain("<style");
    });
  }
});
