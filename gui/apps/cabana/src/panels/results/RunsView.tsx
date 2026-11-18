import { createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady, capabilities } from '../../lib/bridge-status.ts';
import { download } from '../../lib/export-figure.ts';
import { preliminaryText } from '../../lib/preview.ts';
import {
  ANALYSIS_IDS,
  analysisLabel,
  formatWhen,
  frameworkNote,
  goToAnalysis,
  hasResults,
  unavailableReason,
} from '../../lib/results-overview.ts';
import { openExplorer } from '../../lib/results-nav.ts';
import { runCounts, runRows, type MatchOf, type RunRow } from '../../lib/results-runs.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { ExportMenu } from './ExportMenu.tsx';
import { OpenResult, RerunButton, ResultActions } from './ResultActions.tsx';
import { RunDetailsBody } from './RunDetails.tsx';

function Counts(props: { rows: RunRow[] }): JSX.Element {
  const c = () => runCounts(props.rows);
  const tiles = (): [string, number, string?][] => [
    ['Saved runs', c().saved],
    ['Current', c().current],
    ['Need rerun', c().needRerun, c().needRerun ? 'cb-rn__n--warn' : undefined],
    ['Preliminary', c().preliminary],
  ];
  return (
    <ul class="cb-rn__counts" aria-label="Saved run counts">
      <For each={tiles()}>
        {([label, n, cls]) => (
          <li class="cb-rn__count">
            <span class="sc">{label}</span>
            <span class="cb-rn__n" classList={{ [cls ?? '']: !!cls }}>
              {n}
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}

/** Open for a run with results; Rerun for one that needs it or left none. */
function RowAction(props: { row: RunRow }): JSX.Element {
  const r = () => props.row.record;
  return (
    <Show
      when={hasResults(r()) && props.row.kind !== 'needs_rerun'}
      fallback={
        <Show when={props.row.kind !== 'running'}>
          <RerunButton record={r()} />
        </Show>
      }
    >
      <OpenResult record={r()} />
    </Show>
  );
}

const Fact = (p: { k: string; children: JSX.Element }) => (
  <>
    <dt>{p.k}</dt>
    <dd>{p.children}</dd>
  </>
);

/** The data a run read, as short file fingerprints; the full list is in Details. */
const dataVersion = (r: RunRecord) =>
  r.session.inputs.length
    ? `${r.session.inputs.length} files, ${r.session.inputs[0].sha256.slice(0, 8)}`
    : 'not recorded';

/** The selected run: its settings and data version, Explore, Export, and the other actions. */
function SelectedRun(props: { row: RunRow; onDeleted: (r: RunRecord) => void }): JSX.Element {
  const r = () => props.row.record;
  const [details, setDetails] = createSignal(false);
  const note = () => frameworkNote(r(), capabilities()?._info?.commit);
  const [pipeline] = createResource(
    () => (details() && bridgeReady() && r().pipeline_file ? r().run_id : undefined),
    (runId) => bridge.runFile(runId, r().pipeline_file!).catch(() => undefined),
  );
  const engine = () =>
    r().engine === 'framework'
      ? `Python framework ${r().framework?.commit?.slice(0, 7) ?? ''}`.trim()
      : 'Browser engine';
  return (
    <aside class="cb-rn__side" aria-label="Selected run">
      <h3>
        {props.row.label}
        <Show when={props.row.target}>
          <span class="cb-rn__sep"> · </span>
          {props.row.target}
        </Show>
      </h3>
      <p class="cb-muted cb-rn__when">{formatWhen(r().created_utc)}</p>
      <dl class="cb-rn__facts">
        <Fact k="Status">{props.row.status}</Fact>
        <Fact k="Signal">{props.row.signal}</Fact>
        <Fact k="Cells">{props.row.cells}</Fact>
        <Fact k="Scope">
          {r().scope === 'preview' ? `Preliminary, ${preliminaryText(r())}` : 'Full analysis'}
        </Fact>
        <Fact k="Seed">{r().seeds?.base ?? 'not set'}</Fact>
        <Fact k="Engine">{engine()}</Fact>
        <Fact k="Data version">{dataVersion(r())}</Fact>
      </dl>
      <Show when={note()}>
        <p class="cb-muted cb-rn__note">{note()}</p>
      </Show>
      <div class="cb-rn__acts">
        <button
          type="button"
          class="btn-primary"
          disabled={!hasResults(r())}
          title={hasResults(r()) ? undefined : 'This run produced no results.'}
          onClick={() => openExplorer(props.row.analysis, r().run_id)}
        >
          Explore
        </button>
        <button
          type="button"
          class="btn-secondary"
          onClick={() => goToAnalysis(props.row.analysis)}
        >
          Edit analysis
        </button>
        <button
          type="button"
          class="btn-secondary"
          aria-expanded={details()}
          onClick={() => setDetails(!details())}
        >
          {details() ? 'Hide details' : 'Details'}
        </button>
        <ResultActions record={r()} onDeleted={props.onDeleted} />
      </div>
      <div class="cb-rn__export">
        <span class="sc">Export</span>
        <ExportMenu
          label="Export run"
          groups={[
            {
              title: 'This saved run',
              items: [
                {
                  label: 'Bundle (zip)',
                  note: 'Settings, pipeline and results',
                  unavailable: unavailableReason(bridgeReady()),
                  run: async () =>
                    download(
                      `${r().analysis}-${r().run_id}.zip`,
                      await bridge.bundle(r().run_id),
                      'application/zip',
                    ),
                },
              ],
            },
          ]}
        />
        <span class="cb-muted">Figures and tables are exported from Explore.</span>
      </div>
      <Show when={details()}>
        <div class="cb-rn__details">
          <RunDetailsBody record={r()} pipeline={pipeline()} />
        </div>
      </Show>
    </aside>
  );
}

/** Results: counts, one table of every saved run, and the selected run beside it. */
export function RunsView(props: {
  records: RunRecord[];
  matchOf: MatchOf;
  onDeleted: (r: RunRecord) => void;
}): JSX.Element {
  const [filter, setFilter] = createSignal<AnalysisId | ''>('');
  const [picked, setPicked] = createSignal<string>();
  const all = createMemo(() => runRows(props.records, props.matchOf));
  const rows = createMemo(() => (filter() ? all().filter((r) => r.analysis === filter()) : all()));
  const selected = () => rows().find((r) => r.record.run_id === picked()) ?? rows()[0];
  return (
    <div class="cb-rn">
      <div class="cb-rn__main">
        <Counts rows={all()} />
        <section class="cb-rn__box" aria-label="Saved runs">
          <div class="cb-rn__bar">
            <span class="sc">Saved runs</span>
            <select
              aria-label="Filter by analysis"
              value={filter()}
              onChange={(e) => setFilter(e.currentTarget.value as AnalysisId | '')}
            >
              <option value="">All analyses</option>
              <For each={ANALYSIS_IDS}>
                {(id) => <option value={id}>{analysisLabel(id)}</option>}
              </For>
            </select>
          </div>
          <div class="cb-rn__scroll">
            <table class="cb-rn__t">
              <thead>
                <tr>
                  <th>Analysis</th>
                  <th>Comparison or target</th>
                  <th>Run</th>
                  <th>Signal</th>
                  <th>Cells</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <For
                  each={rows()}
                  fallback={
                    <tr>
                      <td colspan="7" class="cb-muted">
                        No saved runs{filter() ? ' of this analysis' : ''}.
                      </td>
                    </tr>
                  }
                >
                  {(row) => (
                    <tr
                      classList={{ 'cb-rn__on': selected()?.record.run_id === row.record.run_id }}
                      aria-selected={selected()?.record.run_id === row.record.run_id}
                      onClick={() => setPicked(row.record.run_id)}
                    >
                      <td>
                        <button
                          type="button"
                          class="cb-rn__pick"
                          onClick={() => setPicked(row.record.run_id)}
                        >
                          {row.label}
                        </button>
                      </td>
                      <td class="cb-rn__target" title={row.target}>
                        {row.target || <span class="cb-muted">no results</span>}
                      </td>
                      <td class="cb-rn__when">{formatWhen(row.record.created_utc)}</td>
                      <td>{row.signal}</td>
                      <td>{row.cells}</td>
                      <td>
                        <span class="cb-rn__status" data-kind={row.kind}>
                          {row.status}
                        </span>
                      </td>
                      <td class="cb-rn__act">
                        <RowAction row={row} />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="cb-muted cb-rn__foot">
            A rerun keeps the old result. Both stay listed until one is deleted.
            <Show when={runCounts(all()).other}>
              {' '}
              {runCounts(all()).other} run(s) failed, were cancelled, are partial or are still
              running.
            </Show>
          </p>
        </section>
      </div>
      <Show
        when={selected()}
        fallback={<aside class="cb-rn__side cb-muted">No run selected.</aside>}
      >
        {(row) => <SelectedRun row={row()} onDeleted={props.onDeleted} />}
      </Show>
    </div>
  );
}
