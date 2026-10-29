// Figure and data exports (plan D-37). SVG views are serialized with their computed styles
// inlined, so text stays text; canvas layers are embedded as PNG images; PNG is drawn at 2x.

const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
];

/** Copy the computed values of the style properties onto each element so the file stands alone. */
function inlineStyles(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const style = STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';');
  target.setAttribute('style', `${target.getAttribute('style') ?? ''};${style}`);
  [...source.children].forEach((child, i) => inlineStyles(child, target.children[i]));
}

export interface FigureOptions {
  /** Canvas layers drawn behind the SVG (heatmaps): name -> canvas. Placed by their bounding box. */
  canvases?: HTMLCanvasElement[];
  background?: string;
}

/** The view as a stand-alone SVG document. Canvas layers become `<image>` elements. */
export function serializeSvg(svg: SVGSVGElement, o: FigureOptions = {}): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  // A canvas inside the SVG is re-added below as an image; its foreign-object wrapper is not portable.
  clone.querySelectorAll('foreignObject').forEach((el) => el.remove());
  const box = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(box.width));
  clone.setAttribute('height', String(box.height));
  if (!clone.getAttribute('viewBox'))
    clone.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  if (o.background) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of Object.entries({
      x: '0',
      y: '0',
      width: '100%',
      height: '100%',
      fill: o.background,
    }))
      rect.setAttribute(k, v);
    clone.insertBefore(rect, clone.firstChild);
  }
  const layers: SVGImageElement[] = [];
  for (const canvas of o.canvases ?? []) {
    const r = canvas.getBoundingClientRect();
    const image = document.createElementNS(SVG_NS, 'image');
    for (const [k, v] of Object.entries({
      x: String(r.left - box.left),
      y: String(r.top - box.top),
      width: String(r.width),
      height: String(r.height),
    }))
      image.setAttribute(k, v);
    image.setAttribute('href', canvas.toDataURL('image/png'));
    layers.push(image);
  }
  // canvas layers sit under the vector marks (axes, labels, markers)
  const anchor = clone.firstChild;
  for (const image of layers) clone.insertBefore(image, anchor);
  return new XMLSerializer().serializeToString(clone);
}

export function download(name: string, data: Blob | string, type = 'text/plain'): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

/** Rasterize an SVG document at `scale` x its size (2 = twice the device pixels of the screen view). */
export async function svgToPng(
  svgText: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The figure could not be drawn as an image.'));
      image.src = url;
    });
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** CSV text from rows; the first lines may carry notes (such as "Preliminary: 50 shuffles"). */
export function toCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
  notes: string[] = [],
): string {
  const cell = (v: string | number | null | undefined) => {
    const t = v == null ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return (
    [
      ...notes.map((n) => `# ${n}`),
      header.map(cell).join(','),
      ...rows.map((r) => r.map(cell).join(',')),
    ].join('\n') + '\n'
  );
}

/** Note lines every exported file of a run carries. */
export const exportNotes = (r: { scope: string; analysis: string; run_id: string }) => [
  `run ${r.run_id} (${r.analysis})`,
  ...(r.scope === 'preview' ? ['Preliminary: quick preview with 50 shuffles'] : []),
];
