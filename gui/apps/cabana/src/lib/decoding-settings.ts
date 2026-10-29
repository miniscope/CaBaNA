// Decoding settings (plan D-22, D-23). Position and behavior decoding keep separate settings so
// switching the target type never changes the other one. "Starting settings" are the defaults.

import { createStore } from 'solid-js/store';
import { SETTINGS_VERSION } from './settings-hash.ts';

export type DecodeTarget = 'position' | 'behaviors';
export type Decoder = 'bayesian' | 'logistic';

export interface CommonDecoding {
  folds: number;
  /** Frames within this gap of a test fold are left out of training (framework F1). */
  foldGapS: number;
  shuffles: number;
  blockS: number;
  correction: 'max_stat' | 'none';
  alpha: number;
  seed: number;
}
const COMMON: CommonDecoding = {
  folds: 5,
  foldGapS: 1,
  shuffles: 1000,
  blockS: 1,
  correction: 'max_stat',
  alpha: 0.05,
  seed: 0,
};

export const DEFAULT_POSITION_DECODING = {
  settingsVersion: SETTINGS_VERSION,
  ...COMMON,
  likelihood: 'gaussian' as 'gaussian' | 'poisson',
  windowS: 0.25,
  smoothSigmaBins: 0,
  sigma: 'per_state' as 'per_state' | 'pooled',
  prior: 'occupancy' as 'occupancy' | 'uniform',
  minFramesPerClass: 20,
};
export const DEFAULT_BEHAVIOR_DECODING = {
  settingsVersion: SETTINGS_VERSION,
  ...COMMON,
  decoder: 'bayesian' as Decoder,
  likelihood: 'gaussian' as 'gaussian' | 'poisson',
  windowS: 0.25,
  smoothSigmaBins: 0,
  sigma: 'pooled' as 'per_state' | 'pooled',
  prior: 'occupancy' as 'occupancy' | 'uniform',
  minFramesPerClass: 20,
  /** Logistic regression. */
  mode: 'one_vs_rest' as 'one_vs_rest' | 'multiclass',
  C: 1,
  binS: 0.5,
  /** Behaviors to decode, in priority order; empty means all labels. */
  labels: [] as string[],
  overlap: 'exclude' as 'exclude' | 'priority',
  /** Add "Other / none of the selected behaviors" as a class. */
  other: false,
};
export type PositionDecoding = typeof DEFAULT_POSITION_DECODING;
export type BehaviorDecoding = typeof DEFAULT_BEHAVIOR_DECODING;

export const [positionDecoding, setPositionDecoding] = createStore<PositionDecoding>({
  ...DEFAULT_POSITION_DECODING,
});
export const [behaviorDecoding, setBehaviorDecoding] = createStore<BehaviorDecoding>({
  ...DEFAULT_BEHAVIOR_DECODING,
  labels: [],
});
export const [decodeTarget, setDecodeTarget] = createStore<{ type: DecodeTarget }>({
  type: 'position',
});
export const PREVIEW_DECODING_SHUFFLES = 50;
export const OTHER_NAME = 'Other / none of the selected behaviors';
