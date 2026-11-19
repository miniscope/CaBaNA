// "Compare settings with…": the settings this run used against another run's, or against the
// settings now (the configuration file viewer). Only settings are compared, never results.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { openProject } from '../../lib/open-project.ts';
import { openConfigCompare } from '../../lib/project-dialogs.ts';
import { formatWhen } from '../../lib/results-overview.ts';
import { runType } from '../../lib/preview.ts';
import { compareSettings } from '../../lib/settings-compare.ts';

const NOW = 'now';

export function SettingsCompare(props: {
  record: RunRecord;
  /** The other runs of this analysis. */
  others: RunRecord[];
  onClose: () => void;
}): JSX.Element {
  // The first choice is made once, when the window opens.
  // eslint-disable-next-line solid/reactivity
  const [other, setOther] = createSignal(openProject() ? NOW : (props.others[0]?.run_id ?? NOW));
  const run = () => props.others.find((r) => r.run_id === other());
  const diff = () => {
    const r = run();
    return r ? compareSettings(props.record, r) : undefined;
  };
  const label = (r: RunRecord) => `${formatWhen(r.created_utc)} · ${runType(r).text}`;
  const nowNeeds = () => (openProject() ? undefined : 'Needs a saved project');
  return (
    <Modal
      label="Compare settings"
      title={`Compare settings · run of ${formatWhen(props.record.created_utc)}`}
      width={640}
      onClose={props.onClose}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary" onClick={props.onClose}>
            Close
          </button>
          <Show when={other() === NOW}>
            <button
              type="button"
              class="btn-primary"
              disabled={!!nowNeeds()}
              title={nowNeeds()}
              onClick={() => {
                props.onClose();
                openConfigCompare('analysis.yaml', props.record);
              }}
            >
              Compare with the settings now
            </button>
          </Show>
        </>
      }
    >
      <label class="cb-sc__pick">
        <span class="sc">compare with</span>
        <select value={other()} onChange={(e) => setOther(e.currentTarget.value)}>
          <option value={NOW} disabled={!!nowNeeds()} title={nowNeeds()}>
            The settings now{nowNeeds() ? ` (${nowNeeds()!.toLowerCase()})` : ''}
          </option>
          <For each={props.others}>{(r) => <option value={r.run_id}>{label(r)}</option>}</For>
        </select>
      </label>
      <Show
        when={diff()}
        fallback={
          <p class="cb-muted">
            The settings now are compared in the configuration file viewer, which marks the lines
            that changed since this run.
          </p>
        }
      >
        {(d) => (
          <Show
            when={d().length}
            fallback={<p class="cb-rx__p">These runs used the same settings.</p>}
          >
            <table class="cb-rd__t cb-sc__t">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>This run</th>
                  <th>{run() ? formatWhen(run()!.created_utc) : ''}</th>
                </tr>
              </thead>
              <tbody>
                <For each={d()}>
                  {(x) => (
                    <tr>
                      <th scope="row">{x.k}</th>
                      <td>{x.a}</td>
                      <td>{x.b}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        )}
      </Show>
    </Modal>
  );
}
