import { Show, type JSX } from 'solid-js';
import { displayMap, gradientCss, maxOf } from '../lib/place-display.ts';
import { FootprintStrip } from './FootprintStrip.tsx';
import { num, type ResultsCtx } from './place-ctx.ts';
import { FieldDetails, Outcome, ShuffleDetails, TestStats } from './PlaceInspector.tsx';
import { HowToRead } from './parts.tsx';
import { RateMap } from './RateMap.tsx';

/** The selected cell beside the gallery: both tests, the two half-session maps, and folded details. */
export function PlaceCellPanel(props: {
  ctx: ResultsCtx;
  onClose: () => void;
  onInspector: () => void;
}): JSX.Element {
  const c = () => props.ctx;
  const out = () => c().out;
  const r = () => out().result;
  const i = () => c().selected();
  const { nx, ny, open, bin } = props.ctx.out.data.grid;
  const mapProps = { nx, ny, open, bin, arenaCm: props.ctx.out.arenaCm };
  const half = (a: Float32Array) =>
    displayMap(a.subarray(i() * r().nStates, (i() + 1) * r().nStates), [ny, nx]);
  const halves = () => [half(r().rateA), half(r().rateB)] as const;
  const top = () => maxOf(...halves());
  const row = () =>
    c()
      .rows()
      .find((x) => x.i === i());

  return (
    <aside class="cb-cellpanel" aria-label="Selected cell">
      <Show
        when={i() >= 0 && row()}
        fallback={<div class="cb-empty">Click a map to inspect a cell.</div>}
      >
        <div class="cb-inspector__head">
          <h4>Cell {c().out.data.cellIds[i()] + 1}</h4>
          <Outcome o={row()!.overall} />
          <span class="cb-inspector__nav">
            <button
              class="btn-secondary btn-small"
              aria-label="Previous cell"
              onClick={() => c().step(-1)}
            >
              ‹
            </button>
            <button
              class="btn-secondary btn-small"
              aria-label="Next cell"
              onClick={() => c().step(1)}
            >
              ›
            </button>
            <button
              class="btn-secondary btn-small"
              aria-label="Close cell panel"
              onClick={() => props.onClose()}
            >
              ✕
            </button>
          </span>
        </div>
        <Show when={c().position() < 0}>
          <p class="cb-muted">This cell is hidden by the current filter or search.</p>
        </Show>

        <TestStats out={out()} i={i()} />

        <div class="cb-cellpanel__halves">
          <figure>
            <figcaption>First half</figcaption>
            <RateMap values={halves()[0]} max={top()} size={260} {...mapProps} />
          </figure>
          <figure>
            <figcaption>Second half</figcaption>
            <RateMap values={halves()[1]} max={top()} size={260} {...mapProps} />
          </figure>
        </div>
        <div class="cb-legend" role="img" aria-label="Color scale">
          <span class="cb-legend__item">Event rate 0</span>
          <span
            class="cb-legend__bar cb-legend__bar--sm"
            style={{ background: gradientCss('right') }}
          />
          <span class="cb-legend__item">{num(top(), 1)} events/s, shared by both halves</span>
          <span class="cb-legend__item">
            <i style={{ background: '#d4d4d0' }} /> Under {out().settings.minOccS} s
          </span>
        </div>
        <HowToRead>
          <p>
            Event-rate maps from the first and second half of the recording, seen from above, on one
            color scale so their rates can be compared directly. The stability test correlates these
            two maps: a stable place cell has its field in the same place in both. Grey bins were
            visited for less than {out().settings.minOccS} s in that half and have no rate.
          </p>
        </HowToRead>

        <ShuffleDetails out={out()} i={i()} />
        <FieldDetails out={out()} i={i()} />
        <details class="cb-notebox cb-fold">
          <summary>Footprint and neural trace</summary>
          <div>
            <FootprintStrip out={out()} i={i()} />
            <HowToRead>
              <p>
                The small image is the cell’s footprint in the field of view. The trace is its
                signal over the whole recording; shaded columns are frames left out of the analysis
                (no position, or below the speed threshold).
              </p>
            </HowToRead>
          </div>
        </details>

        <button class="btn-secondary cb-cellpanel__open" onClick={() => props.onInspector()}>
          Open full cell inspector
        </button>
      </Show>
    </aside>
  );
}
