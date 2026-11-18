// Previous results of one analysis: its saved runs (the run records), the selected run's details,
// and what can be done with it: open it in Results, see the settings it used, use them again, or
// the run's own actions (rerun, export, details, delete).

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import { Modal } from '../components/Modal.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import { capabilities } from '../lib/bridge-status.ts';
import { preliminaryText, executedShuffles } from '../lib/preview.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { formatWhen, frameworkNote, openness } from '../lib/results-overview.ts';
import { openExplorer } from '../lib/results-nav.ts';
import { goToStep } from '../lib/store.ts';
import { runRows } from '../lib/results-runs.ts';
import { dataVersion } from '../lib/run-settings-view.ts';
import { analysisSection } from '../lib/run-settings-view.ts';
import { AnalysisRunSettings, applyRunSettings } from './AnalysisRunSettings.tsx';
import { ResultActions } from './results/ResultActions.tsx';

const Fact = (p: { k: string; children: JSX.Element }) => (
  <>
    <span class="cb-muted">{p.k}</span>
    <span>{p.children}</span>
  </>
);

export function AnalysisPrevious(props: {
  id: AnalysisItem;
  /** Every saved run of the project; this window lists the ones of its analysis. */
  records: RunRecord[];
  onDeleted: (r: RunRecord) => void;
  onClose: () => void;
}): JSX.Element {
  // One window per analysis: the id never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const id = props.id;
  const label = ANALYSES.find((a) => a.id === id)!.label;
  const rows = createMemo(() => runRows(props.records, () => undefined, id));
  const [picked, setPicked] = createSignal<string>();
  const row = () => rows().find((r) => r.record.run_id === picked()) ?? rows()[0];
  const [showSettings, setShowSettings] = createSignal(false);
  const [error, setError] = createSignal('');
  const rec = () => row()?.record;
  const blocked = () =>
    rec()
      ? (() => {
          const o = openness(rec()!);
          return o.kind === 'blocked' ? o.reason : undefined;
        })()
      : 'No saved run.';
  const shuffles = () => (rec() ? executedShuffles(rec()!) : undefined);
  const engine = () =>
    rec()?.engine === 'framework'
      ? `Python framework ${rec()!.framework?.commit?.slice(0, 7) ?? ''}`.trim()
      : 'Browser engine';
  const note = () => (rec() ? frameworkNote(rec()!, capabilities()?._info?.commit) : undefined);

  return (
    <Modal
      label={`Previous results, ${label}`}
      title={`Previous results · ${label}`}
      head={
        <span class="cb-muted cb-cfg__data">
          {rows().length} saved run{rows().length === 1 ? '' : 's'}
        </span>
      }
      width={900}
      height={470}
      onClose={props.onClose}
      actions={
        <ActionsMenu
          items={() => [
            {
              kind: 'action',
              label: 'Open in Results',
              disabled: blocked(),
              onSelect: () => {
                openExplorer(id, rec()!.run_id);
                goToStep('results');
              },
            },
            {
              kind: 'action',
              label: 'View settings used',
              disabled: rec() ? undefined : 'No saved run.',
              onSelect: () => setShowSettings(true),
            },
            {
              kind: 'action',
              label: 'Use these settings',
              disabled: rec() ? undefined : 'No saved run.',
              onSelect: () => setError(applyRunSettings(rec()!) ?? ''),
            },
          ]}
        />
      }
    >
      <Show
        when={rows().length}
        fallback={<p class="cb-muted">No runs yet. Run the analysis from its card.</p>}
      >
        <div class="cb-prev">
          <table class="cb-prev__table">
            <thead>
              <tr>
                <th />
                <th>Run</th>
                <th>Compared or aligned to</th>
                <th>Signal</th>
                <th>Cells</th>
                <th>Scope</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r) => (
                  <tr
                    classList={{ 'cb-prev__on': r.record.run_id === rec()?.run_id }}
                    onClick={() => setPicked(r.record.run_id)}
                  >
                    <td>
                      <input
                        type="radio"
                        name="previous-run"
                        aria-label={`Select the run of ${formatWhen(r.record.created_utc)}`}
                        checked={r.record.run_id === rec()?.run_id}
                        onChange={() => setPicked(r.record.run_id)}
                      />
                    </td>
                    <td>{formatWhen(r.record.finished_utc ?? r.record.created_utc)}</td>
                    <td>{r.target || '—'}</td>
                    <td>{r.signal}</td>
                    <td>{r.cells}</td>
                    <td>{r.record.scope === 'preview' ? 'Quick preview' : 'Full analysis'}</td>
                    <td>{r.status}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={rec()}>
            {(r) => (
              <>
                <div class="sc">selected run</div>
                <div class="cb-prev__facts">
                  <Fact k="Seed">{r().seeds?.base ?? 'not set'}</Fact>
                  <Fact k="Engine">{engine()}</Fact>
                  <Fact k="Data version">{dataVersion(r())}</Fact>
                  <Fact k="Shuffles">
                    {shuffles() === undefined ? 'not recorded' : shuffles()!.toLocaleString()}
                  </Fact>
                  <Show when={r().scope === 'preview'}>
                    <Fact k="Preview">{preliminaryText(r())}</Fact>
                  </Show>
                  <Show when={Object.keys(analysisSection(r())).length === 0}>
                    <Fact k="Settings">not recorded</Fact>
                  </Show>
                </div>
                <Show when={note()}>
                  <p class="cb-muted cb-prev__note">{note()}</p>
                </Show>
                <Show when={blocked()}>
                  <p class="cb-muted cb-prev__note">Cannot open in Results: {blocked()}</p>
                </Show>
                <div class="cb-prev__more">
                  <ResultActions record={r()} onDeleted={props.onDeleted} />
                </div>
              </>
            )}
          </Show>
          <Show when={error()}>
            <p class="cb-warn" role="alert">
              {error()}
            </p>
          </Show>
          <p class="cb-muted cb-prev__note">
            A rerun keeps the old result. Both stay listed until one is deleted.
          </p>
        </div>
      </Show>
      <Show when={showSettings() && rec()}>
        {(r) => <AnalysisRunSettings record={r()} onClose={() => setShowSettings(false)} />}
      </Show>
    </Modal>
  );
}
