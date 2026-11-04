// Plot editor (preview): restyle one saved plot and export it, without rerunning or changing the
// result. It edits a copy of a plot spec; cosmetic and display fields are editable, analytical
// ones are shown read only with the way to change them (the analysis settings and a rerun).
// It sits beside the existing plots and never replaces or alters them.

import { createSignal, For, Show, untrack, type JSX } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { download, svgToPng } from '../../lib/export-figure.ts';
import { CHANGE_TEXT, specCsv, type PlotSpec } from '../../lib/plot-spec.ts';
import { renderSvg } from '../../lib/plot-svg.ts';
import { goToAnalysis } from '../../lib/results-overview.ts';
import { Modal } from '../AurocResults.tsx';

const [opened, setOpened] = createSignal<PlotSpec | undefined>();

/** Open the editor on a copy of `spec`. */
export const openPlotEditor = (spec: PlotSpec) => setOpened(structuredClone(spec));

/** The button beside a plot that opens it in the editor; nothing when the plot has no spec. */
export function EditPlotButton(props: { spec: () => PlotSpec | undefined }): JSX.Element {
  return (
    <button
      type="button"
      class="cb-link cb-pe-open"
      disabled={!props.spec()}
      title="Restyle this plot and export it as SVG, PNG or CSV. The result is not changed."
      onClick={() => {
        const s = props.spec();
        if (s) openPlotEditor(s);
      }}
    >
      Plot editor (preview)
    </button>
  );
}

const fileStem = (s: PlotSpec) =>
  s.source.label.replace(/[^\w.-]+/g, '_').replace(/^_|_$/g, '') || 'plot';

/** The editor dialog; rendered once at the top of the app. */
export function PlotEditor(): JSX.Element {
  return (
    <Show when={opened()} keyed>
      {(original) => <Editor original={original} onClose={() => setOpened(undefined)} />}
    </Show>
  );
}

