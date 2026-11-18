// The Upstream list of the Changes drawer: findings of the existing QC that no correction here can
// repair, with where they can be fixed (a new export, re-tracking or re-extraction). Pure, built
// from QC results the app already computes; listing a finding changes nothing.

export interface UpstreamItem {
  /** Which data it is about, shown as the tag. */
  source: 'Timestamps' | 'Position' | 'Footprints';
  what: string;
  detail: string;
  /** Where it can be fixed, in one line. */
  fixWhere: string;
}

export interface UpstreamInput {
  /** Timing report per timestamps file. */
  timing: { name: string; nDropped: number; droppedFraction: number; gaps: number }[];
  /** Alignment checks between the timestamps and the neural data. */
  alignment: { title: string; status: 'pass' | 'warn' | 'fail'; value?: string }[];
  /** Position gaps that stay missing after gap filling, on the neural frames. */
  longGaps?: { n: number; frames: number; fillLimitS: number; fps: number };
  /** The overlapping-footprints check, when footprints are loaded. */
  overlap?: { status: 'pass' | 'warn' | 'fail'; pairs: number };
}

const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export function upstreamItems(i: UpstreamInput): UpstreamItem[] {
  const out: UpstreamItem[] = [];
  for (const t of i.timing.filter((r) => r.nDropped > 0))
    out.push({
      source: 'Timestamps',
      what: `${t.name}: ${plural(t.nDropped, 'dropped frame')}`,
      detail: `${(100 * t.droppedFraction).toFixed(2)}% of frames, in ${plural(t.gaps, 'gap')}. The frames were never recorded.`,
      fixWhere:
        t.name === 'Behavior camera'
          ? 'Check the camera recording and re-export the timestamps'
          : 'Check the miniscope recording and re-export the timestamps',
    });
  for (const a of i.alignment.filter((c) => c.status === 'fail'))
    out.push({
      source: 'Timestamps',
      what: a.title,
      detail: a.value ? `Failed: ${a.value}` : 'Failed',
      fixWhere: 'Re-export the timestamps and neural data from the same recording',
    });
  const g = i.longGaps;
  if (g && g.n > 0)
    out.push({
      source: 'Position',
      what:
        g.fillLimitS > 0
          ? `${plural(g.n, 'position gap')} longer than ${g.fillLimitS} s`
          : `${plural(g.n, 'position gap')} (gap filling is off)`,
      detail: `${plural(g.frames, 'neural frame')} (${(g.frames / g.fps).toFixed(1)} s) stay without a position after gap filling.`,
      fixWhere: 'Re-run tracking where position is missing',
    });
  if (i.overlap && i.overlap.status !== 'pass')
    out.push({
      source: 'Footprints',
      what: `${plural(i.overlap.pairs, 'overlapping footprint pair')}`,
      detail:
        'More pairs than the limit share over half of the smaller footprint: likely duplicates from extraction. Rejecting one cell of each pair here leaves them out.',
      fixWhere: 'Re-run cell extraction (merge duplicates) and re-export',
    });
  return out;
}
