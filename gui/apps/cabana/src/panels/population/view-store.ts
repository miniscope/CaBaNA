// Display-only state of the Population results. Nothing here is a setting of the analysis, and
// changing it never starts a run (settings live in lib/population-settings.ts).

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { PopulationMethod } from '../../lib/population-settings.ts';
import type { StateOrder } from './logic.ts';

export const DEFAULT_PLOT_SETTINGS = {
  /** Write the value inside each heatmap cell. */
  values: false,
  order: 'listed' as StateOrder,
  limits: 'auto' as 'auto' | 'fixed',
  fixedLo: 0,
  fixedHi: 1,
  /** Log10 y axis of the eigenvalue spectrum. */
  logAxis: false,
  /** Principal components on the x and y axes of the state-means plot (0-based). */
  pcX: 0,
  pcY: 1,
  /** Component whose top-loading cells are listed (0-based). */
  component: 0,
  /** State shown in the half-A versus half-B plot. */
  state: 0,
  /** Rows of the pair tables are paged at 100. */
  page: 0,
  /** Sub-figure of the views that hold several. */
  figure: {} as Record<string, string>,
};
export const [plotSettings, setPlotSettings] = createStore({ ...DEFAULT_PLOT_SETTINGS });

/** The method whose results are shown. */
export const [resultMethod, setResultMethod] = createSignal<PopulationMethod>('similarity');
