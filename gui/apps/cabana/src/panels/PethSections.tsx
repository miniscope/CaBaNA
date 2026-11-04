// The five settings sections of the PETH setup page: events and alignment, time window, data and
// filtering, analysis options, advanced options. Each setting says whether it changes the test.

import { For, Show, type JSX } from 'solid-js';
import {
  pethSettings,
  setPethSettings,
  type PethData,
} from '../lib/peth-run.ts';
import type { Align, OnsetReport } from '../lib/peth.ts';
import { countsText, reasonLines, type EventCounts, type SettingId } from '../lib/peth-setup.ts';
import { HowTo } from './AurocResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Dot, Tag } from './PethShared.tsx';
import { PethTimeline } from './PethTimeline.tsx';
import type { PethSetupState } from './PethSetupState.ts';
import { createSize, PopButton } from './QcParts.tsx';

/** A setting's name with its tag and help beside it. */
const Title = (props: {
  id: SettingId;
  children: JSX.Element;
  help?: JSX.Element;
  label?: string;
}): JSX.Element => (
  <div class="cb-pe-title">
    <span>{props.children}</span>
    <Tag id={props.id} />
    <Show when={props.help}>
      <InfoTip label={`About ${props.label ?? 'this setting'}`}>{props.help}</InfoTip>
    </Show>
  </div>
);

/** The timeline filling its box, redrawn when the box is resized. */
function FitTimeline(props: { s: PethSetupState; data: PethData; height: number }): JSX.Element {
  const [size, measure] = createSize();
  return (
    <div class="cb-pe-tlbox" style={{ height: `${props.height}px` }} ref={measure}>
      <Show when={size().w > 0}>
        <PethTimeline
          data={props.data}
          reports={props.s.timelineReports()}
          ready={(b) => !props.s.timelineReports() || props.s.ready(b)}
          align={props.s.timelineAlign()}
          w={size().w}
          h={size().h}
        />
      </Show>
    </div>
  );
}

/** The session timeline with its switch (both alignments), legend and reading note. */
function Timeline(props: { s: PethSetupState; data: PethData; height: number }): JSX.Element {
  return (
    <div class="cb-pe-timeline">
      <div class="cb-plot__head cb-pe-tlhead">
        <h4>Session timeline</h4>
        <HowTo title="Session timeline">
          <p>
            Each row is one behavior. Bars are annotated bouts; circles mark the aligned end of each
            bout (onsets or offsets, as chosen). Filled circles are included bouts; open red circles
            were excluded by the rules in Data and filtering. Gray rows have too few bouts to be
            evaluated. Hover a circle for the reason.
          </p>
          <p>
            No frame selection is applied to PETH: every frame is used, so every bout whose window
            lies inside the session has the same full window.
          </p>
        </HowTo>
        <Show when={props.s.aligns().length > 1}>
          <span
            class="cb-seg cb-pe-tlseg"
            role="group"
            aria-label="Alignment shown in the timeline"
          >
            <For each={props.s.aligns()}>
              {(a) => (
                <button
                  classList={{ 'cb-seg__on': props.s.timelineAlign() === a }}
                  aria-pressed={props.s.timelineAlign() === a}
                  onClick={() => props.s.setTimelineChoice(a)}
                >
                  {a === 'onset' ? 'Onset' : 'Offset'}
                </button>
              )}
            </For>
          </span>
        </Show>
        <span class="cb-plot__legend">
          <span>
            <span class="cb-pe-swatch" /> Bout
          </span>
          <span>● Included</span>
          <span>
            <span class="cb-pe-hollow">○</span> Excluded
          </span>
        </span>
      </div>
      <FitTimeline s={props.s} data={props.data} height={props.height} />
    </div>
  );
}

