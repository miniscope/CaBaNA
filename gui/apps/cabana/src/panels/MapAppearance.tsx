import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js';
import {
  COLORMAPS,
  placeDisplay,
  placeDisplayChanged,
  resetPlaceDisplay,
  setPlaceDisplay,
} from '../lib/place-display.ts';

const PALETTES: Record<keyof typeof COLORMAPS, string> = { viridis: 'Viridis', jet: 'Blue–red' };

/**
 * How the maps are drawn, in a popover next to them. None of it changes the numbers.
 * `limits` adds the color-limits choice (the gallery has its own switch for it).
 */
export function MapAppearance(props: { limits?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let wrap: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button?.focus();
  };
  createEffect(
    on(open, (o) => {
      if (!o) return;
      queueMicrotask(() => pop?.querySelector<HTMLElement>('button, select, input')?.focus());
      const away = (e: MouseEvent) => {
        if (wrap && !wrap.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('mousedown', away);
      onCleanup(() => document.removeEventListener('mousedown', away));
    }),
  );

  return (
    <div
      class="cb-appearance"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open()) {
          e.stopPropagation();
          close(true);
        }
      }}
      onFocusOut={(e) => {
        if (open() && !wrap?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        class="btn-secondary btn-small"
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        Map appearance{placeDisplayChanged() ? ' •' : ''} <span aria-hidden="true">▾</span>
      </button>
      <Show when={open()}>
        <div class="cb-pop" ref={pop} role="dialog" aria-label="Map appearance">
          <div class="cb-pop__title">Display only</div>
          <div class="cb-pop__row">
            <span id="cb-ap-render">Rendering</span>
            <div class="cb-seg" role="group" aria-labelledby="cb-ap-render">
              <For
                each={
                  [
                    ['bins', 'Bins'],
                    ['smooth', 'Interpolated'],
                  ] as const
                }
              >
                {([v, label]) => (
                  <button
                    type="button"
                    classList={{ 'cb-seg__on': placeDisplay.style === v }}
                    aria-pressed={placeDisplay.style === v}
                    onClick={() => setPlaceDisplay('style', v)}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <label class="cb-pop__row">
            Color palette
            <select
              value={placeDisplay.colormap}
              onChange={(e) =>
                setPlaceDisplay('colormap', e.currentTarget.value as keyof typeof COLORMAPS)
              }
            >
              <For each={Object.keys(PALETTES) as (keyof typeof COLORMAPS)[]}>
                {(c) => <option value={c}>{PALETTES[c]}</option>}
              </For>
            </select>
          </label>
          <Show when={props.limits}>
            <label class="cb-pop__row">
              Color limits
              <select
                value={placeDisplay.scale}
                onChange={(e) =>
                  setPlaceDisplay('scale', e.currentTarget.value as 'shared' | 'own')
                }
              >
                <option value="shared">Shared across this cell’s maps</option>
                <option value="own">Each map on its own</option>
              </select>
            </label>
          </Show>
          <details class="cb-pop__adv">
            <summary>Advanced appearance</summary>
            <label class="cb-pop__row">
              Extra display smoothing
              <span>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.5"
                  value={placeDisplay.sigma}
                  onInput={(e) =>
                    setPlaceDisplay('sigma', Math.min(5, Math.max(0, +e.currentTarget.value || 0)))
                  }
                />{' '}
                bins
              </span>
            </label>
            <div class="cb-muted">
              Blurs the drawn map only. It is separate from the smoothing used in the analysis, and
              like interpolation it can hide how coarse a cell’s data is. Check Bins before trusting
              a field.
            </div>
          </details>
          <div class="cb-muted">Appearance changes do not affect analysis results.</div>
          <div class="cb-pop__foot">
            <button type="button" class="cb-link" onClick={resetPlaceDisplay}>
              Reset appearance
            </button>
            <button type="button" class="btn-primary btn-small" onClick={() => close(true)}>
              Done
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
