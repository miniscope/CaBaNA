// Behavioral QC position tracking: summary cards and the flagged-segment list with its correction notes.
import { Show, type JSX } from 'solid-js';
import { positionExtremes } from '../lib/qc-segments.ts';
import type { MetricCard } from '../components/MetricCards.tsx';
import { goToStep, maxSpeed } from '../lib/store.ts';
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

export function PositionDetail(): JSX.Element {
  const checks = () => posOk()?.checks ?? [];
  return (
    <>
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
      <RailBox title="Correction">
        <p class="cb-muted">
          Short gaps are filled and position is smoothed with a median filter in Preprocess. The
          tracking file is not changed.
        </p>
        <Advice checks={checks()} />
        <div class="cb-controls">
          <button class="btn-secondary btn-small" onClick={() => goToStep('prep')}>
            Open Preprocess ↗
          </button>
        </div>
      </RailBox>
    </>
  );
}
