// The experiment config as text: what Save config as… writes, read-only and updated as fields
// change and files load; and a short guide to the file's parts and where each is set.

import { For, type JSX } from 'solid-js';
import { sessionYaml } from '../../lib/session-config.ts';

export function YamlView(): JSX.Element {
  return (
    <div class="cb-ds-yaml">
      <pre>{sessionYaml()}</pre>
      <p class="cb-muted">
        Read-only. It updates as fields change and files load; Save config as… writes this file.
      </p>
    </div>
  );
}

const PARTS: [string, string][] = [
  ['name', 'Experiment & subjects: the session name.'],
  [
    'neural:\n  file, kind, timestamps\n  alternatives',
    'The analysis data (file, kind) and the reference data (alternatives): Neural acquisition.',
  ],
  [
    'behavior:\n  timestamps, clock\n  position, head_orientation\n  epochs, markers, frame_labels',
    "The loaded behavior files, with Session structure (clock), Tracking (units), Position QC (exclude_frames) and each file's Preprocess settings.",
  ],
  [
    'arena:\n  size, units\n  zones, enclosures, dividers',
    'Spatial setup: typed here or drawn in the arena editor. Coordinates are cm from the lower left corner, y up.',
  ],
  ['subjects:\n  focal', 'Experiment & subjects: the subject ID.'],
  [
    'metadata:\n  species, brain_region, device,\n  stimuli, label_roles, …',
    'Experiment & subjects, Tracking, Stimuli & cues and Neural acquisition. Descriptive: analyses read only the stimuli and label roles.',
  ],
];

export function AboutConfig(props: { onYaml: () => void }): JSX.Element {
  return (
    <div class="cb-ds-about">
      <p class="cb-muted">
        One file describes the session: which files to load, how to line them up, the arena, and
        notes about the experiment. The framework reads it with load_session_dir, so the same file
        runs the analyses in Python. Changes here, and in each file's sections, update the same
        config.yaml.
      </p>
      <div class="cb-ds-about__grid">
        <For each={PARTS}>
          {([k, d]) => (
            <>
              <pre>{k}</pre>
              <p>{d}</p>
            </>
          )}
        </For>
      </div>
      <button class="cb-linkbtn" onClick={() => props.onYaml()}>
        View full config.yaml
      </button>
    </div>
  );
}
