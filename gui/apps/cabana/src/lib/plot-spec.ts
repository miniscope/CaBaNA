// A plot as data, not as a picture: the saved numbers it shows, where they came from, and how
// it looks. The Plot editor (panels/results/PlotEditor.tsx) edits a copy of a spec and the
// renderer (lib/plot-svg.ts) draws it, so restyling never recomputes or alters a result.
// See outputs/claude/2026-11-04_results-architecture.md.

export const PLOT_SPEC_VERSION = 1;

export interface Source {
  analysis: 'place' | 'auroc' | 'peth' | 'decoding' | 'population';
  /** The saved run, when there is one; browser runs made in this session have none. */
  runId?: string;
  engine: string;
  /** What the plot shows, in words ("auROC null, cell 12, investigate_partner"). */
  label: string;
  /** Run settings the numbers depend on, as recorded with the run. Read only. */
  settings: Record<string, string | number | boolean>;
  /** "Preliminary: 50 shuffles" for a Quick preview. */
  preliminary?: string;
}

export interface HistogramData {
  type: 'histogram';
  edges: number[];
  counts: number[];
  /** Vertical lines at saved values (the observed statistic, say). */
  markers: { x: number; label: string }[];
  /** A shaded interval with its label (the central part of the null, say). */
  band?: { lo: number; hi: number; label: string };
}

export interface LineData {
  type: 'line';
  x: number[];
  series: { label: string; y: number[]; lo?: number[]; hi?: number[] }[];
  /** Vertical reference lines (time zero, say). */
  markers: { x: number; label: string }[];
  /** Shaded x intervals (baseline and response windows, say). */
  spans: { from: number; to: number; label: string }[];
}

export interface PlotSpec {
  version: typeof PLOT_SPEC_VERSION;
  source: Source;
  data: HistogramData | LineData;
  axes: { x: string; y: string };
  /** Changes how the saved numbers are shown, never the numbers. */
  display: { xMin?: number; xMax?: number; yMin?: number; yMax?: number };
  /** Appearance only. */
  style: {
    title: string;
    width: number;
    height: number;
    fontSize: number;
    lineWidth: number;
    colors: string[];
    showLegend: boolean;
    showGrid: boolean;
  };
}

export type ChangeClass = 'cosmetic' | 'display' | 'analytical';

/**
 * How a change to a spec field is classed: style is cosmetic, display changes what part of the
 * saved numbers is shown, and anything else (the data, the source and its settings) is analytical
 * and needs a rerun of the analysis, never an edit here.
 */
export function classifyChange(path: string): ChangeClass {
  if (path.startsWith('style.') || path.startsWith('axes.')) return 'cosmetic';
  if (path.startsWith('display.')) return 'display';
  return 'analytical';
}

export const CHANGE_TEXT: Record<ChangeClass, string> = {
  cosmetic: 'Cosmetic: appearance only.',
  display: 'Display: changes which part of the saved numbers is shown, not the numbers.',
  analytical:
    'Analytical: changes the result itself. Change it in the analysis settings and run again.',
};

export const DEFAULT_STYLE: PlotSpec['style'] = {
  title: '',
  width: 480,
  height: 300,
  fontSize: 12,
  lineWidth: 1.5,
  colors: ['#2171b5', '#e6550d', '#31a354', '#756bb1'],
  showLegend: true,
  showGrid: false,
};

/** The saved numbers of a spec as CSV, with the source written above them. */
export function specCsv(spec: PlotSpec): string {
  const head = [
    `# ${spec.source.label}`,
    `# analysis=${spec.source.analysis}; engine=${spec.source.engine}${spec.source.runId ? `; run=${spec.source.runId}` : ''}`,
    ...(spec.source.preliminary ? [`# ${spec.source.preliminary}`] : []),
    ...Object.entries(spec.source.settings).map(([k, v]) => `# ${k}=${v}`),
  ];
  const d = spec.data;
  if (d.type === 'histogram') {
    const rows = d.counts.map((c, i) => `${d.edges[i]},${d.edges[i + 1]},${c}`);
    return [...head, 'bin_start,bin_stop,count', ...rows].join('\n') + '\n';
  }
  const cols = d.series.flatMap((s) => [
    s.label,
    ...(s.lo ? [`${s.label} lower`, `${s.label} upper`] : []),
  ]);
  const rows = d.x.map((x, i) =>
    [x, ...d.series.flatMap((s) => [s.y[i], ...(s.lo ? [s.lo[i], s.hi![i]] : [])])].join(','),
  );
  return [...head, [spec.axes.x, ...cols].map(csvCell).join(','), ...rows].join('\n') + '\n';
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
