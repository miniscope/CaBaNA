import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { binGrid, effectiveBin } from '../lib/arena.ts';
import { bridgeState } from '../lib/bridge-status.ts';
import { openRunOf } from '../lib/results-nav.ts';
import { persistStore } from '../lib/persist-settings.ts';
import {
  DEFAULT_POPULATION,
  POPULATION_METHODS,
  PREVIEW_SHUFFLES,
  populationSettings as s,
  setPopulationSettings as set,
  type PopulationMethod,
  type PopulationSettings,
  type PopulationTarget,
} from '../lib/population-settings.ts';
import { prep } from '../lib/preprocess.ts';
import {
  active,
  blockers,
  cancelRun,
  history,
  lastError,
  latest,
  refreshHistory,
  runAnalysis,
} from '../lib/runs.ts';
import { goToStep } from '../lib/store.ts';
import { Requirements } from '../components/Requirements.tsx';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { PopulationResults } from './PopulationResults.tsx';
import { fitToWindow } from './QcPanel.tsx';
import { PopButton } from './QcParts.tsx';
import {
  labelRows,
  neuralSummary,
  readiness,
  selectedLabels,
  stateCount,
  syncLabels,
} from './population/data.ts';
import { correctionScope } from './population/logic.ts';
import { StatesChart } from './population/StatesChart.tsx';
import { Unavailable } from './results/FrameworkNotice.tsx';
import { RunDetails } from './results/RunDetails.tsx';

// Remembered in this browser; one root so the effect is owned.
createRoot(() => persistStore('cabana-population-settings', s, set, DEFAULT_POPULATION));

type Tab = 'data' | 'methods' | 'stats' | 'results';
const [tab, setTab] = createSignal<Tab>('data');

const D = DEFAULT_POPULATION;
const TARGETS: { id: PopulationTarget; label: string }[] = [
  { id: 'behaviors', label: 'Behaviors' },
  { id: 'zones', label: 'Zones' },
  { id: 'position', label: 'Position bins' },
];
const METHOD_NAME: Record<PopulationMethod, string> = {
  similarity: 'Population vector (PV) similarity',
  stability: 'Population vector (PV) stability',
  separation: 'State separation',
  dimensionality: 'Dimensionality (participation ratio)',
  pairwise: 'Pairwise correlations',
};

/** A labeled setting with an optional explanation, laid out in a row. */
function Field(props: { label: string; tip?: JSX.Element; children: JSX.Element }): JSX.Element {
  return (
    <div class="cb-pn-field">
      <span>
        {props.label}
        <Show when={props.tip}>
          <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.tip}</InfoTip>
        </Show>
      </span>
      {props.children}
    </div>
  );
}

function Select<K extends keyof PopulationSettings>(props: {
  k: K;
  label: string;
  options: [PopulationSettings[K], string][];
}): JSX.Element {
  return (
    <select
      aria-label={props.label}
      value={String(s[props.k])}
      onChange={(e) => set(props.k, e.currentTarget.value as PopulationSettings[K])}
    >
      <For each={props.options}>{([v, text]) => <option value={String(v)}>{text}</option>}</For>
    </select>
  );
}

const Num = (p: {
  k:
    | 'binS'
    | 'pvMinOccupancyS'
    | 'stabilityBlocks'
    | 'components'
    | 'shuffles'
    | 'minShiftS'
    | 'pairSeparationS'
    | 'seed'
    | 'alpha';
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  whole?: boolean;
}) => (
  <NumField
    label={p.label}
    value={s[p.k]}
    def={D[p.k]}
    min={p.min ?? 0}
    max={p.max}
    step={p.step ?? ('any' as unknown as number)}
    unit={p.unit}
    onSet={(v) => set(p.k, p.whole ? Math.round(v) : v)}
  />
);

