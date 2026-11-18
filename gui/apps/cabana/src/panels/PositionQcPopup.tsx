// Position · QC in the shared pop-up frame: jumps and lost stretches over the path and speed
// plots. Interpolate or Keep for each jump is a draft that Apply changes commits; lost stretches
// have no per-item fix. The segments and checks are those of the Position test.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { FlagsBox, QcPopup, SideHead } from '../components/QcPopup.tsx';
import { choiceOf, jumpRows, setChoice } from '../lib/position-corrections.ts';
import { prep } from '../lib/preprocess.ts';
import {
  jumpChanges,
  jumpDraftChoice,
  setJumpChoice,
  startJumpDraft,
  type JumpChoice,
} from '../lib/qc-draft.ts';
import { clock, itemFlagLines, segmentLine } from '../lib/qc-flags.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import type { Segment } from '../lib/qc-segments.ts';
import { maxSpeed } from '../lib/store.ts';
import { PathMap, posOk, segIndex, segments, selectSegment, SpeedPlot } from './BehaviorQc.tsx';
import { Help, PlotCard } from './QcParts.tsx';

const keyOf = (s: Segment) => String(s.first);
const OPTIONS: [JumpChoice | undefined, string][] = [
  ['interpolate', 'Interpolate'],
  ['keep', 'Keep as real'],
  [undefined, 'Not decided'],
];

export function PositionQcPopup(): JSX.Element {
  const [draft, setDraft] = createSignal(startJumpDraft());
  // Single steps have no frame to replace, so there is nothing to choose.
  const jumps = createMemo(() => segments().filter((s) => s.kind === 'jump' && jumpRows(s).length));
  const state = () => jumps().map((s) => ({ key: keyOf(s), applied: choiceOf(s) }));
  const choice = (s: Segment) => jumpDraftChoice(draft(), keyOf(s), choiceOf(s));
  const changes = () => jumpChanges(draft(), state());
  const lines = createMemo(() => itemFlagLines(segments().map(segmentLine), posOk()?.checks ?? []));
  const decided = () => jumps().filter((s) => choice(s) !== undefined).length;
  const checks = () => posOk()?.checks.length ?? 0;
  const numbered = (s: Segment) => segments().indexOf(s) + 1;

  const apply = () => {
    for (const c of changes()) {
      const s = jumps().find((j) => keyOf(j) === c.key);
      if (s) setChoice(s, c.to);
    }
    markPopupReviewed('position-qc', 'arena');
  };

  return (
    <QcPopup
      kind="qc"
      settings="position"
      title="Position · QC"
      sub={
        segments().length
          ? `${segments().filter((s) => s.kind === 'jump').length} jumps · ${segments().filter((s) => s.kind === 'lost').length} lost stretches`
          : 'none flagged'
      }
      width={1060}
      help={
        <Help k="What this is">
          The position checks, with every jump and long lost stretch they found. For a jump,
          Interpolate leaves its frames out as lost frames and Keep records that it is real. Nothing
          changes until Actions, Apply changes.
        </Help>
      }
      top={<FlagsBox flags={lines().flags} passed={lines().passed} />}
      right={
        <>
          <Show
            when={segments().length}
            fallback={
              <>
                <SideHead>corrections</SideHead>
                <div class="cb-qp__small">Nothing to correct.</div>
              </>
            }
          >
            <For each={segments()}>
              {(s) => (
                <div class="cb-qp__pair">
                  <SideHead>
                    <button
                      type="button"
                      class="cb-link"
                      onClick={() => selectSegment(numbered(s) - 1)}
                    >
                      {s.kind === 'jump' ? 'jump' : 'lost stretch'} {numbered(s)} · {clock(s.start)}
                    </button>
                  </SideHead>
                  <Show
                    when={s.kind === 'jump'}
                    fallback={
                      <div class="cb-qp__small">
                        No per-stretch fix. Gap filling in Position preprocessing fills lost runs up
                        to {prep.fillGapS} s; a longer one stays lost.
                      </div>
                    }
                  >
                    <Show
                      when={jumpRows(s).length}
                      fallback={
                        <div class="cb-qp__small">
                          A single step: the position moved and stayed, so there is no frame to
                          replace.
                        </div>
                      }
                    >
                      <For each={OPTIONS}>
                        {([value, label]) => (
                          <label class="cb-qp__opt">
                            <input
                              type="radio"
                              name={`jump-${keyOf(s)}`}
                              checked={choice(s) === value}
                              onChange={() =>
                                setDraft(
                                  setJumpChoice(draft(), jumps().map(keyOf), keyOf(s), value),
                                )
                              }
                            />
                            {label}
                          </label>
                        )}
                      </For>
                      <div class="cb-qp__small">
                        Interpolate leaves the {jumpRows(s).length}{' '}
                        {jumpRows(s).length === 1 ? 'frame' : 'frames'} out as lost frames; gap
                        filling then fills them.
                      </div>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </>
      }
      resetChecked={draft().restoreOriginal}
      onReset={(on) => setDraft({ ...draft(), restoreOriginal: on })}
      status={
        segments().length
          ? `${lines().flags.length} flags · ${decided()} of ${jumps().length} decided`
          : `Passed · ${checks()} checks`
      }
      pending={changes().length}
      onApply={apply}
      onContinue={() => markPopupReviewed('position-qc', 'arena')}
      onClose={closeQcPopup}
    >
      <Show when={posOk()} fallback={<div class="cb-empty">No position data to check.</div>}>
        {(p) => (
          <>
            <PlotCard
              title="Trajectory (cm)"
              class="cb-qp__grow2"
              help={
                <>
                  <Help k="What is plotted">
                    The animal's tracked path in cm. Steps faster than {maxSpeed()} cm/s are red;
                    the selected segment is outlined in black.
                  </Help>
                  <Help k="Axes">x and y in cm, equal scales.</Help>
                  <Help k="Linked">
                    Choosing a segment in the right column zooms the speed plot to it.
                  </Help>
                </>
              }
            >
              {(s) => <PathMap p={p()} w={s().w} h={s().h} />}
            </PlotCard>
            <PlotCard
              title="Speed (cm/s)"
              class="cb-qp__grow1"
              help={
                <>
                  <Help k="What is plotted">Speed between consecutive tracked frames.</Help>
                  <Help k="Axes">Camera time in seconds; speed in cm/s.</Help>
                  <Help k="Thresholds">
                    The red dashed line is the jump threshold ({maxSpeed()} cm/s). The shaded band
                    is the selected segment ({segIndex() + 1} of {segments().length}).
                  </Help>
                  <Help k="Interaction">Scroll to zoom, drag to pan.</Help>
                </>
              }
            >
              {(s) => <SpeedPlot p={p()} h={Math.max(60, s().h - 4)} />}
            </PlotCard>
          </>
        )}
      </Show>
    </QcPopup>
  );
}
