import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { pageCount, rangeText } from '../lib/label-view.ts';

/** "11-20 of 34" with previous and next buttons; the buttons show only when there is more than one page. */
export function LabelPager(props: {
  page: number;
  total: number;
  perPage: number;
  noun: string;
  /** Something to show between the range and the buttons, such as a link. */
  extra?: JSX.Element;
  onPage: (page: number) => void;
}): JSX.Element {
  const last = () => pageCount(props.total, props.perPage) - 1;
  return (
    <div class="cb-lbl-pager">
      <span class="cb-muted">
        {rangeText(props.page, props.total, props.perPage)} {props.noun}
      </span>
      {props.extra}
      <Show when={last() > 0}>
        <button
          class="btn-secondary btn-small"
          aria-label={`Previous ${props.noun}`}
          disabled={props.page <= 0}
          onClick={() => props.onPage(props.page - 1)}
        >
          ‹
        </button>
        <button
          class="btn-secondary btn-small"
          aria-label={`Next ${props.noun}`}
          disabled={props.page >= last()}
          onClick={() => props.onPage(props.page + 1)}
        >
          ›
        </button>
      </Show>
    </div>
  );
}

/**
 * How many table rows fit between the top of `el` and the bottom of the window, so a page of a
 * table never needs scrolling. `reserve` is the height of everything under the rows (header row,
 * pager, notes, bottom bar). Returns the count and the ref to put on a wrapper at the table's top.
 */
export function useRowsFit(max: number, reserve: number, rowPx = 26, min = 4) {
  const [rows, setRows] = createSignal(max);
  let el: HTMLElement | undefined;
  const fit = () => {
    const top = el?.getBoundingClientRect().top ?? 0;
    if (top <= 0) return; // hidden: keep the last count
    setRows(Math.max(min, Math.min(max, Math.floor((innerHeight - top - reserve) / rowPx))));
  };
  const ref = (e: HTMLElement) => {
    el = e;
    onMount(() => {
      fit();
      const watch = new ResizeObserver(fit);
      watch.observe(e);
      onCleanup(() => watch.disconnect());
    });
  };
  return { rows, ref };
}
