// The shape of one QC test, and the helper that keeps a page inside the window.
import type { JSX } from 'solid-js';
import type { Check } from '../lib/qc.ts';
import type { Section } from '../lib/store.ts';
import type { MetricCard } from '../components/MetricCards.tsx';

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
  /** The flagged items, as a list that pages to fit. */
  flaggedList?: () => JSX.Element;
  /** What can be done with the selected flagged item. */
  actions?: () => JSX.Element;
  /** How to correct the problems: advice and the fix tools. */
  correction: () => JSX.Element;
  /** The correction in a few words, shown on one line with the full correction behind an ⓘ. */
  correctionHint: string;
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
