import { createResource, createSignal, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { analysisLabel, formatWhen, hasResults } from '../../lib/results-overview.ts';
import { deleteText } from '../../lib/results-table.ts';
import { sizeText } from '../../lib/project-view.ts';
import { refreshHistory } from '../../lib/runs.ts';
import { runBytes } from '../../lib/run-size.ts';

/** Asks before deleting one saved run, naming what goes and that a rerun is needed for a result. */
export function DeleteRun(props: {
  record: RunRecord;
  /** The saved runs of the project, to say whether other runs of this analysis remain. */
  records: RunRecord[];
  onDeleted: (r: RunRecord) => void;
  onClose: () => void;
}): JSX.Element {
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  // One window per run: the record never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const r = props.record;
  const label = analysisLabel(r.analysis);
  const [bytes] = createResource(() => runBytes(r));
  const others = () =>
    props.records.filter((x) => x.analysis === r.analysis && x.run_id !== r.run_id && hasResults(x))
      .length;
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await bridge.remove(r.run_id);
      await refreshHistory();
      props.onClose();
      props.onDeleted(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      label="Delete run"
      title="Delete this run?"
      width={480}
      onClose={props.onClose}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary cb-btn-danger"
            disabled={busy()}
            onClick={() => void remove()}
          >
            Delete run
          </button>
        </>
      }
    >
      <p class="cb-rx__p">
        {deleteText(
          label,
          formatWhen(r.created_utc),
          others(),
          bytes() === undefined ? undefined : sizeText(bytes()!),
        ).join(' ')}
      </p>
      <Show when={error()}>
        <p class="cb-ro__err" role="alert">
          {error()}
        </p>
      </Show>
    </Modal>
  );
}
