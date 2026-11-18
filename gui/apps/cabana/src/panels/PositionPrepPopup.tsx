// Position · Preprocess in the shared pop-up frame: gap filling, position smoothing and the two
// standard steps as a draft with a live preview of x position in the 10 s with the most lost
// frames. Apply changes makes the draft the session's settings.

import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { QcPopup, SideHead } from '../components/QcPopup.tsx';
import { SliderNumber } from '../components/SliderNumber.tsx';
import { positionCm, positionPipeline } from '../lib/prepared.ts';
import { PARAM_TIP } from '../lib/prep-help.ts';
import { createPrepDraft } from '../lib/prep-draft-state.ts';
import { worstWindow } from '../lib/prep-preview.ts';
import { gapSummary } from '../lib/prep-view.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { excludedRows } from '../lib/position-corrections.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import { cameraTimes, frameTimes, samplingRate } from '../lib/store.ts';
import { ImportPrepSettings } from './ImportPrepSettings.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Help, PlotCard } from './QcParts.tsx';
import { WindowPanel } from './QcTraces.tsx';

const KEYS = ['fillGapS', 'posMethod', 'posWindowS', 'maxGapS', 'speedWindowS'] as const;
type Key = (typeof KEYS)[number];
const WINDOW_S = 10;

const secondsText = (v: number) => (v > 0 ? `${v.toFixed(2)} s` : 'off');

