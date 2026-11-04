// State of a guided analysis setup: three stages (configure, review, run), the open section and
// which sections have been opened. Kept per page outside the page, so it survives a visit to the
// results; the reviewed marks reset when the dataset changes. Nothing here gates a run.

import { createRoot, createSignal } from 'solid-js';
import { onClear } from './store.ts';

export type Stage = 'configure' | 'review' | 'run';
export const STAGES: { id: Stage; title: string }[] = [
  { id: 'configure', title: 'Configure settings' },
  { id: 'review', title: 'Review and preview' },
  { id: 'run', title: 'Run analysis' },
];

export interface Guided {
  stage: () => Stage;
  setStage: (s: Stage) => void;
  section: () => string;
  /** Open a section and mark it reviewed. */
  open: (id: string) => void;
  reviewed: (id: string) => boolean;
  /** The section after (+1) or before (-1) the open one, in `order`; undefined at either end. */
  step: (order: string[], by: 1 | -1) => string | undefined;
  reset: () => void;
}

const all = new Map<string, Guided>();

/** The guided state of page `page`, made on first use with `first` as the open section. */
export function guided(page: string, first: string): Guided {
  const had = all.get(page);
  if (had) return had;
  const g = createRoot(() => {
    const [stage, setStage] = createSignal<Stage>('configure');
    const [section, setSection] = createSignal(first);
    const [seen, setSeen] = createSignal<ReadonlySet<string>>(new Set([first]));
    return {
      stage,
      setStage,
      section,
      open: (id: string) => {
        setSection(id);
        setSeen((s) => (s.has(id) ? s : new Set([...s, id])));
      },
      reviewed: (id: string) => seen().has(id),
      step: (order: string[], by: 1 | -1) => order[order.indexOf(section()) + by],
      reset: () => {
        setStage('configure');
        setSection(first);
        setSeen(new Set([first]));
      },
    };
  });
  all.set(page, g);
  return g;
}

onClear(() => all.forEach((g) => g.reset()));

/** Smallest p a permutation test can give with `n` shuffles: 1 / (n + 1). */
export const pFloor = (n: number) => 1 / (n + 1);

/** "minimum p = 1/51 = 0.0196" for 50 shuffles. */
export const pFloorText = (n: number) => `minimum p = 1/${n + 1} = ${pFloor(n).toPrecision(3)}`;
