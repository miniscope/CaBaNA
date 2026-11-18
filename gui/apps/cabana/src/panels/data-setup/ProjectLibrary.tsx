// The start screen while no session is open: the four steps, a drop area, the sessions whose
// settings this browser kept, and the example datasets.

import { createSignal, For, Show, type JSX } from 'solid-js';
import pkg from '../../../package.json';
import { openEntry, setAppliedNote } from '../../lib/data-setup-view.ts';
import { recentSessions, type RecentSession } from '../../lib/project-library.ts';
import { applySettings, savedDatasets, TEMPLATE_GROUPS } from '../../lib/settings-template.ts';
import { addFiles, EXAMPLES, goToStep, loadExample } from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { fileList } from '../LoadPanel.tsx';

const STEPS: [string, string][] = [
  ['data', 'Data setup'],
  ['viz', 'Data visualization'],
  ['analyze', 'Analysis'],
  ['results', 'Results'],
];

/** A hidden folder input inside a button-styled label. */
function FolderButton(props: {
  class: string;
  children: JSX.Element;
  onFiles: (files: File[]) => void;
}): JSX.Element {
  return (
    <label class={`${props.class} cb-file`}>
      {props.children}
      <input
        type="file"
        hidden
        multiple
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory=""
        onChange={(e) => props.onFiles(fileList(e))}
      />
    </label>
  );
}

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
}

function Recent(): JSX.Element {
  const list = () => recentSessions(savedDatasets());
  return (
    <section class="cb-lib__box" aria-labelledby="cb-lib-recent">
      <div class="cb-lib__boxhead">
        <h3 class="sc" id="cb-lib-recent">
          Recent sessions
        </h3>
        <InfoTip label="About recent sessions">
          Sessions whose settings this browser kept, newest first. Open asks for the session's
          folder, loads it, and applies the settings saved for it (experimental setup,
          preprocessing, QC limits and analysis settings). Original files are not changed.
        </InfoTip>
      </div>
      <Show
        when={list().length}
        fallback={<p class="cb-muted cb-lib__empty">No sessions opened in this browser yet.</p>}
      >
        <ul class="cb-lib__list">
          <For each={list()}>
            {(r) => (
              <li class="cb-lib__item">
                <span class="cb-lib__name">{r.name}</span>
                <span class="cb-lib__when">{r.when}</span>
                <span class="cb-muted cb-lib__sub">{r.task ?? 'Experiment type not set'}</span>
                <FolderButton
                  class="btn-secondary btn-small cb-lib__go"
                  onFiles={(f) => void reopen(r, f)}
                >
                  Open
                </FolderButton>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function Examples(): JSX.Element {
  return (
    <section class="cb-lib__box" aria-labelledby="cb-lib-examples">
      <div class="cb-lib__boxhead">
        <h3 class="sc" id="cb-lib-examples">
          Example data
        </h3>
      </div>
      <p class="cb-muted cb-lib__note">
        Simulated sessions with problems added on purpose, and real recordings.
      </p>
      <ul class="cb-lib__list">
        <For each={EXAMPLES}>
          {(x) => (
            <li class="cb-lib__item">
              <span class="cb-lib__name">
                {x.label}
                <InfoTip label={`About ${x.label}`}>{x.note}</InfoTip>
              </span>
              <span />
              <span class="cb-muted cb-lib__sub">{x.brief}</span>
              <button
                type="button"
                class="btn-secondary btn-small cb-lib__go"
                onClick={() => void loadExample(x.id)}
              >
                Load
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

export function ProjectLibrary(): JSX.Element {
  const [over, setOver] = createSignal(false);
  return (
    <div class="cb-lib">
      <div class="cb-lib__title">
        <h2>CaBaNA</h2>
        <span class="cb-lib__ver">CaLab v{pkg.version}</span>
        <span class="cb-muted">Calcium imaging and behavior analysis</span>
      </div>
      <ol class="cb-lib__steps" aria-label="Steps">
        <For each={STEPS}>
          {([id, label], i) => (
            <li classList={{ 'cb-lib__step--on': i() === 0 }}>
              <button type="button" onClick={() => goToStep(id)}>
                <span class="cb-lib__n">{i() + 1}</span>
                {label}
              </button>
            </li>
          )}
        </For>
      </ol>
      <div
        class="cb-lib__drop"
        classList={{ 'cb-lib__drop--over': over() }}
        onDragOver={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <p class="cb-lib__droptitle">Drop a session folder or files here</p>
        <p class="cb-muted">
          Files are matched by name: timestamps, traces, footprints, position, annotations,
          config.yaml
        </p>
        <div class="cb-controls">
          <FolderButton class="btn-primary btn-small" onFiles={(f) => void addFiles(f)}>
            Choose folder
          </FolderButton>
          <label class="btn-secondary btn-small cb-file">
            Choose files
            <input type="file" hidden multiple onChange={(e) => void addFiles(fileList(e))} />
          </label>
        </div>
        <p class="cb-muted cb-lib__config">
          Repeating an earlier experiment?{' '}
          <button type="button" class="cb-linkbtn" onClick={() => openEntry('config')}>
            Load experiment config
          </button>
        </p>
      </div>
      <div class="cb-lib__cols">
        <Recent />
        <Examples />
      </div>
      <p class="cb-muted cb-lib__foot">Original files are never changed.</p>
    </div>
  );
}
