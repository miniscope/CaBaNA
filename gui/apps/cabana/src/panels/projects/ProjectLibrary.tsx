// Project Library: the sessions whose settings this browser kept, newest first. Saved projects on
// disk replace this list when the engine can list them. Opening one asks for its folder again,
// loads it and applies the settings saved for it.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { setAppliedNote } from '../../lib/data-setup-view.ts';
import { recentSessions, type RecentSession } from '../../lib/project-library.ts';
import { applySettings, savedDatasets, TEMPLATE_GROUPS } from '../../lib/settings-template.ts';
import { addFiles, goToStep } from '../../lib/store.ts';
import { fileList } from '../LoadPanel.tsx';
import { FolderButton } from './FolderButton.tsx';

const NEEDS_ENGINE = 'Needs saved projects (engine)';

/** Load the session's folder again, then apply every group of the settings saved for it. */
async function reopen(r: RecentSession, files: File[]): Promise<void> {
  if (!files.length) return;
  // Held before loading: loading saves the new session's settings under its folder name.
  const saved = r.saved;
  await addFiles(files);
  applySettings(
    saved.settings,
    TEMPLATE_GROUPS.map((g) => g.id),
  );
  setAppliedNote(
    `Applied the settings saved for ${saved.name}: ${TEMPLATE_GROUPS.map((g) => g.label.toLowerCase()).join(', ')}.`,
  );
  goToStep('data');
}

/** A folder that is not in the list: load it like a new project, without saved settings. */
async function openFolder(files: File[]): Promise<void> {
  if (!files.length) return;
  await addFiles(files);
  goToStep('data');
}

export function ProjectLibrary(): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [opening, setOpening] = createSignal<RecentSession>();
  let picker!: HTMLInputElement;
  const rows = () => {
    const q = query().trim().toLowerCase();
    return recentSessions(savedDatasets()).filter((r) => r.name.toLowerCase().includes(q));
  };
  const open = (r: RecentSession) => {
    setOpening(r);
    picker.click();
  };
  const disabled = (label: string) => ({
    kind: 'action' as const,
    label,
    disabled: NEEDS_ENGINE,
    onSelect: () => {},
  });
  return (
    <div class="cb-proj">
      <div class="cb-proj__title">
        <div>
          <h2>Project Library</h2>
          <p class="cb-muted cb-proj__sub">
            Open a recent project to continue your work. Choose its folder again to load it.
          </p>
        </div>
        <span class="cb-spacer" />
        <FolderButton class="btn-secondary" onFiles={(f) => void openFolder(f)}>
          Open from file…
        </FolderButton>
        <input
          type="search"
          class="cb-proj__search"
          placeholder="Search projects"
          aria-label="Search projects"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory=""
        onChange={(e) => {
          const r = opening();
          const files = fileList(e);
          if (r) void reopen(r, files);
        }}
      />
      <div class="cb-proj__card cb-pl__table">
        <Show
          when={rows().length}
          fallback={
            <p class="cb-muted cb-pl__empty">
              {query().trim()
                ? 'No project matches the search.'
                : 'No projects opened in this browser yet. Use + New Project in the sidebar to start one.'}
            </p>
          }
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Last opened</th>
                <th>Files</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r) => (
                  <tr class="cb-pl__row" onClick={() => open(r)}>
                    <td>
                      <div class="cb-pl__name">{r.name}</div>
                      <div class="cb-muted cb-pl__kinds">{r.task ?? 'Experiment type not set'}</div>
                    </td>
                    <td>{r.when}</td>
                    <td>—</td>
                    <td>—</td>
                    <td class="cb-pl__act" onClick={(e) => e.stopPropagation()}>
                      <ActionsMenu
                        class="btn-secondary btn-small"
                        items={[
                          { kind: 'action', label: 'Open', onSelect: () => open(r) },
                          disabled('Rename'),
                          disabled('Duplicate'),
                          disabled('Show in Finder'),
                          { kind: 'separator' },
                          { ...disabled('Delete project…'), danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
}
