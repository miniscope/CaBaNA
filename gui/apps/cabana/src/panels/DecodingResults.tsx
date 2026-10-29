import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { bridge, decodeFloats, type Manifest, type RunRecord } from '../lib/bridge-client.ts';
import { hasCapability } from '../lib/bridge-status.ts';
import {
  loadBehaviorDecoding,
  loadPositionDecoding,
  type BehaviorDecodingView,
  type PositionDecodingView,
} from '../lib/decoding-results.ts';
import { foldBoundaries } from '../lib/fold-strip.ts';
import type { ResultSource } from '../lib/results-load.ts';
import { Help } from './QcParts.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton } from './QcParts.tsx';
import { plotExports } from './decoding/exports.ts';
import {
  behaviorCsv,
  behaviorRows,
  behaviorStats,
  binCells,
  confusionMatrix,
  errorHistogram,
  errorRange,
  fmt,
  fmtP,
  oneVsRestTables,
  positionCsv,
  positionStats,
  type BinCell,
  type Stat,
} from './decoding/model.ts';
import {
  BehaviorScorePlot,
  BinMap,
  ConfusionPlot,
  ErrorHistogramPlot,
  OneVsRestPlot,
  TrajectoryPlot,
  type TrajectoryData,
} from './decoding/Plots.tsx';
import { PlotFrame } from './results/PlotFrame.tsx';
import { RunBanner, type Match } from './results/RunBanner.tsx';
import { RunDetails } from './results/RunDetails.tsx';

export type DecodingSource = ResultSource & { offline?: () => boolean };

const Stats = (props: { stats: Stat[] }): JSX.Element => (
  <div class="cb-dec-summary">
    <For each={props.stats}>
      {(s) => (
        <div class="cb-dec-stat">
          <div class="cb-dec-stat__label">{s.label}</div>
          <div class="cb-dec-stat__value">{s.value}</div>
          <Show when={s.note}>
            <div class="cb-dec-stat__note cb-muted">{s.note}</div>
          </Show>
        </div>
      )}
    </For>
  </div>
);

/** Compact statistics line and the full text behind a link. */
function StatLine(props: {
  label: string;
  symbol: string;
  correction: string | null;
  alpha: number | null;
  shuffles: number | null;
  notes?: string[];
}): JSX.Element {
  const corrected = () => props.correction && props.correction !== 'none';
  return (
    <div class="cb-dec-statline">
      <span>
        {corrected() ? `Corrected p (${props.correction!.replace(/_/g, '-')})` : 'Uncorrected p'} ·
        alpha {props.alpha ?? '?'} · {props.shuffles ?? '?'} shuffles · {props.symbol}
      </span>
      <PopButton
        label="Statistical details"
        title="Statistical details"
        width={520}
        class="cb-link"
        button="Statistical details"
      >
        <p>{props.label}.</p>
        <For each={props.notes ?? []}>{(n) => <p>{n}</p>}</For>
      </PopButton>
    </div>
  );
}

const Check = (props: {
  label: string;
  checked: boolean;
  onSet: (v: boolean) => void;
}): JSX.Element => (
  <label class="cb-as-check">
    <input
      type="checkbox"
      checked={props.checked}
      onChange={(e) => props.onSet(e.currentTarget.checked)}
    />
    {props.label}
  </label>
);

type PosView = 'map' | 'trajectory' | 'errors';
const POS_VIEWS: [PosView, string][] = [
  ['map', 'Error map'],
  ['trajectory', 'Decoded vs true'],
  ['errors', 'Error distribution'],
];

