// Apply settings from another project: pick a saved source, tick the groups to copy, apply. The
// groups and what each leaves out come from settings-template.ts; geometry, clock alignment and
// label selections are never copied. Sources today are the settings this browser kept per session.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Modal } from '../../components/Modal.tsx';
import {
  applySettings,
  savedDatasets,
  TEMPLATE_GROUPS,
  type GroupId,
} from '../../lib/settings-template.ts';
import { projectsOn } from '../../lib/project-session.ts';
import { projectDatasets } from '../../lib/project-sources.ts';
import { sessionName } from '../../lib/store.ts';
import { listed, savedWhen } from '../file-input.ts';

export function ApplyFrom(props: {
  onClose: () => void;
  /** Called with a sentence saying what was applied. */
  onApplied: (text: string) => void;
}): JSX.Element {
  const [name, setName] = createSignal<string>();
  const [include, setInclude] = createStore<Record<GroupId, boolean>>({
    setup: true,
    prep: true,
    qc: true,
    analyses: true,
  });
  // With the engine on the sources are the other projects on disk; otherwise the settings this
  // browser kept for earlier sessions.
  const [onDisk] = createResource(() => (projectsOn() ? true : undefined), projectDatasets);
  const sources = () => (projectsOn() ? (onDisk() ?? []) : savedDatasets());
  const chosen = () => sources().find((d) => d.name === name()) ?? sources()[0];
  const picked = () => TEMPLATE_GROUPS.filter((g) => include[g.id]);
  const apply = () => {
    const d = chosen();
    if (!d) return;
    applySettings(
      d.settings,
      picked().map((g) => g.id),
    );
    props.onApplied(
      `Applied ${listed(picked().map((g) => g.label))} from ${d.name} (saved ${savedWhen(d.savedAt)}).`,
    );
    props.onClose();
  };
  return (
    <Modal
      label="Apply settings from another project"
      title="Apply settings from another project"
      head={<span class="cb-muted cb-vw-facts">into this experimental setup</span>}
      width={760}
      height={540}
      onClose={props.onClose}
      actions={
        <button
          type="button"
          class="btn-primary btn-small"
          disabled={!picked().length || !chosen()}
          onClick={apply}
        >
          Apply {picked().length} {picked().length === 1 ? 'group' : 'groups'}
        </button>
      }
    >
      <div class="cb-dlg">
        <Show
          when={sessionName()}
          fallback={<p class="cb-muted">Load a dataset first. Settings are applied to it.</p>}
        >
          <Show
            when={sources().length}
            fallback={
              <p class="cb-muted">
                {projectsOn()
                  ? onDisk.loading
                    ? 'Reading the other projects…'
                    : 'There is no other project to take settings from yet.'
                  : "No other project's settings are saved in this browser yet."}{' '}
                To use a config file instead, choose Load a config file in the Actions menu.
              </p>
            }
          >
            <label class="cb-dlg__from">
              From
              <select value={chosen()?.name} onChange={(e) => setName(e.currentTarget.value)}>
                <For each={sources()}>
                  {(d) => (
                    <option value={d.name}>
                      {d.name} · saved {savedWhen(d.savedAt)}
                    </option>
                  )}
                </For>
              </select>
              <span class="cb-muted">or Actions, Load a config file</span>
            </label>
            <For each={TEMPLATE_GROUPS}>
              {(g) => (
                <label class="cb-dlg__group">
                  <input
                    type="checkbox"
                    checked={include[g.id]}
                    onChange={(e) => setInclude(g.id, e.currentTarget.checked)}
                  />
                  <span>
                    {g.label}
                    <span class="cb-muted cb-dlg__sub">
                      Copies {g.copies}.{g.skips ? ` Not copied: ${g.skips}.` : ''}
                    </span>
                  </span>
                </label>
              )}
            </For>
            <p class="cb-dlg__never">
              <b>Never copied:</b> arena outline and scale, zone positions, reference picture, clock
              offset and scale, label selections, QC review marks and rejected cells. They belong to
              one recording; draw or check them in this project.
              {projectsOn() ? '' : ' Settings are kept in this browser only.'}
            </p>
          </Show>
        </Show>
      </div>
    </Modal>
  );
}
