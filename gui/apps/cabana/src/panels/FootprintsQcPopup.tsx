// Footprints · QC in the shared pop-up frame: the overlapping pairs, each a choice (keep both or
// reject one cell), applied from Actions. Which pairs overlap is decided as in the Footprints test.

import { createMemo, createSignal, For, type JSX } from 'solid-js';
import { FlagsBox, QcPopup, SideHead } from '../components/QcPopup.tsx';
import {
  pairChoice,
  pendingRejects,
  rejectChanges,
  setPairChoice,
  setRestoreOriginal,
  startRejectDraft,
} from '../lib/qc-draft.ts';
import { pairFlagLines } from '../lib/qc-flags.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import { rejectCells, rejected, restoreCell, selectCell } from '../lib/store.ts';
import {
  ColorBy,
  footprintCheckList,
  FOOTPRINT_HELP,
  overlapPairs,
  SquareMap,
} from './NeuralQcShared.tsx';
import { Help, PlotCard } from './QcParts.tsx';

export function FootprintsQcPopup(): JSX.Element {
  const [draft, setDraft] = createSignal(startRejectDraft(rejected()));
  // The pairs as found now; a pair with a cell rejected earlier is no longer listed.
  const pairs = createMemo(() => overlapPairs());
  const lines = createMemo(() => pairFlagLines(pairs(), footprintCheckList()));
  const pending = () => pendingRejects(rejected(), draft());
  const notes = () => footprintCheckList().filter((c) => c.status !== 'pass').length;

  const apply = () => {
    const change = rejectChanges(rejected(), draft());
    if (change.reject.length) rejectCells(change.reject);
    change.restore.forEach(restoreCell);
    markPopupReviewed('footprints-qc', 'footprints');
  };
  const choose = (a: number, b: number, choice: 'both' | 'a' | 'b') => {
    setDraft(setPairChoice(draft(), a, b, choice));
    selectCell(a, b);
  };

  return (
    <QcPopup
      kind="qc"
      settings="footprints"
      title="Footprints · QC"
      sub={`${pairs().length} overlapping ${pairs().length === 1 ? 'pair' : 'pairs'}`}
      width={1000}
      help={
        <>
          <Help k="What this is">
            Cell pairs whose footprints share over half of the smaller one. Keep both, or reject one
            cell of a pair when both are the same cell. Nothing changes until Actions, Apply
            changes.
          </Help>
        </>
      }
      top={<FlagsBox flags={lines().flags} passed={lines().passed} />}
      right={
        <>
          <For
            each={pairs()}
            fallback={<div class="cb-muted">No cell pairs overlap by more than half.</div>}
          >
            {(p, i) => (
              <div class="cb-qp__pair">
                <SideHead>
                  <button type="button" class="cb-link" onClick={() => selectCell(p.a, p.b)}>
                    pair {i() + 1}
                  </button>
                </SideHead>
                <For
                  each={
                    [
                      ['both', 'Keep both'],
                      ['a', `Reject cell ${p.a + 1}`],
                      ['b', `Reject cell ${p.b + 1}`],
                    ] as const
                  }
                >
                  {([value, label]) => (
                    <label class="cb-qp__opt">
                      <input
                        type="radio"
                        name={`pair-${i()}`}
                        checked={pairChoice(draft(), p.a, p.b) === value}
                        onChange={() => choose(p.a, p.b, value)}
                      />
                      {label}
                    </label>
                  )}
                </For>
              </div>
            )}
          </For>
          <div class="cb-qp__small">Reject one cell of a pair when both are the same cell.</div>
        </>
      }
      resetChecked={draft().restoreOriginal}
      onReset={(on) => setDraft(setRestoreOriginal(draft(), on))}
      status={`${notes() ? `Passed with ${notes()} ${notes() === 1 ? 'note' : 'notes'}` : 'Passed'} · ${footprintCheckList().length} checks`}
      pending={pending()}
      onApply={apply}
      onContinue={() => markPopupReviewed('footprints-qc', 'footprints')}
      onClose={closeQcPopup}
    >
      <PlotCard title="Footprint map" tools={<ColorBy />} help={FOOTPRINT_HELP}>
        {(s) => <SquareMap w={s().w} h={s().h} />}
      </PlotCard>
    </QcPopup>
  );
}
