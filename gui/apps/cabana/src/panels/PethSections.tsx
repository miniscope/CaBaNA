// The five settings sections of the PETH setup page: events and alignment, time window, data and
// filtering, analysis options, advanced options. Each setting says whether it changes the test.

import { createSignal, For, Show, type JSX } from 'solid-js';
import {
  autoShift,
  DEFAULT_PETH_SETTINGS,
  pethSettings,
  setPethSettings,
  type PethData,
} from '../lib/peth-run.ts';
import type { Align, OnsetReport } from '../lib/peth.ts';
import { MIN_NONZERO_PREPOST } from '../lib/peth.ts';
import { countsText, reasonLines, type EventCounts, type SettingId } from '../lib/peth-setup.ts';
import { HowTo } from './AurocResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { NumField } from './PethFields.tsx';
import { Dot, Tag } from './PethShared.tsx';
import { PethTimeline } from './PethTimeline.tsx';
import { PethWindow } from './PethWindow.tsx';
import { ALPHA, type PethSetupState } from './PethSetupState.ts';
import { createSize, PopButton } from './QcParts.tsx';

const D = DEFAULT_PETH_SETTINGS;

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

export function WindowSection(props: { s: PethSetupState }): JSX.Element {
  return (
    <div class="cb-pe-sec">
      <p class="cb-muted">
        The window is the stretch of time around each aligned frame that is cut out and drawn. The
        test compares the response interval with the baseline interval.
      </p>
      <PethWindow fs={props.s.ok()!.fs} />
      <div class="cb-pe-warn">
        Choose the windows before inspecting results; changing them afterward biases which cells
        respond.
      </div>
    </div>
  );
}

export function FilteringSection(props: { s: PethSetupState }): JSX.Element {
  const s = () => props.s;
  const p = () => s().p();
  const set = (k: 'minDurationS' | 'minGapS' | 'minEvents') => (v: number) =>
    setPethSettings('params', k, k === 'minEvents' ? Math.max(1, Math.round(v)) : v);
  return (
    <div class="cb-pe-sec">
      <p class="cb-muted">
        Rules that leave out bouts. They are applied to onsets and offsets independently: each
        alignment gets its own counts, and a bout can pass for one and not the other.
      </p>
      <div class="cb-pe-mins">
        <div class="cb-pe-min">
          <Title
            id="minDuration"
            label="the minimum bout duration"
            help="Bouts shorter than this are not used. Onsets are the first frame of each bout of the annotated behavior, offsets the first frame after it; label padding is not applied."
          >
            Minimum bout duration
          </Title>
          <NumField
            label="Minimum bout duration (s)"
            value={p().minDurationS}
            def={D.params.minDurationS}
            min={0}
            step={0.1}
            unit="s"
            onSet={set('minDurationS')}
          />
        </div>
        <div class="cb-pe-min">
          <Title
            id="minGap"
            label="the minimum gap"
            help="For onsets: a bout that starts sooner than this after the end of the previous bout of the same behavior is not used. For offsets: a bout that ends sooner than this before the start of the next bout of the same behavior is not used (the last bout always passes). 0 turns it off."
          >
            Minimum gap to the neighboring bout
          </Title>
          <NumField
            label="Minimum gap (s)"
            value={p().minGapS}
            def={D.params.minGapS}
            min={0}
            step={0.1}
            unit="s"
            onSet={set('minGapS')}
          />
        </div>
        <div class="cb-pe-min">
          <Title
            id="minEvents"
            label="the minimum bouts"
            help="A behavior with fewer included bouts is not evaluated: it has no curves, p-values or labels."
          >
            Minimum bouts per behavior
          </Title>
          <NumField
            label="Minimum bouts per behavior"
            value={p().minEvents}
            def={D.params.minEvents}
            min={1}
            step={1}
            onSet={set('minEvents')}
          />
        </div>
      </div>
      <Show when={s().aligned()}>
        <div class="cb-pe-live" aria-live="polite">
          <For each={s().aligns()}>
            {(a) => (
              <Show when={s().summaryOf(a)}>
                {(c) => (
                  <span>
                    <Show when={s().aligns().length > 1}>
                      <b>{a === 'onset' ? 'Onset' : 'Offset'}: </b>
                    </Show>
                    {countsText(c())}
                  </span>
                )}
              </Show>
            )}
          </For>
          <span class="cb-muted cb-pe-small">
            Updates as the rules change; tested behaviors only.
          </span>
        </div>
        <div class="cb-pe-tablewrap cb-pe-tablewrap--tall">
          <Exclusions s={s()} data={s().ok()!} reports={s().aligned()!} />
        </div>
        <Timeline s={s()} data={s().ok()!} height={120} />
      </Show>
    </div>
  );
}

