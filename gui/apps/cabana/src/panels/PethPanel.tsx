import { createMemo, Show, type JSX } from 'solid-js';
import { ConfigureBody, type ConfigureControl } from '../components/ConfigureBody.tsx';
import { SettingsSummary } from '../components/GuidedReview.tsx';
import { guided, pFloorText } from '../lib/guided.ts';
import { pethOutcome, pethSettings, pethShowResults, setPethShowResults } from '../lib/peth-run.ts';
import { BackToCards } from './AnalysisBack.tsx';
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

/** The Preview window: the mean-curve preview beside the settings it was drawn with. */
export function PethPreviewView(): JSX.Element {
  const s = createPethSetup();
  const ps = pethSettings;
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
      <div class="cb-pe-review cb-pe-review--window">
        <PethPreview s={s} />
        <div class="cb-pe-review__side">
          <SettingsSummary g={g} groups={pethSummary(s)} />
          <p class="cb-muted">
            PETH runs in the browser, so there is no shorter run with fewer shuffles: the preview
            shows curves only. The full analysis
            {ps.test === 'circular'
              ? ` uses ${ps.nShuffles.toLocaleString()} shuffles (${pFloorText(ps.nShuffles)}).`
              : ' computes curves only, with no shuffle test.'}
          </p>
        </div>
      </div>
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
