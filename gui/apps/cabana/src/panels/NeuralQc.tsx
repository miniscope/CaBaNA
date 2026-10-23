import { createSignal, For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CellScore, Level } from '../lib/cells.ts';
import { eventTraceCheckList, kernelChecks } from '../lib/decon-state.ts';
import {
  cell,
  cellResult,
  cellScores,
  colorBy,
  deconvolved,
  footprints,
  neuralChecks,
  pending,
  rejected,
  rejectCells,
  restoreCell,
  setPendingTo,
  togglePending,
  selectCell,
  setColorBy,
  traceMatrix,
} from '../lib/store.ts';
import { CellPicker, Checks, QcVerdict } from './parts.tsx';
import { DeconQc } from './DeconQc.tsx';
import { CellTraces } from './CellTraces.tsx';
import { FootprintViewer } from './FootprintViewer.tsx';
import { QcDashboard } from './QcDashboard.tsx';

const WORD: Record<Level, string> = { good: 'Accept', warn: 'Check', bad: 'Reject' };

function Score(props: { s: CellScore; partner: number }): JSX.Element {
  const s = () => props.s;
  return (
    <div class="cb-score">
      <span class={`cb-pill cb-pill--${s().overall}`}>Recommendation: {WORD[s().overall]}</span>
      <span class={`cb-badge cb-badge--${s().snrLevel}`}>Signal to noise {s().snr.toFixed(1)}</span>
      <span class={`cb-badge cb-badge--${s().corrLevel}`}>
        {s().corr < 0
          ? 'No neighbors'
          : `Neighbor correlation ${s().corr.toFixed(2)} (cell ${props.partner + 1})`}
      </span>
      <Show when={!Number.isNaN(s().frac)}>
        <span class={`cb-badge cb-badge--${s().eventLevel}`}>
          Deconvolved events on {(100 * s().frac).toFixed(1)}% of frames
        </span>
      </Show>
    </div>
  );
}

/** Footprint map and the traces of one cell, each labeled. */
function Explorer(): JSX.Element {
  const n = () => traceMatrix()?.cells ?? footprints()?.cells ?? 0;
  const scores = () => cellScores();
  const flagged = () =>
    (scores() ?? [])
      .map((s, c) => ({ s, c }))
      .filter((x) => x.s.overall !== 'good' && !x.s.rejected);
  return (
    <Show when={n() > 0}>
      <section class="cb-group" id="cb-cells">
        <h3>Cell explorer</h3>
        <Show when={flagged().length}>
          <div class="cb-flagged">
            <span class="cb-muted">{flagged().length} flagged cells:</span>
            <For each={flagged()}>
              {(x) => (
                <button
                  class={`cb-chip cb-chip--${x.s.overall}`}
                  title={x.s.notes.join(', ')}
                  classList={{ 'cb-chip--on': x.c === cell() }}
                  onClick={() => selectCell(x.c)}
                >
                  {x.c + 1}
                </button>
              )}
            </For>
          </div>
        </Show>
        <CellPicker n={n()} />
        <Show when={scores()?.[cell()]?.rejected}>
          <div class="cb-note">
            This cell is rejected: QC and later steps leave it out.{' '}
            <button class="cb-link" onClick={() => restoreCell(cell())}>
              Restore
            </button>
          </div>
        </Show>
        <Show when={scores()?.[cell()]}>
          <Score s={scores()![cell()]} partner={cellResult()?.partner[cell()] ?? -1} />
          <Show when={scores()![cell()].notes.length}>
            <div class="cb-muted">{scores()![cell()].notes.join(' · ')}</div>
          </Show>
        </Show>
        <div class="cb-cellgrid" classList={{ 'cb-cellgrid--one': !footprints() }}>
          <Show when={footprints()}>
            <div>
              <div class="cb-label">Footprints</div>
              <FootprintViewer partners />
              <div class="cb-controls">
                <label>
                  Color by
                  <select
                    value={colorBy()}
                    onChange={(e) => setColorBy(e.currentTarget.value as 'cell' | 'quality')}
                  >
                    <option value="cell">Cell</option>
                    <option value="quality">Quality (green, amber, red)</option>
                  </select>
                </label>
              </div>
              <div class="cb-muted">
                Click a cell to select it. White: selected. Orange: neighbor it correlates with
                most. Cyan: overlapping partner.
              </div>
            </div>
          </Show>
          <div>
            <CellTraces />
          </div>
        </div>
      </section>
    </Show>
  );
}

