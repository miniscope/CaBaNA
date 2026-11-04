import { createMemo, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Requirements } from '../components/Requirements.tsx';
import { SectionList, StageBar, StageFooter } from '../components/GuidedSetup.tsx';
import { RunChoice, SettingsSummary } from '../components/GuidedReview.tsx';
import { guided } from '../lib/guided.ts';
import {
  cancelPethRun,
  pethOutcome,
  pethSettings,
  pethShowResults,
  pethStatus,
  runPeth,
  setPethShowResults,
} from '../lib/peth-run.ts';
import { pethChanges, pethSettingChanges } from '../lib/peth-view.ts';
import { shufflesFor } from '../lib/preview.ts';
import { ShuffleReach } from './parts.tsx';
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
import { PethHead, PethRunStage } from './PethSetupHead.tsx';
import { pethSections, pethSummary } from './PethSetupSummary.ts';
import { fitToWindow } from './QcPanel.tsx';

const SECTIONS = ['events', 'window', 'filtering', 'options', 'advanced'];
// Kept outside the page so the open stage and section survive a visit to the results.
const g = guided('peth', 'events');

function PethSetup(): JSX.Element {
  const s = createPethSetup();
  const ok = () => s.ok();
  const ps = pethSettings;
  const running = () => {
    const st = pethStatus();
    return st.kind === 'running' ? st : undefined;
  };
  const error = () => {
    const st = pethStatus();
    return st.kind === 'error' ? st.message : undefined;
  };
  const changes = () => [...pethChanges(), ...pethSettingChanges()];

  const sections = () => pethSections(s);
  const summary = () => pethSummary(s);

  const blocked = () =>
    !ok() ? (s.data() as { error: string }).error : running() ? 'A run is in progress.' : s.issue();
  const status = () => {
    const r = running();
    if (r) return r.step;
    if (!ok()) return 'Needs deconvolved events and behavior annotations';
    if (s.issue()) return 'Needs attention';
    return 'Ready to run';
  };
  const start = () => {
    g.setStage('run');
    void runPeth();
  };

  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));

  return (
    <div class="cb-place cb-gs cb-pe-setup" ref={root}>
      <PethHead s={s} changes={changes()} />

      <StageBar
        g={g}
        done={{
          configure: SECTIONS.every((id) => g.reviewed(id)),
          run: !!pethOutcome(),
        }}
      />
      <Show when={!ok()}>
        <div class="cb-empty">
          {(s.data() as { error: string }).error} PETH needs deconvolved neural data, neural
          timestamps and behavior annotations.
        </div>
      </Show>
      <Show when={ok() && error()}>
        <div class="cb-note">{error()}</div>
      </Show>

      <Show when={ok() && g.stage() === 'configure'}>
        <SectionList g={g} label="PETH settings" sections={sections()}>
          {(id) => (
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
          )}
        </SectionList>
      </Show>

      <Show when={ok() && g.stage() === 'review'}>
        <div class="cb-gs-review">
          <div class="cb-pe-review">
            <SettingsSummary g={g} groups={summary()} />
            <PethPreview s={s} />
          </div>
          <RunChoice
            full={ps.nShuffles}
            preview={shufflesFor('preview', ps.nShuffles)}
            noPreview
            previewBlocked="PETH has no framework engine, so no reduced-shuffle run."
            blocked={blocked()}
            noTest={
              ps.test === 'none' ? 'No shuffle test: the run computes curves only.' : undefined
            }
            onPreview={() => undefined}
            onFull={start}
          />
          <Show when={ps.test === 'circular'}>
            <ShuffleReach shuffles={ps.nShuffles} alpha={ps.alpha} preview={false} />
          </Show>
        </div>
      </Show>

      <Show when={ok() && g.stage() === 'run'}>
        <PethRunStage s={s} running={running()} error={error()} changes={changes()} />
      </Show>

      <StageFooter
        g={g}
        status={
          <span>
            <i classList={{ 'cb-dot--ok': !!ok() && !s.issue() && !running() }} /> {status()}
          </span>
        }
        actions={
          <Show when={running()}>
            <button class="btn-secondary" onClick={cancelPethRun}>
              Cancel
            </button>
          </Show>
        }
      />
    </div>
  );
}

/** The PETH page: its settings, or after a run its results. */
export function PethPanel(): JSX.Element {
  const hasResults = createMemo(() => pethShowResults() && pethOutcome());
  return (
    <>
      <Requirements analysis="peth" />
      <Show when={hasResults()} keyed fallback={<PethSetup />}>
        {(out) => <PethResults out={out} onEdit={() => setPethShowResults(false)} />}
      </Show>
    </>
  );
}