/** One row of the analysis options: a name with its tag and help, then the control. */
const Row = (props: { title: JSX.Element; children: JSX.Element }): JSX.Element => (
  <div class="cb-pe-opt">
    {props.title}
    <div class="cb-pe-opt__ctl">{props.children}</div>
  </div>
);

export function OptionsSection(props: { s: PethSetupState }): JSX.Element {
  const off = () => pethSettings.test === 'none';
  const shift = () => autoShift();
  return (
    <div class="cb-pe-sec">
      <p class="cb-muted">
        The shuffle test decides which cells are called higher or lower. The null band, latency and
        Wilcoxon p-value are descriptive: they never change those labels.
      </p>
      <h4 class="cb-pe-grp">
        Shuffle test <span class="cb-muted">· gives the p-value and the labels</span>
      </h4>
      <Row
        title={
          <Title id="testMethod" label="the test">
            Test
          </Title>
        }
      >
        <select
          aria-label="Test"
          value={pethSettings.test}
          onChange={(e) => setPethSettings('test', e.currentTarget.value as 'circular' | 'none')}
        >
          <option value="circular">Circular shift</option>
          <option value="none">None (curves only: no p-values, no labels)</option>
        </select>
      </Row>
      <Row
        title={
          <Title
            id="shuffles"
            label="the number of shuffles"
            help="Circular shifts of each cell's trace against the bouts. The smallest possible p is 1 divided by shuffles + 1."
          >
            Shuffles
          </Title>
        }
      >
        <NumField
          label="Shuffles"
          value={pethSettings.nShuffles}
          def={D.nShuffles}
          min={1}
          step={100}
          disabled={off()}
          onSet={(v) => setPethSettings('nShuffles', Math.max(1, Math.round(v)))}
        />
      </Row>
      <Row
        title={
          <Title
            id="minShift"
            label="the minimum shift"
            help="Smallest circular shift of the neural trace against the bouts. Auto sets it to 3 times the longer of the neural and behavior autocorrelation times, between 5 s and a quarter of the recording."
          >
            Minimum shift
          </Title>
        }
      >
        <label class="cb-radio">
          <input
            type="radio"
            name="peth-shift"
            checked={pethSettings.shiftAuto}
            disabled={off()}
            onChange={() => setPethSettings('shiftAuto', true)}
          />
          Auto{shift() ? ` (${shift()!.minShiftS} s)` : ''}
        </label>
        <label class="cb-radio">
          <input
            type="radio"
            name="peth-shift"
            checked={!pethSettings.shiftAuto}
            disabled={off()}
            onChange={() => setPethSettings('shiftAuto', false)}
          />
          Manual
        </label>
        <NumField
          label="Minimum shift (s)"
          value={pethSettings.minShiftS}
          def={D.minShiftS}
          min={0.5}
          unit="s"
          disabled={off() || pethSettings.shiftAuto}
          onSet={(v) => setPethSettings('minShiftS', v)}
        />
      </Row>
      <Row
        title={
          <Title id="alpha" label="the significance level">
            Significance level (α)
          </Title>
        }
      >
        <NumField
          label="Alpha"
          value={pethSettings.alpha}
          def={D.alpha}
          min={ALPHA.min}
          max={ALPHA.max}
          step={0.01}
          bad={props.s.alphaBad()}
          disabled={off()}
          onSet={(v) => setPethSettings('alpha', v)}
        />
        <Show when={props.s.optionsIssue()}>
          <span class="cb-error cb-pe-small">{props.s.optionsIssue()}</span>
        </Show>
      </Row>
      <Row
        title={
          <Title
            id="correction"
            label="the correction"
            help="Max-stat corrects across the selected behaviors within each cell. It does not correct across cells, and adding or removing behaviors can change adjusted p-values. None gives uncorrected p-values."
          >
            Correction
          </Title>
        }
      >
        <select
          aria-label="Correction"
          disabled={off()}
          value={pethSettings.correction}
          onChange={(e) =>
            setPethSettings('correction', e.currentTarget.value as 'none' | 'max_stat')
          }
        >
          <option value="max_stat">Max-stat across behaviors</option>
          <option value="none">None</option>
        </select>
      </Row>
      <h4 class="cb-pe-grp">
        Null band and latency <span class="cb-muted">· descriptive</span>
      </h4>
      <Row
        title={
          <Title
            id="nullBand"
            label="the null band"
            help="The 2.5th to 97.5th percentile of each cell's mean curve after circular shifts. Its shift count, seed and minimum shift are under Advanced options. Not corrected for bins or cells."
          >
            Null band
          </Title>
        }
      >
        <label class="cb-as-check">
          <input
            type="checkbox"
            checked={pethSettings.band}
            onChange={(e) => setPethSettings('band', e.currentTarget.checked)}
          />
          Compute the null band and latency
        </label>
      </Row>
      <Row
        title={
          <Title
            id="latency"
            label="the latency"
            help="Latency is the center of the first bin, at or after the aligned point, that starts a run of this many consecutive bins outside the band on the same side. Descriptive, not a test."
          >
            Latency: bins outside the band
          </Title>
        }
      >
        <NumField
          label="Bins outside the band"
          value={pethSettings.latencyBins}
          def={D.latencyBins}
          min={1}
          step={1}
          disabled={!pethSettings.band}
          onSet={(v) => setPethSettings('latencyBins', Math.max(1, Math.round(v)))}
        />
      </Row>
      <h4 class="cb-pe-grp">
        Pre vs post Wilcoxon <span class="cb-muted">· descriptive</span>
      </h4>
      <Row
        title={
          <Title id="wilcoxon" label="the Wilcoxon p-value">
            Paired Wilcoxon
          </Title>
        }
      >
        <label class="cb-as-check">
          <input
            type="checkbox"
            checked={pethSettings.wilcoxon}
            onChange={(e) => setPethSettings('wilcoxon', e.currentTarget.checked)}
          />
          Show the paired Wilcoxon p across bouts
        </label>
      </Row>
      <p class="cb-muted cb-pe-small">
        The Wilcoxon test treats bouts as independent, which they are not within one animal. It is
        shown for comparison with published methods and is not used for labels. It needs at least{' '}
        {MIN_NONZERO_PREPOST} bouts with a non-zero difference.
      </p>
    </div>
  );
}

