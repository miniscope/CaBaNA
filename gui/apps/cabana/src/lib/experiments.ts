// Experimental paradigms. Choosing one sets which files are needed. Anything
// not listed keeps the default level from slots.ts.

import type { Level, SlotId } from './slots.ts';

export interface Paradigm {
  id: string;
  label: string;
  summary: string;
  levels: Partial<Record<SlotId, Level>>;
}

type Levels = Paradigm['levels'];

/** An animal moving through space: position is needed, annotations and zones help. */
const spatial = (extra: Levels = {}): Levels => ({
  behavior_timestamps: 'required',
  position: 'required',
  behavior_annotations: 'optional',
  zone_annotations: 'optional',
  head_orientation: 'optional',
  config: 'recommended',
  ...extra,
});

/** Scored behaviors are the point: annotations are needed, position helps. */
const scored = (extra: Levels = {}): Levels => ({
  behavior_annotations: 'required',
  behavior_timestamps: 'recommended',
  position: 'recommended',
  zone_annotations: 'unused',
  ...extra,
});

/** No position: events such as tones, rewards or states are annotated. */
const events = (extra: Levels = {}): Levels => ({
  behavior_annotations: 'required',
  behavior_timestamps: 'recommended',
  position: 'unused',
  zone_annotations: 'unused',
  head_orientation: 'unused',
  ...extra,
});

export const PARADIGMS: Paradigm[] = [
  {
    id: 'open_field',
    label: 'Open field',
    summary: 'One animal explores an empty arena.',
    levels: spatial({ behavior_annotations: 'unused' }),
  },
  {
    id: 'linear_track',
    label: 'Linear track',
    summary: 'Running back and forth for reward.',
    levels: spatial({ zone_annotations: 'recommended' }),
  },
  {
    id: 't_maze',
    label: 'T-maze or Y-maze alternation',
    summary: 'Spatial working memory with trials and choices.',
    levels: spatial({ behavior_annotations: 'recommended', zone_annotations: 'recommended' }),
  },
  {
    id: 'barnes',
    label: 'Barnes maze',
    summary: 'Finding the escape hole on a circular table.',
    levels: spatial(),
  },
  {
    id: 'morris',
    label: 'Morris water maze',
    summary: 'Finding a hidden platform in a pool.',
    levels: spatial({ zone_annotations: 'recommended' }),
  },
  {
    id: 'epm',
    label: 'Elevated plus maze',
    summary: 'Open versus closed arms.',
    levels: spatial({ zone_annotations: 'recommended' }),
  },
  {
    id: 'light_dark',
    label: 'Light-dark box',
    summary: 'Time in the light and dark compartments.',
    levels: spatial({ zone_annotations: 'recommended' }),
  },
  {
    id: 'cpp',
    label: 'Conditioned place preference',
    summary: 'Time spent in chambers paired with a reward or drug.',
    levels: spatial({ zone_annotations: 'recommended', behavior_annotations: 'unused' }),
  },
  {
    id: 'novel_object',
    label: 'Novel object recognition',
    summary: 'Exploring familiar and novel objects.',
    levels: spatial({ behavior_annotations: 'recommended', zone_annotations: 'recommended' }),
  },
  {
    id: 'object_location',
    label: 'Object location memory',
    summary: 'An object is moved to a new place.',
    levels: spatial({ behavior_annotations: 'recommended', zone_annotations: 'recommended' }),
  },
  {
    id: 'three_chamber',
    label: 'Three-chamber social',
    summary: 'Moving between chambers and investigating a stimulus animal or an empty enclosure.',
    levels: spatial({
      behavior_annotations: 'recommended',
      zone_annotations: 'recommended',
      head_orientation: 'recommended',
    }),
  },
  {
    id: 'social_interaction',
    label: 'Direct social interaction',
    summary: 'Free interaction with a partner; social behaviors are scored.',
    levels: scored({ head_orientation: 'optional' }),
  },
  {
    id: 'resident_intruder',
    label: 'Resident-intruder',
    summary: 'Aggression and investigation toward an intruder.',
    levels: scored(),
  },
  {
    id: 'social_memory',
    label: 'Social memory',
    summary: 'Repeated exposure to the same or a novel animal.',
    levels: scored({ zone_annotations: 'optional' }),
  },
  {
    id: 'fear_conditioning',
    label: 'Fear conditioning',
    summary: 'Tones and shocks, with freezing scored.',
    levels: events({ footprints: 'optional' }),
  },
  {
    id: 'fear_extinction',
    label: 'Fear extinction and recall',
    summary: 'Tones without shocks across later sessions.',
    levels: events({ footprints: 'optional' }),
  },
  {
    id: 'operant',
    label: 'Operant task or lick and reward',
    summary: 'Lever presses, nose pokes, licking and reward epochs.',
    levels: events(),
  },
  {
    id: 'home_cage',
    label: 'Home cage or sleep',
    summary: 'Long recordings in the home cage, with states scored.',
    levels: events({ behavior_annotations: 'recommended', position: 'optional' }),
  },
  {
    id: 'eye_whisker',
    label: 'Eye or whisker tracking',
    summary: 'Pupil, gaze or whisker measures. Put x and y of the measure in the position file.',
    levels: {
      behavior_timestamps: 'required',
      position: 'optional',
      behavior_annotations: 'optional',
      zone_annotations: 'unused',
    },
  },
  {
    id: 'custom',
    label: 'Other or not sure',
    summary: 'Nothing is assumed. Load what you have and CaBaNA checks it.',
    levels: {},
  },
];
