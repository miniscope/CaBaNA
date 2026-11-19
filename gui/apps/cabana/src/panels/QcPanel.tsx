// The shape of one QC test, and the helper that keeps a page inside the window.
import type { JSX } from 'solid-js';
import type { Check } from '../lib/qc.ts';
import type { MetricCard } from '../components/MetricCards.tsx';

/** One QC test: the checks it ran. */
export interface Category {
  id: string;
  name: string;
  checks: Check[];
}

/** A test shown with plots: today only the timing check of Data setup. */
export interface PlotTest extends Category {
  /** Plot tabs and what each shows. */
  tabs: { id: string; label: string }[];
  plot: (tab: string) => JSX.Element;
  /** Summary cards for this test. */
  metrics: () => MetricCard[];
  /** How to correct the problems: advice and the fix tools. */
  correction: () => JSX.Element;
  /** The correction in a few words, shown on one line with the full correction behind an ⓘ. */
  correctionHint: string;
}

/** Keep the workspace inside the window: its height runs from its top to the bottom of the window. */
export function fitToWindow(el: HTMLElement): () => void {
  const fit = () => {
    if (!el.isConnected) return; // the window closed before a pending refit ran
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
