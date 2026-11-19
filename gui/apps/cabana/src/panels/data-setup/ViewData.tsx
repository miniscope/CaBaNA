// View data: a loaded file in a pop-up, look only. The plot (or the data table) is on the left with
// the QC flags drawn on it as numbered amber markers; on the right the numbered flags, then the
// checks that passed. Corrections and preprocessing are in Data visualization, linked below.

import { For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Modal } from '../../components/Modal.tsx';
import { confirmAction } from '../../lib/confirm.ts';
import { qcShown } from '../../lib/analysis-data.ts';
import { closeEntry, setView, viewOf } from '../../lib/data-setup-view.ts';
import { pickFile } from '../../lib/pick-file.ts';
import {
  cellsByCheck,
  cellsLabel,
  footprintCentres,
  spanFractions,
  cellNoteFlags,
  splitChecks,
  type QcFlag,
  type Where,
} from '../../lib/qc-markers.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import {
  addFiles,
  cellScores,
  footprints,
  goToStep,
  loaded,
  removeFile,
  samplingRate,
  sessionDuration,
} from '../../lib/store.ts';
import { rateText } from '../../lib/setup-summary.ts';
import { segments } from '../BehaviorQc.tsx';
import { FootprintViewer } from '../FootprintViewer.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { SlotPreview } from '../Preview.tsx';
import { DataTable, hasTable } from './DataTable.tsx';
import { qcChecks } from './FileQc.tsx';
import { LayerHeatmap, MATRIX, SelectedCell } from './NeuralOverview.tsx';

const label = (id: SlotId) => SLOTS.find((s) => s.id === id)!.label;

/** Where the flag of each check is on the plot: flagged cells, or stretches of the session. */
function placeFlags(id: SlotId): Record<string, Where> {
  if (MATRIX[id]) {
    const by = cellsByCheck(cellScores() ?? []);
    return Object.fromEntries(Object.entries(by).map(([check, cells]) => [check, { cells }]));
  }
  if (id !== 'position') return {};
  const spans = (kind: 'jump' | 'lost'): [number, number][] =>
    segments()
      .filter((s) => s.kind === kind)
      .map((s) => [s.start, s.stop]);
  return { jumps: { spans: spans('jump') }, gap: { spans: spans('lost') } };
}

/** The line under the title: file name, then what it holds. */
function facts(id: SlotId): string {
  const info = loaded[id]!;
  const rate = MATRIX[id] ? rateText(samplingRate()) : undefined;
  return [info.name, info.summary, rate].filter(Boolean).join(' · ');
}

/** The footprint map with a ring at each overlapping cell and the flag's number beside it. */
function FootprintPlot(props: { flags: QcFlag[] }): JSX.Element {
  const f = () => footprints()!;
  const centres = () => footprintCentres(f().data, f().cells, f().height, f().width);
  return (
    <div class="cb-vw-fpbox">
      <div class="cb-vw-fp" style={{ 'aspect-ratio': `${f().width} / ${f().height}` }}>
        <FootprintViewer />
        <svg class="cb-vw-overlay" viewBox={`0 0 ${f().width} ${f().height}`} aria-hidden="true">
          <For each={props.flags}>
            {(flag) => (
              <For each={flag.cells}>
                {(c, k) => {
                  const [x, y] = centres()[c] ?? [NaN, NaN];
                  return (
                    <Show when={Number.isFinite(x)}>
                      <circle cx={x} cy={y} r={f().width * 0.03} class="cb-vw-ring" />
                      <Show when={k() === 0}>
                        <g
                          transform={`translate(${x + f().width * 0.045}, ${y - f().width * 0.04})`}
                        >
                          <circle r={f().width * 0.025} class="cb-vw-badge" />
                          <text
                            y={f().width * 0.011}
                            font-size={String(f().width * 0.032)}
                            text-anchor="middle"
                            class="cb-vw-badge__n"
                          >
                            {flag.n}
                          </text>
                        </g>
                      </Show>
                    </Show>
                  );
                }}
              </For>
            )}
          </For>
        </svg>
      </div>
      <p class="cb-muted">
        Each cell is drawn in its own color. Rings: cells whose footprints overlap, numbered as in
        the list.
      </p>
    </div>
  );
}

/** Flagged stretches of the session on a time strip, numbered as in the list. */
function SpanStrip(props: { flags: QcFlag[] }): JSX.Element {
  const spans = () => props.flags.filter((f) => f.spans?.length);
  return (
    <Show when={spans().length}>
      <div class="cb-vw-strip">
        <span class="cb-muted">Flagged stretches over the session (s)</span>
        <div class="cb-vw-strip__bar">
          <For each={spans()}>
            {(flag) => (
              <For each={spanFractions(flag.spans!, 0, sessionDuration() ?? 0)}>
                {([a, b], k) => (
                  <>
                    <i
                      class="cb-vw-strip__span"
                      style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}
                    />
                    <Show when={k() === 0}>
                      <span class="cb-qcnum cb-vw-strip__num" style={{ left: `${a * 100}%` }}>
                        {flag.n}
                      </span>
                    </Show>
                  </>
                )}
              </For>
            )}
          </For>
        </div>
        <span class="cb-vw-strip__axis cb-muted">
          <span>0</span>
          <span>{Math.round(sessionDuration() ?? 0)}</span>
        </span>
      </div>
    </Show>
  );
}

