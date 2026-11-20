// The name window of Save project and of Next on Data setup: the project's name and where its
// folder goes (Change… picks another folder).

import { createSignal, onMount, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { library, nameProblem, refreshLibrary, tidyPath } from '../../lib/project-session.ts';
import { chosenPaths, projects } from '../../lib/projects-client.ts';
import { namePrompt, saveAs, setNamePrompt, suggestedName } from '../../lib/save-project.ts';
import { openProject } from '../../lib/open-project.ts';

export function NamePrompt(): JSX.Element {
  const ask = namePrompt()!;
  const [name, setName] = createSignal(suggestedName());
  const [error, setError] = createSignal<string>();
  const [parent, setParent] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  onMount(() => !library() && void refreshLibrary());
  const here = () =>
    parent() ?? openProject()?.path.replace(/[\\/][^\\/]+$/, '') ?? library()?.root;
  const close = () => !busy() && setNamePrompt(undefined);

  async function changeParent(): Promise<void> {
    const paths = chosenPaths(await projects.dialog('folder', { title: 'Save the project in' }));
    if (paths) setParent(paths[0]);
  }
  async function save(): Promise<void> {
    const problem = nameProblem(name());
    if (problem) return void setError(problem);
    setBusy(true);
    await saveAs(name().trim(), parent(), () => {
      setNamePrompt(undefined);
      ask.after?.();
    });
    setBusy(false);
  }
  return (
    <Modal
      label={ask.thenNext ? 'Name the project to continue' : 'Save project'}
      title={ask.thenNext ? 'Name the project to continue' : 'Save project'}
      width={460}
      onClose={close}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary btn-small" disabled={busy()} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-small"
            disabled={busy()}
            onClick={() => void save()}
          >
            {busy() ? 'Saving…' : ask.thenNext ? 'Save and continue' : 'Save project'}
          </button>
        </>
      }
    >
      <div class="cb-ld-dlg">
        <p class="cb-muted">
          {ask.thenNext
            ? 'The project is saved before Data visualization opens.'
            : 'Saves where each file is, the experiment details and the settings.'}
        </p>
        <input
          type="text"
          aria-label="Project name"
          placeholder="Project name"
          value={name()}
          ref={(el) => queueMicrotask(() => el.select())}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setError(undefined);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <Show when={error()}>
          <span class="cb-ld-dlg__err" role="alert">
            {error()}
          </span>
        </Show>
        <span class="cb-ld-dlg__where cb-muted">
          Saved to{' '}
          <span class="cb-sp-mono">
            {tidyPath(here() ?? '~/CaBaNA Projects')}/{name().trim() || '<name>'}/
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
    </Modal>
  );
}