function PositionResults(props: {
  v: PositionDecodingView;
  record?: RunRecord;
  manifest: Manifest;
}): JSX.Element {
  const [view, setView] = createSignal<PosView>('map');
  const [swap, setSwap] = createSignal(false);
  const [exploratory, setExploratory] = createSignal(false);
  const [lo, setLo] = createSignal<number | undefined>();
  const [hi, setHi] = createSignal<number | undefined>();
  const [bins, setBins] = createSignal(30);
  const [hover, setHover] = createSignal<BinCell | undefined>();
  const cells = createMemo(() => binCells(props.v));
  const limits = (): [number, number] => {
    const [a, b] = cells() ? errorRange(cells()!) : [0, 1];
    return [lo() ?? a, hi() ?? b];
  };
  const hist = createMemo(() =>
    props.v.frameError ? errorHistogram(props.v.frameError.data, bins()) : undefined,
  );
  const meta = () => props.manifest.results.find((r) => r.name === 'decoding_position');
  const hasTrajectory = () => !!meta()?.plots?.includes('decoded_trajectory');
  const [traj] = createResource(
    () => (props.record && hasTrajectory() ? props.record.run_id : undefined),
    async (id): Promise<TrajectoryData> =>
      decodeFloats(
        (await bridge.plotData(
          id,
          'decoding_position',
          'decoded_trajectory',
        )) as unknown as TrajectoryData,
      ),
  );
  const folds = () => {
    const k = Number(
      (props.record?.gui.settings as { analysis?: { folds?: number } })?.analysis?.folds,
    );
    const n = props.v.frameError?.shape[0];
    const fs = Number((meta()?.provenance as { fs?: number })?.fs);
    return k >= 2 && n && fs ? foldBoundaries(n, k).map((b) => b / fs) : [];
  };
  let svg: SVGSVGElement | undefined;
  const csv = () =>
    positionCsv(
      props.v,
      props.record ?? { scope: 'full', analysis: 'decoding', run_id: 'fixture' },
    );
  const exportsOf = (name: string, kind?: string) =>
    plotExports({
      name,
      svg: () => svg,
      csv,
      record: props.record,
      frameworkPlot: kind ? { result: 'decoding_position', kind } : undefined,
    });
  const t = () => props.v.tested;
  return (
    <>
      <Stats stats={positionStats(props.v)} />
      <StatLine
        label={props.v.label}
        symbol={
          exploratory()
            ? 'ring: significant without correction (exploratory)'
            : 'ring: significant after max-stat correction'
        }
        correction={t()?.correction ?? null}
        alpha={t()?.alpha ?? null}
        shuffles={t()?.nShuffles ?? null}
        notes={[props.v.exclusionRule]}
      />
      <div class="cb-dec-views" role="tablist" aria-label="Position decoding views">
        <For each={POS_VIEWS}>
          {([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={view() === id}
              classList={{ 'cb-dec-views__on': view() === id }}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <div class="cb-dec-figure">
        <Show when={view() === 'map'}>
          <PlotFrame
            title="Median error per bin"
            exports={exportsOf('error_map')}
            howTo={
              <>
                <Help k="Shows">
                  The median decoding error of the frames whose true position was in each bin,
                  across the arena grid.
                </Help>
                <Help k="Axes and color">
                  Columns and rows are the grid bins in position-file units. Darker means larger
                  error; the color scale is labeled in position units.
                </Help>
                <Help k="Hatched">
                  Bins left out because they had too few training frames ({props.v.exclusionRule}).
                </Help>
                <Help k="Rings">
                  Bins significant after max-stat correction across eligible bins. With the
                  exploratory switch on, rings mark bins significant without correction.
                </Help>
                <Help k="Plot settings">
                  Color limits, axis swap and the exploratory switch change only the drawing.
                </Help>
              </>
            }
            controls={
              <PopButton
                label="Plot settings"
                title="Plot settings (display only)"
                width={300}
                class="btn-secondary"
                button="Plot settings"
              >
                <div class="cb-dec-pset">
                  <label>
                    Color minimum
                    <input
                      type="number"
                      step="0.5"
                      value={limits()[0]}
                      onInput={(e) =>
                        setLo(e.currentTarget.value === '' ? undefined : +e.currentTarget.value)
                      }
                    />
                  </label>
                  <label>
                    Color maximum
                    <input
                      type="number"
                      step="0.5"
                      value={limits()[1]}
                      onInput={(e) =>
                        setHi(e.currentTarget.value === '' ? undefined : +e.currentTarget.value)
                      }
                    />
                  </label>
                  <Check label="Swap x and y" checked={swap()} onSet={setSwap} />
                  <button
                    type="button"
                    class="cb-link"
                    onClick={() => (setLo(undefined), setHi(undefined))}
                  >
                    Reset color limits
                  </button>
                  <p class="cb-muted">Display only; nothing is recomputed.</p>
                </div>
              </PopButton>
            }
          >
            {() => (
              <div class="cb-dec-plot">
                <div class="cb-dec-plot__tools">
                  <Check
                    label="Exploratory: uncorrected"
                    checked={exploratory()}
                    onSet={setExploratory}
                  />
                  <Show when={exploratory()}>
                    <span class="cb-badge cb-badge--warn">Exploratory: uncorrected</span>
                  </Show>
                  <span class="cb-muted cb-dec-hover">
                    <Show when={hover()} fallback="Point at a bin for its values.">
                      {(c) => (
                        <>
                          {c().bin}:{' '}
                          {c().excluded
                            ? 'excluded, too few training frames'
                            : `median error ${fmt(c().error, 2)}`}{' '}
                          · p {fmtP(c().p)} · corrected p {fmtP(c().pAdj)}
                        </>
                      )}
                    </Show>
                  </span>
                </div>
                <div class="cb-dec-plot__fill">
                  <Show
                    when={cells() && props.v.gridShape}
                    fallback={
                      <p class="cb-muted">
                        The result has no 2-D grid shape, so no map is drawn. See the table export.
                      </p>
                    }
                  >
                    <BinMap
                      cells={cells()!}
                      shape={props.v.gridShape as [number, number]}
                      limits={limits()}
                      swapAxes={swap()}
                      mark={exploratory() ? 'uncorrected' : 'corrected'}
                      onHover={setHover}
                      svgRef={(el) => (svg = el)}
                    />
                  </Show>
                </div>
              </div>
            )}
          </PlotFrame>
        </Show>
        <Show when={view() === 'trajectory'}>
          <PlotFrame
            title="Decoded vs true position"
            exports={exportsOf('trajectory', 'decoded_trajectory')}
            howTo={
              <>
                <Help k="Shows">
                  True position (gray) and decoded position (blue) over time, one panel per position
                  axis, for the first 60 s of decoded frames.
                </Help>
                <Help k="Axes">
                  Time in seconds of the session; position in the units of the position file.
                </Help>
                <Help k="Fold borders">
                  Dashed lines mark where the equal contiguous folds begin (drawn here from the
                  number of folds; the framework cuts the same blocks).
                </Help>
                <Help k="Limits">
                  Gaps are frames that were not decoded. The window shows one minute only.
                </Help>
              </>
            }
          >
            {() => (
              <div class="cb-dec-plot__fill">
                <Show
                  when={hasTrajectory() && props.record}
                  fallback={
                    <p class="cb-muted cb-dec-pad">
                      No plot data for this view: the run does not list a decoded-trajectory plot,
                      or this is a test fixture.
                    </p>
                  }
                >
                  <Show
                    when={traj.state === 'ready' && traj()}
                    fallback={
                      <p class="cb-muted cb-dec-pad">
                        {traj.error
                          ? 'The plot data needs the Python engine, which is not reachable. Other views use the saved copy.'
                          : 'Loading plot data from the framework.'}
                      </p>
                    }
                  >
                    <TrajectoryPlot data={traj()!} folds={folds()} svgRef={(el) => (svg = el)} />
                  </Show>
                </Show>
              </div>
            )}
          </PlotFrame>
        </Show>
        <Show when={view() === 'errors'}>
          <PlotFrame
            title="Decoding error per frame"
            exports={exportsOf('error_histogram')}
            howTo={
              <>
                <Help k="Shows">
                  How many frames were decoded with each error, using the per-frame error the
                  framework saved.
                </Help>
                <Help k="Axes">
                  x: distance between decoded and true position in position units; y: number of
                  frames.
                </Help>
                <Help k="Lines">
                  Solid: overall median error; dashed: chance error (decoding at random). Both come
                  from the framework.
                </Help>
                <Help k="Limits">
                  The bin width is a display choice (Plot settings) and does not change the median.
                </Help>
              </>
            }
            controls={
              <PopButton
                label="Plot settings"
                title="Plot settings (display only)"
                width={260}
                class="btn-secondary"
                button="Plot settings"
              >
                <div class="cb-dec-pset">
                  <label>
                    Histogram bins
                    <input
                      type="number"
                      min="5"
                      max="100"
                      step="5"
                      value={bins()}
                      onInput={(e) =>
                        setBins(
                          Math.max(5, Math.min(100, Math.round(+e.currentTarget.value) || 30)),
                        )
                      }
                    />
                  </label>
                  <p class="cb-muted">Display only.</p>
                </div>
              </PopButton>
            }
          >
            {() => (
              <div class="cb-dec-plot__fill">
                <Show
                  when={hist()}
                  fallback={<p class="cb-muted cb-dec-pad">The result holds no per-frame error.</p>}
                >
                  <ErrorHistogramPlot
                    hist={hist()!}
                    median={props.v.overall.value}
                    chance={props.v.overall.chance}
                    svgRef={(el) => (svg = el)}
                  />
                </Show>
              </div>
            )}
          </PlotFrame>
        </Show>
      </div>
    </>
  );
}

type BehView = 'scores' | 'confusion' | 'timeline';

function BehaviorResults(props: { v: BehaviorDecodingView; record?: RunRecord }): JSX.Element {
  const bayes = () => props.v.classifier === 'bayesian_decoder';
  const [view, setView] = createSignal<BehView>('scores');
  const [byScore, setByScore] = createSignal(false);
  const [normalize, setNormalize] = createSignal(true);
  const rows = createMemo(() => {
    const r = behaviorRows(props.v);
    return byScore() ? [...r].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : r;
  });
  const matrix = () => confusionMatrix(props.v, normalize());
  const tables = () => oneVsRestTables(props.v);
  let svg: SVGSVGElement | undefined;
  const run = () => props.record ?? { scope: 'full', analysis: 'decoding', run_id: 'fixture' };
  const exportsOf = (name: string) =>
    plotExports({
      name,
      svg: () => svg,
      csv: () => behaviorCsv(props.v, run()),
      record: props.record,
    });
  const t = () => props.v.tested;
  const views = (): [BehView, string][] => [
    ['scores', 'Scores'],
    ['confusion', bayes() ? 'Confusion matrix' : 'One-vs-rest tables'],
    ...(bayes() ? ([['timeline', 'Decoded vs true']] as [BehView, string][]) : []),
  ];
  return (
    <>
      <Stats stats={behaviorStats(props.v)} />
      <StatLine
        label={props.v.label}
        symbol="filled circle: significant"
        correction={t()?.correction ?? null}
        alpha={t()?.alpha ?? null}
        shuffles={t()?.nShuffles ?? null}
      />
      <div class="cb-dec-views" role="tablist" aria-label="Behavior decoding views">
        <For each={views()}>
          {([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={view() === id}
              classList={{ 'cb-dec-views__on': view() === id }}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <div class="cb-dec-figure">
        <Show when={view() === 'scores'}>
          <PlotFrame
            title="Score per behavior"
            exports={exportsOf('scores')}
            howTo={
              <>
                <Help k="Shows">
                  One score per behavior from the framework: recall for the Bayesian decoder,
                  balanced accuracy for one-vs-rest logistic regression.
                </Help>
                <Help k="Marks">
                  The dot is the score; a filled dot is significant. The gray bar is the range of
                  the shuffled null; the dashed line is chance.
                </Help>
                <Help k="Axes">x: score from 0 to 1; one row per behavior.</Help>
                <Help k="Limits">
                  Rows are ordered as listed in the run unless Plot settings sorts by score.
                  Uncorrected p-values are exploratory.
                </Help>
              </>
            }
            controls={
              <PopButton
                label="Plot settings"
                title="Plot settings (display only)"
                width={260}
                class="btn-secondary"
                button="Plot settings"
              >
                <div class="cb-dec-pset">
                  <Check label="Sort by score" checked={byScore()} onSet={setByScore} />
                  <p class="cb-muted">Display only.</p>
                </div>
              </PopButton>
            }
          >
            {() => (
              <div class="cb-dec-scores">
                <div class="cb-dec-plot__fill">
                  <BehaviorScorePlot
                    rows={rows()}
                    chance={props.v.overall.chance}
                    svgRef={(el) => (svg = el)}
                  />
                </div>
                <div class="cb-dec-tablewrap">
                  <table class="cb-auroc-table cb-as-tbl">
                    <thead>
                      <tr>
                        <th>Behavior</th>
                        <th class="cb-as-num">Score</th>
                        <th class="cb-as-num">Null range</th>
                        <th class="cb-as-num">Corrected p</th>
                        <th class="cb-as-num">Uncorrected p (exploratory)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={rows()}>
                        {(r) => (
                          <tr>
                            <td>
                              {r.name}
                              {r.significant ? ' ●' : ''}
                            </td>
                            <td class="cb-as-num">{fmt(r.score)}</td>
                            <td class="cb-as-num">
                              {fmt(r.nullLo, 2)} to {fmt(r.nullHi, 2)}
                            </td>
                            <td class="cb-as-num">
                              {r.pAdj == null ? 'no correction' : fmtP(r.pAdj)}
                            </td>
                            <td class="cb-as-num">{fmtP(r.p)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </PlotFrame>
        </Show>
        <Show when={view() === 'confusion'}>
          <PlotFrame
            title={bayes() ? 'Confusion matrix' : 'One-vs-rest tables'}
            exports={exportsOf(bayes() ? 'confusion' : 'one_vs_rest')}
            howTo={
              bayes() ? (
                <>
                  <Help k="Shows">
                    How often each true behavior (rows) was decoded as each behavior (columns).
                  </Help>
                  <Help k="Color">
                    Darker is a larger count, or a larger share of the row when normalized.
                  </Help>
                  <Help k="Plot settings">
                    Normalizing rows divides each row by its total; it does not change the result.
                  </Help>
                </>
              ) : (
                <>
                  <Help k="Shows">
                    One 2 x 2 table per behavior: frames in that behavior or not (rows, true)
                    against decoded in it or not (columns).
                  </Help>
                  <Help k="Color">Darker is a larger frame count, scaled across all tables.</Help>
                  <Help k="Limits">
                    Frames are those the framework used; counts are summed over the held-out folds.
                  </Help>
                </>
              )
            }
            controls={
              <Show when={bayes()}>
                <PopButton
                  label="Plot settings"
                  title="Plot settings (display only)"
                  width={260}
                  class="btn-secondary"
                  button="Plot settings"
                >
                  <div class="cb-dec-pset">
                    <Check label="Normalize rows" checked={normalize()} onSet={setNormalize} />
                    <p class="cb-muted">Display only.</p>
                  </div>
                </PopButton>
              </Show>
            }
          >
            {() => (
              <div class="cb-dec-plot__fill">
                <Show
                  when={bayes() ? matrix() : tables().length}
                  fallback={<p class="cb-muted cb-dec-pad">The result holds no confusion table.</p>}
                >
                  <Show
                    when={bayes()}
                    fallback={<OneVsRestPlot tables={tables()} svgRef={(el) => (svg = el)} />}
                  >
                    <ConfusionPlot
                      names={props.v.states}
                      matrix={matrix()!}
                      normalized={normalize()}
                      svgRef={(el) => (svg = el)}
                    />
                  </Show>
                </Show>
              </div>
            )}
          </PlotFrame>
        </Show>
        <Show when={view() === 'timeline'}>
          <div class="cb-dec-empty">
            <b>Decoded vs true timeline</b>
            <p>
              The installed framework provides no plot data for behavior decoding, so no timeline is
              drawn. Scores and the confusion matrix come from the saved arrays.
            </p>
          </div>
        </Show>
      </div>
    </>
  );
}

/**
 * Results of one decoding run, read from its saved arrays through `source`. `fixture` names a test
 * fixture: it is bannered as such and never shown for a real run.
 */
export function DecodingResults(props: {
  source: DecodingSource;
  record?: RunRecord;
  fixture?: string;
  match?: Match;
  saved?: boolean;
  /** The engine tested the overall value itself (the browser engine does); default: the framework capability. */
  overallTested?: boolean;
}): JSX.Element {
  const [loaded] = createResource(
    () => props.source,
    async (src) => {
      const manifest = await src.manifest();
      const has = props.overallTested ?? hasCapability('decoding_overall_test');
      return {
        manifest,
        pos: await loadPositionDecoding(src, manifest, has),
        beh: await loadBehaviorDecoding(src, manifest, has),
      };
    },
  );
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-dec-results" ref={root}>
      <Show when={props.fixture}>
        <div class="cb-dec-fixture" role="status">
          <b>Test fixture</b>: {props.fixture}. These numbers come from a saved framework test file,
          not from your data.
        </div>
      </Show>
      <Show when={props.record}>
        {(r) => (
          <RunBanner
            record={r()}
            match={props.match}
            saved={props.saved}
            offline={props.source.offline?.()}
          >
            <RunDetails
              record={r()}
              pipeline={JSON.stringify(
                (r().gui.settings as { analysis?: unknown }).analysis,
                null,
                1,
              )}
            />
          </RunBanner>
        )}
      </Show>
      <Show when={loaded.error}>
        <div class="cb-note" role="alert">
          The results could not be read: {String((loaded.error as Error)?.message ?? loaded.error)}
        </div>
      </Show>
      <Show when={loaded()}>
        {(d) => (
          <Show
            when={d().pos || d().beh}
            fallback={
              <div class="cb-dec-empty">
                This run holds no decoding result
                {props.record && props.record.status !== 'ok'
                  ? `: it ended as ${props.record.status}. See Result details for the reason.`
                  : '.'}
              </div>
            }
          >
            <Show when={d().pos}>
              {(v) => <PositionResults v={v()} record={props.record} manifest={d().manifest} />}
            </Show>
            <Show when={d().beh}>{(v) => <BehaviorResults v={v()} record={props.record} />}</Show>
          </Show>
        )}
      </Show>
      <Show when={loaded.loading}>
        <p class="cb-muted">Reading the saved results.</p>
      </Show>
    </div>
  );
}
