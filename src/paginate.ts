import { LINES_PER_PAGE, lineHeightOf } from "./metrics.js";

const cache = new Map<string, number[]>();

export function clearCache(): void {
  cache.clear();
}

function measurePara(mirror: HTMLPreElement, para: string, lineH: number): number[] {
  const t = para.length ? para : " ";
  mirror.textContent = t;
  const node = mirror.firstChild as Text;
  const r = document.createRange();
  r.setStart(node, 0);
  r.setEnd(node, t.length);

  const tops: number[] = [];
  for (const rect of Array.from(r.getClientRects())) {
    const top = Math.round(rect.top * 64) / 64;
    if (!tops.length || top > tops[tops.length - 1] + lineH / 2) tops.push(top);
  }
  if (tops.length <= 1) return [0];

  const topOf = (i: number): number | null => {
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    const rs = r.getClientRects();
    return rs.length ? Math.round(rs[rs.length - 1].top * 64) / 64 : null;
  };

  const starts = [0];
  let lo = 1;
  for (let k = 1; k < tops.length; k++) {
    let a = lo;
    let b = t.length - 1;
    let ans: number | null = null;
    while (a <= b) {
      const m = (a + b) >> 1;
      const tp = topOf(m);
      if (tp === null) {
        a = m + 1;
        continue;
      }
      if (tp >= tops[k] - 0.5) {
        ans = m;
        b = m - 1;
      } else {
        a = m + 1;
      }
    }
    if (ans === null) break;
    starts.push(ans);
    lo = ans + 1;
  }
  return starts;
}

export function lineStarts(mirror: HTMLPreElement, text: string): number[] {
  const out: number[] = [];
  const lineH = lineHeightOf(mirror);
  let base = 0;
  for (const para of text.split("\n")) {
    let rel = cache.get(para);
    if (!rel) {
      rel = measurePara(mirror, para, lineH);
      cache.set(para, rel);
      if (cache.size > 4000) cache.delete(cache.keys().next().value as string);
    }
    for (const s of rel) out.push(base + s);
    base += para.length + 1;
  }
  return out;
}

export const pagesOf = (starts: number[], lpp: number = LINES_PER_PAGE): number =>
  Math.max(1, Math.ceil(starts.length / lpp));

export function pageSlices(text: string, starts: number[], lpp: number = LINES_PER_PAGE): string[] {
  const out: string[] = [];
  for (let p = 0, n = pagesOf(starts, lpp); p < n; p++) {
    const a = starts[p * lpp];
    const bi = (p + 1) * lpp;
    out.push(text.slice(a, bi < starts.length ? starts[bi] : text.length));
  }
  return out;
}
