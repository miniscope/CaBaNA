import { For, Show, type JSX } from 'solid-js';
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
  overlapPartner,
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
import { CellPicker } from './parts.tsx';
import { DeconView } from './DeconQc.tsx';
import { CellTraces } from './CellTraces.tsx';
import { FootprintViewer } from './FootprintViewer.tsx';
import type { Category } from './QcPanel.tsx';
import {
  Advice,
  CategoryHead,
  Findings,
  Help,
  Limits,
  PagedList,
  PlotCard,
  RailBox,
  ReviewActions,
} from './QcParts.tsx';

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

const cellChecks = () => [
  ...neuralChecks().filter((c) => !c.id.startsWith('fp-')),
  ...eventTraceCheckList(),
];
const footprintCheckList = () => neuralChecks().filter((c) => c.id.startsWith('fp-'));
const overlapPairs = () => footprintCheckList().find((c) => c.id === 'fp-overlap')?.pairs ?? [];

/** Cells with a Check or Reject recommendation that are not rejected yet. */
const flaggedCells = () =>
  (cellScores() ?? [])
    .map((s, c) => ({ s, c }))
    .filter((x) => x.s.overall !== 'good' && !x.s.rejected);

const ColorBy = (): JSX.Element => (
  <label class="cb-plot__tool">
    Color by
    <select
      value={colorBy()}
      onChange={(e) => setColorBy(e.currentTarget.value as 'cell' | 'quality')}
    >
      <option value="cell">Cell</option>
      <option value="quality">Quality (green, amber, red)</option>
    </select>
  </label>
);

/** The footprint map as a square that fits the card. */
const SquareMap = (props: { w: number; h: number }): JSX.Element => {
  const side = () => `${Math.max(40, Math.min(props.w, props.h - 20))}px`;
  return (
    <>
      <div style={{ width: side(), height: side(), margin: '0 auto' }}>
        <FootprintViewer partners />
      </div>
      <div class="cb-map-key">
        White: selected · Orange: most correlated neighbor · Cyan: overlapping partner
      </div>
    </>
  );
};

const FOOTPRINT_HELP = (
  <>
    <Help k="What is plotted">
      All cell footprints in one image. Each cell's pixels above a quarter of its own peak are
      drawn, brighter closer to the peak. The overlap check counts only pixels above half the peak.
    </Help>
    <Help k="Axes">Pixels of the field of view, as exported by the extraction.</Help>
    <Help k="Colors">
      White: the selected cell. Orange: the neighbor it correlates with most. Cyan: the overlapping
      partner picked from the pairs list. Dark gray: rejected cells. Other cells take a color per
      cell, or green, amber or red by recommendation when Color by is Quality.
    </Help>
    <Help k="Linked">
      Clicking a cell selects it everywhere: the traces, the cell scores and the lists.
    </Help>
    <Help k="Limits">
      Where footprints overlap, each pixel shows the cell that is brightest there relative to its
      own peak, except that the selected cell is drawn whole. Overlap is judged from shared pixels,
      not from the traces.
    </Help>
  </>
);

