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

  build(): void {
    const t = mirrorText(this.getText());
    const lpp = linesPerPage(lineHeightOf(this.mirror));
    const slices = pageSlices(t, lineStarts(this.mirror, t), lpp);
    const frag = document.createDocumentFragment();
    for (const s of slices) {
      const sec = document.createElement("section");
      sec.className = "page";
      const pre = document.createElement("pre");
      pre.className = "tp-text";
      pre.textContent = s;
      sec.appendChild(pre);
      frag.appendChild(sec);
    }
    this.host.replaceChildren(frag);
    this.fresh = true;
  }

  schedule(): void {
    this.fresh = false;
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.build(), 300);
  }

  buildIfStale(): void {
    if (!this.fresh) this.build();
  }
}
