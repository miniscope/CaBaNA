// The files CaBaNA can take. Each slot is one thing the user brings; Data setup lists them in the
// Neural data and Behavioral data cards, and files are matched to slots by name.

export type Level = 'required' | 'recommended' | 'optional' | 'unused';
export type Group = 'Neural' | 'Behavioral' | 'Configuration';
export type SlotId =
  | 'neural_timestamps'
  | 'neural_deconvolved'
  | 'neural_denoised'
  | 'neural_raw'
  | 'footprints'
  | 'behavior_timestamps'
  | 'position'
  | 'head_orientation'
  | 'zone_annotations'
  | 'behavior_annotations'
  | 'time_markers'
  | 'frame_labels'
  | 'behavior_frame'
  | 'config';

export interface Slot {
  id: SlotId;
  group: Group;
  label: string;
  level: Level;
  /** Example file name shown to the user. */
  file: string;
  /** What the file must contain. */
  format: string;
  /** Matches the file name when a folder or several files are loaded. */
  match: RegExp;
  /** File types the file chooser offers, as for an <input accept>. */
  accept: string;
  /** Behavioral activity: at least one of these is required. */
  activity?: boolean;
}

const ARRAY = '.npy,.npz,.mat';
const TABLE = '.csv';

export const SLOTS: Slot[] = [
  {
    id: 'neural_timestamps',
    group: 'Neural',
    label: 'Neural timestamps',
    level: 'required',
    accept: TABLE,
    file: 'neural_timestamps.csv',
    format: 'One row per miniscope frame. Columns: Frame Number, Time Stamp (ms).',
    match: /neural.*timestamp/i,
  },
  {
    id: 'neural_deconvolved',
    group: 'Neural',
    label: 'Deconvolved events',
    level: 'required',
    accept: ARRAY,
    file: 'neural_deconvolved.npy',
    format: 'Array, cells x frames (.npy, .npz or .mat). Event estimate from any pipeline.',
    match: /deconv(?!.*filtered)/i,
  },
  {
    id: 'neural_denoised',
    group: 'Neural',
    label: 'Denoised traces',
    level: 'recommended',
    accept: ARRAY,
    file: 'neural_denoised.npy',
    format: 'Array, cells x frames (.npy, .npz or .mat).',
    match: /denois/i,
  },
  {
    id: 'neural_raw',
    group: 'Neural',
    label: 'Raw traces',
    level: 'optional',
    accept: ARRAY,
    file: 'neural_raw.npy',
    format: 'Array, cells x frames (.npy, .npz or .mat). Same cells as the other neural files.',
    match: /raw/i,
  },
  {
    id: 'footprints',
    group: 'Neural',
    label: 'Footprints',
    level: 'recommended',
    accept: ARRAY,
    file: 'footprints.npy',
    format: 'Array, cells x height x width (.npy, .npz or .mat). Same cell order as the traces.',
    match: /footprint|spatial/i,
  },
  {
    id: 'behavior_timestamps',
    group: 'Behavioral',
    label: 'Behavioral timestamps',
    level: 'required',
    accept: TABLE,
    file: 'behavior_timestamps.csv',
    format: 'One row per camera frame. Columns: Frame Number, Time Stamp (ms).',
    match: /behavior.*timestamp/i,
  },
  {
    id: 'position',
    group: 'Behavioral',
    label: 'Position',
    level: 'optional',
    accept: TABLE,
    activity: true,
    file: 'position.csv',
    format: 'One row per camera frame. Columns: frame, x, y (cm or pixels). -1 marks a lost frame.',
    match: /^position/i,
  },
  {
    id: 'head_orientation',
    group: 'Behavioral',
    label: 'Head orientation',
    level: 'optional',
    accept: TABLE,
    activity: true,
    file: 'headOrientation.csv',
    format: 'Miniscope IMU format: Time Stamp (ms), qw, qx, qy, qz.',
    match: /head.?orientation/i,
  },
  {
    id: 'zone_annotations',
    group: 'Behavioral',
    label: 'Zone annotations',
    level: 'optional',
    accept: TABLE,
    activity: true,
    file: 'zone_annotations.csv',
    format: 'Epochs. Columns: label, start_s, stop_s.',
    match: /zone/i,
  },
  {
    id: 'behavior_annotations',
    group: 'Behavioral',
    label: 'Behavior annotations',
    level: 'optional',
    accept: TABLE,
    activity: true,
    file: 'behavior_annotations.csv',
    format: 'Epochs. Columns: label, start_s, stop_s.',
    match: /annotation|investigat/i,
  },
  {
    id: 'time_markers',
    group: 'Behavioral',
    label: 'Time markers',
    level: 'optional',
    accept: TABLE,
    activity: true,
    file: 'time_markers.csv',
    format:
      'Occurrences represented by a single time, such as tone onset or a TTL edge. Columns: label, time_s (seconds on the session clock).',
    match: /marker|(^|[^a-z])ttl([^a-z]|$)/i,
  },
  {
    id: 'frame_labels',
    group: 'Behavioral',
    label: 'Frame labels',
    level: 'optional',
    accept: TABLE,
    activity: true,
    file: 'frame_labels.csv',
    format:
      'One row per camera frame. A frame column, then 0/1 columns (binary labels), text columns (categories) or numbers (signals). Blank means missing.',
    match: /frame.?label/i,
  },
  {
    id: 'config',
    group: 'Configuration',
    label: 'Experiment details',
    level: 'recommended',
    accept: '.yaml,.yml',
    file: 'config.yaml',
    format:
      'Arena size, zones, frame rates and units. You can also enter these in Experiment details.',
    match: /(config|experiment).*\.ya?ml$/i,
  },
  // Tested last: any still image not claimed by name is taken as the behavior video frame.
  {
    id: 'behavior_frame',
    group: 'Behavioral',
    label: 'Behavior video frame',
    level: 'optional',
    file: 'behavior_frame.png',
    format: 'An image the same size as the behavior video frames.',
    match: /frame.*\.(png|jpe?g)$|\.(png|jpe?g)$/i,
    accept: '.png,.jpg,.jpeg',
  },
];

