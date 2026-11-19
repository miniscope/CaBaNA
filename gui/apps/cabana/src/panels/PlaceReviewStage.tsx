// The Preview window of the Place cells page, and the summary of every setting a run uses.

import { type JSX } from 'solid-js';
import type { SummaryGroup } from '../components/GuidedReview.tsx';
import { arena, effectiveBin, sizeCm } from '../lib/arena.ts';
import { placeSettings } from '../lib/place-run.ts';
import { denomText, percentText } from '../lib/metrics.ts';
import { placeNeural } from '../lib/prepared.ts';
import { prep } from '../lib/preprocess.ts';
import { auto } from './PlaceSettingFields.tsx';
import { PreviewBody } from './PreviewBody.tsx';

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

/** The Preview window of Place cells: the preview run's maps, the shuffle count and Run preview. */
export function PlaceReviewStage(props: {
  groups: SummaryGroup[];
  blocked?: string;
}): JSX.Element {
  return (
    <PreviewBody
      id="place"
      groups={props.groups}
      full={placeSettings.nShuffles}
      alpha={placeSettings.alpha}
      blocked={props.blocked}
      how={
        <>
          <p>
            A preview runs the whole analysis with fewer shuffles, so its p-values are coarser than
            the full analysis's: the smallest p it can give is 1 / (shuffles + 1). Use it to check
            the settings, not to report or rank cells.
          </p>
          <p>
            Each map is one cell's event-rate map over the arena, scaled to that cell's own peak, so
            compare shapes and not brightness. Cells are listed by spatial information, highest
            first. Grey bins were visited too little to estimate a rate.
          </p>
        </>
      }
    />
  );
}
