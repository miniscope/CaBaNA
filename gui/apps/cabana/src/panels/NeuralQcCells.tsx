// The Cells test of Neural QC: footprint and trace plots, the selected-cell bar, flagged cells and rejection.
import { For, Show, type JSX } from 'solid-js';
import { eventCount, stepFlagged } from '../lib/cells.ts';
import {
  cell,
  cellResult,
  cellScores,
  deconvolved,
  footprints,
  pending,
  rejected,
  rejectCells,
  restoreCell,
  setPendingTo,
  togglePending,
  selectCell,
  traceMatrix,
} from '../lib/store.ts';
import { CellPicker } from './parts.tsx';
import { CellTraces } from './CellTraces.tsx';
import {
  cellChecks,
  ColorBy,
  flaggedCells,
  FOOTPRINT_HELP,
  SquareMap,
  WORD,
} from './NeuralQcShared.tsx';
import { Advice, Help, PagedList, PlotCard, RailBox } from './QcParts.tsx';

/** The selected cell's own numbers: automated recommendation apart from the user's decision. */
function CellBar(): JSX.Element {
  const sel = () => cellScores()?.[cell()];
  const ids = () => flaggedCells().map((x) => x.c);
  const goFlagged = (dir: 1 | -1) => {
    const to = stepFlagged(ids(), cell(), dir);
    if (to !== undefined) selectCell(to);
  };
  return (
    <div class="cb-cbar">
      <b class="cb-cbar__name">Cell {cell() + 1} (selected)</b>
      <Show when={sel()} fallback={<span class="cb-muted">Load traces to score this cell.</span>}>
        <span class="cb-cbar__item">
          <span class="cb-muted">Signal to noise</span>
          <b class={`cb-word--${sel()!.snrLevel}`}>{sel()!.snr.toFixed(1)}</b>
        </span>
        <span class="cb-cbar__item">
          <span class="cb-muted">Events</span>
          <b class={`cb-word--${sel()!.eventLevel}`}>
            {eventCount(sel()!.frac, deconvolved()?.frames ?? 0)?.toLocaleString() ?? 'n/a'}
          </b>
        </span>
        <span class="cb-cbar__item">
          <span class="cb-muted">Recommendation (automated)</span>
          <span class={`cb-pill cb-pill--${sel()!.overall}`}>{WORD[sel()!.overall]}</span>
        </span>
        <span class="cb-cbar__item">
          <span class="cb-muted">Decision (by you)</span>
          <Show
            when={sel()!.rejected}
            fallback={
              <>
                <b>Kept</b>
                <button class="cb-link" onClick={() => rejectCells([cell()])}>
                  Reject
                </button>
              </>
            }
          >
            <b>Rejected</b>
            <button class="cb-link" onClick={() => restoreCell(cell())}>
              Restore
            </button>
          </Show>
        </span>
        <span class="cb-cbar__steps">
          <button
            class="btn-secondary btn-small"
            disabled={stepFlagged(ids(), cell(), -1) === undefined}
            onClick={() => goFlagged(-1)}
          >
            ‹ Previous flagged
          </button>
          <button
            class="btn-secondary btn-small"
            disabled={stepFlagged(ids(), cell(), 1) === undefined}
            onClick={() => goFlagged(1)}
          >
            Next flagged ›
          </button>
        </span>
        <Show when={sel()!.notes.length || sel()!.corr >= 0}>
          <span class="cb-cbar__why cb-muted">
            <Show when={sel()!.notes.length} fallback="No flags.">
              Flagged: {sel()!.notes.join(', ')}.
            </Show>
            <Show when={sel()!.corr >= 0}>
              {' '}
              Most correlated neighbor: cell {(cellResult()?.partner[cell()] ?? -1) + 1}, r ={' '}
              {sel()!.corr.toFixed(2)}.
            </Show>
          </span>
        </Show>
      </Show>
    </div>
  );
}

