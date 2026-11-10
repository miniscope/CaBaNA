// Applies a loaded config.yaml to the GUI's settings. Values from the config replace
// what was typed; anything changed by hand afterwards wins.

import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { arena, setArena, setPendingZones } from './arena.ts';
import { readConfig, type ConfigRead } from './config-read.ts';
import { setPrep } from './preprocess.ts';
import {
  onClear,
  onConfig,
  setConfigFiles,
  setConfiguredFrameMapping,
  setLabelRoles,
  setOverride,
  setSessionName,
  setSource,
  setTol,
} from './store.ts';
import { restoreChoices } from './position-corrections.ts';

/** What the last config.yaml set, kept, did not recognize, or lacked. */
export const [configReport, setConfigReport] = createSignal<ConfigRead>();

/**
 * Why the config's arena could not be used, until the user sets the arena by hand. Without it
 * the arena would silently be the default size.
 */
export const [arenaProblem, setArenaProblem] = createSignal<string>();
onClear(() => {
  setConfigReport(undefined);
  setArenaProblem(undefined);
});
// Typing a size or drawing the outline replaces the unreadable arena.
createRoot(() =>
  createEffect(
    on(
      () => [arena.width, arena.height, arena.box],
      () => setArenaProblem(undefined),
      { defer: true },
    ),
  ),
);

onConfig((text) => {
  const r = readConfig(text);
  const v = r.values;
  setConfigReport(r);
  setConfigFiles(r.files);
  if (v.name) setSessionName(v.name);
  if (v.neuralFps !== undefined) setOverride('neuralFps', v.neuralFps);
  if (v.clockOffsetS !== undefined) setSource('clockOffsetS', v.clockOffsetS);
  if (v.clockScale !== undefined) setSource('clockScale', v.clockScale);
  if (v.positionUnit) setSource('positionUnit', v.positionUnit);
  if (v.maxGapS !== undefined) setPrep('maxGapS', v.maxGapS);
  restoreChoices(v.excludeFrames, v.keptFrames);
  if (v.yDown !== undefined) setSource('yDown', v.yDown);
  if (v.subjectId) setSource('subjectId', v.subjectId);
  for (const [k, val] of Object.entries(v.meta)) setSource(k as never, val as never);
  if (v.stimuli) setSource('stimuli', v.stimuli);
  if (v.labelRoles) setLabelRoles(v.labelRoles);
  setConfiguredFrameMapping(v.frameMapping);
  if (v.mergeGapS !== undefined) setTol('mergeGapS', v.mergeGapS);
  if (v.minBoutS !== undefined) setTol('minBoutS', v.minBoutS);
  if (v.headOffsetDeg !== undefined) setArena('headOffset', v.headOffsetDeg);
  if (v.bodyLengthCm !== undefined) setArena('bodyLength', v.bodyLengthCm);
  if (v.arena) setArena(v.arena);
  else if (r.original?.arena !== undefined)
    setArenaProblem(
      `${r.problems.find((p) => p.startsWith('arena')) ?? 'The arena in the config could not be read.'} Set the arena size in Spatial setup.`,
    );
  if (v.zones?.length) setPendingZones(v.zones);
});
