// Neural data · QC in the shared pop-up frame: the flags, flagged cells with the selected cell's
// footprint and traces, and Keep / Reject as a draft that Apply changes commits. The checks and
// scores are those of the Cells and Deconvolution tests; nothing here changes how a cell is scored.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { FlagsBox, QcPopup, SideHead } from '../components/QcPopup.tsx';
import { stepFlagged } from '../lib/cells.ts';
import { cellsText } from '../lib/changes-log.ts';
import { kernelChecks } from '../lib/decon-state.ts';
import {
  draftRejected,
  pendingRejects,
  rejectChanges,
  setRejects,
  setRestoreOriginal,
  startRejectDraft,
} from '../lib/qc-draft.ts';
import { flagLines } from '../lib/qc-flags.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import {
  cell,
  cellResult,
  cellScores,
  footprints,
  rejectCells,
  rejected,
  restoreCell,
  selectCell,
} from '../lib/store.ts';
import { win } from '../lib/viz.ts';
import { cellChecks, overlapPairs, WORD } from './NeuralQcShared.tsx';
import { QcCellCrop } from './QcCellCrop.tsx';
import { Help, PlotCard } from './QcParts.tsx';
import { WindowTraces } from './QcTraces.tsx';

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Cells with a Check or Reject recommendation, rejected ones included (they stay listed). */
const flaggedIds = createMemo(() =>
  (cellScores() ?? []).flatMap((s, c) => (s.overall !== 'good' ? [c] : [])),
);
/** The chips: flagged cells, and any other cell that is rejected. */
const chipIds = createMemo(() =>
  [...new Set([...flaggedIds(), ...rejected()])].sort((a, b) => a - b),
);

