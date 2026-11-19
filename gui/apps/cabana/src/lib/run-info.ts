// Run information: the key rows beside a result and the sections of the full window. Pure
// functions of the saved record (and, for outputs, what the project reports); nothing here
// computes a result, and a value the record does not hold is left out.

import type { RunRecord } from './bridge-client.ts';
import { executedShuffles, runType } from './preview.ts';
import { cellsOf, signalOf } from './results-runs.ts';
import { analysisSection, dataVersion, processingSection } from './run-settings-view.ts';

export interface InfoRow {
  k: string;
  v: string;
  /** Explains the value, shown as a tooltip. */
  tip?: string;
}
export interface InfoSection {
  title: string;
  rows: InfoRow[];
}

const LABELS: Record<string, string> = {
  binCm: 'Bin size (cm)',
  sigma: 'Smoothing width (bins)',
  sigmaAuto: 'Smoothing',
  nShuffles: 'Shuffles',
  shuffles: 'Shuffles',
  seed: 'Seed',
  alpha: 'Significance (α)',
  minOccS: 'Minimum occupancy (s per bin)',
  minOccFieldsS: 'Minimum occupancy for fields (s per bin)',
  fieldThreshold: 'Field threshold',
  minFieldBins: 'Minimum field bins',
  shiftAuto: 'Circular shift',
  minShiftS: 'Minimum circular shift (s)',
  minSpeed: 'Minimum speed (cm/s)',
  speedFilter: 'Speed filter',
  eventSigmaS: 'Event smoothing, σ (s)',
  maxGapS: 'Longest gap kept (s)',
  fillGapS: 'Gap filled up to (s)',
  posMethod: 'Position smoothing',
  posWindowS: 'Position window (s)',
  speedWindowS: 'Speed window (s)',
  settingsVersion: '',
};

