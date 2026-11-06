// The Review and preview stage of the Place cells page: every setting a run uses, the engine
// notice and the choice between a quick preview and the full run.

import { type JSX } from 'solid-js';
import { RunChoice, SettingsSummary, type SummaryGroup } from '../components/GuidedReview.tsx';
import { arena, effectiveBin, sizeCm } from '../lib/arena.ts';
import type { Guided } from '../lib/guided.ts';
import { placeSettings } from '../lib/place-run.ts';
import { denomText, percentText } from '../lib/metrics.ts';
import { shufflesFor } from '../lib/preview.ts';
import { placeNeural } from '../lib/prepared.ts';
import { prep } from '../lib/preprocess.ts';
import { auto } from './PlaceSettingFields.tsx';
import { EngineNotice } from './results/EngineNotice.tsx';
import { ShuffleReach } from './parts.tsx';

/** Every setting a run uses, grouped like the Configure sections. `used` is the retained frame count. */
export function placeSummary(used: number | undefined, framework: boolean): SummaryGroup[] {
  const ps = placeSettings;
  return [
    {
      title: 'Spatial maps',
      section: 'maps',
      items: [
        { label: 'Minimum speed', value: `${prep.minSpeed} cm/s`, note: 'shared with Preprocess' },
        { label: 'Bin size', value: `${effectiveBin()} cm` },
        { label: 'Minimum time per bin', value: `${arena.minOccupancy} s`, note: 'arena setting' },
        { label: 'Smoothing', value: auto(ps.sigmaAuto, `${ps.sigma} bins`) },
      ],
    },
    {
      title: 'Spatial tuning',
      section: 'tests',
      items: [
        { label: 'Shuffles', value: ps.nShuffles.toLocaleString() },
        { label: 'Significance', value: `p < ${ps.alpha}` },
        { label: 'Minimum shift', value: auto(ps.shiftAuto, `${ps.minShiftS} s`) },
        { label: 'Seed', value: String(ps.seed) },
      ],
    },
    {
      title: 'Place fields',
      section: 'fields',
      items: [
        { label: 'Fraction of peak', value: String(ps.fieldThreshold) },
        { label: 'Smallest region', value: `${ps.minFieldBins} bins` },
        { label: 'Minimum time per bin', value: `${ps.minOccFieldsS} s` },
      ],
    },
    {
      title: 'Data',
      items: [
        { label: 'Cells', value: `${placeNeural()?.cells ?? 0} included` },
        {
          label: 'Frames',
          value:
            used !== undefined
              ? `${denomText(used, placeNeural()!.frames, 'retained')} (${percentText(used, placeNeural()!.frames)})`
              : '–',
        },
        { label: 'Arena', value: `${sizeCm()[0].toFixed(0)} × ${sizeCm()[1].toFixed(0)} cm` },
        { label: 'Engine', value: framework ? 'Framework' : 'Browser' },
      ],
    },
  ];
}

/** The Review stage: the settings summary, the engine notice and the preview or full run choice. */
export function PlaceReviewStage(props: {
  g: Guided;
  groups: SummaryGroup[];
  running: boolean;
  blocked?: string;
  previewBlocked?: string;
  onRun: (preview: boolean) => void;
}): JSX.Element {
  const ps = placeSettings;
  return (
    <div class="cb-gs-review">
      <SettingsSummary g={props.g} groups={props.groups} />
      <EngineNotice mode="place" busy={props.running} onBrowserRun={() => props.onRun(false)} />
      <RunChoice
        full={ps.nShuffles}
        preview={shufflesFor('preview', ps.nShuffles)}
        previewBlocked={props.previewBlocked}
        blocked={props.running ? 'A run is in progress.' : props.blocked}
        onPreview={() => props.onRun(true)}
        onFull={() => props.onRun(false)}
      />
      <ShuffleReach shuffles={ps.nShuffles} alpha={ps.alpha} preview={!props.previewBlocked} />
    </div>
  );
}