/** One method: checkbox, its options only while selected, and whether it can run. */
function MethodRow(props: {
  id: PopulationMethod;
  tip: JSX.Element;
  children?: JSX.Element;
  limit?: string;
}): JSX.Element {
  const ready = () => readiness()[props.id];
  return (
    <div class="cb-pn-method" classList={{ 'cb-pn-method--off': !s.methods[props.id] }}>
      <label class="cb-as-check">
        <input
          type="checkbox"
          checked={s.methods[props.id]}
          onChange={(e) => set('methods', props.id, e.currentTarget.checked)}
        />
        <b>{METHOD_NAME[props.id]}</b>
        <InfoTip label={`About ${METHOD_NAME[props.id].toLowerCase()}`}>{props.tip}</InfoTip>
        <Show when={s.methods[props.id]}>
          <span class="cb-pn-method__state">
            <Show when={ready().ready} fallback={<span class="cb-pill cb-pill--bad">Blocked</span>}>
              <span class="cb-pill cb-pill--good">✓ Ready</span>
            </Show>
          </span>
        </Show>
      </label>
      <Show when={s.methods[props.id]}>
        <Show when={props.children}>
          <div class="cb-pn-opts">{props.children}</div>
        </Show>
        <Show when={!ready().ready}>
          <div class="cb-pn-method__why">{ready().reason}</div>
        </Show>
        <Show when={props.limit}>
          <div class="cb-muted cb-pn-method__limit">{props.limit}</div>
        </Show>
      </Show>
    </div>
  );
}

function Methods(): JSX.Element {
  return (
    <section class="cb-setgroup cb-pn-card">
      <h3>
        Methods
        <InfoTip label="About the methods">
          A population vector (PV) is the mean neural value of every cell while the animal is in a
          state. All selected methods share the target, the time bin and the states above, and run
          together in one run.
        </InfoTip>
      </h3>
      <div class="cb-pn-methods">
        <MethodRow
          id="similarity"
          tip="How alike the population vectors of two states are, for every pair of states. Cosine similarity compares the direction of the vectors; Pearson correlation also removes each vector's mean."
        >
          <Field label="Measure">
            <Select
              k="similarity"
              label="Similarity measure"
              options={[
                ['cosine', 'Cosine similarity'],
                ['pearson', 'Pearson correlation'],
              ]}
            />
          </Field>
          <Field
            label="Minimum time in state"
            tip="Shortest time a state must be occupied in a block for its population vector to be used. Also used by stability."
          >
            <Num k="pvMinOccupancyS" label="Minimum time in state (s)" unit="s" step={0.05} />
          </Field>
        </MethodRow>
        <MethodRow
          id="stability"
          tip="Splits the session into equal blocks and correlates the population vector of each state in the first block with the second. High values mean the pattern of the state is reproducible within the session."
        >
          <Field
            label="Blocks"
            tip="Equal consecutive parts of the session. Stability compares the first with the second, so at least 2 are needed."
          >
            <Num k="stabilityBlocks" label="Blocks" min={1} step={1} whole />
          </Field>
        </MethodRow>
        <MethodRow
          id="separation"
          limit={
            s.space === 'pca'
              ? 'Descriptive: PCA is fitted on all included frames; no held-out evaluation.'
              : undefined
          }
          tip="How far apart the mean population vectors of two states are. With principal component analysis (PCA) the distance is measured in the first components; without it, over all cells. Both are z-scored."
        >
          <Field label="Space">
            <Select
              k="space"
              label="Space"
              options={[
                ['pca', 'Principal component analysis'],
                ['all', 'All cells (no PCA)'],
              ]}
            />
          </Field>
          <Show when={s.space === 'pca'}>
            <Field
              label="Components"
              tip="Number of principal components kept for the distances. It cannot exceed the number of kept cells."
            >
              <Num k="components" label="Number of components" min={1} step={1} whole />
            </Field>
            <Field label="Distance">
              <Select
                k="pcaDistance"
                label="Distance"
                options={[
                  ['euclidean', 'Euclidean'],
                  ['mahalanobis', 'Mahalanobis'],
                ]}
              />
            </Field>
          </Show>
          <Show when={s.space === 'all'}>
            <Field label="Distance">
              <Select
                k="allDistance"
                label="Distance"
                options={[
                  ['euclidean', 'Euclidean'],
                  ['correlation', 'Correlation'],
                ]}
              />
            </Field>
          </Show>
        </MethodRow>
        <MethodRow
          id="dimensionality"
          limit="Descriptive: fitted on all included frames."
          tip="The participation ratio estimates how many independent patterns the population uses: from 1 (one pattern dominates) up to the number of cells (variance spread evenly). It is computed on z-scored cells."
        >
          <label class="cb-as-check">
            <input
              type="checkbox"
              checked={s.perStateParticipation}
              onChange={(e) => set('perStateParticipation', e.currentTarget.checked)}
            />
            Also compute it for each state
          </label>
        </MethodRow>
        <MethodRow
          id="pairwise"
          limit="Descriptive; no significance test."
          tip="Correlation between every pair of cells across the time bins. Total uses all variation; signal keeps what is shared across states; noise keeps what remains after removing state means and needs exclusive states."
        >
          <Field label="Kind">
            <Select
              k="pairwiseKind"
              label="Kind of correlation"
              options={[
                ['total', 'Total'],
                ['signal', 'Signal'],
                ['noise', 'Noise'],
              ]}
            />
          </Field>
          <Field label="Method">
            <Select
              k="pairwiseMethod"
              label="Correlation method"
              options={[
                ['pearson', 'Pearson'],
                ['spearman', 'Spearman'],
              ]}
            />
          </Field>
        </MethodRow>
      </div>
    </section>
  );
}

