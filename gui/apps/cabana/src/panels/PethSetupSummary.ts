// The PETH setup page's section list and review summary, built from the setup state.
import type { GuidedSection } from '../components/GuidedSetup.tsx';
import type { SummaryGroup } from '../components/GuidedReview.tsx';
import { pethSettings } from '../lib/peth-run.ts';
import { windowProblems } from '../lib/peth.ts';
import { countsText, inputSignalText, tagText } from '../lib/peth-setup.ts';
import { prep } from '../lib/preprocess.ts';
import type { PethSetupState } from './PethSetupState.ts';

const iv = (a: [number, number]) => `${a[0]} to ${a[1]} s`;
const alignName = () =>
  pethSettings.align === 'both'
    ? 'onset and offset'
    : pethSettings.align === 'offset'
      ? 'offset'
      : 'onset';

export function pethSections(s: PethSetupState): GuidedSection[] {
  const ok = () => s.ok();
  const ps = pethSettings;
  const problems = () => (ok() ? windowProblems(s.p(), ok()!.fs) : []);
  const windowIssue = () => problems().filter((m) => !m.startsWith('Minimum'))[0];
  const filterIssue = () => problems().filter((m) => m.startsWith('Minimum'))[0];

  const countLine = () =>
    s
      .aligns()
      .map((a) => {
        const c = s.summaryOf(a);
        return c ? `${s.aligns().length > 1 ? `${a}: ` : ''}${countsText(c)}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  const testText = () =>
    ps.test === 'none'
      ? 'No shuffle test (curves only)'
      : `${ps.nShuffles} shuffles · α ${ps.alpha} · ${ps.correction === 'max_stat' ? 'max-stat' : 'no correction'}`;

  return [
    {
      id: 'events',
      title: 'Events and alignment',
      summary: ok() ? `${alignName()} · ${countLine()}` : 'Needs behavior annotations',
      attention:
        ok() && s.aligned() && !s.readyBehaviors().length
          ? 'no behavior is ready to run'
          : undefined,
    },
    {
      id: 'window',
      title: 'Time window',
      summary: `${iv([-s.p().preS, s.p().postS])} · baseline ${iv(s.p().baselineS)} · response ${iv(s.p().responseS)}`,
      attention: windowIssue(),
    },
    {
      id: 'filtering',
      title: 'Data and filtering',
      summary: `≥ ${s.p().minDurationS} s long · gap ≥ ${s.p().minGapS} s · ≥ ${s.p().minEvents} bouts`,
      attention: filterIssue(),
    },
    {
      id: 'options',
      title: 'Analysis options',
      summary: testText(),
      attention: s.optionsIssue(),
    },
    {
      id: 'advanced',
      title: 'Advanced options',
      summary: `Seed ${ps.seed} · null band ${ps.band ? `${ps.bandShifts} shifts` : 'off'}`,
      optional: true,
    },
  ];
}

export function pethSummary(s: PethSetupState): SummaryGroup[] {
  const ok = () => s.ok();
  const ps = pethSettings;

  return [
    {
      title: 'Events and alignment',
      section: 'events',
      items: [
        { label: 'Aligned to', value: alignName(), note: tagText('alignment') },
        {
          label: 'Behaviors tested',
          value: ok()
            ? s
                .readyBehaviors()
                .map((b) => ok()!.labels[b])
                .join(', ') || 'none'
            : '–',
          note: tagText('behaviors'),
        },
        ...s.aligns().map((a) => ({
          label: s.aligns().length > 1 ? `Bouts, ${a}` : 'Bouts',
          value: s.summaryOf(a) ? countsText(s.summaryOf(a)!) : '–',
        })),
      ],
    },
    {
      title: 'Time window',
      section: 'window',
      items: [
        { label: 'Full window', value: iv([-s.p().preS, s.p().postS]), note: tagText('window') },
        { label: 'Baseline', value: iv(s.p().baselineS), note: tagText('baseline') },
        { label: 'Response', value: iv(s.p().responseS), note: tagText('response') },
        { label: 'Bin size', value: `${s.p().binS} s`, note: tagText('binSize') },
        {
          label: 'Baseline subtraction in curves',
          value: s.p().baselineSubtract ? 'Yes' : 'No',
          note: tagText('baselineSubtract'),
        },
      ],
    },
    {
      title: 'Data and filtering',
      section: 'filtering',
      items: [
        {
          label: 'Minimum bout duration',
          value: `${s.p().minDurationS} s`,
          note: tagText('minDuration'),
        },
        { label: 'Minimum gap', value: `${s.p().minGapS} s`, note: tagText('minGap') },
        {
          label: 'Minimum bouts per behavior',
          value: String(s.p().minEvents),
          note: tagText('minEvents'),
        },
      ],
    },
    {
      title: 'Analysis options',
      section: 'options',
      items:
        ps.test === 'none'
          ? [{ label: 'Shuffle test', value: 'None: no p-values, no labels' }]
          : [
              {
                label: 'Shuffles',
                value: ps.nShuffles.toLocaleString(),
                note: tagText('shuffles'),
              },
              {
                label: 'Minimum shift',
                value: ps.shiftAuto ? 'Auto' : `${ps.minShiftS} s`,
                note: tagText('minShift'),
              },
              { label: 'Significance', value: `α = ${ps.alpha}`, note: tagText('alpha') },
              {
                label: 'Correction',
                value: ps.correction === 'max_stat' ? 'Max-stat across behaviors' : 'None',
                note: tagText('correction'),
              },
              {
                label: 'Null band and latency',
                value: ps.band ? `On, ${ps.latencyBins} bins outside` : 'Off',
                note: tagText('nullBand'),
              },
              {
                label: 'Wilcoxon',
                value: ps.wilcoxon ? 'Shown' : 'Off',
                note: tagText('wilcoxon'),
              },
            ],
    },
    {
      title: 'Advanced options',
      section: 'advanced',
      items: [
        { label: 'Seed', value: String(ps.seed), note: tagText('seed') },
        {
          label: 'Null band',
          value: ps.band
            ? `${ps.bandShifts} shifts · seed ${ps.bandSeed} · min shift ${ps.bandMinShiftS} s`
            : 'Off',
        },
      ],
    },
    {
      title: 'Data',
      items: [
        { label: 'Cells', value: ok() ? `${ok()!.cells} included` : '–' },
        { label: 'Signal', value: inputSignalText(prep.eventSigmaS) },
        { label: 'Frames used', value: 'All (no frame selection)' },
        { label: 'Engine', value: 'Browser only' },
      ],
    },
  ];
}
