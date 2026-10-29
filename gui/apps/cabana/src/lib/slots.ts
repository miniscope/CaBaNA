// The files CaBaNA can take. Each slot is one thing the user brings; the Load
// panel lists them in one tab per group and files are matched to slots by name.

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
}

export const SLOTS: Slot[] = [
  {
    id: 'neural_timestamps',
    group: 'Neural',
    label: 'Miniscope timestamps',
    level: 'required',
    file: 'neural_timestamps.csv',
    format: 'One row per miniscope frame. Columns: Frame Number, Time Stamp (ms).',
    match: /neural.*timestamp/i,
  },
  {
    id: 'neural_deconvolved',
    group: 'Neural',
    label: 'Deconvolved events',
    level: 'required',
    file: 'neural_deconvolved.npy',
    format: 'NumPy array, cells x frames. Event estimate from any pipeline.',
    match: /deconv(?!.*filtered)/i,
  },
  {
    id: 'neural_denoised',
    group: 'Neural',
    label: 'Denoised traces',
    level: 'recommended',
    file: 'neural_denoised.npy',
    format: 'NumPy array, cells x frames.',
    match: /denois/i,
  },
  {
    id: 'neural_raw',
    group: 'Neural',
    label: 'Raw traces',
    level: 'recommended',
    file: 'neural_raw.npy',
    format: 'NumPy array, cells x frames.',
    match: /raw/i,
  },
  {
    id: 'footprints',
    group: 'Neural',
    label: 'Footprints',
    level: 'recommended',
    file: 'footprints.npy',
    format: 'NumPy array, cells x height x width. Same cell order as the traces.',
    match: /footprint|spatial/i,
  },
  {
    id: 'behavior_timestamps',
    group: 'Behavioral',
    label: 'Behavior camera timestamps',
    level: 'recommended',
    file: 'behavior_timestamps.csv',
    format: 'One row per camera frame. Columns: Frame Number, Time Stamp (ms).',
    match: /behavior.*timestamp/i,
  },
  {
    id: 'position',
    group: 'Behavioral',
    label: 'Position',
    level: 'recommended',
    file: 'position.csv',
    format: 'One row per camera frame. Columns: frame, x, y (in cm). -1 marks a lost frame.',
    match: /^position/i,
  },
  {
    id: 'head_orientation',
    group: 'Behavioral',
    label: 'Head orientation',
    level: 'optional',
    file: 'headOrientation.csv',
    format: 'Miniscope IMU format: Time Stamp (ms), qw, qx, qy, qz.',
    match: /head.?orientation/i,
  },
  {
    id: 'zone_annotations',
    group: 'Behavioral',
    label: 'Zone annotations',
    level: 'optional',
    file: 'zone_annotations.csv',
    format: 'Epochs. Columns: label, start_s, stop_s.',
    match: /zone/i,
  },
  {
    id: 'behavior_annotations',
    group: 'Behavioral',
    label: 'Behavior annotations',
    level: 'optional',
    file: 'behavior_annotations.csv',
    format: 'Epochs. Columns: label, start_s, stop_s.',
    match: /annotation|investigat/i,
  },
  {
    id: 'time_markers',
    group: 'Behavioral',
    label: 'Time markers',
    level: 'optional',
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
    file: 'frame_labels.csv',
    format:
      'One row per camera frame. A frame column, then 0/1 columns (binary labels), text columns (categories) or numbers (signals). Blank means missing.',
    match: /frame.?label/i,
  },
  {
    id: 'config',
    group: 'Configuration',
    label: 'Experimental setup',
    level: 'recommended',
    file: 'config.yaml',
    format:
      'Arena size, zones, frame rates and units. You can also enter these in Experimental Setup.',
    match: /config.*\.ya?ml$/i,
  },
];

export const GROUPS: Group[] = ['Neural', 'Behavioral', 'Configuration'];

/** Slots are tested in list order, so a zone file is not taken for behavior annotations. */
export function matchSlot(name: string): SlotId | undefined {
  return SLOTS.find((s) => s.match.test(name))?.id;
}