/** Reject flagged cells: all of them, or the ones the user ticks. */
function RejectCells(): JSX.Element {
  const flagged = () =>
    (cellScores() ?? [])
      .map((s, c) => ({ s, c }))
      .filter((x) => x.s.overall !== 'good' && !x.s.rejected);
  const picked = () => [...pending()].filter((c) => flagged().some((x) => x.c === c));
  return (
    <div class="cb-fix">
      <div class="cb-fix__title">Fix in CaBaNA: reject cells</div>
      <Show when={flagged().length} fallback={<div class="cb-muted">No flagged cells left.</div>}>
        <div class="cb-controls">
          <button
            class="btn-secondary btn-small"
            onClick={() => rejectCells(flagged().map((x) => x.c))}
          >
            Reject all flagged ({flagged().length})
          </button>
          <button
            class="btn-secondary btn-small"
            onClick={() => picked().length && rejectCells(picked())}
          >
            Reject selected ({picked().length})
          </button>
          <button class="cb-link" onClick={() => setPendingTo(flagged().map((x) => x.c))}>
            Select all
          </button>
          <button class="cb-link" onClick={() => setPendingTo([])}>
            Clear
          </button>
        </div>
        <div class="cb-flagged">
          <For each={flagged()}>
            {(x) => (
              <label class={`cb-chip cb-chip--${x.s.overall}`} title={x.s.notes.join(', ')}>
                <input
                  type="checkbox"
                  checked={pending().has(x.c)}
                  onChange={() => togglePending(x.c)}
                />{' '}
                {x.c + 1}
              </label>
            )}
          </For>
        </div>
        <div class="cb-muted">
          Tick the cells to reject, or reject them all. Hover a cell for why it is flagged.
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
  );
}

function CellsQc(): JSX.Element {
  return (
    <>
      <QcVerdict
        section="cells"
        title="Neural data"
        checks={[...neuralChecks(), ...eventTraceCheckList()]}
        allowed={['poorCellPct', 'overlapPct', 'riseLowPct']}
      >
        <Show when={traceMatrix()}>
          <RejectCells />
        </Show>
      </QcVerdict>
      <Show when={!footprints() && traceMatrix()}>
        <div class="cb-note">
          Footprints aren't loaded, so overlap and neighbor correlation can't be checked properly.
          Loading them is recommended.
        </div>
      </Show>
      <Checks title="Cells" checks={[...neuralChecks(), ...eventTraceCheckList()]} />
      <Explorer />
    </>
  );
}

const SUBTABS = [
  { id: 'cells', label: 'Cells', view: CellsQc },
  { id: 'decon', label: 'Deconvolution', view: DeconQc },
] as const;

export function NeuralQc(): JSX.Element {
  const [sub, setSub] = createSignal<(typeof SUBTABS)[number]['id']>('cells');
  return (
    <>
      <Show when={!traceMatrix() && !deconvolved() && !footprints()}>
        <div class="cb-empty">
          Load raw or denoised traces, deconvolved events, or footprints to check the neural data.
        </div>
      </Show>
      <QcDashboard
        cards={[
          {
            title: 'Cells',
            checks: [
              ...neuralChecks().filter((c) => !c.id.startsWith('fp-')),
              ...eventTraceCheckList(),
            ],
            section: 'cells',
            open: () => setSub('cells'),
          },
          {
            title: 'Footprints',
            checks: neuralChecks().filter((c) => c.id.startsWith('fp-')),
            section: 'cells',
            open: () => setSub('cells'),
          },
          {
            title: 'Deconvolution',
            checks: deconvolved() ? kernelChecks() : [],
            section: 'decon',
            open: () => setSub('decon'),
          },
        ]}
      />
      <div class="cb-subtabs" role="tablist">
        <For each={SUBTABS}>
          {(t) => (
            <button
              role="tab"
              aria-selected={sub() === t.id}
              classList={{ 'cb-subtab--on': sub() === t.id }}
              onClick={() => setSub(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <Dynamic component={SUBTABS.find((t) => t.id === sub())!.view} />
    </>
  );
}