/** Excluded bouts by reason for every behavior, one table per alignment. */
export function Exclusions(props: {
  s: PethSetupState;
  data: PethData;
  reports: Partial<Record<Align, OnsetReport[]>>;
}): JSX.Element {
  const p = () => props.s.p();
  return (
    <>
      <For each={props.s.aligns()}>
        {(a) => (
          <>
            <Show when={props.s.aligns().length > 1}>
              <h5>Aligned to bout {a}</h5>
            </Show>
            <table class="cb-auroc-table cb-pe-tbl">
              <thead>
                <tr>
                  <th>Behavior</th>
                  <th class="cb-as-num">Bouts</th>
                  <th class="cb-as-num">Included</th>
                  <th class="cb-as-num">Too short (under {p().minDurationS} s)</th>
                  <th class="cb-as-num">Too close ({p().minGapS} s)</th>
                  <th class="cb-as-num">Aligned frame excluded</th>
                  <th class="cb-as-num">Window past the recording edge</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.data.labels}>
                  {(l, b) => {
                    const r = () => props.reports[a]![b()];
                    return (
                      <tr classList={{ 'cb-muted': !props.s.ready(b()) }}>
                        <td>{l}</td>
                        <td class="cb-as-num">{r().bouts}</td>
                        <td class="cb-as-num">{r().onsets.length}</td>
                        <td class="cb-as-num">{r().short}</td>
                        <td class="cb-as-num">{r().gap}</td>
                        <td class="cb-as-num">{r().outside}</td>
                        <td class="cb-as-num">{r().edge}</td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </>
        )}
      </For>
      <p class="cb-muted">
        Checked in this order; each bout is counted once, under the first reason. For onsets the gap
        is measured from the end of the previous bout of the same behavior; for offsets, from the
        end of this bout to the start of the next bout of the same behavior (the last bout has no
        next bout and always passes). Excluded bouts still count as the neighboring bout. PETH uses
        every frame, so no aligned frame is excluded.
      </p>
    </>
  );
}

/** Included and excluded bouts of the tested behaviors, one block per alignment, with the reasons. */
function EventSummary(props: { s: PethSetupState }): JSX.Element {
  const s = () => props.s;
  return (
    <div class="cb-pe-evsum" aria-label="Event summary">
      <h4>Event summary</h4>
      <For each={s().aligns()}>
        {(a) => {
          const c = (): EventCounts | undefined => s().summaryOf(a);
          return (
            <Show when={c()}>
              <div class="cb-pe-evsum__blk">
                <Show when={s().aligns().length > 1}>
                  <div class="cb-pe-evsum__al">Aligned to bout {a}</div>
                </Show>
                <div class="cb-pe-evsum__main">
                  <strong>{c()!.bouts.toLocaleString()}</strong> bouts: {countsText(c()!)}
                </div>
                <Show
                  when={reasonLines(c()!, s().p(), a).length}
                  fallback={<div class="cb-muted cb-pe-small">No bout excluded.</div>}
                >
                  <ul class="cb-pe-reasons">
                    <For each={reasonLines(c()!, s().p(), a)}>{(t) => <li>{t}</li>}</For>
                  </ul>
                </Show>
              </div>
            </Show>
          );
        }}
      </For>
      <div class="cb-pe-evsum__ready">
        <Show
          when={s().readyBehaviors().length}
          fallback={<span class="cb-warn">No behavior is ready to run.</span>}
        >
          <span class="cb-pill cb-pill--good">✓ Ready</span> {s().readyBehaviors().length} behavior
          {s().readyBehaviors().length === 1 ? '' : 's'} will be tested
        </Show>
        <Show when={s().notEvaluated().length}>
          <div class="cb-muted cb-pe-small">
            Not evaluated, too few bouts (minimum {s().p().minEvents}):{' '}
            {s().notEvaluated().join(', ')}
          </div>
        </Show>
      </div>
      <div class="cb-muted cb-pe-small">
        Counts cover the behaviors that will be tested. Excluded bouts are listed by reason in Data
        and filtering.
      </div>
    </div>
  );
}

export function EventsSection(props: { s: PethSetupState }): JSX.Element {
  const s = () => props.s;
  const ok = () => s().ok()!;
  return (
    <div class="cb-pe-sec">
      <p class="cb-muted">
        Choose the behaviors to align to and which end of each bout the time windows start from.
        Bouts come from the behavior annotation file.
      </p>
      <div class="cb-controls cb-pe-align">
        <Title
          id="alignment"
          label="the alignment"
          help={
            <>
              Onset is the first frame of each bout; offset is the first frame after the bout. With
              Both, each behavior gets two separate PETHs, one aligned to onsets and one to offsets,
              each with its own curves, p-values and labels, so the number of tests doubles. Onset
              and offset tests are corrected separately, so the correction does not control the
              error rate for a claim that combines both. Aligning to offsets is a GUI addition; it
              is not in the framework.
            </>
          }
        >
          Align windows to
        </Title>
        <For each={['onset', 'offset', 'both'] as const}>
          {(a) => (
            <label class="cb-radio">
              <input
                type="radio"
                name="peth-align"
                checked={pethSettings.align === a}
                onChange={() => setPethSettings('align', a)}
              />
              {a === 'both' ? 'Both (separate analyses)' : `Bout ${a}`}
            </label>
          )}
        </For>
      </div>
      <div class="cb-pe-evgrid">
        <div>
          <Title
            id="behaviors"
            label="the behavior selection"
            help="Every annotated behavior is listed. Max-stat correction runs across the selected behaviors, so adding or removing one can change adjusted p-values."
          >
            Behaviors
          </Title>
          <div class="cb-pe-tablewrap">
            <table class="cb-auroc-table cb-as-tbl cb-pe-tbl">
              <thead>
                <tr>
                  <th aria-label="Selected" />
                  <th>Behavior</th>
                  <th class="cb-as-num">Bouts</th>
                  <th class="cb-as-num">
                    Included{s().aligns().length > 1 ? ' (onset / offset)' : ''}
                  </th>
                  <th class="cb-as-num">
                    Excluded{s().aligns().length > 1 ? ' (onset / offset)' : ''}
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <For each={ok().info}>
                  {(b, i) => (
                    <tr classList={{ 'cb-muted': !s().ready(i()) }}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include ${b.label}`}
                          disabled={!s().ready(i())}
                          checked={s().chosen(i())}
                          onChange={() => s().toggle(b.label)}
                        />
                      </td>
                      <td>
                        <Dot label={b.label} muted={!s().ready(i())} /> {b.label}
                      </td>
                      <td class="cb-as-num">{b.bouts}</td>
                      <td class="cb-as-num">{s().aligned() ? s().countText(i()) : '–'}</td>
                      <td class="cb-as-num">
                        <Show when={s().aligned()} fallback="–">
                          <PopButton
                            label={`Excluded bouts of ${b.label}, by reason`}
                            title="Excluded bouts by reason"
                            width={640}
                            class="cb-link"
                            button={s()
                              .counts(i())
                              .map((n) => b.bouts - n)
                              .join(' / ')}
                          >
                            <Exclusions s={s()} data={ok()} reports={s().aligned()!} />
                          </PopButton>
                        </Show>
                      </td>
                      <td>
                        <Show when={s().aligned()} fallback="–">
                          <Show
                            when={s().ready(i())}
                            fallback={`Not evaluated: ${s().countText(i())} bout${s().countText(i()) === '1' ? '' : 's'}, minimum ${s().p().minEvents}`}
                          >
                            <Show
                              when={s().chosen(i())}
                              fallback={<span>Left out of the run</span>}
                            >
                              <span class="cb-pill cb-pill--good">✓ Ready</span>
                            </Show>
                          </Show>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
        <Show when={s().aligned()}>
          <EventSummary s={s()} />
        </Show>
      </div>
      <Timeline s={s()} data={ok()} height={150} />
    </div>
  );
}
