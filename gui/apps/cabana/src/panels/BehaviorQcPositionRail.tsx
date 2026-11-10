// Behavioral QC position tracking: summary cards and the flagged-segment list with its correction notes.
import { Show, type JSX } from 'solid-js';
import { positionExtremes, type Segment } from '../lib/qc-segments.ts';
import { choiceOf, jumpRows, setChoice } from '../lib/position-corrections.ts';
import { openData, showRows } from '../lib/data-setup-view.ts';
import type { MetricCard } from '../components/MetricCards.tsx';
import { maxSpeed } from '../lib/store.ts';
import { Advice, PagedList, RailBox } from './QcParts.tsx';
import { InfoTip } from './InfoTip.tsx';
import { fmtS, posOk, SEG, segIndex, segments, selectSegment } from './BehaviorQc.tsx';

export const positionMetrics = (): MetricCard[] => {
  const p = posOk();
  if (!p) return [];
  const { maxJump, longestGapS } = positionExtremes(p);
  const n = segments().length;
  return [
    {
      label: 'Flagged segments',
      value: String(n),
      denom: 'jumps and lost stretches over 1 s',
      tone: n ? 'orange' : 'ok',
    },
    {
      label: 'Max jump',
      value: `${maxJump.toFixed(0)} cm/s`,
      denom: 'fastest step between frames',
      tone: maxJump > maxSpeed() ? 'fail' : 'neutral',
    },
    {
      label: 'Longest gap',
      value: `${longestGapS.toFixed(2)} s`,
      denom: 'longest lost stretch',
      tone: longestGapS > 1 ? 'warn' : 'neutral',
    },
    {
      label: 'Jump threshold',
      value: `${maxSpeed()} cm/s`,
      denom: 'set in QC settings',
      tone: 'blue',
    },
  ];
};

/** Interpolate or keep the selected jump. Interpolated frames are read as lost frames. */
function JumpChoice(props: { seg: Segment; n: number }): JSX.Element {
  const rows = () => jumpRows(props.seg).length;
  const c = () => choiceOf(props.seg);
  const choose = (to: 'interpolate' | 'keep') => (
    <button
      class="btn-small"
      classList={{ 'btn-primary': c() === to, 'btn-secondary': c() !== to }}
      aria-pressed={c() === to}
      onClick={() => setChoice(props.seg, c() === to ? undefined : to)}
    >
      {to === 'interpolate' ? 'Interpolate' : 'Keep'}
    </button>
  );
  return (
    <RailBox
      title={`Jump ${props.n}`}
      extra={
        <span class="cb-jump__state">
          <Show when={rows()}>
            <span class="cb-muted">
              {c() === 'interpolate' ? 'Left out' : c() === 'keep' ? 'Kept' : 'Not decided'} ·{' '}
              {rows()} {rows() === 1 ? 'frame' : 'frames'}
            </span>
          </Show>
          <InfoTip label="About Interpolate and Keep">
            Interpolate leaves out the frames inside the jump, as lost frames; the gap settings in
            Preprocess fill them. Keep records that the jump is real. Either choice is saved to the
            experiment config. Rows opens these frames in the data table.
          </InfoTip>
        </span>
      }
    >
      <Show
        when={rows()}
        fallback={
          <p class="cb-muted">
            A single step: the position moved and stayed, so there is no frame to replace.
          </p>
        }
      >
        <div class="cb-controls cb-jump">
          {choose('interpolate')}
          {choose('keep')}
          <button
            class="btn-secondary btn-small"
            title="See these rows in the data table"
            onClick={() => showRows('position', props.seg.first - 3)}
          >
            Rows
          </button>
        </div>
      </Show>
    </RailBox>
  );
}

export function PositionFlagged(): JSX.Element {
  return (
    <Show when={posOk()}>
      <RailBox
        title="Flagged segments"
        grow
        extra={
          <InfoTip label="What is listed">
            Steps faster than the jump threshold, grouped when they are a frame or two apart, and
            lost stretches longer than 1 s. A test can pass with flagged segments when they are
            under the limit.
          </InfoTip>
        }
      >
        <PagedList
          id={SEG}
          items={segments()}
          selected={segIndex()}
          onSelect={selectSegment}
          empty="No jumps over the threshold and no lost stretches over 1 s."
        >
          {(s, i) => (
            <span class="cb-segrow">
              <span class="cb-muted">{String(i + 1).padStart(2, '0')}</span>
              <span>{fmtS(s.start)}</span>
              <span>{s.kind === 'jump' ? 'Jump' : 'Lost'}</span>
              <span>
                {s.kind === 'jump'
                  ? `${s.peak!.toFixed(0)} cm/s`
                  : `${(s.stop - s.start).toFixed(1)} s`}
              </span>
            </span>
          )}
        </PagedList>
      </RailBox>
    </Show>
  );
}

export const PositionActions = () => (
  <Show when={segments()[segIndex()]?.kind === 'jump' && segments()[segIndex()]}>
    {(s) => <JumpChoice seg={s()} n={segIndex() + 1} />}
  </Show>
);

export function PositionCorrection(): JSX.Element {
  return (
    <>
      <p class="cb-muted">
        Short gaps are filled and position is smoothed with a median filter in Preprocess. The
        tracking file is not changed.
      </p>
      <Advice checks={posOk()?.checks ?? []} />
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => openData('position', 'prep')}>
          Open Position → Preprocess
        </button>
      </div>
    </>
  );
}
