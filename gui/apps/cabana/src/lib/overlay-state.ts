// State of the behavior overlays: the viewer's choices, what they give for this session, and the hovered bout.

import { createMemo, createSignal } from 'solid-js';
import { annotationResults } from './store.ts';
import { span } from './viz.ts';
import {
  groupByFile,
  isolate,
  layoutStripes,
  setAll,
  shownNames,
  visibleBouts,
  type AnnotationFile,
  type Bout,
  type Choices,
  type Intensity,
} from './overlays.ts';

const KEY = 'cabana.behaviorOverlays';

// A per-viewer preference, kept by behavior name so it carries over to other sessions.
function load(): { choices: Choices; intensity: Intensity } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      choices: typeof saved.choices === 'object' && saved.choices ? saved.choices : {},
      intensity: saved.intensity === 'strong' ? 'strong' : 'subtle',
    };
  } catch {
    return { choices: {}, intensity: 'subtle' };
  }
}

const saved = load();
const [choices, setChoices] = createSignal<Choices>(saved.choices);
const [intensity, setIntensityState] = createSignal<Intensity>(saved.intensity);
export { intensity };

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ choices: choices(), intensity: intensity() }));
  } catch {
    // Storage can be blocked; the choices then last for this page only.
  }
}

export const files = createMemo<AnnotationFile[]>(() =>
  annotationResults()
    .filter((a) => !a.error)
    .map((a) => ({ id: a.id, name: a.name, epochs: a.epochs.filter((e) => e.stop > e.start) })),
);

const sessionSeconds = () => span()[1] - span()[0];
export const groups = createMemo(() => groupByFile(files(), sessionSeconds()));
export const shown = createMemo(() => shownNames(groups(), choices()));
export const behaviorCount = () => groups().reduce((n, g) => n + g.behaviors.length, 0);

/** Every shown bout of the session with its stripe; the same list is drawn and hit-tested. */
export const stripes = createMemo(() => layoutStripes(visibleBouts(files(), shown(), span())));
/** Every bout, shown or not: timeline rows stay and can be hovered whatever the overlays show. */
export const allBouts = createMemo(() => files().flatMap((f) => f.epochs));

export function setShown(name: string, on: boolean): void {
  setChoices({ ...choices(), [name]: on });
  save();
}
export function showAll(on: boolean): void {
  setChoices(setAll(groups(), choices(), on));
  save();
}
export function isolateBehavior(name: string): void {
  setChoices(isolate(groups(), choices(), name));
  save();
}
export function setIntensity(v: Intensity): void {
  setIntensityState(v);
  save();
}

/** The bout under the mouse in a plot or the timeline; outlined in both. */
export const [hoverBout, setHoverBout] = createSignal<Bout | undefined>();
