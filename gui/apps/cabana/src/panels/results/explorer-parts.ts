// What one analysis supplies to the shared Results explorer frame: its main plot, the switcher
// above it, and the content of the Summary card. The frame owns everything else.

import type { JSX } from 'solid-js';
import type { PlotSpec } from '../../lib/plot-spec.ts';

export interface ExplorerParts {
  /** Title of the main plot card, e.g. "Population PETH · investigate_stimulus". */
  title: () => string;
  /** The "How to read this plot" text. */
  help: () => JSX.Element;
  /** The run holds a shuffle test, so its shuffle count is worth showing beside the scope. */
  tested: boolean;
  /** Name of the main view in the View selector. */
  mainLabel: string;
  /** Choose one of several behaviors or labels shown by the main plot. */
  switcher?: { label: string; options: string[]; index: () => number; set: (i: number) => void };
  /** One line under the title: what the rows, axes and colors are. */
  subtitle?: () => string;
  main: () => JSX.Element;
  summary: () => JSX.Element;
  /** The main plot as a plot the Plot editor can restyle; absent when it has none. */
  editSpec?: () => PlotSpec | undefined;
}
