// The (i) text of each data type on Data setup: what it is, its status, file types, contents, what
// uses it, an example name it is found by, and how to get it. External tools stay hyperlinks.

import { Show, type JSX } from 'solid-js';
import { extText, slotOf, type SlotId } from '../../lib/slots.ts';
import { InfoTip } from '../InfoTip.tsx';

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noopener">
    {text}
  </a>
);
const CALA = () => link('https://miniscope.github.io/CaLab/Cala/', 'Cala');
const EXTRACT = () => (
  <p>
    Made by cell extraction from the miniscope video, together with the other neural files. {CALA()}
    , the extraction tool in CaLab, is recommended; files from other extraction pipelines work too.
  </p>
);
const mono = (t: string) => <span class="cb-sp-mono">{t}</span>;

interface Help {
  what: string;
  usedBy: string;
  get: () => JSX.Element;
}

export const SLOT_HELP: Record<SlotId, Help> = {
  neural_timestamps: {
    what: 'The time of every miniscope frame. It is the master clock: every other file is aligned to it.',
    usedBy: 'Every page and analysis',
    get: () => (
      <p>
        Saved by the acquisition software with each recording. The Miniscope DAQ software writes{' '}
        {mono('timeStamps.csv')} in the miniscope folder of each session; look in your raw recording
        folder.
      </p>
    ),
  },
  neural_deconvolved: {
    what: 'Event estimates from deconvolution: the neural data every analysis reads.',
    usedBy: 'Every analysis',
    get: () => (
      <p>
        Made by deconvolving the denoised or raw traces.{' '}
        {link('https://miniscope.github.io/CaLab/CaDecon/', 'CaDecon')} in CaLab is recommended: it
        estimates the events and shows how well they fit each trace.{' '}
        {link('https://miniscope.github.io/CaLab/CaTune/', 'CaTune')} helps choose its parameters.
        Events from other pipelines work too.
      </p>
    ),
  },
  neural_denoised: {
    what: 'Traces after denoising. Used to view cells and to check the deconvolution; not analyzed.',
    usedBy: 'Data QC, Data visualization',
    get: EXTRACT,
  },
  neural_raw: {
    what: 'Fluorescence traces as extracted, before denoising. Used to check each cell’s signal to noise; not analyzed.',
    usedBy: 'Data QC, Data visualization',
    get: EXTRACT,
  },
  footprints: {
    what: 'The spatial footprint of each cell. Draws the cell map, where cells are selected.',
    usedBy: 'Data visualization, Data QC',
    get: EXTRACT,
  },
  behavior_timestamps: {
    what: 'The time of every behavior camera frame. Aligns behavior to the neural clock.',
    usedBy: 'Every analysis that uses behavior',
    get: () => (
      <p>
        Saved by the acquisition software with each recording, in the behavior camera’s folder (the
        Miniscope DAQ software names it {mono('timeStamps.csv')}).
      </p>
    ),
  },
  position: {
    what: 'The animal’s position in each camera frame.',
    usedBy: 'Place cells, decoding of position, zone checks',
    get: () => (
      <p>
        Made by tracking the animal in the behavior video.{' '}
        {link('https://github.com/denisecailab/ezTrack', 'ezTrack')} tracks the whole animal without
        training; {link('https://github.com/DeepLabCut/DeepLabCut', 'DeepLabCut')} tracks body parts
        after you label example frames. Position can also be marked by hand, frame by frame. The
        file needs frame, x and y columns.
      </p>
    ),
  },
  behavior_annotations: {
    what: 'Scored behavior bouts, each with a start and a stop.',
    usedBy: 'auROC, PETH, decoding, population',
    get: () => (
      <p>
        Score the behavior video by hand or with a behavior classifier, then export each bout’s
        label, start and stop in seconds.
      </p>
    ),
  },
  zone_annotations: {
    what: 'Time spent in each arena zone, as epochs.',
    usedBy: 'auROC, PETH, population',
    get: () => (
      <p>
        Export zone entries and exits from your tracking software (
        {link('https://github.com/denisecailab/ezTrack', 'ezTrack')} reports time in regions you
        draw), or score them by hand.
      </p>
    ),
  },
  head_orientation: {
    what: 'Head orientation from the miniscope’s motion sensor.',
    usedBy: 'Data visualization',
    get: () => (
      <p>
        Recorded by Miniscope V4’s motion sensor and saved as {mono('headOrientation.csv')} in the
        miniscope folder of each session.
      </p>
    ),
  },
  time_markers: {
    what: 'Occurrences represented by a single time, such as tone onset or a TTL edge.',
    usedBy: 'PETH',
    get: () => (
      <p>
        From TTL inputs recorded with the session or from your task-control software. Convert the
        times to seconds on the session clock.
      </p>
    ),
  },
  frame_labels: {
    what: 'One label or value per camera frame: binary labels, categories or numeric signals.',
    usedBy: 'auROC, decoding, population',
    get: () => (
      <p>
        Any per-frame variable: output of a behavior classifier, task state from your task software,
        or a signal you computed.
      </p>
    ),
  },
  behavior_frame: {
    what: 'A still frame from the behavior recording. The arena editor uses it as the background for drawing the arena outline and zones.',
    usedBy: 'Arena editor (Experiment details), position plots',
    get: () => (
      <p>
        Save one frame of the behavior video as an image, with the arena empty if possible. The
        arena editor can also take a frame straight from the video.
      </p>
    ),
  },
  config: {
    what: 'Experiment type, arena, scale, zones, frame rates and units.',
    usedBy: 'Spatial analyses, timing checks',
    get: () => <p>Made with Add experiment details on this page, or saved by another project.</p>,
  },
};

const statusText = (id: SlotId) =>
  slotOf(id).activity
    ? 'One of the behavioral activity files (at least one is required)'
    : {
        required: 'Required',
        recommended: 'Recommended',
        optional: 'Optional',
        unused: 'Not needed',
      }[slotOf(id).level];

/** The (i) beside a data type's name. */
export function SlotInfo(props: { id: SlotId }): JSX.Element {
  const s = () => slotOf(props.id);
  const h = () => SLOT_HELP[props.id];
  return (
    <InfoTip label={`About ${s().label}`} width={340}>
      <div class="cb-ld-help">
        <strong>{s().label}</strong>
        <p>{h().what}</p>
        <dl>
          <dt>Status</dt>
          <dd>{statusText(props.id)}</dd>
          <dt>File type</dt>
          <dd>{extText(s())}</dd>
          <dt>Contents</dt>
          <dd>{s().format}</dd>
          <dt>Used by</dt>
          <dd>{h().usedBy}</dd>
          <dt>Found by name</dt>
          <dd>for example {mono(s().file)}</dd>
        </dl>
        <div class="cb-ld-help__get">
          <strong>How to get this data</strong>
          {h().get()}
        </div>
      </div>
    </InfoTip>
  );
}

/** The (i) of a heading or card: a title and a few paragraphs. */
export function GroupInfo(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <InfoTip label={`About ${props.label}`} width={340}>
      <div class="cb-ld-help">
        <Show when={props.label}>
          <strong>{props.label}</strong>
        </Show>
        {props.children}
      </div>
    </InfoTip>
  );
}
