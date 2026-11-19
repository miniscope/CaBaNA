// What one analysis supplies to the Results window: its plot types (the first is the main one, the
// figure of the Overview), the content of the Summary card, and whether the plot types already
// cover every plot of the analysis's own page. The window owns everything else.

import type { JSX } from 'solid-js';
import type { PlotSpec } from '../../lib/plot-spec.ts';

/** One entry of the Plot type drop-down, with the controls that belong to it. */
export interface PlotType {
  id: string;
  /** Name in the Plot type drop-down. */
  label: string;
  /** The "How to read this plot" text. */
  help?: () => JSX.Element;
  /** Choose one of several behaviors or labels shown by the plot. */
  switcher?: { label: string; options: string[]; index: () => number; set: (i: number) => void };
  /** One line under the controls: what the rows, axes and colors are. */
  subtitle?: () => string;
  main: () => JSX.Element;
  /** A smaller drawing for the Overview; the plot itself when absent. */
  overview?: () => JSX.Element;
  /** The plot as a plot the Plot editor can restyle; absent when it has none. */
  editSpec?: () => PlotSpec | undefined;
}

export interface ExplorerParts {
  /** The result in one line, from the arrays the parts read; absent when the saved tables say it. */
  headline?: () => string | undefined;
  plots: PlotType[];
  /** The plot types are all the plots of the analysis's page; none is listed from there. */
  coversPlots?: boolean;
  summary: () => JSX.Element;
}
