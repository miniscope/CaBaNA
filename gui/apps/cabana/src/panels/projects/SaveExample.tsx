// Save as project for example data: the name, the folder, what is kept with it, and what is copied.

import { createSignal, onMount, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { exampleChanges } from '../../lib/example-session.ts';
import { formatBytes } from '../../lib/new-project.ts';
import { library, refreshLibrary, tidyPath } from '../../lib/project-session.ts';
import { chosenPaths, projects } from '../../lib/projects-client.ts';
import { copySize, saveExampleAsProject } from '../../lib/save-example.ts';
import { exampleMedia, sessionName } from '../../lib/store.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the project keeps, with the real counts of this session. */
function keptList(): string {
  const c = exampleChanges();
  return [
    `QC corrections (${c.corrections})`,
    `preprocessing (${plural(c.prep, 'change')})`,
    `analysis settings${c.analysis ? ` (${plural(c.analysis, 'analysis', 'analyses')} changed)` : ''}`,
    c.runs
      ? `${plural(c.runs, 'run')} and ${c.runs === 1 ? 'its' : 'their'} results`
      : 'runs and results',
    `change history (${plural(c.log, 'entry', 'entries')})`,
  ].join(' · ');
}

export function SaveExample(props: { onSaved?: () => void; onClose: () => void }): JSX.Element {
  const [name, setName] = createSignal(sessionName() ?? 'Example project');
  const [parent, setParent] = createSignal<string>();
  const [progress, setProgress] = createSignal<string>();
  const [problem, setProblem] = createSignal<string>();
  const busy = () => progress() !== undefined;
  const size = copySize();
  const ok = () => name().trim().length > 0 && !busy();
  onMount(() => !library() && void refreshLibrary());

  async function changeParent(): Promise<void> {
    try {
      const paths = chosenPaths(await projects.dialog('folder', { title: 'Save the project in' }));
      if (paths) setParent(paths[0]);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The folder dialog could not be opened.');
    }
  }

  async function save(): Promise<void> {
    if (!ok()) return;
    setProblem(undefined);
    setProgress('Starting…');
    try {
      await saveExampleAsProject(name().trim(), parent(), setProgress);
      props.onClose();
      props.onSaved?.();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setProgress(undefined);
    }
  }

  return (
    <Modal
      label="Save as project"
      title="Save as project"
      width={560}
      onClose={() => !busy() && props.onClose()}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary" disabled={busy()} onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn-primary" disabled={!ok()} onClick={() => void save()}>
            {busy() ? 'Saving…' : 'Save project'}
          </button>
        </>
      }
    >
      <div class="cb-dlg">
        <label class="cb-np__row">
          <span>Project name</span>
          <input
            type="text"
            value={name()}
            disabled={busy()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            ref={(el) => queueMicrotask(() => el.select())}
          />
        </label>
        <div class="cb-np__row">
          <span>Saved to</span>
          <span class="cb-np__where">
            <span class="cb-np__path">
              {tidyPath(parent() ?? library()?.root ?? '~/CaBaNA Projects')}/{name().trim()}/
            </span>
            <button
              type="button"
              class="btn-secondary btn-small"
              disabled={busy()}
              onClick={() => void changeParent()}
            >
              Change…
            </button>
          </span>
        </div>
        <div class="cb-dlg__kicker">Saved with it</div>
        <p class="cb-dlg__note">{keptList()}</p>
        <p class="cb-dlg__note cb-muted">
          The {size.count} example files ({formatBytes(size.bytes)}) are copied into the project
          folder, since the example has no files of its own on this computer. From then on it is a
          project like any other.
          <Show when={exampleMedia()?.frame || exampleMedia()?.video}>
            {' '}
            The example's arena picture and video are not stored in a project; they stay available
            in this window.
          </Show>
        </p>
        <Show when={progress()}>
          <p class="cb-dlg__note" role="status">
            {progress()}
          </p>
        </Show>
        <Show when={problem()}>
          <p class="cb-warn cb-dlg__note">{problem()}</p>
        </Show>
      </div>
    </Modal>
  );
}
