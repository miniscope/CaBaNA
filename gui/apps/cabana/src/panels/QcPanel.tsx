import { createMemo, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { Check } from '../lib/qc.ts';
import { experiment, missingRequired, type Section } from '../lib/store.ts';
import { qcCategory, qcTab, setQcTab, type QcTab } from '../lib/qc-view.ts';
import { behaviorCategories, behaviorSettings } from './BehaviorQc.tsx';
import { neuralCategories, neuralNote, neuralSettings } from './NeuralQc.tsx';
import type { MetricCard } from '../components/MetricCards.tsx';
import { InfoTip } from './InfoTip.tsx';
import { PlotTabs, QcRail, QcSummary, plotTabOf, testCounts } from './QcShell.tsx';

/** One test in the QC list: its checks, plot tabs, summary cards and tools. */
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
  /** One line under the name in the list of tests. */
  description: string;
  /** Plot tabs and what each shows, for a test in the tabbed layout. */
  tabs: { id: string; label: string }[];
  plot: (tab: string) => JSX.Element;
  /** Summary cards for this test. */
  metrics: () => MetricCard[];
  /** Flagged items and corrections, under the checks in the right-hand column. */
  detail: () => JSX.Element;
}

const TABS: {
  id: QcTab;
  label: string;
  list: () => Category[];
  empty: string;
  /** The QC settings button. */
  settings: () => JSX.Element;
  /** Replaces the list of flagged items in the summary. */
  note?: () => string | undefined;
}[] = [
  {
    id: 'behavior',
    label: 'Behavioral',
    list: behaviorCategories,
    settings: behaviorSettings,
    empty: 'Load position and camera timestamps, or annotation files, to check behavior.',
  },
  {
    id: 'neural',
    label: 'Neural',
    list: neuralCategories,
    settings: neuralSettings,
    note: neuralNote,
    empty:
      'Load raw or denoised traces, deconvolved events, or footprints to check the neural data.',
  },
];

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
              const c = () => testCounts(t.list());
              return (
                <button
                  role="tab"
                  aria-selected={qcTab() === t.id}
                  classList={{ 'cb-qc__toggle--on': qcTab() === t.id }}
                  onClick={() => setQcTab(t.id)}
                >
                  {t.label}
                  <span class="cb-qc__toggle-n">
                    {c().testsFailed
                      ? `${c().testsFailed} failed`
                      : c().tests
                        ? `${c().tests} passed`
                        : 'not checked'}
                  </span>
                </button>
              );
            }}
          </For>
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
        <QcSummary
          list={list()}
          cards={current().metrics()}
          settings={tab().settings()}
          note={tab().note?.()}
          listFlagged={!tab().note}
        />
        <div class="cb-qc__body cb-qc__body--tabbed">
          <PlotTabs cat={current()}>{current().plot(plotTabOf(current()))}</PlotTabs>
          <QcRail list={list()} cat={current()} />
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
