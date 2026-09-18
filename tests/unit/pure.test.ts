import { describe, expect, it } from "vitest";
import { LINES_PER_PAGE, PAGE_BODY_H, linesPerPage, mirrorText } from "../../src/metrics.js";
import { pageSlices, pagesOf } from "../../src/paginate.js";
import { downloadName, looksBinary, normaliseIncoming, suggestName } from "../../src/files.js";

describe("metrics", () => {
  it("the page body is a whole number of line boxes", () => {
    expect(PAGE_BODY_H % 32).toBe(0);
    expect(LINES_PER_PAGE).toBe(30);
  });

  it("derives the lines per page from the spacing actually in effect", () => {
    expect(linesPerPage(32)).toBe(LINES_PER_PAGE);
    expect(linesPerPage(32) * 32).toBe(PAGE_BODY_H);
    expect(linesPerPage(24)).toBe(40);
    expect(linesPerPage(40)).toBe(24);
    expect(linesPerPage(4000)).toBe(1);
  });

  it("adds a hanging space only for a trailing forced break", () => {
    expect(mirrorText("a")).toBe("a");
    expect(mirrorText("")).toBe("");
    expect(mirrorText("a\n")).toBe("a\n ");
    expect(mirrorText("a\n\n")).toBe("a\n\n ");
  });
});

describe("pagination arithmetic", () => {
  const starts = (n: number) => Array.from({ length: n }, (_, i) => i * 10);

  it("counts pages", () => {
    expect(pagesOf([0])).toBe(1);
    expect(pagesOf(starts(30))).toBe(1);
    expect(pagesOf(starts(31))).toBe(2);
    expect(pagesOf(starts(60))).toBe(2);
    expect(pagesOf(starts(61))).toBe(3);
  });

  it("counts and slices at whatever lines-per-page the spacing gives", () => {
    expect(pagesOf(starts(40), 40)).toBe(1);
    expect(pagesOf(starts(41), 40)).toBe(2);
    expect(pagesOf(starts(24), 24)).toBe(1);
    expect(pagesOf(starts(25), 24)).toBe(2);

    const text = "x".repeat(700);
    expect(pageSlices(text, starts(41), 40)[0]!.length).toBe(400);
    expect(pageSlices(text, starts(41), 40).join("")).toBe(text);
  });

  it("slices at visual line starts, losing nothing", () => {
    const text = "x".repeat(700);
    const s = starts(31);
    const slices = pageSlices(text, s);
    expect(slices).toHaveLength(2);
    expect(slices.join("")).toBe(text);
    expect(slices[0]!.length).toBe(300);
  });

  it("31 visual lines are 30 + 1, never 29 + 2", () => {
    const text = Array.from({ length: 31 }, (_, i) => `L${String(i + 1).padStart(3, "0")}`).join("\n");
    const s: number[] = [];
    let at = 0;
    for (const line of text.split("\n")) {
      s.push(at);
      at += line.length + 1;
    }
    const slices = pageSlices(text, s);
    expect(slices).toHaveLength(2);
    expect(slices[0]!.split("\n").filter(Boolean)).toHaveLength(30);
    expect(slices[1]!.trim()).toBe("L031");
  });
});

describe("file names and incoming text", () => {
  it("keeps chosen download names plain text and strips filesystem separators", () => {
    expect(downloadName("My story")).toBe("My story.txt");
    expect(downloadName("  My story.TXT  ")).toBe("My story.TXT");
    expect(downloadName("a/b\\c:story?.txt")).toBe("abcstory.txt");
    expect(downloadName("... ")).toBe("My writing.txt");
    expect(downloadName("My story.pdf")).toBe("My story.pdf.txt");
    expect(downloadName("x".repeat(250)).length).toBe(184);
  });

  it("names the file after the first line the child wrote", () => {
    expect(suggestName("There are very few good tragedies\nsome are idylls in dialogue")).toBe("There are very few good tragedies.txt");
    expect(suggestName("\n\n  \n  Hello there!  \n")).toBe("Hello there.txt");
    expect(suggestName("")).toBe("My writing.txt");
    expect(suggestName("!!!***")).toBe("My writing.txt");
    expect(suggestName("x".repeat(80))).toBe("x".repeat(40) + ".txt");
  });

  it("treats a tab in the first line as a separator, not as nothing", () => {
    // Tab types a real tab inside the writing area (DECISIONS 5.9), so a child
    // who tab-separates a title line hits this. It used to give "TidePool.txt".
    expect(suggestName("Tide\tPool\tStory")).toBe("Tide Pool Story.txt");
    expect(suggestName("\tIndented title")).toBe("Indented title.txt");
    // And removing a character between two spaces must not leave a double one.
    expect(suggestName("Cat \u2014 Dog")).toBe("Cat Dog.txt");
  });

  it("strips the BOM, normalises CRLF and lone CR, drops NULs", () => {
    expect(normaliseIncoming("﻿a\r\nb\rc\nd\0e")).toBe("a\nb\nc\nde");
  });

  it("refuses a file that is more than 1 % replacement characters", () => {
    expect(looksBinary("")).toBe(false);
    expect(looksBinary("plain writing, all of it")).toBe(false);
    expect(looksBinary("a".repeat(200) + "�")).toBe(false);
    expect(looksBinary("a".repeat(50) + "�".repeat(5))).toBe(true);
  });
});