export function NeuralQcPopup(): JSX.Element {
  const [draft, setDraft] = createSignal(startRejectDraft(rejected()));
  // Open on a flagged cell when the selected one is not listed.
  if (chipIds().length && !chipIds().includes(cell())) selectCell(chipIds()[0]);

  const checks = () => [...cellChecks(), ...kernelChecks()];
  const notFlaggedNow = () =>
    (cellScores() ?? []).filter((s) => s.overall !== 'good' && !s.rejected);
  const lines = createMemo(() =>
    flagLines(
      notFlaggedNow().map((s) => s.notes),
      checks(),
    ),
  );
  const notes = () => checks().filter((c) => c.status !== 'pass').length;
  const pending = () => pendingRejects(rejected(), draft());
  const sel = () => cellScores()?.[cell()];
  const isRejected = (c: number) => draftRejected(draft()).has(c);
  const step = (dir: 1 | -1) => {
    const to = stepFlagged(chipIds(), cell(), dir);
    if (to !== undefined) selectCell(to);
  };
  const overlap = () => overlapPairs().find((p) => p.a === cell() || p.b === cell());
  const chipText = (c: number) => {
    const now = rejected().has(c);
    const want = isRejected(c);
    return `${c + 1}${now && want ? ' · rejected' : want ? ' · to reject' : now ? ' · to restore' : ''}`;
  };

  const apply = () => {
    const change = rejectChanges(rejected(), draft());
    if (change.reject.length) rejectCells(change.reject);
    change.restore.forEach(restoreCell);
    markPopupReviewed('neural-qc', 'neural');
  };

  const status = () => {
    const failed = checks().filter((c) => c.status === 'fail').length;
    const head = failed
      ? `${failed} ${failed === 1 ? 'check' : 'checks'} failed`
      : notes()
        ? `Passed with ${notes()} ${notes() === 1 ? 'note' : 'notes'}`
        : 'Passed';
    return `${head} · ${checks().length} checks`;
  };

  return (
    <QcPopup
      kind="qc"
      title="Neural data · QC"
      sub={`${notFlaggedNow().length} cells flagged · ${notes()} ${notes() === 1 ? 'note' : 'notes'}`}
      help={
        <>
          <Help k="What this is">
            The checks on the neural data and the cells they flag. Keep or Reject each cell here;
            nothing changes until Actions, Apply changes. Rejected cells are left out of every
            analysis.
          </Help>
          <Help k="Recommendation">
            Automated, from signal to noise, correlation with a neighbor and events per cell. It
            never rejects a cell by itself.
          </Help>
        </>
      }
      top={<FlagsBox flags={lines().flags} passed={lines().passed} />}
      right={
        <>
          <SideHead>cell {cell() + 1}</SideHead>
          <Show
            when={sel()}
            fallback={<div class="cb-qp__rec">Load traces to score this cell.</div>}
          >
            {(s) => (
              <div class="cb-qp__rec">
                Recommendation (automated): <b>{WORD[s().overall]}</b>
              </div>
            )}
          </Show>
          <label class="cb-qp__opt">
            <input
              type="radio"
              name="cell-decision"
              checked={!isRejected(cell())}
              onChange={() => setDraft(setRejects(draft(), [cell()], false))}
            />
            Keep
          </label>
          <label class="cb-qp__opt">
            <input
              type="radio"
              name="cell-decision"
              checked={isRejected(cell())}
              onChange={() => setDraft(setRejects(draft(), [cell()], true))}
            />
            Reject
          </label>
          <div class="cb-qp__row">
            <button
              class="btn-secondary btn-small"
              disabled={stepFlagged(chipIds(), cell(), -1) === undefined}
              onClick={() => step(-1)}
            >
              Previous flagged
            </button>
            <button
              class="btn-secondary btn-small"
              disabled={stepFlagged(chipIds(), cell(), 1) === undefined}
              onClick={() => step(1)}
            >
              Next flagged
            </button>
          </div>
          <SideHead>all flagged cells</SideHead>
          <label class="cb-qp__opt">
            <input
              type="checkbox"
              disabled={!chipIds().length}
              checked={chipIds().length > 0 && chipIds().every(isRejected)}
              onChange={(e) => setDraft(setRejects(draft(), chipIds(), e.currentTarget.checked))}
            />
            Reject all {chipIds().length} flagged cells
          </label>
          <div class="cb-qp__earlier">
            Applied earlier:{' '}
            {rejected().size
              ? `${cellsText([...rejected()]).toLowerCase()} rejected`
              : 'nothing rejected'}
            .{' '}
            {pending()
              ? `${pending()} pending ${pending() === 1 ? 'change' : 'changes'}.`
              : 'No pending changes.'}
            <div class="cb-muted">
              Nothing changes until Actions, Apply changes. Rejected cells are left out of every
              analysis.
            </div>
          </div>
        </>
      }
      resetChecked={draft().restoreOriginal}
      onReset={(on) => setDraft(setRestoreOriginal(draft(), on))}
      status={status()}
      pending={pending()}
      onApply={apply}
      onContinue={() => markPopupReviewed('neural-qc', 'neural')}
      onClose={closeQcPopup}
    >
      <Show
        when={cellScores()}
        fallback={<div class="cb-empty">Load raw or denoised traces to score the cells.</div>}
      >
        <div class="cb-qp__chips" role="group" aria-label="Flagged cells">
          <span class="cb-qp__small">flagged cells</span>
          <For each={chipIds()}>
            {(c) => (
              <button
                type="button"
                class="cb-qp__chip"
                classList={{ 'cb-qp__chip--on': c === cell() }}
                aria-pressed={c === cell()}
                onClick={() => selectCell(c)}
              >
                {chipText(c)}
              </button>
            )}
          </For>
          <Show when={!chipIds().length}>
            <span class="cb-qp__small">none</span>
          </Show>
        </div>
        <div class="cb-qp__cell">
          <Show when={footprints()}>
            <QcCellCrop />
          </Show>
          <div>
            <div class="cb-qp__title">
              <b>Cell {cell() + 1}</b>
            </div>
            <div class="cb-qp__flagtext">
              <Show when={sel()?.notes.length} fallback="No flags.">
                {sel()!.notes.join(', ')}
              </Show>
              <Show when={overlap()}>
                {(p) =>
                  ` · footprint overlaps cell ${(p().a === cell() ? p().b : p().a) + 1} (${p().note})`
                }
              </Show>
              <Show when={(sel()?.corr ?? -1) >= 0}>
                {` · most correlated neighbor: cell ${(cellResult()?.partner[cell()] ?? -1) + 1}, r = ${sel()!.corr.toFixed(2)}`}
              </Show>
            </div>
          </div>
        </div>
        <PlotCard
          title={`Traces, cell ${cell() + 1}`}
          legend={
            <span class="cb-qp__small">
              {clock(win()[0])}–{clock(win()[1])}
            </span>
          }
          help={
            <>
              <Help k="What is plotted">
                The selected cell's raw fluorescence, denoised trace and deconvolved events, one
                panel each, for whichever are loaded, over the Data visualization window.
              </Help>
              <Help k="Axes">Time in seconds; each panel has its own vertical scale.</Help>
              <Help k="Colors">Gray: raw. Blue: denoised. Orange: deconvolved events.</Help>
              <Help k="Linked">
                The panels share zoom and cursor: scroll to zoom, drag to pan. The window is the one
                set on Data visualization.
              </Help>
              <Help k="Limits">Scales differ between panels, so heights cannot be compared.</Help>
            </>
          }
        >
          {(s) => (
            <div class="cb-qp__traces" style={{ height: `${s().h}px` }}>
              <WindowTraces height={Math.max(70, (s().h - 70) / 3)} />
            </div>
          )}
        </PlotCard>
      </Show>
    </QcPopup>
  );
}
