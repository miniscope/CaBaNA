// A file's QC section on the Data setup page: the QC test that belongs to that file. One status
// line on top; on the left the checks, the flagged items, the review and the correction; the
// test's plots on the right. The calculations are those of the old Data QC page, unchanged.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { qcStatusText } from '../../lib/qc-status.ts';
import { reviewed, setQcPlotTab } from '../../lib/qc-view.ts';
import type { SlotId } from '../../lib/slots.ts';
import { rawTrace } from '../../lib/store.ts';
import { behaviorCategories, behaviorSettings } from '../BehaviorQc.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { neuralCategories, neuralSettings } from '../NeuralQc.tsx';
import type { Category } from '../QcPanel.tsx';
import { PlotHeadSlot, PopButton, ReviewActions, StatusIcon, worst } from '../QcParts.tsx';
import { plotTabOf, RESULT } from '../QcShell.tsx';

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

function StatusLine(props: { cat: Category; settings: JSX.Element }): JSX.Element {
  const s = () => worst(props.cat.checks);
  return (
    <div class={`cb-ds-qcs cb-ds-qcs--${s()}`} role="status">
      <StatusIcon status={s()} />
      <span>{qcStatusText(props.cat.checks, !!reviewed[props.cat.id])}</span>
      <span class="cb-spacer" />
      {props.settings}
    </div>
  );
}

/** Each check as one compact row: what it is, measured against its limit, and the result. */
function Checks(props: { cat: Category }): JSX.Element {
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

function Review(props: { cat: Category }): JSX.Element {
  return (
    <section class="cb-ds-qcl__box cb-ds-qcl__review">
      <h4>Your review</h4>
      <ReviewActions id={props.cat.id} section={props.cat.section} checks={props.cat.checks} />
    </section>
  );
}

/** The correction in a few words; the advice and fix tools open from the ⓘ. */
function Correction(props: { cat: Category }): JSX.Element {
  return (
    <div class="cb-ds-qcfix">
      <b>Correction</b>
      <span class="cb-muted cb-ds-qcfix__hint">{props.cat.correctionHint}</span>
      <PopButton
        label={`Correction: ${props.cat.name}`}
        title="Correction"
        width={360}
        class="cb-tip__btn"
        button={<span aria-hidden="true">ⓘ</span>}
      >
        {props.cat.correction()}
      </PopButton>
    </div>
  );
}

/** The plot tabs as a small segmented control. */
function Tabs(props: { cat: Category }): JSX.Element {
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
function Caption(props: { cat: Category }): JSX.Element {
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
function PlotArea(props: { cat: Category }): JSX.Element {
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

export function FileQc(props: { id: SlotId | 'sync' }): JSX.Element {
  const testId = () => TEST[props.id];
  const neural = () => NEURAL.has(testId() ?? '');
  const cat = createMemo((): Category | undefined =>
    (neural() ? neuralCategories() : behaviorCategories()).find((c) => c.id === testId()),
  );
  // Cell checks are computed from one trace file: the raw traces when loaded, else the denoised.
  const why = (): { text: string; more: string } | undefined =>
    testId() === 'cells' && props.id === 'neural_denoised' && rawTrace()
      ? {
          text: 'Computed from the raw traces.',
          more: 'Cell checks use the raw traces when they are loaded, else the denoised traces, so they are the same here and under Raw traces.',
        }
      : undefined;
  return (
    <Show
      when={cat()}
      fallback={<p class="cb-muted">No checks for this file yet. They run once it is loaded.</p>}
    >
      {(c) => (
        <div class="cb-ds-qc">
          <StatusLine cat={c()} settings={neural() ? neuralSettings() : behaviorSettings()} />
          <div class="cb-ds-qc__body">
            <aside class="cb-ds-qcl" aria-label="Checks and review">
              <Show when={why()}>
                {(w) => (
                  <section class="cb-ds-qcl__box cb-ds-qcl__why">
                    <h4>
                      Why these checks are here{' '}
                      <InfoTip label="Why these checks are here">{w().more}</InfoTip>
                    </h4>
                    <p class="cb-muted">{w().text}</p>
                  </section>
                )}
              </Show>
              <Checks cat={c()} />
              {c().flaggedList?.()}
              {c().actions?.()}
              <Review cat={c()} />
              <Correction cat={c()} />
            </aside>
            {/* Keyed: the plot cards take the tabs when they are created. */}
            <Show when={c().id} keyed>
              {(_id: string) => <PlotArea cat={c()} />}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
