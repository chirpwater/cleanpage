/**
 * The printed document (DESIGN §6).
 *
 * Do NOT print the live textarea. A textarea whose height is constrained does
 * not fragment: a 95-line document in a 960 px-tall field produced a 1-page
 * PDF and lines 31-95 were clipped and lost. An auto-grown textarea does
 * happen to fragment correctly in Chromium today, but the requirement is not
 * bet on that: constructed slices are the only strategy measured invariant to
 * the print dialog (margins, paper size, and print scale 0.8 / 1.0 / 1.25).
 *
 * Nobody may "simplify" the mirror away.
 */
import { lineHeightOf, linesPerPage, mirrorText } from "./metrics.js";
import { lineStarts, pageSlices } from "./paginate.js";

export class PrintDoc {
  private fresh = false;
  private idle = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly mirror: HTMLPreElement,
    private readonly getText: () => string,
  ) {}

  /** One <section class="page"> per 30 visual lines, each forced onto its own sheet. */
  build(): void {
    const t = mirrorText(this.getText());
    // Measured from the mirror, not from LINES_PER_PAGE: a user stylesheet
    // that changes the line height must move the printed page cuts with it, or
    // the paper stops being the pages the student saw.
    const lpp = linesPerPage(lineHeightOf(this.mirror));
    const slices = pageSlices(t, lineStarts(this.mirror, t), lpp);
    const frag = document.createDocumentFragment();
    for (const s of slices) {
      const sec = document.createElement("section");
      sec.className = "page";
      const pre = document.createElement("pre");
      pre.className = "tp-text";
      // NOT mirrorText(s): the hanging space is applied once, to the whole
      // document, before slicing. A non-final slice ends with the "\n" that
      // terminates its 30th line, and that newline's line box belongs to the
      // FIRST line of the next page, not to a 31st line of this one. Applying
      // the fix-up per slice adds a spurious line box and the page then spills
      // onto an extra sheet (measured: a 5-page corpus printed as 7).
      pre.textContent = s;
      sec.appendChild(pre);
      frag.appendChild(sec);
    }
    this.host.replaceChildren(frag);
    this.fresh = true;
  }

  /** Rebuild 300 ms after typing stops, so `beforeprint` has nothing to compute. */
  schedule(): void {
    this.fresh = false;
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.build(), 300);
  }

  buildIfStale(): void {
    if (!this.fresh) this.build();
  }
}
