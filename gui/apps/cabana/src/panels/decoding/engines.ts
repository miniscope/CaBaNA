// What each decoding engine applies of the requested settings, in plain language. Read from the
// framework's capabilities, never assumed. Nothing here runs anything.

import type { CapabilityName } from '../../lib/bridge-client.ts';

export type EngineId = 'framework' | 'browser';
export const ENGINE_NAMES: Record<EngineId, string> = {
  framework: 'Python framework',
  browser: 'Browser engine',
};

/** The settings that decide what an engine has to apply. */
export interface Request {
  target: 'position' | 'behaviors';
  decoder: 'bayesian' | 'logistic';
  mode: 'one_vs_rest' | 'multiclass';
  overlap: 'exclude' | 'priority';
  foldGapS: number;
}

export interface EngineLine {
  label: string;
  /** applied: used as set. unavailable: asked for and not applied. none: not asked for. */
  status: 'applied' | 'unavailable' | 'none';
  text: string;
}

type Has = (c: CapabilityName) => boolean;

/** Training/test separation text shared by the Review and Train and test sections. */
export const GAP_UNAVAILABLE =
  'Training/test separation unavailable: training frames next to each test block are not excluded, so results may be inflated by temporal dependence.';

/** Whether this engine can apply a training/test separation. The browser engine never can. */
export const appliesGap = (engine: EngineId, has: Has) =>
  engine === 'framework' && has('decoding_fold_gap');

/**
 * Why a full analysis is not offered on this engine, or '' when it is: a separation above 0 that the
 * engine cannot apply. The run needs the separation set to 0 first, and then records no temporal gap.
 */
export function gapBlock(engine: EngineId, foldGapS: number, has: Has): string {
  if (!(foldGapS > 0) || appliesGap(engine, has)) return '';
  return `${ENGINE_NAMES[engine]} cannot apply the ${foldGapS} s training/test separation. Set it to 0 s to run without one; the result then records no temporal gap.`;
}

/** What a result says about the separation, from its saved settings (undefined: not recorded). */
export function gapRecord(foldGapS: number | undefined): string {
  if (foldGapS === undefined) return 'Not recorded (the run predates the setting)';
  return foldGapS > 0 ? `${foldGapS} s` : 'None: no temporal gap (0 s)';
}

/** One line per setting the engine matters for, for the Engine section in Review. */
export function engineLines(engine: EngineId, req: Request, has: Has): EngineLine[] {
  const fw = engine === 'framework';
  const out: EngineLine[] = [];
  const gap = req.foldGapS;
  if (!(gap > 0))
    out.push({
      label: 'Training/test separation',
      status: 'none',
      text: 'Set to 0 s: training frames run up to each test block. Results record no temporal gap.',
    });
  else if (appliesGap(engine, has))
    out.push({
      label: 'Training/test separation',
      status: 'applied',
      text: `Applied: training frames within ${gap} s of a test block are left out.`,
    });
  else
    out.push({ label: 'Training/test separation', status: 'unavailable', text: GAP_UNAVAILABLE });

  if (req.decoder === 'bayesian') {
    const ok = !fw || has('decoding_fold_local_window');
    out.push({
      label: 'Test window at block edges',
      status: ok ? 'applied' : 'unavailable',
      text: ok
        ? "Applied: a test frame's window never reads frames of another fold."
        : 'Unavailable: the test window of frames at a block edge reads the neighboring training frames.',
    });
  }
  const overall = !fw || has('decoding_overall_test');
  out.push({
    label: 'Overall value tested',
    status: overall ? 'applied' : 'unavailable',
    text: overall
      ? 'Applied: the overall value is compared with the shuffled null.'
      : 'Unavailable: the overall value is shown without a p-value. Per-bin and per-behavior tests are unaffected.',
  });
  if (req.target === 'behaviors' && req.overlap === 'exclude') {
    const ok = !fw || has('overlap_policy');
    out.push({
      label: 'Overlapping behaviors excluded',
      status: ok ? 'applied' : 'unavailable',
      text: ok
        ? 'Applied: frames covered by two or more selected behaviors are left out.'
        : 'Unavailable: overlapping behaviors cannot be decoded as separate classes.',
    });
  }
  if (req.decoder === 'logistic' && req.mode === 'multiclass') {
    const ok = fw && has('overlap_policy');
    out.push({
      label: 'Multiclass logistic regression',
      status: ok ? 'applied' : 'unavailable',
      text: ok
        ? 'Applied: one behavior is chosen per time bin.'
        : fw
          ? 'Unavailable: needs the overlap policy, which the installed framework lacks.'
          : 'Unavailable: use one-vs-rest on the browser engine.',
    });
  }
  out.push({
    label: 'Quick preview',
    status: fw ? 'applied' : 'unavailable',
    text: fw
      ? 'Available: a run with fewer shuffles, saved as Preliminary.'
      : 'Unavailable: Quick preview runs only on the Python framework.',
  });
  if (!fw)
    out.push({
      label: 'Random draws',
      status: 'none',
      text: 'Shuffles use other random draws than the framework, so p-values agree only within shuffling error.',
    });
  return out;
}

/** Class picker mode: several behaviors, or one behavior against everything else included. */
export type ClassMode = 'several' | 'one_vs_other';
export const classMode = (selected: string[], other: boolean): ClassMode =>
  selected.length === 1 && other ? 'one_vs_other' : 'several';

/** The behavior and Other settings after switching the picker to `mode`. */
export function withClassMode(
  mode: ClassMode,
  selected: string[],
  usable: string[],
): { labels: string[]; other: boolean } {
  if (mode === 'one_vs_other')
    return { labels: [selected[0] ?? usable[0]].filter(Boolean), other: true };
  return { labels: [], other: false };
}
