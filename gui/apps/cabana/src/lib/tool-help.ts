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
