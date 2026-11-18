import { createResource, createSignal, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { openProject } from '../../lib/open-project.ts';
import { sizeText } from '../../lib/project-view.ts';
import { projects } from '../../lib/projects-client.ts';
import { analysisLabel, formatWhen } from '../../lib/results-overview.ts';
import { refreshHistory } from '../../lib/runs.ts';

/** Why Delete outputs is unavailable, or undefined when it can be used. */
export const deleteOutputsNeeds = (engineOn: boolean): string | undefined =>
  engineOn ? undefined : 'Needs the Python engine.';

/**
 * Asks before deleting the large files of one run. The record, its settings and its summary table
 * stay, so the run stays listed as "outputs deleted" and needs a rerun to be explored again.
 */
export function DeleteOutputs(props: { record: RunRecord; onClose: () => void }): JSX.Element {
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  // eslint-disable-next-line solid/reactivity
  const r = props.record;
  // The size comes from the storage report of the open project; without one it is not stated.
  const [info] = createResource(async () => {
    const project = openProject();
    if (!project) return undefined;
    return (await projects.storage(project.id)).runs.find((x) => x.run_id === r.run_id);
  });
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await projects.deleteOutputs(r.run_id);
      await refreshHistory();
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      label="Delete outputs"
      title="Delete this run's outputs?"
      width={480}
      onClose={props.onClose}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary" onClick={props.onClose}>
            Keep outputs
          </button>
          <button
            type="button"
            class="btn-primary cb-btn-danger"
            disabled={busy() || !!info()?.outputs_deleted}
            onClick={() => void remove()}
          >
            Delete outputs{info() ? ` (${sizeText(info()!.large_bytes)})` : ''}
          </button>
        </>
      }
    >
      <p class="cb-rx__p">
        The large result files and figures of the {analysisLabel(r.analysis)} run of{' '}
        {formatWhen(r.created_utc)} are deleted
        <Show when={info()}> ({sizeText(info()!.large_bytes)})</Show>.
      </p>
      <p class="cb-rx__p">
        The run's record, its settings and its summary table stay, so it stays listed as outputs
        deleted. To explore it again, run the analysis again with the same settings.
      </p>
      <Show when={info()?.outputs_deleted}>
        <p class="cb-rx__p">The outputs of this run are already deleted.</p>
      </Show>
      <Show when={error()}>
        <p class="cb-ro__err" role="alert">
          {error()}
        </p>
      </Show>
    </Modal>
  );
}