function Plot(props: { id: SlotId; flags: QcFlag[] }): JSX.Element {
  return (
    <Show
      when={viewOf(props.id) === 'table' && hasTable(props.id)}
      fallback={
        <Show
          when={MATRIX[props.id]}
          fallback={
            <Show
              when={props.id === 'footprints' && footprints()}
              fallback={
                <div class="cb-vw-stack">
                  <div class="cb-vw-fill">
                    <SlotPreview slot={props.id} />
                  </div>
                  <SpanStrip flags={props.flags} />
                </div>
              }
            >
              <FootprintPlot flags={props.flags} />
            </Show>
          }
        >
          <div class="cb-ds-neural cb-vw-neural">
            <LayerHeatmap slot={props.id} marks={props.flags} />
            <SelectedCell slot={props.id} />
          </div>
        </Show>
      }
    >
      <DataTable slot={props.id} />
    </Show>
  );
}

/** The cells a flag points at, in words, under its title. */
const where = (f: QcFlag) => (f.cells?.length && !f.pair ? cellsLabel(f.cells) : '');

function FlagList(props: {
  id: SlotId;
  flags: QcFlag[];
  passed: { title: string; value: string }[];
}) {
  const off = () => !qcShown(props.id);
  return (
    <aside class="cb-vw-key" aria-label="QC flags">
      <div class="sc">QC flags</div>
      <Show
        when={!off()}
        fallback={
          <p class="cb-muted">
            Quality checks are off for this reference file. Turn them on in Data visualization.
          </p>
        }
      >
        <Show when={props.flags.length} fallback={<p class="cb-vw-key__none">No flags</p>}>
          <ol class="cb-vw-flags">
            <For each={props.flags}>
              {(f) => (
                <li>
                  <span class="cb-qcnum">{f.n}</span>
                  <div>
                    <div>{f.title}</div>
                    <div class="cb-muted cb-vw-flags__sub">
                      {[f.text, where(f)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>
        <div class="sc cb-vw-key__passed">Passed</div>
        <Show when={props.passed.length} fallback={<p class="cb-muted">No checks passed yet.</p>}>
          <ul class="cb-vw-passed">
            <For each={props.passed}>
              {(c) => (
                <li>
                  <span class="cb-vw-passed__mk" aria-hidden="true">
                    ✓
                  </span>
                  <span>{c.title}</span>
                  <span class="cb-ds-tone--ok">Pass</span>
                  <Show when={c.value}>
                    <span class="cb-vw-passed__val">{c.value}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </aside>
  );
}

export function ViewDataPopup(props: { id: SlotId }): JSX.Element {
  const split = () =>
    qcShown(props.id)
      ? splitChecks(
          qcChecks(props.id),
          placeFlags(props.id),
          // only where the cell checks are shown for this file
          MATRIX[props.id] && qcChecks(props.id).some((c) => c.id === 'corr')
            ? cellNoteFlags(cellScores() ?? [])
            : [],
        )
      : { flags: [], passed: [] };
  const remove = () => {
    confirmAction({
      title: 'Remove file?',
      message: `Remove ${loaded[props.id]?.name} from this project? The original file is not changed.`,
      confirmLabel: 'Remove file',
      danger: true,
      onConfirm: () => {
        closeEntry();
        removeFile(props.id);
      },
    });
  };
  const replace = () => {
    const id = props.id;
    pickFile((f) => void addFiles([f], id));
  };
  const table = () => viewOf(props.id) === 'table' && hasTable(props.id);
  return (
    <Modal
      label={label(props.id)}
      title={label(props.id)}
      head={<span class="cb-vw-facts">{facts(props.id)}</span>}
      width={1000}
      height={620}
      onClose={closeEntry}
      onDropFiles={(f) => void addFiles([f[0]], props.id)}
      actions={
        <>
          <Show when={hasTable(props.id)}>
            <div class="cb-vw-seg" role="tablist" aria-label="Show the file as">
              <button
                type="button"
                role="tab"
                aria-selected={!table()}
                classList={{ 'cb-vw-seg--on': !table() }}
                onClick={() => setView(props.id, 'plot')}
              >
                Plot
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={table()}
                classList={{ 'cb-vw-seg--on': table() }}
                onClick={() => setView(props.id, 'table')}
              >
                Data table
              </button>
            </div>
          </Show>
          <ActionsMenu
            items={() => [
              {
                kind: 'action',
                label: 'Replace file',
                onSelect: replace,
              },
              { kind: 'separator' },
              { kind: 'action', label: 'Remove file', danger: true, onSelect: remove },
            ]}
          />
        </>
      }
      footer={
        <>
          <span class="cb-spacer" />
          <InfoTip label="About this window">
            This window only shows the file and its checks. Corrections, rejecting cells and
            preprocessing are made in Data visualization.
          </InfoTip>
          <span class="cb-vw-foot">
            Review QC flags and apply preprocessing in{' '}
            <button
              type="button"
              class="cb-linkbtn"
              onClick={() => {
                closeEntry();
                goToStep('viz');
              }}
            >
              Data visualization
            </button>
            .
          </span>
        </>
      }
    >
      <div class="cb-vw">
        <div class="cb-vw-plot">
          <Plot id={props.id} flags={split().flags} />
        </div>
        <FlagList id={props.id} flags={split().flags} passed={split().passed} />
      </div>
    </Modal>
  );
}
