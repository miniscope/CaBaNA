// What the Decoding page knows right now: the settings of the chosen target, the loaded inputs,
// the pipeline they would build, and every reason a run cannot start.

import { createMemo } from 'solid-js';
import { arena } from '../../lib/arena.ts';
import { populationContext } from '../../lib/analysis-registry.ts';
import { bridgeState, hasCapability } from '../../lib/bridge-status.ts';
import {
  behaviorDecoding,
  decodeTarget,
  OTHER_NAME,
  positionDecoding,
} from '../../lib/decoding-settings.ts';
import { active, blockers } from '../../lib/runs.ts';
import { behaviorDecodingPipeline, positionDecodingPipeline } from '../../lib/spec/decoding.ts';
import {
  annotationResults,
  deconvolved,
  denoisedTrace,
  frameTimes,
  positionResult,
  rawTrace,
} from '../../lib/store.ts';
import {
  choiceGates,
  frameCounts,
  frameworkItems,
  localChecks,
  PLAIN_REQUIREMENT,
  settingProblems,
  type ClassCounts,
  type FrameworkItem,
  type InputFacts,
} from './logic.ts';

export const target = () => decodeTarget.type;
export const isPosition = () => target() === 'position';
/** Settings fields both targets share (every field of the position store is in the behavior store). */
export const shared = () => (isPosition() ? positionDecoding : behaviorDecoding);
export const isLogistic = () => !isPosition() && behaviorDecoding.decoder === 'logistic';

export const gates = () => choiceGates(hasCapability);

/** Behaviors that will be decoded, in priority order: the selection, or every usable label. */
export const selectedBehaviors = () => {
  const all = populationContext().labels.behaviors;
  return behaviorDecoding.labels.length
    ? behaviorDecoding.labels.filter((l) => all.includes(l))
    : all;
};

const bouts = () =>
  annotationResults()
    .filter((a) => a.id === 'behavior_annotations' && !a.error)
    .flatMap((a) => a.epochs);

/** Frames per behavior on the neural clock; undefined without neural timestamps or behaviors. */
export const counts = createMemo<ClassCounts | undefined>(() => {
  const times = frameTimes();
  const labels = selectedBehaviors();
  if (isPosition() || !times || !labels.length) return undefined;
  return frameCounts(bouts(), times, labels, behaviorDecoding.overlap, behaviorDecoding.other);
});

export const facts = (): InputFacts => {
  const pos = positionResult();
  return {
    neuralLoaded: !!(deconvolved() || rawTrace() || denoisedTrace()),
    deconvolved: !!deconvolved(),
    positionLoaded: !!pos && !('error' in pos),
    arenaOutline: !!arena.box,
    usableBehaviors: populationContext().labels.behaviors,
    selected: selectedBehaviors(),
    usable: counts(),
    minFramesPerClass: behaviorDecoding.minFramesPerClass,
  };
};

export const spec = () =>
  isPosition()
    ? positionDecodingPipeline(positionDecoding, populationContext())
    : behaviorDecodingPipeline(behaviorDecoding, populationContext());

export interface Checks {
  needsInput: string[];
  framework: FrameworkItem[];
  engineOff: boolean;
}

export function checks(): Checks {
  const needsInput = [
    ...localChecks(target(), facts()),
    ...settingProblems(shared(), isLogistic()),
  ];
  const framework = frameworkItems(spec().requires, hasCapability);
  if (isLogistic() && behaviorDecoding.mode === 'multiclass' && !hasCapability('overlap_policy'))
    framework.push({
      text: PLAIN_REQUIREMENT.overlap_policy!,
      short: 'multiclass needs the overlap policy, which is not in the installed framework',
      code: 'Multiclass logistic regression needs exclusive states (overlap_policy).',
    });
  return { needsInput, framework, engineOff: bridgeState().kind !== 'ready' };
}

/** The reason Run is unavailable, as one line next to the button; empty when it can run. */
export function runBlock(): string {
  const c = checks();
  if (c.engineOff) return 'The Python engine is not running. See Checks.';
  if (c.needsInput.length)
    return `Needs input: ${c.needsInput[0]}${c.needsInput.length > 1 ? ` (+${c.needsInput.length - 1} more, see Checks)` : ''}`;
  if (c.framework.length)
    return `Framework update required: ${c.framework.map((f) => f.short).join('; ')}`;
  const rest = blockers('decoding');
  return rest[0] ?? '';
}
export const canRun = () => !active() && runBlock() === '';
export { OTHER_NAME };
