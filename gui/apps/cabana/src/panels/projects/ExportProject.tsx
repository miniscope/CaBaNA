// Export portable project: one zip that opens in CaBaNA on another computer. Configuration and
// history are always in; results, figures and the original data are chosen, with their sizes.

import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Modal } from '../../components/Modal.tsx';
import { openProject } from '../../lib/open-project.ts';
import { setExportOpen } from '../../lib/project-dialogs.ts';
import { exportSizes, exportTotal, sizeText } from '../../lib/project-view.ts';
import { projects, type ExportInclude } from '../../lib/projects-client.ts';

const CHOICES: { key: 'config' | keyof ExportInclude; label: string; note?: string }[] = [
  { key: 'config', label: 'Configuration files and history' },
  { key: 'results', label: 'Analysis results and run records' },
  { key: 'figures', label: 'Figures' },
  {
    key: 'data',
    label: 'Original data',
    note: 'Leave out to share settings and results only; the other computer is asked to locate the data.',
  },
];

export function ExportProject(): JSX.Element {
  const project = openProject()!;
  const [include, setInclude] = createStore<ExportInclude>({
    results: true,
    figures: false,
    data: false,
  });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [report] = createResource(() => projects.storage(project.id));
  const sizes = () => (report() ? exportSizes(report()!) : undefined);
  const total = () => (sizes() ? exportTotal(sizes()!, include) : undefined);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await projects.exportProject(project.id, { ...include });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), {
        href: url,
        download: `${project.name}.cabana.zip`,
      }).click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      label="Export portable project"
      title="Export portable project"
      width={680}
      height={470}
      onClose={() => setExportOpen(false)}
      actions={
        <button
          type="button"
          class="btn-primary btn-small"
          disabled={busy()}
          onClick={() => void run()}
        >
          {busy() ? 'Exporting…' : `Export${total() === undefined ? '' : ` ${sizeText(total()!)}`}`}
        </button>
      }
    >
      <div class="cb-dlg">
        <p class="cb-muted">
          One zip file that opens in CaBaNA on another computer: Open from file… in the Project
          Library, then choose the zip. It is saved like any download.
        </p>
        <For each={CHOICES}>
          {(c) => (
            <label class="cb-dlg__group">
              <input
                type="checkbox"
                checked={c.key === 'config' || include[c.key as keyof ExportInclude]}
                disabled={c.key === 'config'}
                onChange={(e) => setInclude(c.key as keyof ExportInclude, e.currentTarget.checked)}
              />
              <span>
                {c.label}
                <Show when={c.note}>
                  <span class="cb-muted cb-dlg__sub">{c.note}</span>
                </Show>
              </span>
              <span class="cb-sp-mono cb-ps__size">
                {sizes() ? sizeText(sizes()![c.key]) : '…'}
              </span>
            </label>
          )}
        </For>
        <p class="cb-muted">
          Processed intermediates are not included; they are made again when needed.
        </p>
        <Show when={error()}>
          <p class="cb-warn" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Modal>
  );
}
