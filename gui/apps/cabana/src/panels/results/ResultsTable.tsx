import { createResource, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Pill, RunTypePill } from '../../components/Pill.tsx';
import { type RunRecord } from '../../lib/bridge-client.ts';
import type { Match } from '../../lib/results-match.ts';
import {
  failureMessage,
  formatWhen,
  goToAnalysis,
  hasResults,
} from '../../lib/results-overview.ts';
import { headlineOf, tableCounts, tableRows, type TableRow } from '../../lib/results-table.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { PREVIEW_TEXT } from '../../lib/preview.ts';
import { InfoTip } from '../InfoTip.tsx';
import { ViewResultsMenu } from '../ViewResultsMenu.tsx';
import { openProject } from '../../lib/open-project.ts';
import { openProjectSettings, setExportOpen } from '../../lib/project-dialogs.ts';
import { savedData } from './run-data.ts';

function Status(props: { row: TableRow }): JSX.Element {
  const r = () => props.row.record;
  return (
    <>
      <Show when={r()} fallback={<span class="cb-muted">No runs yet</span>}>
        {(rec) => (
          <>
            <Show when={props.row.status === 'needs_rerun'}>
              <Pill tone="corr">Needs rerun</Pill>
            </Show>
            <Show when={props.row.status === 'current'}>
              <Pill tone="ok">Current</Pill>
            </Show>
            <Show when={props.row.status === 'older'}>
              <Pill tone="neutral">Older settings</Pill>
            </Show>
            <Show when={props.row.status === 'saved'}>
              <Pill tone="neutral" title="Cannot be compared with the settings now">
                Not compared
              </Pill>
            </Show>
            <Show when={props.row.status === 'running'}>
              <Pill tone="flag">Running</Pill>
            </Show>
            <Show when={props.row.status === 'failed'}>
              <Pill tone="flag">{rec().status === 'failed' ? 'Failed' : 'No results'}</Pill>
            </Show>
            <Show when={props.row.reason}>
              <span class="cb-rx__why">{props.row.reason}</span>
            </Show>
            <Show when={props.row.status === 'failed' && rec().status === 'failed'}>
              <span class="cb-rx__why">{failureMessage(rec())}</span>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}

function Result(props: { row: TableRow }): JSX.Element {
  const [headline] = createResource(
    () => {
      const r = props.row.record;
      return r && hasResults(r) ? r : undefined;
    },
    async (r) => {
      try {
        return headlineOf(r.analysis as AnalysisId, await savedData(r));
      } catch {
        return undefined;
      }
    },
  );
  return (
    <Show
      when={props.row.record}
      fallback={
        <button
          type="button"
          class="cb-link"
          onClick={(e) => {
            e.stopPropagation();
            goToAnalysis(props.row.analysis);
          }}
        >
          Set up in Analysis
        </button>
      }
    >
      <Show
        when={hasResults(props.row.record!)}
        fallback={<span class="cb-muted">No results</span>}
      >
        {headline() ?? (
          <span class="cb-muted">{headline.loading ? 'Reading the run' : 'Saved result'}</span>
        )}
      </Show>
    </Show>
  );
}

/**
 * Results overview: counts, then one table with a row per analysis. View results opens that
 * analysis's Results window on its latest run, or on an earlier one from the menu.
 */
export function ResultsTable(props: {
  records: RunRecord[];
  matchOf: (r: RunRecord) => Match | undefined;
}): JSX.Element {
  const rows = () => tableRows(props.records, props.matchOf);
  const counts = () => tableCounts(props.records, props.matchOf);
  const tiles = (): [string, number][] => [
    ['Saved runs', counts().saved],
    ['Current', counts().current],
    ['Need rerun', counts().needRerun],
    ['Previews', counts().previews],
  ];
  const needsProject = () => (openProject() ? undefined : 'Open or create a project first');
  return (
    <>
      <div class="cb-rx__title">
        <h2>Results</h2>
        <InfoTip label="About saved results">
          <p>
            Every saved run, with the settings and data version that produced it. Opening a result
            never changes the current settings.
          </p>
          <p>
            Type says how a run was made: a Full analysis, or a Preview, {PREVIEW_TEXT}. Settings
            says whether it matches the settings and inputs now: Current, Needs rerun (they changed
            since) or Older settings.
          </p>
        </InfoTip>
        <span class="cb-spacer" />
        <ActionsMenu
          items={[
            {
              kind: 'action',
              label: 'Manage stored outputs',
              disabled: needsProject(),
              onSelect: () => openProjectSettings('storage'),
            },
            {
              kind: 'action',
              label: 'Export all results…',
              sub: 'With the portable project export',
              disabled: needsProject(),
              onSelect: () => setExportOpen(true),
            },
          ]}
        />
        <For each={tiles()}>
          {([label, n]) => (
            <div class="cb-rx__count" aria-label={`${label}: ${n}`}>
              <span class="sc">{label}</span>
              <b>{n}</b>
            </div>
          )}
        </For>
      </div>
      <div class="cb-rx__card">
        <div class="cb-rx__scroll">
          <table class="cb-rx__table">
            <thead>
              <tr>
                <th>Analysis</th>
                <th>Latest run</th>
                <th>Type</th>
                <th>Settings</th>
                <th>Result</th>
                <th>Runs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <tr data-analysis={row.analysis}>
                    <td class="cb-rx__name">{row.label}</td>
                    <td>
                      {row.record ? (
                        formatWhen(row.record.created_utc)
                      ) : (
                        <span class="cb-muted">—</span>
                      )}
                    </td>
                    <td>
                      <Show when={row.type}>{(t) => <RunTypePill type={t()} />}</Show>
                    </td>
                    <td>
                      <Status row={row} />
                    </td>
                    <td>
                      <Result row={row} />
                    </td>
                    <td>{row.runs || ''}</td>
                    <td class="cb-rx__act">
                      <ViewResultsMenu analysis={row.analysis} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="cb-muted cb-rx__note">
          A rerun keeps the old result; both stay listed until one is deleted. View results opens
          the results window; export and delete are in its Actions menu.
        </p>
      </div>
    </>
  );
}
