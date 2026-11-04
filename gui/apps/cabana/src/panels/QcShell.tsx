// The frame of a Data QC tab: the summary bar, the list of tests with their checks, and the plot
// tabs. Behavioral and Neural QC fill it with their own tests and plots.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { MetricCards, type MetricCard } from '../components/MetricCards.tsx';
import { qcCounts } from '../lib/metrics.ts';
import type { Status } from '../lib/qc.ts';
import { proceed } from '../lib/store.ts';
import {
  qcCategory,
  qcPlotTab,
  qcTab,
  reviewed,
  setQcCategory,
  setQcPlotTab,
} from '../lib/qc-view.ts';
import type { Category } from './QcPanel.tsx';
import { PopButton, ReviewActions, StatusIcon, worst } from './QcParts.tsx';

const RESULT: Record<Status | 'none', string> = {
  pass: 'Pass',
  warn: 'Note',
  fail: 'Fail',
  none: 'Not checked',
};

/** Tests with at least one check; a test that did not run is neither passed nor failed. */
const tested = (list: Category[]) => list.filter((c) => c.checks.length);

/** The one count used by the tab label and the summary, so they always agree. */
export const testCounts = (list: Category[]) => qcCounts(tested(list).map((c) => c.checks));

export function QcSummary(props: {
  list: Category[];
  cards: MetricCard[];
  /** The QC settings button. */
  settings: JSX.Element;
  /** Added after the flagged items, for example "3 rejected by you". */
  note?: string;
}): JSX.Element {
  const counts = createMemo(() => testCounts(props.list));
  const status = () => worst(tested(props.list).flatMap((c) => c.checks));
  const sub = () => {
    const flagged = props.list
      .filter((c) => c.flagged)
      .map((c) => `${c.name}: ${c.flagged} flagged ${c.flaggedWord}`);
    const done = tested(props.list).filter((c) => reviewed[c.id]).length;
    return [
      ...(flagged.length > 2
        ? [`${flagged.slice(0, 2).join(' · ')} · +${flagged.length - 2} more`]
        : flagged),
      props.note,
      counts().tests ? `${done} of ${counts().tests} tests reviewed` : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  return (
    <div class="cb-qs">
      <div class={`cb-qs__status cb-qs__status--${status()}`}>
        <StatusIcon status={status()} />
        <div>
          <b>{counts().tests ? counts().text : 'Nothing to check yet'}</b>
          <span>{sub()}</span>
        </div>
      </div>
      <div class="cb-qs__cards">
        <MetricCards cards={props.cards} label="Summary of the selected test" />
      </div>
      {props.settings}
    </div>
  );
}

/** Tabs over the plot area. The tab follows the selected test and is kept when switching. */
export function PlotTabs(props: { cat: Category; children: JSX.Element }): JSX.Element {
  const tabs = () => props.cat.tabs ?? [];
  const on = () => {
    const id = qcPlotTab[props.cat.id];
    return tabs().some((t) => t.id === id) ? id : tabs()[0]?.id;
  };
  return (
    <div class="cb-qc-center cb-ptabs-wrap">
      <div class="cb-ptabs" role="tablist" aria-label={`${props.cat.name} plots`}>
        <For each={tabs()}>
          {(t) => (
            <button
              type="button"
              role="tab"
              aria-selected={on() === t.id}
              classList={{ 'cb-ptabs__on': on() === t.id }}
              onClick={() => setQcPlotTab(props.cat.id, t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>
      <div class="cb-ptabs__body">{props.children}</div>
    </div>
  );
}

/** The plot tab currently shown for a test. */
export function plotTabOf(cat: Category): string {
  const id = qcPlotTab[cat.id];
  return (cat.tabs ?? []).some((t) => t.id === id) ? id : (cat.tabs?.[0]?.id ?? '');
}

function TestRow(props: { c: Category; on: boolean }): JSX.Element {
  const s = () => worst(props.c.checks);
  const continuing = () => s() === 'fail' && props.c.section && proceed[props.c.section];
  return (
    <button
      type="button"
      class="cb-qtest"
      classList={{ 'cb-qtest--on': props.on, 'cb-qtest--file': !!props.c.group }}
      aria-current={props.on ? 'true' : undefined}
      onClick={() => setQcCategory(qcTab(), props.c.id)}
    >
      <StatusIcon status={s()} />
      <span class="cb-qtest__text">
        <span class="cb-qtest__name">{props.c.name.replace(/_/g, '_​')}</span>
        <Show when={props.c.description}>
          <span class="cb-qtest__desc">{props.c.description}</span>
        </Show>
        <span class="cb-qtest__tags">
          <Show when={props.c.flagged}>
            <span class="cb-qnav__flagged">
              {props.c.flagged} flagged{' '}
              {props.c.flagged === 1 ? props.c.flaggedWord.replace(/s$/, '') : props.c.flaggedWord}
            </span>
          </Show>
          <Show when={reviewed[props.c.id]}>
            <span class="cb-qtag cb-qtag--reviewed">Reviewed</span>
          </Show>
          <Show when={continuing()}>
            <span class="cb-qtag">Continuing with issues</span>
          </Show>
        </span>
      </span>
      <span class={`cb-qres cb-qres--${s()}`}>{RESULT[s()]}</span>
      <span aria-hidden="true" class="cb-qtest__go">
        ›
      </span>
    </button>
  );
}

function TestList(props: { list: Category[]; id: string }): JSX.Element {
  return (
    <section class="cb-rail-box cb-qtests">
      <div class="cb-rail-box__head">
        <h3>QC checks</h3>
        <span class="cb-muted">Select a test for its checks and plots</span>
      </div>
      <ul>
        <For each={props.list}>
          {(c, i) => (
            <>
              <Show when={c.group && c.group !== props.list[i() - 1]?.group}>
                <li class="cb-qnav__group">
                  {c.group}{' '}
                  <span class="cb-muted">
                    {props.list.filter((x) => x.group === c.group).length} files
                  </span>
                </li>
              </Show>
              <li>
                <TestRow c={c} on={c.id === props.id} />
              </li>
            </>
          )}
        </For>
      </ul>
    </section>
  );
}

/** Each check of the selected test: what was measured, its limit and the result, then the review. */
function CheckList(props: { cat: Category }): JSX.Element {
  const checks = () => props.cat.checks;
  const s = () => worst(checks());
  return (
    <section class="cb-rail-box">
      <div class="cb-rail-box__head">
        <h3>{props.cat.name}</h3>
        <span class={`cb-qres cb-qres--${s()}`}>{RESULT[s()]}</span>
      </div>
      <Show when={checks().length} fallback={<div class="cb-muted">No checks ran.</div>}>
        <ul class="cb-qchecks">
          <For each={checks()}>
            {(c) => (
              <li>
                <StatusIcon status={c.status} />
                <span class="cb-qchecks__title">{c.title}</span>
                <span class={`cb-qres cb-qres--${c.status}`}>{RESULT[c.status]}</span>
                <PopButton label={`Details: ${c.title}`} title={c.title} width={340} button="›">
                  <p>{c.detail}</p>
                  <Show when={c.fix && c.status !== 'pass'}>
                    <p>
                      <b>What to do.</b> {c.fix}
                    </p>
                  </Show>
                </PopButton>
                <Show when={c.value || c.limit}>
                  <span class="cb-qchecks__nums">
                    <Show when={c.value}>
                      <span>
                        Measured <b>{c.value}</b>
                      </span>
                    </Show>
                    <Show when={c.limit}>
                      <span class="cb-muted">Limit: {c.limit}</span>
                    </Show>
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <div class="cb-qrev">
          <span>
            Computed result: <b>{RESULT[s()]}</b>
          </span>
          <span>
            Your review: <b>{reviewed[props.cat.id] ? 'Reviewed' : 'Not reviewed'}</b>
          </span>
        </div>
        <ReviewActions id={props.cat.id} section={props.cat.section} checks={checks()} />
      </Show>
    </section>
  );
}

/** The right-hand column: the tests, the selected test's checks, and that test's own tools. */
export function QcRail(props: { list: Category[]; cat: Category }): JSX.Element {
  return (
    <aside class="cb-qc-rail cb-qrail">
      <TestList list={props.list} id={props.cat.id} />
      <CheckList cat={props.cat} />
      {props.cat.detail?.()}
    </aside>
  );
}
