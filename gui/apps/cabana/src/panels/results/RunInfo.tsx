// Run information: a collapsible card of key rows beside a result, and the full window with the
// settings used, the data and processing at run time, the run itself and its outputs.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { openProject } from '../../lib/open-project.ts';
import { projects } from '../../lib/projects-client.ts';
import { sizeText } from '../../lib/project-view.ts';
import { analysisLabel, formatWhen } from '../../lib/results-overview.ts';
import { infoSections, keyRows } from '../../lib/run-info.ts';
import { runBytes } from '../../lib/run-size.ts';
import { AnalysisRunSettings } from '../AnalysisRunSettings.tsx';
import { RunDetailsBody } from './RunDetails.tsx';

export interface RunStatusText {
  text: string;
  reason?: string;
}

/** The right-panel card: the key rows, then a button for the full information. */
export function RunInfoCard(props: {
  record: RunRecord;
  open: boolean;
  onToggle: () => void;
  onFull: () => void;
}): JSX.Element {
  return (
    <section class="cb-rx__card cb-ri" aria-label="Run information">
      <div class="cb-rx__head">
        <h3>Run information</h3>
        <span class="cb-spacer" />
        <button
          type="button"
          class="cb-ri__fold"
          aria-expanded={props.open}
          aria-label={props.open ? 'Collapse run information' : 'Expand run information'}
          title={props.open ? 'Collapse' : 'Expand'}
          onClick={() => props.onToggle()}
        >
          {props.open ? '▴' : '▾'}
        </button>
      </div>
      <Show
        when={props.open}
        fallback={
          <p class="cb-muted cb-ri__line">
            {keyRows(props.record)
              .filter((r) => ['Run type', 'Shuffles', 'Data version'].includes(r.k))
              .map((r) => r.v)
              .join(' · ')}
          </p>
        }
      >
        <dl class="cb-ri__rows">
          <For each={keyRows(props.record)}>
            {(r) => (
              <>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </>
            )}
          </For>
        </dl>
        <button type="button" class="btn-secondary cb-ri__full" onClick={() => props.onFull()}>
          View full run information
        </button>
      </Show>
    </section>
  );
}

/** Full run information: one place for the settings used and the run's details. */
export function RunInfoWindow(props: {
  record: RunRecord;
  data?: ExplorerData;
  status: RunStatusText;
  figures?: number;
  onCompare: () => void;
  onApply: () => void;
  onClose: () => void;
}): JSX.Element {
  const r = () => props.record;
  const [bytes] = createResource(
    () => r().run_id,
    () => runBytes(r()),
  );
  const [pipeline] = createResource(
    () => (bridgeReady() && r().pipeline_file ? r().run_id : undefined),
    (id) => bridge.runFile(id, r().pipeline_file!).catch(() => undefined),
  );
  const [file, setFile] = createSignal(false);
  // Frozen settings exist only for runs made with a project open; ask for one of them.
  const [frozen] = createResource(
    () => (bridgeReady() && openProject() && r().engine === 'framework' ? r().run_id : undefined),
    (id) =>
      projects
        .runConfig(id, 'analysis.yaml')
        .then(() => true)
        .catch(() => false),
  );
  const sections = () =>
    infoSections(r(), {
      frozen: openProject() ? frozen() : false,
      status: props.status,
      started: formatWhen(r().created_utc),
      bytes: bytes(),
      sizeText,
      tables: props.data?.tables.length,
      figures: props.figures,
    });
  const compare = () => (openProject() ? undefined : 'Needs a saved project to compare with');
  return (
    <>
      <Modal
        label="Run information"
        title={`Run information · ${analysisLabel(r().analysis)}, ${formatWhen(r().created_utc)}`}
        width={820}
        onClose={props.onClose}
        footer={
          <>
            <button
              type="button"
              class="cb-link"
              disabled={!!compare()}
              title={compare()}
              onClick={props.onCompare}
            >
              Compare settings with now
            </button>
            <span class="cb-spacer" />
            <button type="button" class="btn-secondary" onClick={props.onClose}>
              Close
            </button>
            <button type="button" class="btn-primary" onClick={props.onApply}>
              Apply settings to new run
            </button>
          </>
        }
      >
        <div class="cb-ri__full-grid">
          <For each={sections()}>
            {(sec) => (
              <section>
                <div class="sc">{sec.title}</div>
                <dl class="cb-ri__rows cb-ri__rows--full">
                  <For each={sec.rows}>
                    {(row) => (
                      <>
                        <dt>{row.k}</dt>
                        <dd title={row.tip}>{row.v}</dd>
                      </>
                    )}
                  </For>
                </dl>
                <Show when={sec.title === 'analysis parameters'}>
                  <button type="button" class="cb-link" onClick={() => setFile(true)}>
                    Full settings file
                  </button>
                </Show>
              </section>
            )}
          </For>
        </div>
        <details class="cb-ri__more">
          <summary>Inputs, framework features, pipeline, warnings and errors</summary>
          <RunDetailsBody record={r()} pipeline={pipeline()} />
        </details>
      </Modal>
      <Show when={file()}>
        <AnalysisRunSettings record={r()} onClose={() => setFile(false)} />
      </Show>
    </>
  );
}
