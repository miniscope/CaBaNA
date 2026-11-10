// Position → Arena and zones on the Data setup page: the arena editor from Experimental setup
// (outline, scale, zones, picture), and beside it the share of tracked time in each zone, which
// updates as zones are drawn or moved. Everything here is saved to the experiment config.

import { For, Show, type JSX } from 'solid-js';
import { zoneShare } from '../../lib/arena.ts';
import { ZONE_COLORS } from '../../lib/draw.ts';
import { InfoTip } from '../InfoTip.tsx';
import { SpatialSetup, SpatialStageBar } from '../SpatialSetup.tsx';

function ZoneTime(): JSX.Element {
  const outside = () => Math.max(0, 100 - zoneShare().reduce((a, z) => a + z.pct, 0));
  return (
    <section class="cb-ds-zt" aria-label="Time in each zone">
      <div class="cb-ds-zt__head">
        <strong>Time in each zone</strong>
        <InfoTip label="About time in each zone">
          Share of the tracked position frames inside each zone, updated as zones are drawn or
          moved. A frame inside two zones counts for the first zone, as in the zone epochs the
          analyses use. Excluded regions are not zones and are not listed.
        </InfoTip>
      </div>
      <Show
        when={zoneShare().length}
        fallback={<p class="cb-muted">Draw zones on the arena to see the time in each.</p>}
      >
        <For each={zoneShare()}>
          {(z) => (
            <div class="cb-ds-zt__row">
              <span class="cb-ds-zt__name" title={z.name}>
                {z.name}
              </span>
              <span class="cb-ds-zt__track">
                <span
                  style={{
                    width: `${z.pct}%`,
                    background: ZONE_COLORS[z.index % ZONE_COLORS.length],
                  }}
                />
              </span>
              <span class="cb-ds-zt__pct">{z.pct.toFixed(0)}%</span>
            </div>
          )}
        </For>
        <div class="cb-ds-zt__row">
          <span class="cb-ds-zt__name cb-muted">Outside zones</span>
          <span class="cb-ds-zt__track">
            <span class="cb-ds-zt__out" style={{ width: `${outside()}%` }} />
          </span>
          <span class="cb-ds-zt__pct">{outside().toFixed(0)}%</span>
        </div>
      </Show>
    </section>
  );
}

export function FileArena(): JSX.Element {
  return (
    <div class="cb-ds-arena">
      <div class="cb-ds-arena__main">
        <SpatialStageBar />
        <div class="cb-es-body">
          <SpatialSetup />
        </div>
      </div>
      <ZoneTime />
    </div>
  );
}
