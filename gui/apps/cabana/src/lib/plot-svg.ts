// Draws a plot spec (lib/plot-spec.ts) as standalone SVG text: vector marks, text kept as text,
// styles written inline. The same string is shown in the Plot editor and exported, so what is
// exported is what was seen. Draws only from the spec; it computes no statistics.

import type { HistogramData, LineData, PlotSpec } from './plot-spec.ts';

/** About `n` round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(+v.toPrecision(12));
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => +v.toFixed(2);
const tickText = (v: number) => String(+v.toPrecision(6));

/** The data's own x and y extent, before the display range is applied. */
export function dataExtent(d: HistogramData | LineData): {
  x: [number, number];
  y: [number, number];
} {
  if (d.type === 'histogram') {
    const xs = [d.edges[0], d.edges[d.edges.length - 1], ...d.markers.map((m) => m.x)];
    return { x: [Math.min(...xs), Math.max(...xs)], y: [0, Math.max(1, ...d.counts)] };
  }
  const ys = d.series
    .flatMap((s) => [...s.y, ...(s.lo ?? []), ...(s.hi ?? [])])
    .filter(Number.isFinite);
  return {
    x: [Math.min(...d.x), Math.max(...d.x)],
    y: ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1],
  };
}

export function renderSvg(spec: PlotSpec): string {
  const { style: st, display: dp, data: d } = spec;
  const ext = dataExtent(d);
  const x0 = dp.xMin ?? ext.x[0];
  const x1 = dp.xMax ?? ext.x[1];
  const pad = d.type === 'line' ? 0.05 * (ext.y[1] - ext.y[0] || 1) : 0;
  const y0 = dp.yMin ?? ext.y[0] - pad;
  const y1 = dp.yMax ?? ext.y[1] + (d.type === 'histogram' ? 0.05 * ext.y[1] : pad);
  const f = st.fontSize;
  const m = { l: 3.5 * f + 10, r: 12, t: st.title ? 2 * f + 8 : 10, b: 2.6 * f + 12 };
  const pw = Math.max(10, st.width - m.l - m.r);
  const ph = Math.max(10, st.height - m.t - m.b);
  const sx = (v: number) => num(m.l + ((v - x0) / (x1 - x0 || 1)) * pw);
  const sy = (v: number) => num(m.t + ph - ((v - y0) / (y1 - y0 || 1)) * ph);
  const font = `font-family="Helvetica, Arial, sans-serif" font-size="${f}"`;
  const parts: string[] = [];
  const clip = `<clipPath id="plot-area"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath>`;

  const xt = niceTicks(x0, x1);
  const yt = niceTicks(y0, y1, 4);
  if (st.showGrid)
    for (const v of yt)
      parts.push(
        `<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e5e5e5"/>`,
      );

  const marks: string[] = [];
  const color = (i: number) => st.colors[i % st.colors.length];
  if (d.type === 'histogram') {
    if (d.band)
      marks.push(
        `<rect x="${sx(d.band.lo)}" y="${m.t}" width="${num(sx(d.band.hi) - sx(d.band.lo))}" height="${ph}" fill="#000" fill-opacity="0.06" stroke="#777" stroke-dasharray="4 3"/>`,
      );
    d.counts.forEach((c, i) => {
      const a = sx(d.edges[i]);
      const b = sx(d.edges[i + 1]);
      marks.push(
        `<rect x="${a}" y="${sy(c)}" width="${num(Math.max(0, b - a - 0.5))}" height="${num(sy(y0) - sy(c))}" fill="${color(0)}" fill-opacity="0.75"/>`,
      );
    });
  } else {
    d.spans.forEach((s) =>
      marks.push(
        `<rect x="${sx(s.from)}" y="${m.t}" width="${num(sx(s.to) - sx(s.from))}" height="${ph}" fill="#000" fill-opacity="0.05"/>`,
      ),
    );
    d.series.forEach((s, i) => {
      if (s.lo && s.hi) {
        const up = d.x.map((x, j) => `${sx(x)},${sy(s.hi![j])}`);
        const down = d.x.map((x, j) => `${sx(x)},${sy(s.lo![j])}`).reverse();
        marks.push(
          `<polygon points="${[...up, ...down].join(' ')}" fill="${color(i)}" fill-opacity="0.18"/>`,
        );
      }
      const pts = d.x.map((x, j) => `${sx(x)},${sy(s.y[j])}`).join(' ');
      marks.push(
        `<polyline points="${pts}" fill="none" stroke="${color(i)}" stroke-width="${st.lineWidth}"/>`,
      );
    });
  }
  for (const mk of d.markers)
    marks.push(
      `<line x1="${sx(mk.x)}" x2="${sx(mk.x)}" y1="${m.t}" y2="${m.t + ph}" stroke="#d62728" stroke-width="${st.lineWidth}"/>`,
    );
  parts.push(`<g clip-path="url(#plot-area)">${marks.join('')}</g>`);

  // axes
  parts.push(
    `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="#333"/>`,
    `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="#333"/>`,
  );
  for (const v of xt)
    parts.push(
      `<line x1="${sx(v)}" x2="${sx(v)}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="#333"/>`,
      `<text x="${sx(v)}" y="${m.t + ph + f + 4}" text-anchor="middle" ${font} fill="#333">${tickText(v)}</text>`,
    );
  for (const v of yt)
    parts.push(
      `<line x1="${m.l - 4}" x2="${m.l}" y1="${sy(v)}" y2="${sy(v)}" stroke="#333"/>`,
      `<text x="${m.l - 6}" y="${num(sy(v) + f / 3)}" text-anchor="end" ${font} fill="#333">${tickText(v)}</text>`,
    );
  parts.push(
    `<text x="${num(m.l + pw / 2)}" y="${st.height - 6}" text-anchor="middle" ${font} fill="#111">${esc(spec.axes.x)}</text>`,
    `<text transform="translate(${f + 2},${num(m.t + ph / 2)}) rotate(-90)" text-anchor="middle" ${font} fill="#111">${esc(spec.axes.y)}</text>`,
  );
  if (st.title)
    parts.push(
      `<text x="${num(m.l + pw / 2)}" y="${f + 6}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${num(f * 1.15)}" font-weight="600" fill="#111">${esc(st.title)}</text>`,
    );
  if (st.showLegend) parts.push(legend(spec, m.l + pw - 4, m.t + 4, font, color));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${st.width}" height="${st.height}" viewBox="0 0 ${st.width} ${st.height}">` +
    `<defs>${clip}</defs><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
  );
}

/** Legend entries in the top-right corner: series, markers and the band, each with its label. */
function legend(
  spec: PlotSpec,
  right: number,
  top: number,
  font: string,
  color: (i: number) => string,
): string {
  const d = spec.data;
  const f = spec.style.fontSize;
  const items: { label: string; swatch: string }[] = [];
  const line = (c: string, dash = '') =>
    `<line x1="0" x2="14" y1="0" y2="0" stroke="${c}" stroke-width="2"${dash}/>`;
  if (d.type === 'histogram') {
    items.push({
      label: 'Count',
      swatch: `<rect x="0" y="-4" width="14" height="8" fill="${color(0)}" fill-opacity="0.75"/>`,
    });
    if (d.band)
      items.push({
        label: d.band.label,
        swatch: `<rect x="0" y="-4" width="14" height="8" fill="#000" fill-opacity="0.06" stroke="#777" stroke-dasharray="4 3"/>`,
      });
  } else d.series.forEach((s, i) => items.push({ label: s.label, swatch: line(color(i)) }));
  d.markers.forEach((mk) => items.push({ label: mk.label, swatch: line('#d62728') }));
  return items
    .map(
      (it, i) =>
        `<g transform="translate(${right - 6 * f - 60},${top + (i + 0.6) * (f + 4)})">${it.swatch}<text x="18" y="${num(f / 3)}" ${font} fill="#333">${esc(it.label)}</text></g>`,
    )
    .join('');
}