function Target(): JSX.Element {
  const rows = labelRows;
  const grid = createMemo(() => binGrid(effectiveBin()));
  const openBins = () => grid()?.open.filter(Boolean).length ?? 0;
  return (
    <section class="cb-setgroup cb-pn-card cb-pn-target">
      <h3>
        Target and states
        <InfoTip label="About the target">
          The states are the groups of frames the population is compared across. Behaviors and zones
          come from the annotation files; position bins come from the arena grid. Behaviors may
          overlap in time; zones may not.
        </InfoTip>
      </h3>
      <div class="cb-pn-targetbar">
        <div class="cb-seg" role="radiogroup" aria-label="Target">
          <For each={TARGETS}>
            {(t) => (
              <button
                type="button"
                role="radio"
                aria-checked={s.target === t.id}
                classList={{ 'cb-seg__on': s.target === t.id }}
                onClick={() => set('target', t.id)}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>
        <Field
          label="Time bin"
          tip="Neural frames are grouped into bins of this length before any population analysis. It applies only to this page."
        >
          <Num k="binS" label="Time bin (s)" unit="s" step={0.1} min={0.05} />
        </Field>
      </div>
      <Show
        when={s.target !== 'position'}
        fallback={
          <div class="cb-pn-posinfo">
            <p>
              Each open bin of the arena grid ({effectiveBin()} cm bins) is a state:{' '}
              <b>{openBins()} open bins</b>. Frames below the speed threshold set in Preprocess are
              left out.
            </p>
            <p class="cb-muted">
              Arena outline and bin size come from Experimental setup.{' '}
              <button class="cb-link" onClick={() => goToStep('setup')}>
                Go to Experimental setup
              </button>
            </p>
          </div>
        }
      >
        <Show
          when={rows().length}
          fallback={
            <div class="cb-empty">
              No {s.target === 'zones' ? 'zone' : 'behavior'} annotations are loaded.{' '}
              <button class="cb-link" onClick={() => goToStep('load')}>
                Go to Load data
              </button>
            </div>
          }
        >
          <StatesChart rows={rows()} />
        </Show>
      </Show>
    </section>
  );
}

function Statistics(): JSX.Element {
  const scope = createMemo(() => correctionScope(s, stateCount()));
  return (
    <div class="cb-pn-statgrid">
      <section class="cb-setgroup cb-pn-card">
        <h3>
          Shuffle test
          <InfoTip label="About the shuffle test">
            Each shuffle shifts every cell's events in time by its own random amount (a circular
            shift), which keeps each cell's own timing structure but breaks its link to the states.
            The observed value is compared with the shuffled values. The approved starting values
            (200 shuffles, 20 s minimum shift) come from the framework's population recipe.
          </InfoTip>
        </h3>
        <div class="cb-pn-fields">
          <Field
            label="Shuffles"
            tip="Number of shuffled sessions. More shuffles give finer p-values. A quick preview uses 50 and is marked Preliminary."
          >
            <Num k="shuffles" label="Shuffles" min={10} step={50} whole />
          </Field>
          <Field
            label="Minimum shift"
            tip="Shortest circular shift applied to a cell. It should be longer than the time scale of the neural events."
          >
            <Num k="minShiftS" label="Minimum shift (s)" unit="s" step={1} />
          </Field>
          <Field
            label="Pair separation"
            tip="Minimum difference between the shifts of two cells, so that pairs of cells are not shifted together."
          >
            <Num k="pairSeparationS" label="Pair separation (s)" unit="s" step={0.5} />
          </Field>
          <Field
            label="Seed"
            tip="Starting value of the random number generator. The same seed and settings give the same shifts."
          >
            <Num k="seed" label="Seed" whole step={1} />
          </Field>
          <Field label="Alpha" tip="Significance level for the marks in the figures.">
            <Num k="alpha" label="Alpha" min={0.0001} max={0.5} step={0.01} />
          </Field>
          <Field
            label="Correction"
            tip="Max-stat compares each state with the largest value among all states in every shuffle, which controls the chance of any false positive across states. It applies only to results with one value per state."
          >
            <Select
              k="correction"
              label="Correction"
              options={[
                ['none', 'None'],
                ['max_stat', 'Max-stat (per-state results only)'],
              ]}
            />
          </Field>
        </div>
        <p class="cb-muted">
          Quick preview uses {PREVIEW_SHUFFLES} shuffles and is marked Preliminary. Run analysis
          uses the shuffles above.
        </p>
      </section>
      <section class="cb-setgroup cb-pn-card">
        <h3>What the correction covers</h3>
        <Show when={scope().length} fallback={<p class="cb-muted">No method is selected.</p>}>
          <table class="cb-auroc-table cb-as-tbl cb-pn-scope">
            <thead>
              <tr>
                <th>Result</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              <For each={scope()}>
                {(l) => (
                  <tr>
                    <td>{l.label}</td>
                    <td>
                      {l.text}
                      <Show when={l.corrected}>
                        <span class="cb-pill cb-pill--good">corrected</span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
        <p class="cb-muted">
          Max-stat is offered only for results with one value per state (population vector
          stability, and participation ratio per state). Matrix results (similarity, separation)
          stay uncorrected whatever is chosen here.
        </p>
      </section>
    </div>
  );
}

function Footer(props: { issues: () => string[] }): JSX.Element {
  // Position bins are states too: every open bin of the arena grid.
  const stateCount = () =>
    s.target === 'position'
      ? (binGrid(effectiveBin())?.open.filter(Boolean).length ?? 0)
      : selectedLabels().length;
  const running = () => (active()?.id === 'population' ? active() : undefined);
  const failed = () => (latest.population?.status === 'failed' ? latest.population : undefined);
  const engineOff = () => bridgeState().kind !== 'ready';
  const start = async (scope: 'full' | 'preview') => {
    const rec = await runAnalysis('population', scope);
    if (rec && rec.status !== 'failed') {
      openRunOf('population', undefined);
      setTab('results');
    }
  };
  return (
    <div class="cb-pe-foot cb-pn-foot">
      <span class="cb-pe-foot__text">
        <Show
          when={!running()}
          fallback={
            <>
              <Show when={running()!.fraction > 0 || running()!.shuffles}>
                <progress class="cb-progress" value={running()!.fraction} max={1} />
              </Show>
              <span class="cb-muted">
                {running()!.shuffles
                  ? `Shuffles ${running()!.shuffles![0]} of ${running()!.shuffles![1]}`
                  : running()!.message}
                {running()!.phase === 'cancelling' ? ' · cancelling' : ''}
              </span>
            </>
          }
        >
          <Show when={lastError()?.id === 'population'}>
            <span class="cb-error" role="alert">
              {lastError()!.message.length > 160
                ? `${lastError()!.message.slice(0, 160)}…`
                : lastError()!.message}
            </span>
            <Show when={lastError()!.message.length > 160}>
              <PopButton
                label="Full message"
                title="Why the run did not start"
                width={460}
                class="cb-link"
                button="Full message"
              >
                <p>{lastError()!.message}</p>
              </PopButton>
            </Show>
            <Show when={/n_shuffles|alpha/i.test(lastError()!.message)}>
              <button class="cb-link" onClick={() => setTab('stats')}>
                Go to Statistical settings
              </button>
            </Show>
          </Show>
          <Show when={failed()}>
            <span class="cb-error">Last run failed.</span>
            <RunDetails record={failed()!} />
          </Show>
          <Show
            when={props.issues().length}
            fallback={
              <span class="cb-muted">
                {stateCount()} states · {Object.values(s.methods).filter(Boolean).length} methods ·{' '}
                {s.shuffles} shuffles
              </span>
            }
          >
            <span class="cb-muted">{props.issues()[0]}</span>
            <PopButton
              label="Why the run is blocked"
              title="Why the run is blocked"
              width={420}
              class="cb-link"
              button={`Why blocked${props.issues().length > 1 ? ` (${props.issues().length})` : ''}`}
            >
              <Unavailable
                engineOff={engineOff()}
                input={props.issues().filter((i) => !/engine/i.test(i))}
              />
            </PopButton>
          </Show>
        </Show>
      </span>
      <Show
        when={!running()}
        fallback={
          <button
            class="btn-secondary"
            disabled={!running()!.runId || running()!.phase === 'cancelling'}
            onClick={() => void cancelRun()}
          >
            Cancel
          </button>
        }
      >
        <button
          class="btn-secondary"
          disabled={!!props.issues().length}
          title={`${PREVIEW_SHUFFLES} shuffles; the result is marked Preliminary`}
          onClick={() => void start('preview')}
        >
          Quick preview ({PREVIEW_SHUFFLES} shuffles)
        </button>
        <button
          class="btn-primary"
          disabled={!!props.issues().length}
          onClick={() => void start('full')}
        >
          Run analysis ▶
        </button>
      </Show>
    </div>
  );
}

/** The Population page: Data & states, Methods, Statistical settings, and the results of the latest run. */
export function PopulationPanel(): JSX.Element {
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  // Saved runs of the project, once the engine is reachable.
  createEffect(() => {
    if (bridgeState().kind === 'ready' && !history().length)
      void refreshHistory().catch(() => undefined);
  });
  syncLabels();
  const n = neuralSummary;
  const issues = createMemo(() => {
    const own = blockers('population').filter((b) => b !== 'Python engine not running.');
    const notReady = POPULATION_METHODS.filter(
      (m) => s.methods[m.id] && !readiness()[m.id].ready,
    ).map((m) => `${METHOD_NAME[m.id]}: ${readiness()[m.id].reason}`);
    const engine = bridgeState().kind !== 'ready' ? ['Python engine not running.'] : [];
    return [...own, ...notReady, ...engine];
  });
  return (
    <>
      <Requirements analysis="population" />
      <div class="cb-place cb-as cb-pn" ref={root}>
        <div class="cb-place-head">
          <div>
            <h2>Population Activity Analysis</h2>
            <p class="cb-muted">
              Examine how neurons behave together across the recording. Compare population activity
              patterns across behaviors, zones, or positions, measure their stability over time, and
              explore relationships between neurons.
            </p>
          </div>
          <div class="cb-seg" role="tablist" aria-label="Population views">
            <For
              each={
                [
                  ['data', 'Data & states'],
                  ['methods', 'Methods'],
                  ['stats', 'Statistical settings'],
                  ['results', 'Results'],
                ] as const
              }
            >
              {([id, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === id}
                  classList={{ 'cb-seg__on': tab() === id }}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={tab() !== 'results'}>
          <div class="cb-pn-input">
            <Show when={n()} fallback={<span>No deconvolved events are loaded.</span>}>
              <span>
                <b>Input:</b> deconvolved events
              </span>
              <span>
                {prep.eventSigmaS
                  ? `event smoothing σ ${prep.eventSigmaS} s`
                  : 'no event smoothing'}{' '}
                (
                <button class="cb-link" onClick={() => goToStep('prep')}>
                  Preprocess
                </button>
                )
              </span>
              <span>
                <b>{n()!.kept}</b> of {n()!.total} cells kept
              </span>
              <span>Single session. Cells are not matched across sessions.</span>
            </Show>
          </div>
        </Show>
        <div class="cb-pn-body">
          <Show when={tab() === 'data'}>
            <Target />
          </Show>
          <Show when={tab() === 'methods'}>
            <Methods />
          </Show>
          <Show when={tab() === 'stats'}>
            <Statistics />
          </Show>
          <Show when={tab() === 'results'}>
            <PopulationResults onSetup={() => setTab('data')} />
          </Show>
        </div>
        <Footer issues={issues} />
      </div>
    </>
  );
}
