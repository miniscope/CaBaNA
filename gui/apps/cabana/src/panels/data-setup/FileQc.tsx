// A file's QC section on the Data setup page: the QC tests that belong to that file (for the
// analysis data, also the cell checks), or for reference data a note that QC is off. One status
// line on top; on the left the checks and the flagged items, the test's plots in the middle, and
// on the right what can be done: the selected item's actions, the review and the correction.
// The calculations are those of the old Data QC page, unchanged.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { analysisSlot } from '../../lib/analysis-data.ts';
import type { Check } from '../../lib/qc.ts';
import { qcStatusText } from '../../lib/qc-status.ts';
import { reviewed, setQcPlotTab } from '../../lib/qc-view.ts';
import type { SlotId } from '../../lib/slots.ts';
import { traceMatrix } from '../../lib/store.ts';
import { behaviorTests, timingTest } from '../BehaviorQc.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { neuralTests } from '../NeuralQc.tsx';
import type { PlotTest } from '../QcPanel.tsx';
import { PlotHeadSlot, PopButton, ReviewActions, StatusIcon, worst } from '../QcParts.tsx';
import { plotTabOf, RESULT } from '../QcShell.tsx';
import { HelpMark } from '../../components/HelpMark.tsx';

/** The QC test of each file, by the test's id; annotation tests use the file's slot id. */
const TEST: Partial<Record<SlotId | 'sync', string>> = {
  sync: 'timing',
  position: 'position',
  neural_raw: 'cells',
  neural_denoised: 'cells',
  neural_deconvolved: 'decon',
  footprints: 'footprints',
  zone_annotations: 'zone_annotations',
  behavior_annotations: 'behavior_annotations',
};
const NEURAL = new Set(['cells', 'decon', 'footprints']);

function StatusLine(props: { cat: PlotTest }): JSX.Element {
  const s = () => worst(props.cat.checks);
  return (
    <div class={`cb-ds-qcs cb-ds-qcs--${s()}`}>
      <StatusIcon status={s()} />
      <span role="status">{qcStatusText(props.cat.checks, !!reviewed[props.cat.id])}</span>
    </div>
  );
}

