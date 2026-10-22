// The tools users may have made their files with, and how to get each tool's output into the format
// CaBaNA reads. Anything not listed gets the general advice.

export type Field = 'positionTool' | 'extractionTool' | 'deconTool' | 'annotationTool';
export type Option = [id: string, label: string];

export const OPTIONS: Record<Field, { label: string; options: Option[] }> = {
  positionTool: {
    label: 'Position Tracking',
    options: [
      ['dlc', 'DeepLabCut'],
      ['sleap', 'SLEAP'],
      ['deepposekit', 'DeepPoseKit'],
      ['leap', 'LEAP'],
      ['idtracker', 'idtracker.ai'],
      ['eztrack', 'ezTrack'],
      ['toxtrac', 'ToxTrac'],
      ['bonsai', 'Bonsai'],
      ['anymaze', 'ANY-maze'],
      ['ethovision', 'EthoVision XT'],
      ['other', 'Other'],
    ],
  },
  extractionTool: {
    label: 'Footprint and Trace Extraction',
    options: [
      ['caiman', 'CaImAn (CNMF)'],
      ['caiman-e', 'CaImAn (CNMF-E)'],
      ['minian', 'Minian'],
      ['min1pipe', 'MIN1PIPE'],
      ['ciatah', 'CIAtah'],
      ['extract', 'EXTRACT'],
      ['suite2p', 'Suite2p'],
      ['other', 'Other'],
    ],
  },
  deconTool: {
    label: 'Deconvolution',
    options: [
      ['oasis', 'OASIS'],
      ['cascade', 'CASCADE'],
      ['mlspike', 'MLspike'],
      ['foopsi', 'FOOPSI'],
      ['cadecon', 'CaDecon'],
      ['suite2p', 'Suite2p (OASIS-based)'],
      ['other', 'Other'],
    ],
  },
  annotationTool: {
    label: 'Behavior annotation tool',
    options: [
      ['boris', 'BORIS'],
      ['bento', 'BENTO'],
      ['simba', 'SimBA'],
      ['mars', 'MARS'],
      ['deepethogram', 'DeepEthogram'],
      ['jaaba', 'JAABA'],
      ['bsoid', 'B-SOiD'],
      ['vame', 'VAME'],
      ['moseq', 'Keypoint-MoSeq'],
      ['sheet', 'A spreadsheet'],
      ['other', 'Other'],
    ],
  },
};

/** How to get each tool's output into the format CaBaNA reads. Anything not listed gets the general advice. */
export const HELP: Record<Field, { general: string; byTool: Record<string, string> }> = {
  positionTool: {
    general:
      'Position: a CSV with columns frame, x, y, one row per camera frame. -1 marks a lost frame.',
    byTool: {
      dlc: 'Position: DeepLabCut writes three header rows and a likelihood for each body part. Keep one body part, write columns frame, x, y, and set frames with low likelihood (for example under 0.9) to -1.',
      sleap:
        'Position: SLEAP can export tracks as CSV or analysis files. Keep one node, write columns frame, x, y, and set low-score frames to -1.',
    },
  },
  extractionTool: {
    general:
      'Traces and footprints: NumPy arrays, traces as cells x frames and footprints as cells x height x width, in the same cell order.',
    byTool: {
      caiman:
        'Traces and footprints: save the denoised traces (estimates.C) as .npy, cells x frames. Raw is C plus the residuals (YrA). Footprints come from estimates.A, reshaped to cells x height x width.',
      'caiman-e':
        'Traces and footprints: save the denoised traces (estimates.C) as .npy, cells x frames. Raw is C plus the residuals (YrA). Footprints come from estimates.A, reshaped to cells x height x width.',
      minian:
        'Traces and footprints: save A, C and YrA as .npy. A is already unit x height x width. C is unit x frame.',
    },
  },
  deconTool: {
    general: 'Events: a NumPy array, cells x frames, in the same cell order as the traces.',
    byTool: {
      oasis:
        'Events: OASIS gives small non-zero values on many frames. Data QC reports how many frames have an event.',
      cascade:
        'Events: CASCADE gives a spike probability for each frame. Save it as a NumPy array, cells x frames.',
      cadecon:
        'Events: download the events from CaDecon and save them as a NumPy array, cells x frames.',
    },
  },
  annotationTool: {
    general:
      'Annotations: a CSV with columns label, start_s, stop_s, one row per epoch. Set Annotation Units if your times are not in seconds.',
    byTool: {
      boris:
        'Annotations: export the tabular events, then reshape them into label, start_s, stop_s. BORIS times are in seconds.',
      bento:
        'Annotations: Bento annotation files are often in frames. If yours are, set Annotation Units to camera frames.',
      simba:
        'Annotations: SimBA usually writes a 0 or 1 for every frame and behavior. Turn each run of 1s into one epoch, and set Annotation Units to camera frames if you keep frame numbers.',
      deepethogram:
        'Annotations: DeepEthogram usually writes a 0 or 1 for every frame and behavior. Turn each run of 1s into one epoch, and set Annotation Units to camera frames if you keep frame numbers.',
    },
  },
};
