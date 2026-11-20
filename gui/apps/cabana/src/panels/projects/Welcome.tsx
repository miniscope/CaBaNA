// Getting started: what CaBaNA is, then the two ways in (start a new project, open an existing
// one), example data, and three guides.

import { For, onMount, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { ANALYSIS_INFO } from '../../lib/analyze-view.ts';
import { errorText, showMessage } from '../../lib/confirm.ts';
import { guardLeave, openExample, startNewProject } from '../../lib/leave.ts';
import {
  analysisOverviewOpen,
  setAnalysisOverviewOpen,
  setRequirementsTab,
} from '../../lib/load-data-windows.ts';
import {
  library,
  openExisting,
  openFromPath,
  projectsOn,
  refreshLibrary,
} from '../../lib/project-session.ts';
import { chosenPaths, projects } from '../../lib/projects-client.ts';
import { ANALYSIS_ITEMS, ITEM_LABEL } from '../../lib/readiness.ts';
import { EXAMPLES, goToStep } from '../../lib/store.ts';
import { Icon } from '../data-setup/data-illustrations.tsx';

const ENGINE_OFF = 'Start the Python engine to open a project';
const fail = (what: string) => (e: unknown) => showMessage(`${what} did not work`, errorText(e));

/** Ask the engine for a .cabana.zip file and open it. */
async function openZip(): Promise<void> {
  const paths = chosenPaths(await projects.dialog('files', { title: 'Open a .cabana.zip file' }));
  if (!paths) return;
  if (!/\.zip$/i.test(paths[0]))
    return showMessage(
      'Not a CaBaNA project',
      `${paths[0].split(/[\\/]/).pop()} is not a .cabana.zip file. Choose a project exported from CaBaNA.`,
    );
  await openFromPath(paths[0]);
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function openMenu(): MenuItem[] {
  const off = projectsOn() ? undefined : ENGINE_OFF;
  const recent = (library()?.projects ?? []).filter((p) => p.readable).slice(0, 3);
  return [
    {
      kind: 'action',
      label: 'Open a .cabana.zip file…',
      disabled: off,
      onSelect: () => guardLeave(() => void openZip().catch(fail('Opening the project'))),
    },
    { kind: 'separator' },
    { kind: 'header', label: 'Recent projects' },
    ...(recent.length
      ? recent.map((p): MenuItem => ({
          kind: 'action',
          label: `${p.name} · ${shortDate(p.modified)}`,
          onSelect: () =>
            guardLeave(() => void openExisting({ id: p.id }).catch(fail('Opening the project'))),
        }))
      : [
          {
            kind: 'action',
            label: 'No recent projects',
            disabled: off ?? 'No project has been saved yet',
            tipOnly: !off,
            onSelect: () => {},
          } as MenuItem,
        ]),
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Project Library',
      onSelect: () => guardLeave(() => goToStep('library')),
    },
  ];
}

const exampleMenu = (): MenuItem[] =>
  EXAMPLES.map((x) => ({
    kind: 'action',
    label: x.label,
    sub: x.brief,
    onSelect: () =>
      guardLeave(
        () =>
          void openExample(x.id).then((problem) => problem && showMessage('Example data', problem)),
      ),
  }));

function Guide(props: {
  icon: 'book' | 'sliders' | 'play';
  title: string;
  text: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" class="cb-gs__guide" onClick={props.onClick}>
      <Icon name={props.icon} size={26} />
      <span>
        <b>{props.title}</b>
        <span>{props.text}</span>
      </span>
      <Icon name="arrow" size={18} />
    </button>
  );
}

function AnalysisOverview(): JSX.Element {
  return (
    <Modal
      label="Analysis overview"
      title="Analysis overview"
      width={620}
      onClose={() => setAnalysisOverviewOpen(false)}
    >
      <div class="cb-gs__analyses">
        <For each={ANALYSIS_ITEMS}>
          {(id) => (
            <div>
              <h4>{ITEM_LABEL[id]}</h4>
              <p>{ANALYSIS_INFO[id].does}</p>
              <p>Needs: {ANALYSIS_INFO[id].needs}</p>
            </div>
          )}
        </For>
      </div>
    </Modal>
  );
}

export function GettingStarted(): JSX.Element {
  onMount(() => projectsOn() && void refreshLibrary());
  return (
    <div class="cb-gs">
      <header class="cb-gs__hero">
        <h1>CaBaNA</h1>
        <p class="cb-gs__sub">Calcium imaging analysis for behavior</p>
        <p class="cb-gs__text">
          Load, preprocess and analyze miniscope calcium imaging data alongside behavioral
          measurements.
        </p>
      </header>
      <div class="cb-gs__choices">
        <section class="cb-gs__choice">
          <Icon name="filePlus" size={34} />
          <div class="cb-gs__main">
            <h3>Start a new project</h3>
            <p>
              Add your neural and behavioral data. CaBaNA identifies each file and guides you
              through setup.
            </p>
            <div class="cb-gs__foot">
              <button type="button" class="btn-primary" onClick={startNewProject}>
                Load data →
              </button>
            </div>
          </div>
        </section>
        <section class="cb-gs__choice">
          <Icon name="folder" size={34} />
          <div class="cb-gs__main">
            <h3>Open an existing project</h3>
            <p>Continue earlier work, with its files, settings and results.</p>
            <div class="cb-gs__foot">
              <ActionsMenu label="Open CaBaNA project" class="btn-secondary" items={openMenu} />
            </div>
          </div>
        </section>
      </div>
      <div>
        <ActionsMenu label="Try example data" class="btn-secondary btn-small" items={exampleMenu} />
      </div>
      <hr class="cb-gs__rule" />
      <section>
        <h2 class="cb-gs__h">Get started</h2>
        <div class="cb-gs__guides">
          <Guide
            icon="book"
            title="Data requirements"
            text="Required and recommended files for neural and behavioral data."
            onClick={() => setRequirementsTab('neural')}
          />
          <Guide
            icon="sliders"
            title="Analysis overview"
            text="The analyses available: place cells, PETH, auROC, decoding and population."
            onClick={() => setAnalysisOverviewOpen(true)}
          />
          <Guide
            icon="play"
            title="Quick start guide"
            text="A short walkthrough of the CaBaNA workflow."
            onClick={() => goToStep('about')}
          />
        </div>
      </section>
      {analysisOverviewOpen() && <AnalysisOverview />}
    </div>
  );
}
