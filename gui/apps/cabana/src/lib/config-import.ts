// Applies a loaded config.yaml to the GUI's settings. Values from the config replace
// what was typed; anything changed by hand afterwards wins.

import { createSignal } from 'solid-js';
import { setArena, setPendingZones } from './arena.ts';
import { readConfig, type ConfigRead } from './config-read.ts';
import {
  onClear,
  onConfig,
  setConfigFiles,
  setOverride,
  setSessionName,
  setSource,
  setTol,
} from './store.ts';

/** What the last config.yaml set, kept, did not recognize, or lacked. */
export const [configReport, setConfigReport] = createSignal<ConfigRead>();

onClear(() => setConfigReport(undefined));

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
  if (v.subjectId) setSource('subjectId', v.subjectId);
  for (const [k, val] of Object.entries(v.meta)) setSource(k as never, val as never);
  if (v.stimuli) setSource('stimuli', v.stimuli);
  if (v.mergeGapS !== undefined) setTol('mergeGapS', v.mergeGapS);
  if (v.minBoutS !== undefined) setTol('minBoutS', v.minBoutS);
  if (v.headOffsetDeg !== undefined) setArena('headOffset', v.headOffsetDeg);
  if (v.bodyLengthCm !== undefined) setArena('bodyLength', v.bodyLengthCm);
  if (v.arena) setArena(v.arena);
  if (v.zones?.length) setPendingZones(v.zones);
});
