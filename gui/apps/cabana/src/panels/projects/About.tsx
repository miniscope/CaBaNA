// What CaBaNA does, in the app: the steps, the analyses, the data it reads and the version.

import { For, type JSX } from 'solid-js';
import pkg from '../../../package.json';
import { ANALYSES } from '../../lib/analyses.ts';
import { BRIEF } from '../../lib/analysis-list.ts';
import { SLOTS, type Level } from '../../lib/slots.ts';
import { goToStep } from '../../lib/store.ts';

const STEPS: [string, string][] = [
  ['Data setup', 'add the files, check each one and describe the experiment.'],
  ['Data visualization', 'look at the neural data, position and annotations together.'],
  ['Analysis', 'choose an analysis, set it up and run it.'],
  ['Results', 'read, compare and export what the runs produced.'],
];

const LEVELS: [Level, string][] = [
  ['required', 'Required'],
  ['recommended', 'Recommended'],
  ['optional', 'Optional'],
];

const labels = (level: Level) =>
  SLOTS.filter((s) => s.level === level)
    .map((s) => s.label.toLowerCase())
    .join(', ');

export function About(): JSX.Element {
  return (
    <div class="cb-proj cb-about">
      <div class="cb-proj__title">
        <div>
          <h2>About CaBaNA</h2>
          <p class="cb-muted cb-proj__sub">
            Analyses of how neural data relates to behavior. CaLab v{pkg.version}
          </p>
        </div>
      </div>
      <button type="button" class="cb-linkbtn" onClick={() => goToStep('welcome')}>
        ‹ Back to Welcome
      </button>
      <h3 class="sc">The four steps</h3>
      <ol>
        <For each={STEPS}>
          {([name, line]) => (
            <li>
              <b>{name}:</b> {line}
            </li>
          )}
        </For>
      </ol>
      <h3 class="sc">The analyses</h3>
      <ul>
        <For each={ANALYSES}>
          {(a) => (
            <li>
              <b>{a.label}:</b> {BRIEF[a.id]}.
            </li>
          )}
        </For>
      </ul>
      <h3 class="sc">The data it reads</h3>
      <ul>
        <For each={LEVELS}>
          {([level, title]) => (
            <li>
              <b>{title}:</b> {labels(level)}.
            </li>
          )}
        </For>
      </ul>
      <p>Files are matched to these by name; a config.yaml can name them.</p>
      <h3 class="sc">Your files</h3>
      <p>Original data files are never changed.</p>
    </div>
  );
}
