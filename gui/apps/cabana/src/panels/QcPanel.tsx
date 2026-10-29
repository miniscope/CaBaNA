import { createMemo, For, onCleanup, onMount, Show, untrack, type JSX } from 'solid-js';
import type { Check } from '../lib/qc.ts';
import { experiment, missingRequired, proceed, type Section } from '../lib/store.ts';
import {
  qcCategory,
  qcTab,
  reviewed,
  setQcCategory,
  setQcTab,
  type QcTab,
} from '../lib/qc-view.ts';
import { behaviorCategories } from './BehaviorQc.tsx';
import { neuralCategories } from './NeuralQc.tsx';
import { InfoTip } from './InfoTip.tsx';
import { StatusIcon, worst, type Shown } from './QcParts.tsx';

/** One entry in the QC navigator. Its view fills the center and right-hand columns. */
export interface Category {
  id: string;
  name: string;
  /** Listed under this heading, indented (annotation files). */
  group?: string;
  checks: Check[];
  /** Items to review, and what they are ("segments", "cells"). */
  flagged: number;
  flaggedWord: string;
  section?: Section;
  view: () => JSX.Element;
}

const TABS: { id: QcTab; label: string; list: () => Category[]; empty: string }[] = [
  {
    id: 'behavior',
    label: 'Behavioral',
    list: behaviorCategories,
    empty: 'Load position and camera timestamps, or annotation files, to check behavior.',
  },
  {
    id: 'neural',
    label: 'Neural',
    list: neuralCategories,
    empty:
      'Load raw or denoised traces, deconvolved events, or footprints to check the neural data.',
  },
];

const WORD: Record<Shown, string> = {
  pass: 'Passed',
  warn: 'Passed, with notes',
  fail: 'Failed',
  reviewed: 'Reviewed',
  none: 'Not checked',
};

/** What the navigator shows for a category: reviewed and continuing-with-issues override the check result. */
function shown(c: Category): { status: Shown; word: string } {
  const s = worst(c.checks);
  if (reviewed[c.id]) return { status: 'reviewed', word: `Reviewed, ${WORD[s].toLowerCase()}` };
  if (s === 'fail' && c.section && proceed[c.section])
    return { status: 'fail', word: 'Failed, continuing' };
  return { status: s, word: WORD[s] };
}

const count = (checks: Check[]) => ({
  pass: checks.filter((c) => c.status === 'pass').length,
  warn: checks.filter((c) => c.status === 'warn').length,
  fail: checks.filter((c) => c.status === 'fail').length,
});

function Navigator(props: { list: Category[] }): JSX.Element {
  const groups = (i: number) =>
    props.list[i].group && props.list[i].group !== props.list[i - 1]?.group;
  return (
    <nav class="cb-qnav" aria-label="QC categories">
      <div class="cb-qnav__head">
        <span>Checks</span>
        <InfoTip label="What the status icons mean">
          <span class="cb-legend-tip">
            <StatusIcon status="pass" /> Passed: every check is within its limit.
            <br />
            <StatusIcon status="warn" /> Notes: worth a look, does not count as a failure.
            <br />
            <StatusIcon status="fail" /> Failed: a check is over its limit.
            <br />
            <StatusIcon status="reviewed" /> Reviewed: marked as looked at.
            <br />
            The orange count is the number of items flagged for review. A category can pass and
            still have flagged items, when they are under the limit.
          </span>
        </InfoTip>
      </div>
      <ul>
        <For each={props.list}>
          {(c, i) => {
            const s = () => shown(c);
            return (
              <>
                <Show when={groups(i())}>
                  <li class="cb-qnav__group">
                    {c.group}{' '}
                    <span class="cb-muted">
                      {props.list.filter((x) => x.group === c.group).length} files
                    </span>
                  </li>
                </Show>
                <li>
                  <button
                    type="button"
                    class="cb-qnav__item"
                    classList={{
                      'cb-qnav__item--on': qcCategory[qcTab()] === c.id,
                      'cb-qnav__item--file': !!c.group,
                    }}
                    aria-current={qcCategory[qcTab()] === c.id ? 'page' : undefined}
                    onClick={() => setQcCategory(qcTab(), c.id)}
                  >
                    <StatusIcon status={s().status} />
                    <span>
                      <span class="cb-qnav__name">{c.name.replace(/_/g, '_\u200b')}</span>
                      <span class={`cb-qnav__state cb-qnav__state--${s().status}`}>{s().word}</span>
                      <Show when={c.flagged}>
                        <span class="cb-qnav__flagged">
                          {c.flagged} flagged{' '}
                          {c.flagged === 1 ? c.flaggedWord.replace(/s$/, '') : c.flaggedWord}
                        </span>
                      </Show>
                    </span>
                  </button>
                </li>
              </>
            );
          }}
        </For>
      </ul>
      <div class="cb-qnav__foot cb-muted">
        Selections, settings and plot zoom are kept when switching.
      </div>
    </nav>
  );
}