const IMAGE = /\.(png|jpe?g)$/i;
/** Video files are never data: a folder's videos are listed as ignored. */
export const isVideo = (name: string): boolean => /\.(avi|mp4|mov|mkv|wmv|m4v)$/i.test(name);

/** The accepted file types as shown to the user: ".npy, .npz, .mat". */
export const extText = (s: Pick<Slot, 'accept'>): string =>
  s.accept.replace('.jpeg', '').replace(/,$/, '').split(',').filter(Boolean).join(', ');

export const slotOf = (id: SlotId): Slot => SLOTS.find((s) => s.id === id)!;

/** The rows each data card shows before anything is added. */
export const DEFAULT_ROWS: SlotId[] = [
  'neural_timestamps',
  'neural_deconvolved',
  'behavior_timestamps',
];
/** The neural + menu, in the order of its rows. */
export const NEURAL_ADD: SlotId[] = ['neural_denoised', 'neural_raw', 'footprints'];
/** Behavioral activity: at least one is required. */
export const BEHAVIOR_ACTIVITY: SlotId[] = SLOTS.filter((s) => s.activity).map((s) => s.id);
/** The behavioral + menu: the activity types, then the behavior video frame. */
export const BEHAVIOR_ADD: SlotId[] = [
  'position',
  'behavior_annotations',
  'zone_annotations',
  'head_orientation',
  'time_markers',
  'frame_labels',
  'behavior_frame',
];

/** A data type the user names (Other… in Data setup); listed with the project, never analyzed. */
export type OtherId = `other_${number}`;
export const isOtherId = (id: string): id is OtherId => /^other_[1-9]\d*$/.test(id);

/**
 * Slots are tested in list order, so a zone file is not taken for behavior annotations. A still
 * image only ever fills the behavior video frame, and a video fills nothing.
 */
export function matchSlot(name: string): SlotId | undefined {
  if (isVideo(name)) return undefined;
  if (IMAGE.test(name)) return 'behavior_frame';
  return SLOTS.find((s) => s.match.test(name))?.id;
}
