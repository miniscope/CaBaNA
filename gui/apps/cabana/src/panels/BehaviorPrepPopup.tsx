// Behavior · Preprocess in the shared pop-up frame: "Pad each bout by" as a draft with a live
// preview of every label's bouts as annotated (pale) and padded (solid) in the Data
// visualization window. Apply changes makes it the session's setting.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { QcPopup, SideHead } from '../components/QcPopup.tsx';
import { SliderNumber } from '../components/SliderNumber.tsx';
import { dilateMask, lowerBound } from '../lib/framework.ts';
import { createPrepDraft } from '../lib/prep-draft-state.ts';
import { PARAM_TIP } from '../lib/prep-help.ts';
import { maskRuns, paddedGainPct } from '../lib/prep-preview.ts';
import { fs, labelRows } from '../lib/prep-view.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import { frameTimes } from '../lib/store.ts';
import { win } from '../lib/viz.ts';
import { colorOf } from '../lib/viz-tracks.ts';
import { ImportPrepSettings } from './ImportPrepSettings.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Help, PlotCard } from './QcParts.tsx';

const KEYS = ['labelPadS'] as const;
const LABEL_W = 150;
const ROW = 22;
const W = 760;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function BehaviorPrepPopup(): JSX.Element {
  const d = createPrepDraft(KEYS);
  const { applied, value, set, modified } = d;
  const [importing, setImporting] = createSignal(false);
  const pad = () => value('labelPadS');

  // Padded frames of every label at the draft value, from the labels as scored.
  const rows = createMemo(() =>
    labelRows().map((r) => ({
      label: r.label,
      scored: r.asScored,
      padded: pad() > 0 ? dilateMask(r.asScored, fs(), pad()) : r.asScored,
    })),
  );
  const gain = () => {
    const n = (m: boolean[]) => m.filter(Boolean).length;
    return paddedGainPct(
      rows().reduce((s, r) => s + n(r.scored), 0),
      rows().reduce((s, r) => s + n(r.padded), 0),
    );
  };
  const view = () => {
    const t = frameTimes();
    if (!t) return undefined;
    const [a, b] = win();
    return { t, a, b, lo: lowerBound(t, a), hi: lowerBound(t, b) };
  };
  const bars = (mask: boolean[]) => {
    const v = view();
    if (!v) return [];
    return maskRuns(mask, v.lo, v.hi).map(([i, j]) => {
      const x = (s: number) => LABEL_W + ((s - v.a) / (v.b - v.a)) * (W - LABEL_W);
      return { x: x(v.t[i]), w: Math.max(2, x(v.t[Math.min(j, v.t.length) - 1]) - x(v.t[i])) };
    });
  };
  const done = () => markPopupReviewed('behavior-prep', 'behavior');
  const height = () => rows().length * ROW + 4;

  return (
    <>
      <QcPopup
        kind="prep"
        title="Behavior and position · Preprocess"
        sub="whole session"
        width={1040}
        height={520}
        help={
          <Help k="What this is">
            Padding lengthens every bout, before and after, in the frame labels every analysis
            reads. The plot previews it. Nothing changes until Actions, Apply changes.
          </Help>
        }
        top={
          <div class="cb-qp__what">
            {modified() ? (
              <>
                <b>1 setting modified</b> · pads every bout by {pad().toFixed(2)} s on each side:
                frames counted as a behavior +{gain().toFixed(0)}%. Padded bouts that touch are
                merged.
              </>
            ) : applied().labelPadS > 0 ? (
              `Applied: bouts padded by ${applied().labelPadS.toFixed(2)} s on each side`
            ) : (
              'Bouts are used exactly as annotated.'
            )}
          </div>
        }
        right={
          <>
            <SideHead>bout padding</SideHead>
            <SliderNumber
              label="Pad each bout by"
              help={<InfoTip label="About bout padding">{PARAM_TIP.labelPadS}</InfoTip>}
              value={pad()}
              min={0}
              max={Math.max(2, applied().labelPadS)}
              step={0.05}
              unit="s"
              zeroLabel="off"
              defaultText="off"
              note="each side; zone and behavior annotations"
              onInput={(v) => set('labelPadS', v)}
            />
            <SideHead>standard steps</SideHead>
            <div class="cb-qp__rec">Bouts to frame labels</div>
            <div class="cb-qp__small">Merging close bouts and removing short ones are in QC.</div>
          </>
        }
        resetChecked={d.resetChecked()}
        onReset={d.setReset}
        onImport={() => setImporting(true)}
        status={
          modified()
            ? 'saved results that use behaviors would need a rerun'
            : applied().labelPadS !== DEFAULT_PREP.labelPadS
              ? 'differs from the default'
              : 'at its default'
        }
        pending={modified()}
        onApply={() => {
          d.commit();
          done();
        }}
        onContinue={done}
        onClose={closeQcPopup}
      >
        <PlotCard
          title="Bouts"
          legend={
            <span class="cb-qp__small">
              {clock(win()[0])}–{clock(win()[1])} · pale: as annotated · solid: padded
            </span>
          }
          help={
            <>
              <Help k="What is plotted">
                One row per label: its bouts as annotated (pale) and as frame labels after padding
                (solid), over the Data visualization window.
              </Help>
              <Help k="Axes">Time across the window; labels down the side.</Help>
              <Help k="Limits">
                Padded bouts that touch become one. The window is the one set on Data visualization;
                the percentage in the top line is for the whole session.
              </Help>
            </>
          }
        >
          {() => (
            <Show
              when={rows().length}
              fallback={<div class="cb-empty">Load annotation files to preview padding.</div>}
            >
              <svg
                viewBox={`0 0 ${W} ${height()}`}
                style={{ width: '100%', 'max-height': `${height() * 1.6}px` }}
                role="img"
                aria-label="Bouts as annotated and padded"
              >
                <For each={rows()}>
                  {(r, i) => (
                    <g>
                      <text x="0" y={i() * ROW + 13} font-size="11" fill="#616161">
                        {r.label}
                      </text>
                      <For each={bars(r.scored)}>
                        {(b) => (
                          <rect
                            x={b.x}
                            y={i() * ROW + 1}
                            width={b.w}
                            height={16}
                            fill={colorOf(r.label)}
                            opacity="0.25"
                          />
                        )}
                      </For>
                      <For each={bars(r.padded)}>
                        {(b) => (
                          <rect
                            x={b.x}
                            y={i() * ROW + 5}
                            width={b.w}
                            height={8}
                            fill={colorOf(r.label)}
                          />
                        )}
                      </For>
                    </g>
                  )}
                </For>
              </svg>
            </Show>
          )}
        </PlotCard>
      </QcPopup>
      <Show when={importing()}>
        <ImportPrepSettings
          keys={KEYS}
          now={(k) => value(k as (typeof KEYS)[number])}
          onImport={d.importValues}
          onClose={() => setImporting(false)}
        />
      </Show>
    </>
  );
}