export function PositionPrepPopup(): JSX.Element {
  const d = createPrepDraft(KEYS);
  const { applied, value, set, modified } = d;
  const [importing, setImporting] = createSignal(false);
  const fs = () => samplingRate() ?? 30;

  const run = (v: (k: Key) => number | string) => {
    const c = positionCm();
    const ct = cameraTimes();
    const nt = frameTimes();
    if (!c || !ct || !nt) return undefined;
    return positionPipeline(c, ct, nt, excludedRows(), fs(), {
      maxGapS: v('maxGapS') as number,
      fillGapS: v('fillGapS') as number,
      posMethod: v('posMethod') as 'median' | 'gaussian',
      posWindowS: v('posWindowS') as number,
      speedWindowS: v('speedWindowS') as number,
    });
  };
  const asApplied = createMemo(() => run((k) => applied()[k]));
  const after = createMemo(() => run((k) => value(k)));
  // The window is picked from the applied settings so it stays put while a slider moves.
  const window10 = createMemo(() => {
    const a = asApplied();
    const nt = frameTimes();
    if (!a || !nt) return undefined;
    const lost = Array.from(a.rx, (v) => !Number.isFinite(v));
    const w = worstWindow(lost, fs(), WINDOW_S);
    return { ...w, range: [nt[w.start], nt[Math.min(w.end, nt.length) - 1]] as [number, number] };
  });
  const lostRanges = (): [number, number][] => {
    const a = after();
    const w = window10();
    const nt = frameTimes();
    if (!a || !w || !nt) return [];
    const out: [number, number][] = [];
    for (let i = w.start; i < w.end; i++)
      if (!Number.isFinite(a.rx[i])) out.push([nt[i] - 0.5 / fs(), nt[i] + 0.5 / fs()]);
    return out;
  };

  const slider = (k: 'fillGapS' | 'posWindowS', label: string, max: number, step: number) => (
    <SliderNumber
      label={label}
      help={<InfoTip label={`About ${label.toLowerCase()}`}>{PARAM_TIP[k]}</InfoTip>}
      value={value(k)}
      min={0}
      max={Math.max(max, applied()[k])}
      step={step}
      unit="s"
      zeroLabel="off"
      defaultText={DEFAULT_PREP[k] > 0 ? `${DEFAULT_PREP[k]} s` : 'off'}
      onInput={(v) => set(k, v)}
    />
  );
  const number = (k: 'maxGapS' | 'speedWindowS', label: string) => (
    <label class="cb-qp__num-row">
      <span>
        {label}
        <InfoTip label={`About ${label.toLowerCase()}`}>{PARAM_TIP[k]}</InfoTip>
      </span>
      <input
        type="number"
        min={0}
        step={k === 'maxGapS' ? 0.1 : 0.05}
        value={value(k)}
        onInput={(e) => e.currentTarget.valueAsNumber >= 0 && set(k, e.currentTarget.valueAsNumber)}
        onChange={(e) => (e.currentTarget.value = String(value(k)))}
      />
      <span class="cb-muted">s</span>
    </label>
  );
  const done = () => markPopupReviewed('position-prep', 'arena');

  return (
    <>
      <QcPopup
        kind="prep"
        title="Position · Preprocess"
        sub="whole session"
        help={
          <Help k="What this is">
            Settings that change the position every analysis reads. The plot previews them on the
            part of the session with the most lost frames. Nothing changes until Actions, Apply
            changes.
          </Help>
        }
        top={
          <div class="cb-qp__what">
            {modified() ? (
              <>
                <b>
                  {modified()} {modified() === 1 ? 'setting' : 'settings'} modified
                </b>{' '}
                · affects the whole session and all analyses
              </>
            ) : (
              `At the applied settings: fills ${
                applied().fillGapS > 0
                  ? `lost runs up to ${applied().fillGapS} s (${gapSummary().filled.n} of ${gapSummary().filled.n + gapSummary().long.n + gapSummary().edge.n} in this session)`
                  : 'nothing (off)'
              } · smooths with ${applied().posWindowS > 0 ? `a ${secondsText(applied().posWindowS)} ${applied().posMethod} filter` : 'no filter'} · whole session`
            )}
          </div>
        }
        right={
          <>
            <SideHead>fill tracking gaps</SideHead>
            {slider('fillGapS', 'Fill runs up to', 2, 0.1)}
            <SideHead>position smoothing</SideHead>
            <div class="cb-qp__method">
              <span>Method</span>
              <div class="cb-ds-seg" role="group" aria-label="Smoothing method">
                {(['median', 'gaussian'] as const).map((m) => (
                  <button
                    type="button"
                    aria-pressed={value('posMethod') === m}
                    classList={{ 'cb-ds-seg--on': value('posMethod') === m }}
                    onClick={() => set('posMethod', m)}
                  >
                    {m === 'median' ? 'Median' : 'Gaussian'}
                  </button>
                ))}
              </div>
            </div>
            {slider('posWindowS', 'Window', 1, 0.05)}
            <SideHead>standard steps</SideHead>
            {number('maxGapS', 'Onto neural frames, gap limit')}
            {number('speedWindowS', 'Speed window')}
            <div class="cb-qp__small">
              The speed filter ({applied().minSpeed} cm/s) is a Place cells setting.
            </div>
          </>
        }
        resetChecked={d.resetChecked()}
        onReset={d.setReset}
        onImport={() => setImporting(true)}
        status={
          modified()
            ? 'saved results that use position would need a rerun'
            : KEYS.some((k) => applied()[k] !== DEFAULT_PREP[k])
              ? 'settings differ from the defaults'
              : 'all at defaults'
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
          title="x position (cm)"
          legend={
            <span class="cb-qp__small">
              <Show when={window10()}>
                {(w) => (
                  <>
                    {w().range[0].toFixed(1)}–{w().range[1].toFixed(1)} s, the {WINDOW_S} s with the
                    most lost frames ({w().lost} lost) · gray: as tracked · purple: after these
                    settings · shaded: lost frames
                  </>
                )}
              </Show>
            </span>
          }
          help={
            <>
              <Help k="What is plotted">
                x position in cm over the {WINDOW_S} s of the session with the most lost frames: as
                tracked in gray, after gap filling and smoothing in purple.
              </Help>
              <Help k="Axes">Time in seconds on the neural clock; position in cm.</Help>
              <Help k="Shading">Frames with no tracked position are shaded.</Help>
              <Help k="Limits">
                Only x is drawn, and only this window; the settings apply to x and y over the whole
                session.
              </Help>
            </>
          }
        >
          {(s) => (
            <Show
              when={window10()}
              fallback={<div class="cb-empty">Load position and timestamps to preview.</div>}
            >
              {(w) => (
                <WindowPanel
                  height={Math.max(100, s().h - 4)}
                  range={w().range}
                  shade={lostRanges}
                  lines={[
                    { label: 'As tracked', stroke: '#9e9e9e', values: after()?.rx },
                    { label: 'After', stroke: '#6a51a3', width: 1.5, values: after()?.sx },
                  ]}
                />
              )}
            </Show>
          )}
        </PlotCard>
      </QcPopup>
      <Show when={importing()}>
        <ImportPrepSettings
          keys={KEYS}
          now={(k) => value(k as Key)}
          onImport={d.importValues}
          onClose={() => setImporting(false)}
        />
      </Show>
    </>
  );
}
