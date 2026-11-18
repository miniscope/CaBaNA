import { createSignal, Show, type JSX } from 'solid-js';
import { CompactHeader } from '@calab/ui';
import pkg from '../../package.json';
import {
  closeSession,
  deconvolved,
  goToStep,
  experiment,
  experimentId,
  samplingRate,
  sessionDuration,
  sessionName,
  setSessionName,
  source,
  traceMatrix,
} from '../lib/store.ts';
import { headerLine, type SessionFacts } from '../lib/header-line.ts';
import { nothingLoaded } from '../lib/data-setup-view.ts';
import { renameSaved } from '../lib/settings-template.ts';
import type { MenuItem } from '../lib/actions-menu.ts';
import { ClearSessionDialog, RenameDialog } from '../panels/projects/ProjectDialogs.tsx';
import { ActionsMenu } from './ActionsMenu.tsx';
import { SavedIndicator } from './SavedIndicator.tsx';

/** What is known about the open session; undefined while no neural data is loaded. */
function facts(): SessionFacts | undefined {
  const m = traceMatrix() ?? deconvolved();
  if (!m) return undefined;
  const dur = sessionDuration();
  return {
    name: sessionName() || source.subjectId || undefined,
    task: experimentId() === 'custom' ? undefined : experiment().label,
    cells: m.cells,
    frames: m.frames,
    hz: samplingRate(),
    minutes: dur === undefined ? undefined : dur / 60,
  };
}

const NEEDS_ENGINE = 'Needs saved projects (engine)';
type Dialog = 'rename' | 'clear';

export function Header(): JSX.Element {
  const [dialog, setDialog] = createSignal<Dialog>();
  const projectName = () => sessionName() || 'this session';
  const items = (): MenuItem[] => [
    { kind: 'action', label: 'Rename project', onSelect: () => setDialog('rename') },
    { kind: 'action', label: 'Project settings', disabled: NEEDS_ENGINE, onSelect: () => {} },
    { kind: 'action', label: 'Duplicate project', disabled: NEEDS_ENGINE, onSelect: () => {} },
    {
      kind: 'action',
      label: 'Export portable project…',
      disabled: NEEDS_ENGINE,
      onSelect: () => {},
    },
    { kind: 'action', label: 'Open project library', onSelect: () => goToStep('library') },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Clear session data…',
      danger: true,
      onSelect: () => setDialog('clear'),
    },
    {
      kind: 'action',
      label: 'Delete project…',
      danger: true,
      disabled: NEEDS_ENGINE,
      onSelect: () => {},
    },
  ];
  const rename = (name: string) => {
    const old = sessionName();
    if (old) renameSaved(old, name);
    setSessionName(name);
    setDialog(undefined);
  };
  return (
    <>
      <CompactHeader
        title="CaBaNA"
        version={`CaLab v${pkg.version}`}
        onBrandClick={() => goToStep('welcome')}
        info={<span class="cb-hd-line">{headerLine(facts())}</span>}
        actions={
          <Show when={!nothingLoaded()}>
            <SavedIndicator />
            <ActionsMenu
              label="Manage project"
              class="btn-secondary btn-small cb-hd-btn"
              items={items}
            />
          </Show>
        }
      />
      <Show when={dialog() === 'rename'}>
        <RenameDialog
          name={sessionName() ?? ''}
          onRename={rename}
          onClose={() => setDialog(undefined)}
        />
      </Show>
      <Show when={dialog() === 'clear'}>
        <ClearSessionDialog
          name={projectName()}
          onConfirm={() => {
            setDialog(undefined);
            closeSession();
          }}
          onClose={() => setDialog(undefined)}
        />
      </Show>
    </>
  );
}
