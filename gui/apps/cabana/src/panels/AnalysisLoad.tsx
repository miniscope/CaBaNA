// Load configuration for one analysis: settings from one of its saved runs, from another project
// (a dataset whose settings this browser kept; this analysis's section only), or from a file (not
// available yet). Loaded settings open in Configure settings to check, and Discard there puts the
// earlier ones back.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { Pill } from '../components/Pill.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { applyAnalysisFrom, snapshotSettings } from '../lib/analysis-draft.ts';
import { openAnalysisWindow } from '../lib/analysis-window.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { formatWhen } from '../lib/results-overview.ts';
import { runRows } from '../lib/results-runs.ts';
import { savedDatasets } from '../lib/settings-template.ts';
import { loadRunSettings } from './analysis-run-settings.ts';

type Source = 'run' | 'project' | 'file';

function Option(props: {
  source: Source;
  chosen: Source;
  onPick: (s: Source) => void;
  title: string;
  detail: string;
  disabled?: string;
  tag?: string;
  children?: JSX.Element;
}): JSX.Element {
  const on = () => props.chosen === props.source;
  return (
    <div class="cb-ld__opt" classList={{ 'cb-ld__opt--on': on() }} aria-disabled={!!props.disabled}>
      <label>
        <input
          type="radio"
          name="load-source"
          checked={on()}
          disabled={!!props.disabled}
          onChange={() => props.onPick(props.source)}
        />
        <span>
          <span class="cb-ld__title">
            {props.title}
            <Show when={props.tag}>
              <Pill tone="neutral">{props.tag}</Pill>
            </Show>
          </span>
          <span class="cb-muted cb-ld__detail">{props.disabled ?? props.detail}</span>
        </span>
      </label>
      <Show when={on() && props.children}>
        <div class="cb-ld__pick">{props.children}</div>
      </Show>
    </div>
  );
}

export function AnalysisLoad(props: {
  id: AnalysisItem;
  records: RunRecord[];
  onClose: () => void;
}): JSX.Element {
  // One window per analysis: the id never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const id = props.id;
  const label = ANALYSES.find((a) => a.id === id)!.label;
  const runs = createMemo(() =>
    runRows(props.records, () => undefined, id).filter((r) => r.record.status !== 'failed'),
  );
  const datasets = () => savedDatasets();
  const [source, setSource] = createSignal<Source>(runs().length ? 'run' : 'project');
  const [runId, setRunId] = createSignal<string>();
  const [dataset, setDataset] = createSignal<string>();
  const [error, setError] = createSignal('');
  const chosenRun = () =>
    runs().find((r) => r.record.run_id === runId())?.record ?? runs()[0]?.record;
  const chosenSet = () => datasets().find((d) => d.name === dataset()) ?? datasets()[0];

  const load = () => {
    const before = snapshotSettings(id);
    setError('');
    if (source() === 'run' && chosenRun()) {
      const err = loadRunSettings(chosenRun()!);
      if (err) return setError(err);
    } else if (source() === 'project' && chosenSet()) applyAnalysisFrom(chosenSet()!.settings, id);
    else return;
    openAnalysisWindow(id, 'configure', before);
  };
  const ready = () =>
    (source() === 'run' && !!chosenRun()) || (source() === 'project' && !!chosenSet());

  return (
    <Modal
      label={`Load configuration, ${label}`}
      title={`Load configuration · ${label}`}
      width={680}
      height={440}
      onClose={props.onClose}
      actions={
        <button type="button" class="btn-primary btn-small" disabled={!ready()} onClick={load}>
          Load
        </button>
      }
    >
      <div class="cb-ld">
        <Option
          source="run"
          chosen={source()}
          onPick={setSource}
          title="From a previous run"
          detail={`Use the settings of a saved ${label} run in this project.`}
          disabled={runs().length ? undefined : `No saved ${label} run in this project yet.`}
        >
          <select
            aria-label="Previous run"
            value={chosenRun()?.run_id}
            onChange={(e) => setRunId(e.currentTarget.value)}
          >
            <For each={runs()}>
              {(r) => (
                <option value={r.record.run_id}>
                  {formatWhen(r.record.finished_utc ?? r.record.created_utc)} ·{' '}
                  {r.record.scope === 'preview' ? 'Quick preview' : 'Full analysis'}
                </option>
              )}
            </For>
          </select>
        </Option>
        <Option
          source="project"
          chosen={source()}
          onPick={setSource}
          title="From another project"
          detail={`Copy ${label} settings saved with another dataset in this browser. Nothing else is copied.`}
          disabled={
            datasets().length ? undefined : "No other dataset's settings are saved in this browser."
          }
        >
          <select
            aria-label="Dataset"
            value={chosenSet()?.name}
            onChange={(e) => setDataset(e.currentTarget.value)}
          >
            <For each={datasets()}>
              {(d) => (
                <option value={d.name}>
                  {d.name} · saved {formatWhen(d.savedAt)}
                </option>
              )}
            </For>
          </select>
        </Option>
        <Option
          source="file"
          chosen={source()}
          onPick={setSource}
          title="From a file"
          detail="A settings file exported from CaBaNA."
          disabled="Not available yet: it needs an analysis settings export format."
          tag="not available yet"
        />
        <Show when={error()}>
          <p class="cb-warn" role="alert">
            {error()}
          </p>
        </Show>
        <p class="cb-muted cb-ld__note">
          Loaded settings open in Configure settings to check before saving. Discard changes there
          puts the earlier settings back.
        </p>
      </div>
    </Modal>
  );
}