export function AdvancedSection(): JSX.Element {
  const [bad, setBad] = createSignal(false);
  const off = () => !pethSettings.band;
  return (
    <div class="cb-pe-sec">
      <p class="cb-muted">
        Seeds and the settings of the null band. The defaults suit most analyses.
      </p>
      <Row
        title={
          <Title
            id="seed"
            label="the random seed"
            help="The same seed, settings and data give the same shuffles and results. Saved with every run."
          >
            Random seed (shuffle test)
          </Title>
        }
      >
        <label
          class="cb-prep-field"
          classList={{ 'cb-prep-field--changed': pethSettings.seed !== D.seed, 'cb-pe-bad': bad() }}
        >
          <input
            type="number"
            min="0"
            step="1"
            aria-label="Random seed"
            aria-invalid={bad() || undefined}
            value={pethSettings.seed}
            onInput={(e) => {
              const t = e.currentTarget.value;
              const v = +t;
              const valid = t !== '' && Number.isInteger(v) && v >= 0;
              setBad(!valid);
              if (valid) setPethSettings('seed', v);
            }}
          />
        </label>
        <Show when={bad()}>
          <span class="cb-error cb-pe-small">
            The seed must be a whole number from 0; the seed in use is {pethSettings.seed}.
          </span>
        </Show>
      </Row>
      <h4 class="cb-pe-grp">
        Null band{' '}
        <span class="cb-muted">· descriptive; its own shifts and seed, separate from the test</span>
      </h4>
      <Row
        title={
          <Title id="nullBand" label="the null band shifts">
            Shifts
          </Title>
        }
      >
        <NumField
          label="Null band shifts"
          value={pethSettings.bandShifts}
          def={D.bandShifts}
          min={1}
          step={50}
          disabled={off()}
          onSet={(v) => setPethSettings('bandShifts', Math.max(1, Math.round(v)))}
        />
      </Row>
      <Row
        title={
          <Title id="nullBand" label="the null band seed">
            Seed
          </Title>
        }
      >
        <NumField
          label="Null band seed"
          value={pethSettings.bandSeed}
          def={D.bandSeed}
          step={1}
          disabled={off()}
          onSet={(v) => setPethSettings('bandSeed', Math.round(v))}
        />
      </Row>
      <Row
        title={
          <Title id="nullBand" label="the null band minimum shift">
            Minimum shift
          </Title>
        }
      >
        <NumField
          label="Null band minimum shift (s)"
          value={pethSettings.bandMinShiftS}
          def={D.bandMinShiftS}
          min={0.5}
          unit="s"
          disabled={off()}
          onSet={(v) => setPethSettings('bandMinShiftS', v)}
        />
      </Row>
    </div>
  );
}