function CellsView(): JSX.Element {
  const n = () => traceMatrix()?.cells ?? footprints()?.cells ?? 0;
  const scores = () => cellScores();
  const flagged = flaggedCells;
  const sel = () => scores()?.[cell()];
  const ticked = () => [...pending()].filter((c) => flagged().some((x) => x.c === c));
  return (
    <>
      <div class="cb-qc-center">
        <CategoryHead
          title="Cells"
          checks={cellChecks()}
          flagged={flagged().length ? `${flagged().length} flagged cells` : undefined}
        />
        <Show when={!footprints() && traceMatrix()}>
          <div class="cb-note">
            Footprints aren't loaded, so overlap and neighbor correlation can't be checked properly.
            Loading them is recommended.
          </div>
        </Show>
        <Show when={n() > 0}>
          <div class="cb-cellrow">
            <CellPicker n={n()} />
            <Show when={sel()}>
              <Score s={sel()!} partner={cellResult()?.partner[cell()] ?? -1} />
            </Show>
          </div>
          <Show when={sel()?.notes.length}>
            <div class="cb-muted">{sel()!.notes.join(' · ')}</div>
          </Show>
          <Show when={sel()?.rejected}>
            <div class="cb-note">
              This cell is rejected: QC and later steps leave it out.{' '}
              <button class="cb-link" onClick={() => restoreCell(cell())}>
                Restore
              </button>
            </div>
          </Show>
          <div class="cb-qc-pair">
            <Show when={footprints()}>
              <PlotCard title="Footprints" tools={<ColorBy />} help={FOOTPRINT_HELP}>
                {(s) => <SquareMap w={s().w} h={s().h} />}
              </PlotCard>
            </Show>
            <PlotCard
              title={`Traces, cell ${cell() + 1}`}
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
              {(s) => <CellTraces height={Math.max(40, (s().h - 84) / 3)} />}
            </PlotCard>
          </div>
        </Show>
      </div>
      <aside class="cb-qc-rail">
        <Findings checks={cellChecks()} />
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
                <span class="cb-cellrow-item">
                  <span>
                    Cell {x.c + 1}{' '}
                    <span class={`cb-word--${x.s.overall}`}>{WORD[x.s.overall]}</span>
                  </span>
                  <span class="cb-muted">{x.s.notes.join(', ')}</span>
                </span>
              )}
            </PagedList>
          </RailBox>
        </Show>
        <RailBox title="Settings" fold="settings">
          <Limits keys={['poorCellPct', 'riseLowPct']} />
        </RailBox>
        <RailBox title="Correction" fold="correction">
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
          <ReviewActions id="cells" section="cells" checks={cellChecks()} />
        </RailBox>
      </aside>
    </>
  );
}

function FootprintsView(): JSX.Element {
  const checks = footprintCheckList;
  const pairs = overlapPairs;
  return (
    <>
      <div class="cb-qc-center">
        <CategoryHead
          title="Footprints"
          checks={checks()}
          flagged={pairs().length ? `${pairs().length} overlapping pairs` : undefined}
        />
        <PlotCard
          title="Footprint map"
          class="cb-plot--grow3"
          tools={<ColorBy />}
          help={FOOTPRINT_HELP}
        >
          {(s) => <SquareMap w={s().w} h={s().h} />}
        </PlotCard>
      </div>
      <aside class="cb-qc-rail">
        <Findings checks={checks()} />
        <RailBox title="Overlapping pairs" grow>
          <PagedList
            id="pairs"
            items={pairs()}
            selected={pairs().findIndex((p) => p.a === cell() && p.b === overlapPartner())}
            onSelect={(i) => selectCell(pairs()[i].a, pairs()[i].b)}
            empty="No cell pairs share over half of the smaller footprint."
            after={(p) => (
              <span class="cb-list__after">
                <button type="button" class="cb-link" onClick={() => rejectCells([p.a])}>
                  Reject {p.a + 1}
                </button>
                <button type="button" class="cb-link" onClick={() => rejectCells([p.b])}>
                  Reject {p.b + 1}
                </button>
              </span>
            )}
          >
            {(p) => (
              <span>
                Cell {p.a + 1} and cell {p.b + 1}, {p.note}
              </span>
            )}
          </PagedList>
        </RailBox>
        <RailBox title="Settings" fold="settings">
          <Limits keys={['overlapPct']} />
        </RailBox>
        <RailBox title="Correction" fold="correction">
          <Advice checks={checks()} />
          <ReviewActions id="footprints" section="cells" checks={checks()} />
        </RailBox>
      </aside>
    </>
  );
}

/** The neural QC categories for the navigator; none when nothing neural is loaded. */
export function neuralCategories(): Category[] {
  if (!traceMatrix() && !deconvolved() && !footprints()) return [];
  const flaggedCount = flaggedCells().length;
  return [
    {
      id: 'cells',
      name: 'Cells',
      checks: cellChecks(),
      flagged: flaggedCount,
      flaggedWord: 'cells',
      section: 'cells',
      view: CellsView,
    },
    ...(footprints()
      ? [
          {
            id: 'footprints',
            name: 'Footprints',
            checks: footprintCheckList(),
            flagged: overlapPairs().length,
            flaggedWord: 'pairs',
            section: 'cells' as const,
            view: FootprintsView,
          },
        ]
      : []),
    ...(deconvolved()
      ? [
          {
            id: 'decon',
            name: 'Deconvolution',
            checks: kernelChecks(),
            flagged: kernelChecks().filter((c) => c.status !== 'pass').length,
            flaggedWord: 'notes',
            section: 'decon' as const,
            view: DeconView,
          },
        ]
      : []),
  ];
}
