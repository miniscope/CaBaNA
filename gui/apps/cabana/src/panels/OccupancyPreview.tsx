import { InfoTip } from './InfoTip.tsx';
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { arena, sizeCm, toCm, type Zone } from '../lib/arena.ts';
import { drawZones } from '../lib/draw.ts';
import { colorAt, gradientCss } from '../lib/place-display.ts';
import { coverage } from '../lib/place-coverage.ts';
import { effectiveBin } from '../lib/arena.ts';
import { placeSettings } from '../lib/place-run.ts';
import { Note, HowToRead } from './parts.tsx';

const PX = 640;
const GREY = '#d4d4d0';
type Which = 'tuning' | 'fields';

/**
 * The arena tiled with the chosen bins, colored by the time spent in each, so the effect of the bin
 * size, speed filter and minimum times is visible before the analysis runs.
 */
export function OccupancyPreview(props: { which: Which }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const which = () => props.which;
  const [showZones, setShowZones] = createSignal(true);
  const cov = createMemo(() => coverage(effectiveBin()));
  const top = createMemo(() => {
    const c = cov();
    if (!c) return 1;
    const s = [...c.seconds].filter((_, i) => c.grid.open[i]).sort((a, b) => a - b);
    return s[Math.floor(0.95 * (s.length - 1))] || 1;
  });

  createEffect(() => {
    const ctx = canvas?.getContext('2d');
    const c = cov();
    if (!canvas || !ctx || !c) return;
    const [w, h] = sizeCm();
    const s = PX / Math.max(w, h);
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const { nx, ny, bin, open } = c.grid;
    const valid = c.validFor[which()];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!open[k]) continue;
        ctx.fillStyle = valid[k]
          ? `rgb(${colorAt(Math.min(1, c.seconds[k] / top())).join(',')})`
          : GREY;
        ctx.fillRect(i * bin * s, canvas.height - (j + 1) * bin * s, bin * s, bin * s);
      }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < nx; i++) {
      ctx.moveTo(i * bin * s, 0);
      ctx.lineTo(i * bin * s, canvas.height);
    }
    for (let j = 1; j < ny; j++) {
      ctx.moveTo(0, j * bin * s);
      ctx.lineTo(canvas.width, j * bin * s);
    }
    ctx.stroke();
    if (showZones()) {
      // Zones are stored in picture pixels; the plot is in cm with the origin at the lower left.
      const zones = arena.zones.flatMap((z): Zone[] => {
        const pts = z.pts.map((p) => toCm(p));
        return pts.every(Boolean)
          ? [{ ...z, pts: pts.map((p) => [p![0] * s, canvas.height - p![1] * s]) as Zone['pts'] }]
          : [];
      });
      drawZones(ctx, zones, 2, 12);
    }
  });

  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, cov()?.open ?? 1))}%`;
  const stats = () => {
    const c = cov();
    if (!c) return [];
    return which() === 'tuning'
      ? [
          [
            'Spatial information coverage',
            pct(c.information),
            'Arena bins meeting the minimum sampling time for spatial information.',
          ],
          [
            'Stability coverage',
            pct(c.stability),
            'Arena bins meeting the sampling requirements for the stability test.',
          ],
        ]
      : [
          [
            'Place-field coverage',
            pct(c.fields),
            'Arena bins meeting the minimum sampling time for outlining place fields.',
          ],
        ];
  };

  return (
    <section class="cb-group cb-card-box cb-occupancy">
      <div class="cb-occupancy__head">
        <h3>
          Occupancy for {which() === 'tuning' ? 'the tuning tests' : 'place-field outlines'}
          <InfoTip label="About the occupancy preview">
            Time spent in each spatial bin, using the current bin size and minimum speed. Grey bins
            are under the minimum time
            {which() === 'tuning' ? ' for the tests' : ' for outlining fields'}.
          </InfoTip>
        </h3>
        <span class="cb-muted">Follows the open settings section</span>
      </div>
      <Show
        when={cov()}
        fallback={<div class="cb-empty">Load position and set up the arena to see occupancy.</div>}
      >
        <div class="cb-occupancy__body">
          <div>
            <canvas
              ref={canvas}
              class="cb-map cb-occupancy__map"
              style={{ 'aspect-ratio': `${sizeCm()[0]} / ${sizeCm()[1]}` }}
            />
            <div class="cb-legend">
              <span class="cb-legend__item">0 s</span>
              <span class="cb-legend__bar" style={{ background: gradientCss('right') }} />
              <span class="cb-legend__item">{top().toFixed(1)} s</span>
              <span class="cb-legend__item">
                <i style={{ background: GREY }} /> under the minimum
              </span>
            </div>
            <HowToRead>
              <p>
                Each square is one spatial bin of the arena, seen from above. Darker bins are where
                the animal spent more time; grey bins were visited for less than the minimum time
                and are left out of the maps. Use this to check that the arena is sampled evenly
                before reading the maps: bins with little time give unreliable event rates.
              </p>
            </HowToRead>
            <Show when={arena.zones.length}>
              <label class="cb-radio">
                <input
                  type="checkbox"
                  checked={showZones()}
                  onChange={(e) => setShowZones(e.currentTarget.checked)}
                />
                Show zones
              </label>
            </Show>
          </div>
          <div class="cb-occupancy__stats">
            <For each={stats()}>
              {([label, value, text]) => (
                <div class="cb-statbox">
                  <div class="cb-muted">{label}</div>
                  <div class="cb-statbox__value">{value}</div>
                  <div class="cb-muted">{text}</div>
                </div>
              )}
            </For>
            <Note>
              <Show
                when={which() === 'tuning'}
                fallback={
                  <p>
                    Only frames that pass the minimum-speed filter are counted. Grey bins are
                    visited for less than {placeSettings.minOccFieldsS} s and cannot be part of a
                    place field.
                  </p>
                }
              >
                <p>
                  Only frames that pass the minimum-speed filter are counted. Spatial information
                  uses the whole recording. Stability compares maps built separately from the first
                  and second half of the recording, so a bin counts toward stability coverage only
                  if it meets the minimum time ({arena.minOccupancy} s) in both halves. Grey bins in
                  this preview follow that stricter requirement.
                </p>
              </Show>
              <p>Meeting the minimum does not guarantee a reliable rate estimate.</p>
            </Note>
          </div>
        </div>
      </Show>
    </section>
  );
}
