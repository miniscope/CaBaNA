import { createMemo, createSignal, Show, type JSX } from 'solid-js';
import { ConfigureBody, type ConfigureControl } from '../components/ConfigureBody.tsx';
import { PreviewLayout } from '../components/PreviewLayout.tsx';
import { guided, pFloorText } from '../lib/guided.ts';
import { pethOutcome, pethSettings, pethShowResults, setPethShowResults } from '../lib/peth-run.ts';
import { BackToCards } from './AnalysisBack.tsx';
import { previewBand, signalLabel } from '../lib/peth-setup.ts';
import { PREVIEW_SHUFFLES } from '../lib/preview.ts';
import { PethPreview } from './PethPreview.tsx';
import { PethResults } from './PethResults.tsx';
import {
  AdvancedSection,
  EventsSection,
  FilteringSection,
  OptionsSection,
  WindowSection,
} from './PethSections.tsx';
import { createPethSetup } from './PethSetupState.ts';
import { pethSections, pethSummary } from './PethSetupSummary.ts';

// Kept outside the page so the open section survives closing and reopening the window.
export const g = guided('peth', 'events');

/** The Configure settings window's setting groups. */
export function PethSetup(props: { configure: ConfigureControl }): JSX.Element {
  const s = createPethSetup();
  const ok = () => s.ok();
  const sections = () => pethSections(s);

  const sectionBody = (id: string) => (
    <>
      <h3 class="cb-pe-sectitle">{sections().find((x) => x.id === id)!.title}</h3>
      <Show when={id === 'events'}>
        <EventsSection s={s} />
      </Show>
      <Show when={id === 'window'}>
        <WindowSection s={s} />
      </Show>
      <Show when={id === 'filtering'}>
        <FilteringSection s={s} />
      </Show>
      <Show when={id === 'options'}>
        <OptionsSection s={s} />
      </Show>
      <Show when={id === 'advanced'}>
        <AdvancedSection />
      </Show>
    </>
  );
  return (
    <Show
      when={ok()}
      fallback={
        <div class="cb-empty">
          {(s.data() as { error: string }).error} PETH needs deconvolved neural data, neural
          timestamps and behavior annotations.
        </div>
      }
    >
      <ConfigureBody g={g} label="PETH settings" sections={sections()} control={props.configure}>
        {sectionBody}
      </ConfigureBody>
    </Show>
  );
}

/**
 * The Preview window: the mean curves with the current settings, and with Run preview the grey
 * band of shifted-onset means, drawn in the browser by the same shifting the full PETH uses for
 * its null band. Display only: nothing is saved and no test is reported.
 */
export function PethPreviewView(): JSX.Element {
  const s = createPethSetup();
  const ps = pethSettings;
  const [shuffles, setShuffles] = createSignal(PREVIEW_SHUFFLES);
  const [drawn, setDrawn] = createSignal<{
    key: string;
    bands: { lo: Float64Array; hi: Float64Array }[];
    shifts: number;
  }>();
  const [busy, setBusy] = createSignal(false);
  // The band belongs to the settings it was drawn with; a change removes it.
  const key = () =>
    JSON.stringify([s.p(), ps.unselected, ps.align, ps.bandSeed, ps.bandMinShiftS, ps.latencyBins]);
  const band = () => (drawn()?.key === key() ? drawn() : undefined);
  // The full analysis's count: the test's shuffles, else the band's shifts.
  const full = () => (ps.test === 'circular' ? ps.nShuffles : ps.bandShifts);
  const n = () => Math.min(shuffles(), full());
  const run = async () => {
    const d = s.ok();
    const r = s.aligned();
    if (!d || !r || s.issue()) return;
    setBusy(true);
    await new Promise((res) => setTimeout(res)); // let the button show "Running preview…" first
    try {
      setDrawn({ key: key(), bands: previewBand(d, ps, r, n()), shifts: n() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show
      when={s.ok()}
      fallback={
        <div class="cb-empty">
          {(s.data() as { error: string }).error} PETH needs deconvolved neural data, neural
          timestamps and behavior annotations.
        </div>
      }
    >
      <PreviewLayout
        id="peth"
        groups={pethSummary(s)}
        full={full()}
        shuffles={n()}
        onShuffles={setShuffles}
        blocked={s.issue()}
        running={busy()}
        ran={!!band()}
        onRun={() => void run()}
        note="For exploring settings only. Preview results are not used for final statistical reporting. Nothing is saved."
        howTitle="How to read this plot"
        how={
          <>
            <p>
              Mean of each behavior's included bouts, averaged over all cells, from the loaded data
              and the current settings. Shading around a curve is ± SEM across cells.{' '}
              {signalLabel(s.p().baselineSubtract)}.
            </p>
            <p>
              Run preview draws the grey band: the 2.5th to 97.5th percentile of the mean curve
              when the onsets are kept and the neural data is shifted in time, once per shift. The
              number of shuffles sets how many shifted-onset means draw it. A curve outside the
              band is unlikely from timing alone, but a preview makes no test and labels no cell.
            </p>
            <p>
              The full analysis{' '}
              {ps.test === 'circular'
                ? `tests every cell with ${ps.nShuffles.toLocaleString()} shuffles (${pFloorText(ps.nShuffles)}).`
                : 'computes curves only, with no shuffle test.'}
            </p>
          </>
        }
      >
        <PethPreview s={s} band={band()} />
      </PreviewLayout>
    </Show>
  );
}

/** The PETH results page. Without a result there is nothing here: setup is in the card's Actions. */
export function PethPanel(): JSX.Element {
  const hasResults = createMemo(() => pethShowResults() && pethOutcome());
  return (
    <Show when={hasResults()} keyed fallback={<BackToCards id="peth" />}>
      {(out) => <PethResults out={out} onEdit={() => setPethShowResults(false)} />}
    </Show>
  );
}
