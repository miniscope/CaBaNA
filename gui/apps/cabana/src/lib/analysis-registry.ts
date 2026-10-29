// Connects each framework analysis to the stores it reads: builds the pipeline from the current
// settings and the loaded data, and says which Preprocess fields feed its hash.

import { configReport } from './config-import.ts';
import { hasCapability } from './bridge-status.ts';
import { behaviorDecoding, decodeTarget, positionDecoding } from './decoding-settings.ts';
import { populationSettings } from './population-settings.ts';
import { aurocSettings } from './auroc-run.ts';
import { arena, effectiveBin } from './arena.ts';
import { placeSettings } from './place-run.ts';
import { aurocPipeline, placePipeline } from './spec/place.ts';
import { registerFrameworkAnalysis, type FrameworkRun } from './runs.ts';
import { commonInput } from './session-config.ts';
import { annotationResults } from './store.ts';
import { behaviorDecodingPipeline, positionDecodingPipeline } from './spec/decoding.ts';
import { populationPipeline, type PopulationContext } from './spec/population.ts';
import { prep } from './preprocess.ts';
import type { CapabilityName } from './bridge-client.ts';

const labelsOf = (slot: 'zone_annotations' | 'behavior_annotations') => [
  ...new Set(
    annotationResults()
      .filter((a) => a.id === slot && !a.error)
      .flatMap((a) => a.epochs.map((e) => e.label)),
  ),
];

/** What the pipeline builders need from the loaded data. Bout tables are named `<epoch name>_epochs`. */
export function populationContext(): PopulationContext & { has: (c: CapabilityName) => boolean } {
  const names = configReport()?.values.epochNames ?? {};
  return {
    common: commonInput(),
    behaviorSource: `${names.behavior_annotations ?? 'behavior'}_epochs`,
    zoneSource: `${names.zone_annotations ?? 'zones'}_epochs`,
    labels: { behaviors: labelsOf('behavior_annotations'), zones: labelsOf('zone_annotations') },
    has: hasCapability,
  };
}

const POPULATION_PREP = [
  'eventSigmaS',
  'fillGapS',
  'posMethod',
  'posWindowS',
  'speedWindowS',
  'minSpeed',
  'maxGapS',
];
const BEHAVIOR_DECODING_PREP: string[] = [];
const POSITION_DECODING_PREP = [
  'fillGapS',
  'posMethod',
  'posWindowS',
  'speedWindowS',
  'minSpeed',
  'maxGapS',
];

/** Shuffles of a Quick preview (saved as Preliminary). */
export const PREVIEW_SHUFFLES = 50;

const PLACE_PREP = ['eventSigmaS', 'maxGapS', 'fillGapS', 'posMethod', 'posWindowS', 'speedWindowS', 'minSpeed'];
const AUROC_PREP = ['eventSigmaS', 'labelPadS', 'maxGapS', 'fillGapS', 'posMethod', 'posWindowS', 'speedWindowS'];

export function registerAnalyses(): void {
  registerFrameworkAnalysis('place', (scope): FrameworkRun => {
    const ctx = populationContext();
    // Minimum time per bin is shared with the arena settings, as in the browser engine. A quick
    // preview uses the preview shuffle count.
    const settings = {
      ...placeSettings,
      nShuffles: scope === 'preview' ? Math.min(PREVIEW_SHUFFLES, placeSettings.nShuffles) : placeSettings.nShuffles,
      minOccS: arena.minOccupancy,
      binCm: effectiveBin(),
    };
    const built = placePipeline(settings, ctx.common, effectiveBin());
    // A value an automatic choice replaces cannot change the result, so it stays out of the hash.
    const used: Partial<typeof settings> = { ...settings };
    if (settings.sigmaAuto) delete used.sigma;
    if (settings.shiftAuto) delete used.minShiftS;
    return {
      spec: { ...built, requires: [], target: 'position' },
      settings: used,
      prepKeys: PLACE_PREP,
    };
  });
  registerFrameworkAnalysis('auroc', (scope): FrameworkRun => {
    const ctx = populationContext();
    const settings = {
      ...aurocSettings,
      nShuffles: scope === 'preview' ? Math.min(PREVIEW_SHUFFLES, aurocSettings.nShuffles) : aurocSettings.nShuffles,
      unselected: [...aurocSettings.unselected],
      match: { ...aurocSettings.match },
    };
    const built = aurocPipeline(settings, ctx.common, ctx.behaviorSource, ctx.labels.behaviors);
    const used: Partial<typeof settings> = { ...settings };
    // The framework's automatic timescale acts on circular shifts only, so a speed-matched run keeps the typed shift.
    if (settings.shiftAuto && settings.method === 'circular') delete used.minShiftS;
    if (settings.compare === 'rest') {
      delete used.pairA;
      delete used.pairB;
    }
    if (!settings.speedFilter) delete used.minSpeed;
    if (settings.method === 'circular') delete used.match;
    return {
      spec: { ...built, requires: [], target: 'auroc_target' },
      settings: used,
      prepKeys: AUROC_PREP,
    };
  });
  registerFrameworkAnalysis('population', (scope): FrameworkRun => {
    const settings = { ...populationSettings, labels: [...populationSettings.labels] };
    const position = settings.target === 'position';
    return {
      spec: populationPipeline(settings, populationContext(), scope === 'preview'),
      settings,
      // Event smoothing feeds every population analysis; position steps only the position target.
      prepKeys: position ? POPULATION_PREP : ['eventSigmaS'],
    };
  });
  registerFrameworkAnalysis('decoding', (scope): FrameworkRun => {
    const ctx = populationContext();
    const preview = scope === 'preview';
    if (decodeTarget.type === 'position')
      return {
        spec: positionDecodingPipeline(positionDecoding, ctx, preview),
        settings: { type: 'position', ...positionDecoding },
        prepKeys: POSITION_DECODING_PREP,
      };
    return {
      spec: behaviorDecodingPipeline(behaviorDecoding, ctx, preview),
      settings: { type: 'behaviors', ...behaviorDecoding, labels: [...behaviorDecoding.labels] },
      prepKeys: BEHAVIOR_DECODING_PREP,
    };
  });
}

/** Keys of `prep` that exist (guards against a typo in the lists above). */
export const validPrepKeys = (keys: string[]) => keys.every((k) => k in prep);
