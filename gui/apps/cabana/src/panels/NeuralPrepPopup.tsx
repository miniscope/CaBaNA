// Neural data · Preprocess in the shared pop-up frame: event smoothing and trace smoothing as
// sliders on a draft, with a live preview of the selected cell. Apply changes makes the draft the
// session's settings through the same setter the Preprocess step uses.

import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { QcPopup, SideHead } from '../components/QcPopup.tsx';
import { SliderNumber } from '../components/SliderNumber.tsx';
import { smoothNeural } from '../lib/framework.ts';
import { PARAM_TIP } from '../lib/prep-help.ts';
import { createPrepDraft } from '../lib/prep-draft-state.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import {
  cell,
  deconvolved,
  denoisedTrace,
  rawTrace,
  samplingRate,
  traceMatrix,
} from '../lib/store.ts';
import { win } from '../lib/viz.ts';
import { ImportPrepSettings } from './ImportPrepSettings.tsx';
import { InfoTip } from './InfoTip.tsx';
import { CellPicker } from './parts.tsx';
import { Help, PlotCard } from './QcParts.tsx';
import { cellRow, WindowPanel } from './QcTraces.tsx';

const KEYS = ['eventSigmaS', 'traceSigmaS'] as const;
/** Slider range: 0 is off. A value applied earlier above the maximum stretches the range. */
const SLIDER_MAX = 2;

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const secondsText = (v: number) => (v > 0 ? `${v.toFixed(2)} s` : 'off');

export function NeuralPrepPopup(): JSX.Element {
  const d = createPrepDraft(KEYS);
  const { applied, value, set, modified } = d;
  const [importing, setImporting] = createSignal(false);
  const fs = () => samplingRate() ?? 30;

  const events = () => cellRow(deconvolved());
  const trace = () => cellRow(denoisedTrace() ?? rawTrace());
  // Smoothed over the whole session so the window's edges are not distorted.
  const eventsAfter = createMemo(() => {
    const r = events();
    return r && value('eventSigmaS') > 0 ? smoothNeural(r, fs(), value('eventSigmaS')) : undefined;
  });
  const traceAfter = createMemo(() => {
    const r = trace();
    return r && value('traceSigmaS') > 0 ? smoothNeural(r, fs(), value('traceSigmaS')) : undefined;
  });

  const done = () => {
    markPopupReviewed('neural-prep', 'neural');
  };
  const slider = (k: (typeof KEYS)[number], label: string, note?: string): JSX.Element => (
    <SliderNumber
      label={label}
      help={<InfoTip label={`About ${label.toLowerCase()}`}>{PARAM_TIP[k]}</InfoTip>}
      value={value(k)}
      min={0}
      max={Math.max(SLIDER_MAX, applied()[k])}
      step={0.05}
      unit="s"
      zeroLabel="off"
      defaultText={DEFAULT_PREP[k] > 0 ? `${DEFAULT_PREP[k]} s` : 'off'}
      note={note}
      onInput={(v) => set(k, v)}
    />
  );

  return (
    <>
      <QcPopup
        kind="prep"
        title="Neural data · Preprocess"
        sub="whole session"
        width={1060}
        help={
          <Help k="What this is">
            Settings that change the neural data every analysis reads. The plot previews them on the
            selected cell. Nothing changes until Actions, Apply changes.
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
              `Applied: event smoothing ${secondsText(applied().eventSigmaS)}, smooth traces ${secondsText(applied().traceSigmaS)}`
            )}
          </div>
        }
        right={
          <>
            <SideHead>settings</SideHead>
            {slider('eventSigmaS', 'Event smoothing', 'Gaussian width')}
            {slider('traceSigmaS', 'Smooth traces', 'no analysis reads traces yet')}
            <div class="cb-qp__small">
              The plot updates as you drag. Actions, Apply changes makes them the session's
              settings.
            </div>
          </>
        }
        resetChecked={d.resetChecked()}
        onReset={d.setReset}
        onImport={() => setImporting(true)}
        status={
          modified()
            ? `${modified()} ${modified() === 1 ? 'setting' : 'settings'} modified, not applied`
            : KEYS.some((k) => applied()[k] !== DEFAULT_PREP[k])
              ? 'settings differ from the defaults'
              : 'all settings at their defaults'
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
          title={`Preview, cell ${cell() + 1}`}
          tools={<CellPicker compact n={traceMatrix()?.cells ?? deconvolved()?.cells ?? 0} />}
          legend={
            <span class="cb-qp__small">
              {clock(win()[0])}–{clock(win()[1])} · gray: as loaded · color: after these settings
            </span>
          }
          help={
            <>
              <Help k="What is plotted">
                The selected cell over the Data visualization window: the denoised (or raw) trace
                and the deconvolved events, as loaded in gray and after the settings in color.
              </Help>
              <Help k="Axes">Time in seconds; each panel has its own vertical scale.</Help>
              <Help k="Transformations">
                A Gaussian filter along time, its width set by the sliders. 0 leaves the signal as
                loaded.
              </Help>
              <Help k="Limits">
                Only the selected cell is shown; the settings apply to every cell. No analysis reads
                traces yet.
              </Help>
            </>
          }
        >
          {(s) => (
            <div class="cb-qp__traces" style={{ height: `${s().h}px` }}>
              <div class="cb-qp__small">{denoisedTrace() ? 'Denoised trace' : 'Raw trace'}</div>
              <WindowPanel
                height={Math.max(70, (s().h - 60) / 2)}
                lines={[
                  { label: 'As loaded', stroke: '#bdbdbd', values: trace() },
                  { label: 'After', stroke: '#2171b5', width: 1.5, values: traceAfter() },
                ]}
              />
              <div class="cb-qp__small">Deconvolved events</div>
              <WindowPanel
                height={Math.max(70, (s().h - 60) / 2)}
                lines={[
                  { label: 'As loaded', stroke: '#bdbdbd', values: events() },
                  { label: 'After', stroke: '#e09800', width: 1.5, values: eventsAfter() },
                ]}
              />
            </div>
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