/** Each check as one compact row: what it is, measured against its limit, and the result. */
function Checks(props: { cat: PlotTest }): JSX.Element {
  return (
    <section class="cb-ds-qcl__box">
      <h4>Checks</h4>
      <Show when={props.cat.checks.length} fallback={<p class="cb-muted">No checks ran.</p>}>
        <ul class="cb-ds-qck">
          <For each={props.cat.checks}>
            {(c) => (
              <li>
                <StatusIcon status={c.status} />
                <span class="cb-ds-qck__name">{c.title}</span>
                <span class={`cb-qres cb-qres--${c.status}`}>{RESULT[c.status]}</span>
                <InfoTip label={`About: ${c.title}`}>
                  <p>{c.detail}</p>
                  <Show when={c.fix && c.status !== 'pass'}>
                    <p>
                      <b>What to do.</b> {c.fix}
                    </p>
                  </Show>
                </InfoTip>
                <Show when={c.value || c.limit}>
                  <span class="cb-ds-qck__nums">
                    {[c.value, c.limit].filter(Boolean).join(' · ')}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function Review(props: { cat: PlotTest }): JSX.Element {
  return (
    <section class="cb-ds-qcl__box cb-ds-qcl__review">
      <h4>Your review</h4>
      <ReviewActions id={props.cat.id} checks={props.cat.checks} />
    </section>
  );
}

/** The correction in a few words; the advice and fix tools open from the ⓘ. */
function Correction(props: { cat: PlotTest }): JSX.Element {
  return (
    <div class="cb-ds-qcfix">
      <b>Correction</b>
      <span class="cb-muted cb-ds-qcfix__hint">{props.cat.correctionHint}</span>
      <PopButton
        label={`Correction: ${props.cat.name}`}
        title="Correction"
        width={360}
        class="cb-tip__btn"
        button={<HelpMark />}
      >
        {props.cat.correction()}
      </PopButton>
    </div>
  );
}

/** The plot tabs as a small segmented control. */
function Tabs(props: { cat: PlotTest }): JSX.Element {
  const on = () => plotTabOf(props.cat);
  return (
    <div class="cb-ds-seg" role="tablist" aria-label={`${props.cat.name} plots`}>
      <For each={props.cat.tabs}>
        {(t) => (
          <button
            type="button"
            role="tab"
            aria-selected={on() === t.id}
            classList={{ 'cb-ds-seg--on': on() === t.id }}
            onClick={() => setQcPlotTab(props.cat.id, t.id)}
          >
            {t.label}
          </button>
        )}
      </For>
    </div>
  );
}

/** What the summary cards used to show, as one line under the plot. */
function Caption(props: { cat: PlotTest }): JSX.Element {
  return (
    <Show when={props.cat.metrics().length}>
      <p class="cb-ds-qcap">
        <For each={props.cat.metrics()}>
          {(m) => (
            <span title={m.denom}>
              {m.label} <b>{m.value}</b>
            </span>
          )}
        </For>
      </p>
    </Show>
  );
}

/**
 * The selected tab's plot. With more than one tab the tabs sit in the plot card's own head; a tab
 * drawn without a plot card (a table) gets them on a line of their own.
 */
function PlotArea(props: { cat: PlotTest }): JSX.Element {
  const [held, hold] = createSignal(false);
  const many = () => props.cat.tabs.length > 1;
  const title = () => props.cat.tabs.find((t) => t.id === plotTabOf(props.cat))?.label ?? '';
  return (
    <div class="cb-ds-qplot">
      <Show when={many() && !held()}>
        <div class="cb-plot__head">
          <Tabs cat={props.cat} />
        </div>
      </Show>
      <PlotHeadSlot.Provider
        value={{ on: many, head: () => <Tabs cat={props.cat} />, title, held, hold }}
      >
        <div class="cb-ds-qplot__body">{props.cat.plot(plotTabOf(props.cat))}</div>
      </PlotHeadSlot.Provider>
      <Caption cat={props.cat} />
    </div>
  );
}

/** A file's QC tests. The analysis data also shows the cell checks, wherever they are computed. */
function testsOf(id: SlotId | 'sync'): string[] {
  const own = TEST[id];
  if (!own) return [];
  return id === analysisSlot() && own !== 'cells' && traceMatrix() ? [own, 'cells'] : [own];
}

/** Every check of a file's QC tests, as computed. */
export function qcChecks(id: SlotId | 'sync'): Check[] {
  const ids = testsOf(id);
  const cats = [
    ...(ids.some((t) => NEURAL.has(t)) ? neuralTests() : []),
    ...(ids.some((t) => !NEURAL.has(t)) ? behaviorTests() : []),
  ];
  return cats.filter((c) => ids.includes(c.id)).flatMap((c) => c.checks);
}

/** Failed, noted and total checks of a file's QC tests, for the step wizard. */
export function qcCounts(id: SlotId): { fails: number; notes: number; total: number } {
  const checks = qcChecks(id);
  return {
    fails: checks.filter((c) => c.status === 'fail').length,
    notes: checks.filter((c) => c.status === 'warn').length,
    total: checks.length,
  };
}

/** The Timestamp alignment check: its checks, plots and correction. */
export function FileQc(): JSX.Element {
  return (
    <Show
      when={timingTest()}
      fallback={<p class="cb-muted">No checks for this file yet. They run once it is loaded.</p>}
    >
      {(c) => (
        <div class="cb-ds-qc">
          <StatusLine cat={c()} />
          <div class="cb-ds-qc__body">
            <aside class="cb-ds-qcl" aria-label="Checks">
              <Checks cat={c()} />
            </aside>
            <PlotArea cat={c()} />
            <aside class="cb-ds-qcl cb-ds-qcr" aria-label="Review and correction">
              <Review cat={c()} />
              <Correction cat={c()} />
            </aside>
          </div>
        </div>
      )}
    </Show>
  );
}
