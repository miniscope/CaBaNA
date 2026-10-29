// How place-cell maps are drawn. Display only: none of this changes the statistics.

import { createStore } from 'solid-js/store';
import { viridisRGB } from '@calab/ui/chart';
import { smoothGrid } from './placecells.ts';

export const COLORMAPS = {
  viridis: viridisRGB,
  /** The classic blue to red map used in much of the place-cell literature. */
  jet: (t: number): [number, number, number] => {
    const c = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)));
    return [
      c(1.5 - Math.abs(4 * t - 3)),
      c(1.5 - Math.abs(4 * t - 2)),
      c(1.5 - Math.abs(4 * t - 1)),
    ];
  },
} as const;

const DEFAULT_DISPLAY = {
  /** Squares as binned, or interpolated between bin centers. */
  style: 'bins' as 'bins' | 'smooth',
  /** Extra Gaussian smoothing of the drawn map, in bins. 0 draws the analysis maps as they are. */
  sigma: 0,
  colormap: 'viridis' as keyof typeof COLORMAPS,
  /** One color scale for the three maps of a cell, or each map on its own. */
  scale: 'shared' as 'shared' | 'own',
};
export const [placeDisplay, setPlaceDisplay] = createStore({ ...DEFAULT_DISPLAY });

export const resetPlaceDisplay = () => setPlaceDisplay({ ...DEFAULT_DISPLAY });
export const placeDisplayChanged = () =>
  (Object.keys(DEFAULT_DISPLAY) as (keyof typeof DEFAULT_DISPLAY)[]).some(
    (k) => placeDisplay[k] !== DEFAULT_DISPLAY[k],
  );

export const colorAt = (t: number) => COLORMAPS[placeDisplay.colormap](Math.min(1, Math.max(0, t)));

/** A CSS gradient of the current color map, low to high. */
export function gradientCss(direction: 'right' | 'top'): string {
  const stops = Array.from({ length: 9 }, (_, i) => `rgb(${colorAt(i / 8).join(',')})`);
  return `linear-gradient(to ${direction}, ${stops.join(',')})`;
}

/** A map as drawn: smoothed a little more if asked, with unvisited bins kept empty. */
export function displayMap(values: ArrayLike<number>, shape: [number, number]): Float32Array {
  const out = Float32Array.from(values);
  if (!(placeDisplay.sigma > 0)) return out;
  const ok = Uint8Array.from(out, (v) => (Number.isFinite(v) ? 1 : 0));
  const sm = smoothGrid(
    Float64Array.from(out, (v) => (Number.isFinite(v) ? v : 0)),
    ok,
    shape,
    placeDisplay.sigma,
  );
  return out.map((v, i) => (ok[i] ? sm[i] : NaN));
}

export const maxOf = (...maps: ArrayLike<number>[]) =>
  Math.max(0, ...maps.flatMap((m) => Array.from(m).filter(Number.isFinite)));