function Editor(props: { original: PlotSpec; onClose: () => void }): JSX.Element {
  const [spec, setSpec] = createStore<PlotSpec>(untrack(() => structuredClone(props.original)));
  const svg = () => renderSvg(spec);
  const [busy, setBusy] = createSignal(false);
  const numIn = (
    label: string,
    get: () => number | undefined,
    set: (v: number | undefined) => void,
    o: { step?: number; min?: number; optional?: boolean } = {},
  ) => (
    <label class="cb-ped-field">
      <span>{label}</span>
      <input
        type="number"
        step={o.step ?? 1}
        min={o.min}
        value={get() ?? ''}
        placeholder={o.optional ? 'auto' : undefined}
        onInput={(e) => {
          const raw = e.currentTarget.value;
          if (raw === '' && o.optional) return set(undefined);
          const v = +raw;
          if (Number.isFinite(v)) set(v);
        }}
      />
    </label>
  );
  const png = async () => {
    setBusy(true);
    try {
      download(
        `${fileStem(spec)}.png`,
        await svgToPng(svg(), spec.style.width, spec.style.height, 2),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Plot editor (preview)" size="wide" onClose={props.onClose}>
      <div class="cb-ped">
        <div class="cb-ped-view">
          {/* The same SVG text that is exported. */}
          <img
            class="cb-ped-canvas"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`}
            width={spec.style.width}
            height={spec.style.height}
            alt={`Preview: ${spec.source.label}`}
          />
          <p class="cb-muted cb-ped-src">
            {spec.source.label} · {spec.source.engine}
            {spec.source.runId ? ` · run ${spec.source.runId}` : ' · not saved as a run'}
            <Show when={spec.source.preliminary}>
              {' · '}
              <span class="cb-warn">{spec.source.preliminary}</span>
            </Show>
          </p>
        </div>
        <div class="cb-ped-side">
          <section>
            <h4>Appearance</h4>
            <p class="cb-muted">{CHANGE_TEXT.cosmetic}</p>
            <label class="cb-ped-field cb-ped-field--wide">
              <span>Title</span>
              <input
                value={spec.style.title}
                onInput={(e) => setSpec('style', 'title', e.currentTarget.value)}
              />
            </label>
            <label class="cb-ped-field cb-ped-field--wide">
              <span>x label</span>
              <input
                value={spec.axes.x}
                onInput={(e) => setSpec('axes', 'x', e.currentTarget.value)}
              />
            </label>
            <label class="cb-ped-field cb-ped-field--wide">
              <span>y label</span>
              <input
                value={spec.axes.y}
                onInput={(e) => setSpec('axes', 'y', e.currentTarget.value)}
              />
            </label>
            <div class="cb-ped-row">
              {numIn(
                'Width (px)',
                () => spec.style.width,
                (v) => setSpec('style', 'width', Math.max(200, v ?? 480)),
                { step: 10, min: 200 },
              )}
              {numIn(
                'Height (px)',
                () => spec.style.height,
                (v) => setSpec('style', 'height', Math.max(150, v ?? 300)),
                { step: 10, min: 150 },
              )}
              {numIn(
                'Font (px)',
                () => spec.style.fontSize,
                (v) => setSpec('style', 'fontSize', Math.max(6, v ?? 12)),
                { min: 6 },
              )}
              {numIn(
                'Line width',
                () => spec.style.lineWidth,
                (v) => setSpec('style', 'lineWidth', Math.max(0.5, v ?? 1.5)),
                { step: 0.5, min: 0.5 },
              )}
            </div>
            <div class="cb-ped-row">
              <label class="cb-ped-field">
                <span>Color</span>
                <input
                  type="color"
                  value={spec.style.colors[0]}
                  onInput={(e) => setSpec('style', 'colors', 0, e.currentTarget.value)}
                />
              </label>
              <label class="cb-check">
                <input
                  type="checkbox"
                  checked={spec.style.showLegend}
                  onChange={(e) => setSpec('style', 'showLegend', e.currentTarget.checked)}
                />
                Legend
              </label>
              <label class="cb-check">
                <input
                  type="checkbox"
                  checked={spec.style.showGrid}
                  onChange={(e) => setSpec('style', 'showGrid', e.currentTarget.checked)}
                />
                Grid
              </label>
            </div>
          </section>
          <section>
            <h4>Display range</h4>
            <p class="cb-muted">{CHANGE_TEXT.display} Empty means the full range.</p>
            <div class="cb-ped-row">
              {numIn(
                'x from',
                () => spec.display.xMin,
                (v) => setSpec('display', 'xMin', v),
                { step: 0.01, optional: true },
              )}
              {numIn(
                'x to',
                () => spec.display.xMax,
                (v) => setSpec('display', 'xMax', v),
                { step: 0.01, optional: true },
              )}
              {numIn(
                'y from',
                () => spec.display.yMin,
                (v) => setSpec('display', 'yMin', v),
                { step: 0.01, optional: true },
              )}
              {numIn(
                'y to',
                () => spec.display.yMax,
                (v) => setSpec('display', 'yMax', v),
                { step: 0.01, optional: true },
              )}
            </div>
          </section>
          <section>
            <h4>Analysis (read only)</h4>
            <p class="cb-muted">{CHANGE_TEXT.analytical}</p>
            <dl class="cb-ped-dl">
              <For each={Object.entries(spec.source.settings)}>
                {([k, v]) => (
                  <>
                    <dt>{k.replace(/_/g, ' ')}</dt>
                    <dd>{String(v)}</dd>
                  </>
                )}
              </For>
            </dl>
            <button
              type="button"
              class="cb-link"
              onClick={() => {
                props.onClose();
                goToAnalysis(spec.source.analysis);
              }}
            >
              Open the analysis settings
            </button>
          </section>
          <div class="cb-controls">
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => download(`${fileStem(spec)}.svg`, svg(), 'image/svg+xml')}
            >
              SVG
            </button>
            <button
              type="button"
              class="btn-secondary btn-small"
              disabled={busy()}
              onClick={() => void png()}
            >
              PNG (2x)
            </button>
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => download(`${fileStem(spec)}.csv`, specCsv(unwrap(spec)), 'text/csv')}
            >
              CSV
            </button>
            <span class="cb-spacer" />
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => setSpec(reconcile(structuredClone(props.original)))}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
