// Pieces the five result views share: the figure frame, the plot-settings popover, the one-line
// statistical summary, the paged pair table and the figure chooser.

import { createResource, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { Manifest, ManifestResult, RunRecord } from '../../lib/bridge-client.ts';
import {
  loadPopulationView,
  POPULATION_RESULT,
  type MatrixView,
  type PairRow,
  type PopulationResultKey,
} from '../../lib/population-results.ts';
import type { ResultSource } from '../../lib/results-load.ts';
import { PopButton } from '../QcParts.tsx';
import { PlotFrame } from '../results/PlotFrame.tsx';
import { Heatmap } from './charts.tsx';
import { exportGroups } from './exports.ts';
import {
  colorLimits,
  fmt,
  markMeaning,
  offDiagonalRowMeans,
  pageCount,
  pageOf,
  pairsCsv,
  resultScope,
  scaleKind,
  similarityLimits,
  stateOrder,
  type ScaleKind,
} from './logic.ts';
import { plotSettings, setPlotSettings } from './view-store.ts';

export interface ViewProps {
  src: ResultSource;
  manifest: Manifest;
  record: RunRecord;
}

/** The framework result of a method and the view read from its arrays. */
export function useView<T>(p: ViewProps, key: PopulationResultKey) {
  const [view] = createResource(
    () => [p.src, p.manifest, key] as const,
    ([src, manifest, k]) => loadPopulationView(src, manifest, k) as Promise<T | undefined>,
  );
  const meta = () => p.manifest.results.find((r) => r.name === POPULATION_RESULT[key]);
  return { view, meta };
}

export const recorded = (m: ManifestResult | undefined) =>
  (m?.shuffle ?? {}) as { alpha?: number; n_shuffles?: number; correction?: string; tail?: string };

/** A message in the figure area (loading, failed, nothing to show). */
export const Message = (p: { children: JSX.Element }) => <div class="cb-pn-msg">{p.children}</div>;

/** Local figure chooser inside a method's view. */
export function FigureTabs(p: {
  id: string;
  options: { id: string; label: string }[];
  fallback?: string;
}): JSX.Element {
  const current = () =>
    p.options.find((o) => o.id === plotSettings.figure[p.id])?.id ?? p.fallback ?? p.options[0].id;
  return (
    <div class="cb-seg cb-pn-tabs" role="tablist" aria-label="Figure">
      <For each={p.options}>
        {(o) => (
          <button
            type="button"
            role="tab"
            aria-selected={current() === o.id}
            classList={{ 'cb-seg__on': current() === o.id }}
            onClick={() => setPlotSettings('figure', p.id, o.id)}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  );
}
export const currentFigure = (id: string, options: { id: string }[]) =>
  options.find((o) => o.id === plotSettings.figure[id])?.id ?? options[0].id;

/** Button that opens the display controls. They never start a run. */
export function PlotSettings(p: { children: JSX.Element }): JSX.Element {
  return (
    <PopButton
      label="Plot settings"
      title="Plot settings"
      width={320}
      class="btn-secondary"
      button="Plot settings ▾"
    >
      <div class="cb-pn-ps">
        <p class="cb-muted">Display only. These never rerun the analysis.</p>
        {p.children}
      </div>
    </PopButton>
  );
}

export const Row = (p: { label: string; children: JSX.Element }) => (
  <label class="cb-pn-psrow">
    <span>{p.label}</span>
    {p.children}
  </label>
);

export function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="cb-as-check cb-pn-psrow">
      <input
        type="checkbox"
        checked={p.checked}
        onChange={(e) => p.onChange(e.currentTarget.checked)}
      />
      {p.label}
    </label>
  );
}

/** A figure in a PlotFrame, with the refs its exports need. */
export function Figure(p: {
  title: string;
  howTo: JSX.Element;
  view: ViewProps;
  resultName: string;
  csv: () => { header: string[]; rows: (string | number | null)[][] };
  file: string;
  settings?: JSX.Element;
  children: (refs: {
    svgRef: (el: SVGSVGElement) => void;
    canvasRef: (el: HTMLCanvasElement) => void;
    expanded: boolean;
  }) => JSX.Element;
}): JSX.Element {
  let svg: SVGSVGElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const plots = () => p.view.manifest.results.find((r) => r.name === p.resultName)?.plots ?? [];
  return (
    <PlotFrame
      title={p.title}
      howTo={p.howTo}
      controls={p.settings ? <PlotSettings>{p.settings}</PlotSettings> : undefined}
      exports={exportGroups({
        record: p.view.record,
        resultName: p.resultName,
        plots: plots(),
        svg: () => svg,
        canvases: () => (canvas ? [canvas] : []),
        csv: p.csv,
        file: `${p.file}_${p.view.record.run_id}`,
      })}
    >
      {(expanded) =>
        p.children({
          svgRef: (el) => (svg = el),
          canvasRef: (el) => (canvas = el),
          expanded,
        })
      }
    </PlotFrame>
  );
}

/** The visible statistical summary and, under "Statistical details", the full test description. */
export function Summary(p: {
  meta: ManifestResult | undefined;
  method: Parameters<typeof resultScope>[0];
  nStates: number;
  perState?: boolean;
  /** Full text from `significanceLabel`. */
  details: string;
  limits: string[];
}): JSX.Element {
  const r = () => recorded(p.meta);
  const tested = () => p.method !== 'pairwise';
  const corrected = () => !!r().correction && r().correction !== 'none';
  return (
    <div class="cb-pn-sum">
      <span>
        <b>{resultScope(p.method, r(), { nStates: p.nStates, perState: p.perState })}</b>
      </span>
      <Show when={tested()}>
        <span>alpha {r().alpha ?? '?'}</span>
        <span>{r().n_shuffles ?? '?'} shuffles</span>
        <span>{markMeaning(r().alpha, corrected())}</span>
      </Show>
      <span>Single session</span>
      <For each={p.limits}>{(t) => <span class="cb-pn-limit">{t}</span>}</For>
      <PopButton
        label="Statistical details"
        title="Statistical details"
        width={440}
        class="cb-link"
        button="Statistical details"
      >
        <p>{p.details}</p>
        <Show when={tested()}>
          <p class="cb-muted">
            The p-value is the share of shuffled sessions (each cell's events shifted in time by a
            different amount, keeping the state labels) whose value is at least as extreme as the
            observed one, counting the observed value itself. The null range is the middle 95% of
            the shuffled values.
          </p>
        </Show>
      </PopButton>
    </div>
  );
}

/**
 * How many table rows fit the box that `ref` is set on, so a long table is paged instead of
 * scrolling inside its box.
 */
export function useFittingRows(rowPx = 28, headPx = 34) {
  const [rows, setRows] = createSignal(8);
  const ref = (el: HTMLElement) => {
    const ro = new ResizeObserver(([e]) =>
      setRows(Math.max(3, Math.floor((e.contentRect.height - headPx) / rowPx))),
    );
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  };
  return [rows, ref] as const;
}

/** Rows of state pairs, a page at a time as many as fit the box. */
export function PairsTable(p: { pairs: PairRow[]; alpha?: number | null }): JSX.Element {
  const [page, setPage] = createSignal(0);
  const [perPage, fitRef] = useFittingRows();
  const rows = () => pageOf(p.pairs, page(), perPage());
  return (
    <div class="cb-pn-tablebox">
      <div class="cb-pn-tablescroll" ref={fitRef}>
        <table class="cb-auroc-table cb-as-tbl">
          <thead>
            <tr>
              <th>State A</th>
              <th>State B</th>
              <th class="cb-as-num">Value</th>
              <th class="cb-as-num">Null range</th>
              <th class="cb-as-num">p (uncorrected)</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(r) => (
                <tr>
                  <td class="cb-pn-trunc" title={r.a}>
                    {r.a}
                  </td>
                  <td class="cb-pn-trunc" title={r.b}>
                    {r.b}
                  </td>
                  <td class="cb-as-num">{fmt(r.value, 3)}</td>
                  <td class="cb-as-num">
                    {r.nullLo == null ? '–' : `${fmt(r.nullLo, 3)} to ${fmt(r.nullHi, 3)}`}
                  </td>
                  <td class="cb-as-num">
                    {fmt(r.p, 3)}
                    {r.p != null && p.alpha != null && r.p <= p.alpha ? ' *' : ''}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={pageCount(p.pairs.length, perPage()) > 1}>
        <div class="cb-pn-pager">
          <button class="btn-secondary" disabled={page() === 0} onClick={() => setPage(page() - 1)}>
            Previous
          </button>
          <span class="cb-muted">
            Page {Math.min(page(), pageCount(p.pairs.length, perPage()) - 1) + 1} of{' '}
            {pageCount(p.pairs.length, perPage())} · {p.pairs.length} pairs
          </span>
          <button
            class="btn-secondary"
            disabled={page() >= pageCount(p.pairs.length, perPage()) - 1}
            onClick={() => setPage(page() + 1)}
          >
            Next
          </button>
        </div>
      </Show>
    </div>
  );
}

/** Matrix figure shared by population vector similarity and state separation. */
export function MatrixFigure(p: {
  view: MatrixView;
  props: ViewProps;
  resultName: string;
  title: string;
  howTo: JSX.Element;
  scaleTitle: string;
  /** Cosine or Pearson for similarity; omit for distances (start at 0). */
  similarity?: string;
  alpha?: number | null;
  file: string;
}): JSX.Element {
  const kind = (): ScaleKind => (p.similarity ? scaleKind(p.similarity) : 'sequential');
  const n = () => p.view.states.length;
  const limits = () =>
    colorLimits(kind(), {
      values: p.view.values.data,
      natural: p.similarity ? similarityLimits(p.similarity) : undefined,
      fixed:
        plotSettings.limits === 'fixed'
          ? { lo: plotSettings.fixedLo, hi: plotSettings.fixedHi }
          : undefined,
    });
  const order = () =>
    stateOrder(p.view.states, plotSettings.order, offDiagonalRowMeans(p.view.values.data, n()));
  const pOf = (a: number, b: number) => {
    const row = p.view.pairs.find(
      (r) =>
        (r.a === p.view.states[a] && r.b === p.view.states[b]) ||
        (r.a === p.view.states[b] && r.b === p.view.states[a]),
    );
    return row?.p ?? null;
  };
  const pairIndex = new Map<string, number | null>();
  const significant = (a: number, b: number) => {
    if (a === b || p.alpha == null) return false;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!pairIndex.has(key)) pairIndex.set(key, pOf(a, b));
    const v = pairIndex.get(key);
    return v != null && v <= p.alpha;
  };
  return (
    <Figure
      title={p.title}
      howTo={p.howTo}
      view={p.props}
      resultName={p.resultName}
      file={p.file}
      csv={() => {
        const c = pairsCsv(p.view.pairs);
        return c;
      }}
      settings={<MatrixSettings />}
    >
      {(r) => (
        <Heatmap
          label={p.title}
          svgRef={r.svgRef}
          canvasRef={r.canvasRef}
          labels={p.view.states}
          values={p.view.values.data}
          order={order()}
          kind={kind()}
          limits={limits()}
          showValues={plotSettings.values}
          mark={significant}
          scaleTitle={p.scaleTitle}
          tip={(a, b) => {
            const row = p.view.pairs.find(
              (x) =>
                (x.a === p.view.states[a] && x.b === p.view.states[b]) ||
                (x.a === p.view.states[b] && x.b === p.view.states[a]),
            );
            return `${p.view.states[a]} and ${p.view.states[b]}: ${fmt(p.view.values.data[a * n() + b], 3)}${row ? `; null range ${fmt(row.nullLo)} to ${fmt(row.nullHi)}; p ${fmt(row.p)}` : ''}`;
          }}
        />
      )}
    </Figure>
  );
}

/** Controls for the heatmaps. */
export function MatrixSettings(p: { cells?: boolean }): JSX.Element {
  return (
    <>
      <Show when={!p.cells}>
        <Check
          label="Show values in cells"
          checked={plotSettings.values}
          onChange={(v) => setPlotSettings('values', v)}
        />
        <Row label="State order">
          <select
            value={plotSettings.order}
            onChange={(e) =>
              setPlotSettings('order', e.currentTarget.value as 'listed' | 'name' | 'mean')
            }
          >
            <option value="listed">As listed</option>
            <option value="name">By name</option>
            <option value="mean">By mean value, highest first</option>
          </select>
        </Row>
      </Show>
      <Row label="Color limits">
        <select
          value={plotSettings.limits}
          onChange={(e) => setPlotSettings('limits', e.currentTarget.value as 'auto' | 'fixed')}
        >
          <option value="auto">Automatic</option>
          <option value="fixed">Fixed</option>
        </select>
      </Row>
      <Show when={plotSettings.limits === 'fixed'}>
        <div class="cb-controls">
          <label>
            Low
            <input
              type="number"
              step="0.1"
              value={plotSettings.fixedLo}
              onInput={(e) =>
                Number.isFinite(+e.currentTarget.value) &&
                setPlotSettings('fixedLo', +e.currentTarget.value)
              }
            />
          </label>
          <label>
            High
            <input
              type="number"
              step="0.1"
              value={plotSettings.fixedHi}
              onInput={(e) =>
                Number.isFinite(+e.currentTarget.value) &&
                setPlotSettings('fixedHi', +e.currentTarget.value)
              }
            />
          </label>
        </div>
      </Show>
    </>
  );
}
