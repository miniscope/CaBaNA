// "Settings used": what a saved run was made with, frozen with the run. Left, the analysis
// section; right, the processing settings at the time. Use these settings copies the analysis
// section into the current settings and opens Configure settings to check them.

import { Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import { Modal } from '../components/Modal.tsx';
import type { RunRecord } from '../lib/bridge-client.ts';
import { ANALYSES } from '../lib/analyses.ts';
import { snapshotSettings } from '../lib/analysis-draft.ts';
import { openAnalysisWindow } from '../lib/analysis-window.ts';
import {
  analysisSection,
  dataVersion,
  processingSection,
  yamlText,
} from '../lib/run-settings-view.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { formatWhen } from '../lib/results-overview.ts';
import { openProject } from '../lib/open-project.ts';
import { openConfigFile } from '../lib/project-dialogs.ts';
import { loadRunSettings } from './analysis-run-settings.ts';

/** Copy the run's settings into the current ones and open Configure on them. Returns an error text. */
export function applyRunSettings(record: RunRecord): string | undefined {
  const id = record.analysis as AnalysisItem;
  const before = snapshotSettings(id);
  const error = loadRunSettings(record);
  if (!error) openAnalysisWindow(id, 'configure', before);
  return error;
}

export function AnalysisRunSettings(props: {
  record: RunRecord;
  onClose: () => void;
}): JSX.Element {
  // One window per run: the record never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const r = props.record;
  const label = ANALYSES.find((a) => a.id === r.analysis)!.label;
  const processing = processingSection(r);
  return (
    <Modal
      label={`Settings used, ${label}`}
      title={`Settings used · ${label} run ${formatWhen(r.finished_utc ?? r.created_utc)}`}
      head={<span class="cb-muted cb-cfg__data">frozen with the run</span>}
      width={1000}
      height={560}
      onClose={props.onClose}
      actions={
        <ActionsMenu
          items={[
            { kind: 'action', label: 'Use these settings', onSelect: () => applyRunSettings(r) },
            // With a project open the run's frozen copies of the yaml files can be read.
            ...(openProject() && r.engine === 'framework'
              ? (['analysis.yaml', 'processing.yaml', 'experiment.yaml'] as const).map((name) => ({
                  kind: 'action' as const,
                  label: `View frozen ${name}`,
                  onSelect: () => openConfigFile(name, r),
                }))
              : []),
          ]}
        />
      }
    >
      <div class="cb-rs">
        <div class="cb-rs__col">
          <div class="sc">analysis settings · {label}</div>
          <pre class="cb-rs__text">{yamlText(analysisSection(r))}</pre>
        </div>
        <div class="cb-rs__col">
          <div class="sc">processing at the time of the run</div>
          <Show
            when={processing}
            fallback={
              <p class="cb-muted">
                Not recorded: runs made in the browser keep the analysis settings only.
              </p>
            }
          >
            {(p) => <pre class="cb-rs__text">{yamlText(p())}</pre>}
          </Show>
          <p class="cb-muted cb-rs__note">
            Data version: {dataVersion(r)} · engine:{' '}
            {r.engine === 'framework' ? 'Python framework' : 'browser'} · seed{' '}
            {r.seeds?.base ?? 'not set'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