export function CellsPlot(): JSX.Element {
  const n = () => traceMatrix()?.cells ?? footprints()?.cells ?? 0;
  return (
    <>
      <Show when={!footprints() && traceMatrix()}>
        <div class="cb-note">
          Footprints aren't loaded, so overlap and neighbor correlation can't be checked properly.
          Loading them is recommended.
        </div>
      </Show>
      <Show when={n() > 0}>
        <div class="cb-qc-pair">
          <Show when={footprints()}>
            <PlotCard title="Footprints" tools={<ColorBy />} help={FOOTPRINT_HELP}>
              {(s) => <SquareMap w={s().w} h={s().h} />}
            </PlotCard>
          </Show>
          <PlotCard
            title={`Traces, cell ${cell() + 1}`}
            tools={<CellPicker n={n()} compact />}
            help={
              <>
                <Help k="What is plotted">
                  The selected cell's raw fluorescence, denoised trace and deconvolved events, one
                  panel each, for whichever of them are loaded.
                </Help>
                <Help k="Axes">Time in seconds; each panel has its own vertical scale.</Help>
                <Help k="Colors">Gray: raw. Blue: denoised. Orange: deconvolved events.</Help>
                <Help k="Linked">
                  The panels share zoom and cursor: scroll to zoom, drag to pan. Pick a cell with
                  the cell box or by clicking a footprint.
                </Help>
                <Help k="Limits">
                  Scales differ between panels, so heights cannot be compared across them.
                </Help>
              </>
            }
          >
            {(s) => (
              // Each panel keeps room for its trace under its own time axis; in a short window the
              // card scrolls rather than squeezing the traces flat.
              <div class="cb-plot__scroll" style={{ height: `${s().h}px` }}>
                <CellTraces height={Math.max(90, (s().h - 84) / 3)} />
              </div>
            )}
          </PlotCard>
        </div>
        <CellBar />
      </Show>
    </>
  );
}

export const ticked = () => [...pending()].filter((c) => flaggedCells().some((x) => x.c === c));

export function CellsFlagged(): JSX.Element {
  const flagged = flaggedCells;
  return (
    <Show when={traceMatrix()}>
      <RailBox title="Flagged cells" grow>
        <PagedList
          id="cells"
          rowH={46}
          items={flagged()}
          selected={flagged().findIndex((x) => x.c === cell())}
          onSelect={(i) => selectCell(flagged()[i].c)}
          empty="No flagged cells left."
          before={(x) => (
            <input
              type="checkbox"
              checked={pending().has(x.c)}
              onChange={() => togglePending(x.c)}
              aria-label={`Select cell ${x.c + 1} to reject`}
            />
          )}
        >
          {(x) => (
            <span class="cb-cellrow-item" title={x.s.notes.join(', ')}>
              <span>
                Cell {x.c + 1} <span class={`cb-word--${x.s.overall}`}>{WORD[x.s.overall]}</span>
              </span>
              <span class="cb-muted">{x.s.notes.join(', ')}</span>
            </span>
          )}
        </PagedList>
      </RailBox>
    </Show>
  );
}

export function CellsCorrection(): JSX.Element {
  const flagged = flaggedCells;
  return (
    <>
      <Advice checks={cellChecks()} />
      <Show when={traceMatrix()}>
        <div class="cb-fix">
          <div class="cb-fix__title">Fix in CaBaNA: reject cells</div>
          <Show
            when={flagged().length}
            fallback={<div class="cb-muted">No flagged cells left.</div>}
          >
            <div class="cb-controls">
              <button
                class="btn-secondary btn-small"
                onClick={() => rejectCells(flagged().map((x) => x.c))}
              >
                Reject all flagged ({flagged().length})
              </button>
              <button
                class="btn-secondary btn-small"
                onClick={() => ticked().length && rejectCells(ticked())}
              >
                Reject selected ({ticked().length})
              </button>
              <button class="cb-link" onClick={() => setPendingTo(flagged().map((x) => x.c))}>
                Select all
              </button>
              <button class="cb-link" onClick={() => setPendingTo([])}>
                Clear
              </button>
            </div>
            <div class="cb-muted">
              Tick cells in the Flagged cells list to reject them, or reject them all.
            </div>
          </Show>
          <Show when={rejected().size}>
            <div class="cb-flagged">
              <span class="cb-muted">Rejected ({rejected().size}), click to restore:</span>
              <For each={[...rejected()].sort((a, b) => a - b)}>
                {(c) => (
                  <button class="cb-chip cb-chip--rejected" onClick={() => restoreCell(c)}>
                    {c + 1}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
}
