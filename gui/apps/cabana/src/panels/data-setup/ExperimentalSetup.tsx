// The Experimental setup pop-up: the settings of the experiment in six groups, applied as you
// type. Actions holds the YAML view, applying settings from another project, loading a config
// file and exporting a copy.

import { createSignal, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Modal } from '../../components/Modal.tsx';
import { closeEntry } from '../../lib/data-setup-view.ts';
import { openProject } from '../../lib/open-project.ts';
import { pickFile } from '../../lib/pick-file.ts';
import { openConfigFile } from '../../lib/project-dialogs.ts';
import { tidyPath } from '../../lib/project-session.ts';
import { saveStatus, saveText } from '../../lib/save-status.ts';
import { addFiles, loaded } from '../../lib/store.ts';
import { ApplyFrom } from './ApplyFrom.tsx';
import { ConfigView, setAsYaml } from './ConfigView.tsx';
import { ExportCopy } from './ExportCopy.tsx';

type Dialog = 'apply' | 'export';

/** The file the setup is kept in: the loaded config, else the project's experiment.yaml. */
const fileName = () =>
  openProject() || !loaded.config?.size ? 'experiment.yaml' : loaded.config.name;

/** The file line under the title: file, real save state and, with a project open, its folder. */
function fileLine(): string {
  const { text } = saveText(saveStatus());
  const state = text.charAt(0).toLowerCase() + text.slice(1);
  const folder = openProject() ? ` · ${tidyPath(openProject()!.path)}/` : '';
  return `${fileName()} · ${state}${folder}`;
}

export function ExperimentalSetup(props: {
  /** Called with the sentence describing settings applied from another project. */
  onApplied: (text: string) => void;
}): JSX.Element {
  const [dialog, setDialog] = createSignal<Dialog>();
  const close = () => {
    setAsYaml(false);
    closeEntry();
  };
  return (
    <>
      <Modal
        label="Experimental setup"
        title="Experimental setup"
        head={<span class="cb-muted cb-vw-facts">{fileLine()}</span>}
        width={900}
        height={560}
        closeLabel={
          openProject()
            ? openProject()!.save_mode === 'manual'
              ? 'Close. Changes are saved with Save project'
              : 'Close. Changes are saved automatically'
            : 'Close. Changes are applied as you type'
        }
        onClose={close}
        actions={
          <ActionsMenu
            items={[
              {
                kind: 'action',
                label: 'View as YAML',
                onSelect: () =>
                  openProject() ? openConfigFile('experiment.yaml') : setAsYaml(true),
              },
              {
                kind: 'action',
                label: 'Apply settings from another project…',
                onSelect: () => setDialog('apply'),
              },
              {
                kind: 'action',
                label: 'Load a config file…',
                onSelect: () => pickFile((f) => void addFiles([f], 'config'), '.yaml,.yml'),
              },
              { kind: 'separator' },
              { kind: 'action', label: 'Export a copy…', onSelect: () => setDialog('export') },
            ]}
          />
        }
      >
        <ConfigView />
      </Modal>
      <Show when={dialog() === 'apply'}>
        <ApplyFrom onClose={() => setDialog(undefined)} onApplied={props.onApplied} />
      </Show>
      <Show when={dialog() === 'export'}>
        <ExportCopy onClose={() => setDialog(undefined)} />
      </Show>
    </>
  );
}