/** Keep the workspace inside the window: its height runs from its top to the bottom of the window. */
export function fitToWindow(el: HTMLElement): () => void {
  const fit = () => {
    const pad =
      parseFloat(getComputedStyle(el.closest('.cb-body') ?? el.parentElement!).paddingBottom) || 0;
    // The page body ends above the footer with Next, so measure to its bottom edge.
    const bottom = el.closest('.cb-body')?.getBoundingClientRect().bottom ?? innerHeight;
    el.style.height = `${Math.max(320, bottom - el.getBoundingClientRect().top - pad - 2)}px`;
  };
  const start = () => {
    el.closest('.cb-body')?.scrollTo(0, 0);
    fit();
  };
  start();
  requestAnimationFrame(start); // again once the page is attached, in case it was not yet
  addEventListener('resize', fit);
  // Banners above the workspace (requirements, notices) appear and vanish after it mounts.
  const watch = new ResizeObserver(fit);
  const observeAbove = () => {
    watch.disconnect();
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) watch.observe(s);
    const body = el.closest('.cb-body');
    if (body) watch.observe(body);
  };
  observeAbove();
  const siblings = new MutationObserver(() => {
    observeAbove();
    fit();
  });
  if (el.parentElement) siblings.observe(el.parentElement, { childList: true });
  return () => {
    removeEventListener('resize', fit);
    watch.disconnect();
    siblings.disconnect();
  };
}

export function QcPanel(): JSX.Element {
  const tab = () => TABS.find((t) => t.id === qcTab())!;
  const list = createMemo(() => tab().list());
  const current = () => list().find((c) => c.id === qcCategory[qcTab()]) ?? list()[0];
  const all = createMemo(() => count(TABS.flatMap((t) => t.list().flatMap((c) => c.checks))));
  const nReviewed = () => TABS.flatMap((t) => t.list()).filter((c) => reviewed[c.id]).length;
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  return (
    <div class="cb-qc" ref={root}>
      <div class="cb-qc__top">
        <h2>Data QC</h2>
        <InfoTip label="About Data QC">
          Checks on the files you loaded. Warnings don't stop you from continuing, but look at the
          plots and tell CaBaNA whether each part is usable.
        </InfoTip>
        <div class="cb-qc__toggle" role="tablist" aria-label="Data type">
          <For each={TABS}>
            {(t) => {
              const c = () => count(t.list().flatMap((x) => x.checks));
              return (
                <button
                  role="tab"
                  aria-selected={qcTab() === t.id}
                  classList={{ 'cb-qc__toggle--on': qcTab() === t.id }}
                  onClick={() => setQcTab(t.id)}
                >
                  {t.label}
                  <span class="cb-qc__toggle-n">
                    {c().fail
                      ? `${c().fail} failed`
                      : c().warn
                        ? `${c().warn} ${c().warn === 1 ? 'note' : 'notes'}`
                        : c().pass
                          ? `${c().pass} passed`
                          : 'not checked'}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
        <div class="cb-qc__pills">
          <span class="cb-pill-s cb-pill-s--pass">
            <StatusIcon status="pass" />
            {all().pass} passed
          </span>
          <span class="cb-pill-s cb-pill-s--warn">
            <StatusIcon status="warn" />
            {all().warn} {all().warn === 1 ? 'note' : 'notes'}
          </span>
          <span class="cb-pill-s cb-pill-s--fail">
            <StatusIcon status="fail" />
            {all().fail} failed
          </span>
          <span class="cb-pill-s cb-pill-s--reviewed">
            <StatusIcon status="reviewed" />
            {nReviewed()} reviewed
          </span>
          <InfoTip label="How these counts work">
            Counts of individual checks over both the Behavioral and Neural tabs. Reviewed counts
            the categories marked as reviewed.
          </InfoTip>
        </div>
      </div>
      <Show when={missingRequired().length}>
        <div class="cb-note cb-qc__missing">
          For {experiment().label.toLowerCase()}, these required files are not loaded:{' '}
          {missingRequired()
            .map((s) => s.label.toLowerCase())
            .join(', ')}
          . Checks that need them are skipped.
        </div>
      </Show>
      <Show when={list().length} fallback={<div class="cb-empty cb-qc__empty">{tab().empty}</div>}>
        <div class="cb-qc__body">
          <Navigator list={list()} />
          <Show when={current()?.id} keyed>
            {(_id) => untrack(() => current()!.view())}
          </Show>
        </div>
      </Show>
      <div class="cb-qc__foot">
        <span class="cb-muted">
          Warnings and flags don't stop you from continuing. A failed section asks you to continue
          without correction.
        </span>
      </div>
    </div>
  );
}