const humanize = (key: string) => {
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const labelOf = (key: string) => LABELS[key] ?? humanize(key);

const count = (n: number) => n.toLocaleString('en-US');

function valueText(key: string, v: unknown): string {
  if (typeof v === 'boolean')
    return key.endsWith('Auto') ? (v ? 'automatic' : 'set by hand') : v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.replace(/_/g, ' ');
  if (Array.isArray(v)) return v.length > 6 ? `${v.length} items` : v.join(', ') || 'none';
  return JSON.stringify(v);
}

/** Scalar entries of a settings section as rows; nested objects one level down, empty sections none. */
export function settingRows(section: Record<string, unknown> | undefined): InfoRow[] {
  const rows: InfoRow[] = [];
  for (const [k, v] of Object.entries(section ?? {})) {
    if (LABELS[k] === '' || v === undefined || v === null) continue;
    if (v && typeof v === 'object' && !Array.isArray(v))
      rows.push(
        ...settingRows(v as Record<string, unknown>).map((r) => ({
          ...r,
          k: `${labelOf(k)}: ${r.k.toLowerCase()}`,
        })),
      );
    else rows.push({ k: labelOf(k), v: valueText(k, v) });
  }
  return rows;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const row = (k: string, v: string | undefined): InfoRow[] => (v === undefined ? [] : [{ k, v }]);

const SIGNAL_TEXT: Record<string, string> = {
  events: 'Deconvolved events',
  denoised: 'Denoised trace',
  raw: 'Raw trace',
};

/** How the run's null was built, in words, with the count; undefined when the run had no shuffles. */
export function shuffleText(r: RunRecord): string | undefined {
  const s = analysisSection(r);
  const n = executedShuffles(r);
  if (n === undefined || (r.analysis === 'peth' && s.test === 'none')) return undefined;
  const how = s.method === 'speed' ? 'speed-matched shuffles' : 'circular shifts';
  return `${count(n)} ${how}`;
}

type RowMaker = (s: Record<string, unknown>) => InfoRow[];
const alphaRow: RowMaker = (s) =>
  row('Significance (α)', num(s.alpha) === undefined ? undefined : String(s.alpha));

/** The three settings that say most about a run of each analysis. */
const SPECIFIC: Record<string, RowMaker> = {
  place: (s) => [
    ...row('Bin size', num(s.binCm) === undefined ? undefined : `${s.binCm} cm`),
    ...row(
      'Smoothing',
      s.sigmaAuto === true
        ? 'Gaussian, automatic width'
        : num(s.sigma) === undefined
          ? undefined
          : `Gaussian, σ ${s.sigma} bin`,
    ),
    ...alphaRow(s),
  ],
  auroc: (s) => [
    ...row(
      'Comparison',
      s.compare === 'behavior' && s.pairA && s.pairB
        ? `${s.pairA} vs ${s.pairB}`
        : s.compare
          ? 'each behavior vs other frames'
          : undefined,
    ),
    ...row('Correction', str(s.correction)?.replace(/_/g, ' ')),
    ...alphaRow(s),
  ],
  peth: (s) => {
    const p = (s.params ?? {}) as Record<string, unknown>;
    const win = (v: unknown) =>
      Array.isArray(v) && v.length === 2 ? `${v[0]} to ${v[1]} s` : undefined;
    return [
      ...row('Aligned to', str(s.align) ? `${s.align}s` : undefined),
      ...row('Baseline window', win(p.baselineS)),
      ...row('Response window', win(p.responseS)),
    ];
  },
  decoding: (s) => [
    ...row('Target', str(s.type)),
    ...row('Decoder', str(s.decoder)),
    ...alphaRow(s),
  ],
  population: (s) => [
    ...row('Target', str(s.target)),
    ...row('Time bin', num(s.binS) === undefined ? undefined : `${s.binS} s`),
    ...alphaRow(s),
  ],
};

/** The key rows of the Run information card: type, shuffles, signal, three settings, data version. */
export function keyRows(r: RunRecord): InfoRow[] {
  const s = analysisSection(r);
  return [
    { k: 'Run type', v: runType(r).kind === 'preview' ? 'Preview' : 'Full analysis' },
    ...row('Shuffles', shuffleText(r)),
    { k: 'Signal', v: SIGNAL_TEXT[signalOf(r)] ?? signalOf(r) },
    ...(SPECIFIC[r.analysis]?.(s) ?? []).slice(0, 3),
    { k: 'Data version', v: dataVersion(r) },
  ];
}

/** "1 min 42 s": the time from the run being queued to its end, so it includes waiting. */
export function timeToFinish(r: RunRecord): string | undefined {
  if (!r.finished_utc) return undefined;
  const s = Math.round((Date.parse(r.finished_utc) - Date.parse(r.created_utc)) / 1000);
  if (!Number.isFinite(s) || s < 0) return undefined;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export interface InfoContext {
  /** Settings status words and, for a run that needs a rerun, why. */
  status: { text: string; reason?: string };
  started: string;
  /** Bytes of the run in the project's storage report; undefined without a saved project. */
  bytes?: number;
  sizeText: (bytes: number) => string;
  tables?: number;
  figures?: number;
  /** The run has frozen settings files (made with a project open); undefined while unknown. */
  frozen?: boolean;
}

const FROZEN = 'experiment, processing, analysis (frozen with the run)';

/** The four sections of the full run information window. */
export function infoSections(r: RunRecord, c: InfoContext): InfoSection[] {
  const prep = processingSection(r);
  const framework = r.engine === 'framework';
  const fw = r.framework;
  return [
    { title: 'analysis parameters', rows: settingRows(analysisSection(r)) },
    {
      title: 'data and processing',
      rows: [
        { k: 'Data version', v: dataVersion(r) },
        { k: 'Cells', v: `${cellsOf(r)}${cellsOf(r) === 'all' ? '' : ' (rejected at run time)'}` },
        ...(prep
          ? settingRows(prep)
          : [
              {
                k: 'Processing',
                v: 'not recorded (browser-engine runs keep the analysis settings only)',
              },
            ]),
      ],
    },
    {
      title: 'run',
      rows: [
        { k: 'Run type', v: runType(r).text },
        { k: 'Settings', v: c.status.text, tip: c.status.reason },
        ...(c.status.reason ? [{ k: 'Why', v: c.status.reason }] : []),
        { k: 'Started', v: c.started },
        ...row('Time to finish (includes waiting)', timeToFinish(r)),
        {
          k: 'Engine',
          v: framework
            ? `Python engine · CaBaNA ${fw?.cabana_version ?? 'version unknown'}${fw?.commit ? ` · commit ${fw.commit.slice(0, 7)}` : ''}`
            : 'Browser engine',
        },
        { k: 'Run ID', v: r.run_id },
      ],
    },
    {
      title: 'outputs',
      rows: [
        c.bytes === undefined
          ? { k: 'Size', v: '—', tip: 'Sizes need a saved project' }
          : { k: 'Size', v: c.sizeText(c.bytes) },
        ...row('Tables', c.tables === undefined ? undefined : String(c.tables)),
        ...row('Figures', c.figures === undefined ? undefined : String(c.figures)),
        {
          k: 'Settings files',
          v:
            framework && c.frozen
              ? FROZEN
              : framework && c.frozen === false
                ? 'none: made with no project open; settings kept in the run record'
                : 'settings kept in the run record',
        },
        { k: 'Folder', v: framework || r.files?.length ? `runs/${r.run_id}/` : '—' },
      ],
    },
  ];
}
