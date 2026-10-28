// Pieces of the Data QC workspace: popovers, plot cards, the findings list, the right-hand boxes,
// lists with pages, and the review and limit controls.

import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { Popover } from './Popover.tsx';
import type { Check, Status } from '../lib/qc.ts';
import { DEFAULT_TOL, proceed, setProceed, setTol, tol, type Section } from '../lib/store.ts';
import {
  listPage,
  openFold,
  reviewed,
  setListPage,
  setOpenFold,
  setReviewed,
} from '../lib/qc-view.ts';
import { InfoTip } from './InfoTip.tsx';

export type Shown = Status | 'reviewed' | 'none';
const ICON: Record<Shown, string> = { pass: '✓', warn: '!', fail: '✕', reviewed: '✓', none: '–' };

export function StatusIcon(props: { status: Shown }): JSX.Element {
  return (
    <span class={`cb-qi cb-qi--${props.status}`} aria-hidden="true">
      {ICON[props.status]}
    </span>
  );
}

export const worst = (checks: Check[]): Status | 'none' =>
  !checks.length
    ? 'none'
    : checks.some((c) => c.status === 'fail')
      ? 'fail'
      : checks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'pass';

/** Width and height of an element, updated as it resizes. */
export function createSize(): [Accessor<{ w: number; h: number }>, (el: HTMLElement) => void] {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  return [
    size,
    (el) => {
      ro = new ResizeObserver(([e]) =>
        setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }),
      );
      ro.observe(el);
    },
  ];
}

/** A button that opens a popover with a title and a close button. */
export function PopButton(props: {
  label: string;
  title: string;
  width?: number;
  class?: string;
  button: JSX.Element;
  /** The popover's content, or a function given a way to close it. */
  children: JSX.Element | ((close: () => void) => JSX.Element);
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  return (
    <>
      <button
        ref={btn}
        type="button"
        class={props.class ?? 'cb-ib'}
        aria-label={props.label}
        title={props.label}
        aria-expanded={open()}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open())}
      >
        {props.button}
      </button>
      <Show when={open()}>
        <Popover
          anchor={btn}
          onClose={() => setOpen(false)}
          width={props.width}
          label={props.title}
        >
          <div class="cb-pop__head">
            <strong>{props.title}</strong>
            <button
              type="button"
              class="cb-ib"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
                btn.focus();
              }}
            >
              ✕
            </button>
          </div>
          {untrack(() => {
            const body = props.children;
            return typeof body === 'function' ? body(() => setOpen(false)) : body;
          })}
        </Popover>
      </Show>
    </>
  );
}

/** The "?" beside a plot title: what is plotted, axes and units, colors, links and limits. */
export function HowTo(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <PopButton
      label="How to read this plot"
      title={`How to read: ${props.title}`}
      width={440}
      class="cb-ib cb-ib--q"
      button="?"
    >
      <div class="cb-howto-body">{props.children}</div>
    </PopButton>
  );
}

/** One labeled paragraph of a plot explanation. */
export const Help = (props: { k: string; children: JSX.Element }): JSX.Element => (
  <p>
    <b>{props.k}.</b> {props.children}
  </p>
);

/**
 * A plot with its title, a "How to read" note and an expand button. `children` gets the size of
 * the plot area, so the same plot fills the card or the larger overlay, and a function that opens
 * the overlay (for a plot too small to read in the card).
 */
export function PlotCard(props: {
  title: string;
  help: JSX.Element;
  legend?: JSX.Element;
  tools?: JSX.Element;
  /** Extra controls shown only in the expanded view. */
  bigTools?: JSX.Element;
  class?: string;
  /** Opens help elsewhere (a side panel) instead of the popover; the expanded view keeps the popover. */
  onHelp?: () => void;
  children: (size: Accessor<{ w: number; h: number }>, expand?: () => void) => JSX.Element;
}): JSX.Element {
  const [size, measure] = createSize();
  const [big, setBig] = createSignal(false);
  let expand!: HTMLButtonElement;
  return (
    <section class={`cb-plot ${props.class ?? ''}`}>
      <div class="cb-plot__head">
        <h3>{props.title}</h3>
        <Show when={props.onHelp} fallback={<HowTo title={props.title}>{props.help}</HowTo>}>
          <button
            type="button"
            class="cb-ib cb-ib--q"
            aria-label="How to read this plot"
            title="How to read this plot"
            onClick={() => props.onHelp!()}
          >
            ?
          </button>
        </Show>
        <button
          ref={expand}
          type="button"
          class="cb-ib"
          aria-label={`Expand ${props.title}`}
          title="Expand plot"
          onClick={() => setBig(true)}
        >
          ⤢
        </button>
        {props.tools}
        <Show when={props.legend}>
          <div class="cb-plot__legend">{props.legend}</div>
        </Show>
      </div>
      <div class="cb-plot__body" ref={measure}>
        <Show when={size().h > 20}>{untrack(() => props.children(size, () => setBig(true)))}</Show>
      </div>
      <Show when={big()}>
        <Overlay
          title={props.title}
          onClose={() => {
            setBig(false);
            expand.focus();
          }}
          head={
            <>
              <HowTo title={props.title}>{props.help}</HowTo>
              {props.tools}
              {props.bigTools}
              <Show when={props.legend}>
                <div class="cb-plot__legend">{props.legend}</div>
              </Show>
            </>
          }
        >
          {(s) => props.children(s)}
        </Overlay>
      </Show>
    </section>
  );
}

/** A large view over the page. Escape or the close button closes it. */
function Overlay(props: {
  title: string;
  head: JSX.Element;
  onClose: () => void;
  children: (size: Accessor<{ w: number; h: number }>) => JSX.Element;
}): JSX.Element {
  const [size, measure] = createSize();
  let close!: HTMLButtonElement;
  const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    close.focus();
    document.addEventListener('keydown', key);
  });
  onCleanup(() => document.removeEventListener('keydown', key));
  return (
    <Portal>
      <div class="cb-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="cb-overlay__box" role="dialog" aria-modal="true" aria-label={props.title}>
          <div class="cb-plot__head">
            <h3>{props.title}</h3>
            {props.head}
            <button
              ref={close}
              type="button"
              class="cb-ib"
              aria-label="Close"
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>
          <div class="cb-plot__body" ref={measure}>
            <Show when={size().h > 20}>{untrack(() => props.children(size))}</Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** A box in the right-hand column. Boxes with `fold` fold, and only one of them is open at a time. */
export function RailBox(props: {
  title: string;
  fold?: string;
  /** Takes the height left in the column (a list that pages to fit). */
  grow?: boolean;
  extra?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  const folds = () => !!props.fold;
  const open = () => !folds() || openFold() === props.fold;
  return (
    <section class="cb-rail-box" classList={{ 'cb-rail-box--grow': props.grow }}>
      <Show
        when={folds()}
        fallback={
          <div class="cb-rail-box__head">
            <h3>{props.title}</h3>
            {props.extra}
          </div>
        }
      >
        <button
          type="button"
          class="cb-rail-box__head cb-rail-box__fold"
          aria-expanded={open()}
          onClick={() => setOpenFold(open() ? undefined : props.fold)}
        >
          <h3>{props.title}</h3>
          <span aria-hidden="true">{open() ? '▴' : '▾'}</span>
        </button>
      </Show>
      <Show when={open()}>{props.children}</Show>
    </section>
  );
}

/**
 * Every check in a category: its result and number, with the full text and advice a click away.
 * With more than three checks, the passed ones fold into one line to save height.
 */
export function Findings(props: { checks: Check[] }): JSX.Element {
  const [all, setAll] = createSignal(false);
  const fold = () => props.checks.length > 3 && !all();
  const passed = () => props.checks.filter((c) => c.status === 'pass');
  const shown = () => (fold() ? props.checks.filter((c) => c.status !== 'pass') : props.checks);
  return (
    <RailBox title="Findings">
      <Show when={props.checks.length} fallback={<div class="cb-muted">No checks ran.</div>}>
        <ul class="cb-findings">
          <For each={shown()}>
            {(c) => (
              <li>
                <StatusIcon status={c.status} />
                <span class="cb-findings__title">{c.title}</span>
                <span class="cb-findings__value">
                  {c.value ?? (c.status === 'pass' ? 'OK' : '')}
                  <Show when={c.limit}>
                    <span class="cb-muted"> {c.limit}</span>
                  </Show>
                </span>
                <PopButton label={`Details: ${c.title}`} title={c.title} width={340} button="›">
                  <p>{c.detail}</p>
                  <Show when={c.fix && c.status !== 'pass'}>
                    <p>
                      <b>What to do.</b> {c.fix}
                    </p>
                  </Show>
                </PopButton>
              </li>
            )}
          </For>
          <Show when={props.checks.length > 3 && passed().length}>
            <li class="cb-findings__more">
              <Show when={fold()} fallback={<span />}>
                <StatusIcon status="pass" />
                <span class="cb-findings__title">
                  {passed().length} {passed().length === 1 ? 'check' : 'checks'} passed
                </span>
              </Show>
              <button
                type="button"
                class="cb-link"
                aria-expanded={!fold()}
                onClick={() => setAll(!all())}
              >
                {fold() ? 'Show' : 'Hide passed'}
              </button>
            </li>
          </Show>
        </ul>
      </Show>
    </RailBox>
  );
}

/**
 * A list shown a page at a time, with the selected item highlighted. As many rows as fit in the
 * space left in the column are shown per page (`rowH` is the height of one row).
 */
export function PagedList<T>(props: {
  id: string;
  items: T[];
  rowH?: number;
  selected?: number;
  onSelect?: (i: number) => void;
  empty: string;
  children: (item: T, i: number) => JSX.Element;
  /** Controls beside the row (a checkbox before, buttons after), outside the row's own button. */
  before?: (item: T, i: number) => JSX.Element;
  after?: (item: T, i: number) => JSX.Element;
}): JSX.Element {
  const [size, measure] = createSize();
  // Rows are measured once drawn; `rowH` is the guess before that.
  const [rowH, setRowH] = createSignal(props.rowH ?? 30);
  let list: HTMLUListElement | undefined;
  const per = () => Math.max(3, Math.floor((size().h - 36) / rowH()));
  const pages = () => Math.max(1, Math.ceil(props.items.length / per()));
  const page = () => Math.min(listPage[props.id] ?? 0, pages() - 1);
  const shown = () => props.items.slice(page() * per(), (page() + 1) * per());
  const go = (p: number) => setListPage(props.id, Math.max(0, Math.min(pages() - 1, p)));
  createEffect(() => {
    shown();
    const h = list?.firstElementChild?.getBoundingClientRect().height;
    if (h) setRowH(Math.max(h, 20));
  });
  // Turn to the page of the selected item when the selection changes.
  createEffect(
    on(
      () => props.selected,
      (i) => i !== undefined && i >= 0 && setListPage(props.id, Math.floor(i / untrack(per))),
    ),
  );
  return (
    <div class="cb-paged" ref={measure}>
      <Show when={props.items.length} fallback={<div class="cb-muted">{props.empty}</div>}>
        <ul class="cb-list" ref={list}>
          <For each={shown()}>
            {(it, k) => {
              const i = () => page() * per() + k();
              return (
                <li>
                  {props.before?.(it, i())}
                  <button
                    type="button"
                    class="cb-list__item"
                    classList={{ 'cb-list__item--on': props.selected === i() }}
                    aria-current={props.selected === i()}
                    onClick={() => props.onSelect?.(i())}
                  >
                    {props.children(it, i())}
                  </button>
                  {props.after?.(it, i())}
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={pages() > 1}>
          <div class="cb-pager">
            <span class="cb-muted">
              {page() * per() + 1}–{Math.min(props.items.length, (page() + 1) * per())} of{' '}
              {props.items.length}
            </span>
            <button
              type="button"
              class="cb-ib"
              aria-label="Previous page"
              onClick={() => go(page() - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              class="cb-ib"
              aria-label="Next page"
              onClick={() => go(page() + 1)}
            >
              ›
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/** Previous and next buttons that step through a list. */
export function StepButtons(props: {
  n: number;
  i: number;
  go: (i: number) => void;
  what: string;
}) {
  return (
    <span class="cb-steps-btns">
      <button
        type="button"
        class="btn-secondary btn-small"
        disabled={props.i <= 0}
        onClick={() => props.go(props.i - 1)}
      >
        ‹ Previous {props.what}
      </button>
      <button
        type="button"
        class="btn-secondary btn-small"
        disabled={props.i >= props.n - 1}
        onClick={() => props.go(props.i + 1)}
      >
        Next {props.what} ›
      </button>
    </span>
  );
}

/** What to do about each failing or noted check, from its `fix`. */
export function Advice(props: { checks: Check[] }): JSX.Element {
  const items = () => props.checks.filter((c) => c.status !== 'pass' && c.fix);
  return (
    <Show when={items().length}>
      <div class="cb-rail-label">What to do</div>
      <ol class="cb-advice">
        <For each={items()}>{(c) => <li>{c.fix}</li>}</For>
      </ol>
    </Show>
  );
}

/** Mark a category reviewed, and for a failed section, continue without correcting it. */
export function ReviewActions(props: {
  id: string;
  section?: Section;
  checks: Check[];
}): JSX.Element {
  const failed = () => props.checks.some((c) => c.status === 'fail');
  return (
    <div class="cb-review">
      <Show when={failed() && props.section}>
        <Show
          when={proceed[props.section!]}
          fallback={
            <button
              class="btn-secondary btn-small"
              onClick={() => setProceed(props.section!, true)}
            >
              Continue without correction
            </button>
          }
        >
          <span class="cb-muted">Continuing with these issues.</span>
          <button class="cb-link" onClick={() => setProceed(props.section!, false)}>
            Undo
          </button>
        </Show>
      </Show>
      <button
        class="btn-secondary btn-small"
        classList={{ 'cb-review--on': !!reviewed[props.id] }}
        aria-pressed={!!reviewed[props.id]}
        onClick={() => setReviewed(props.id, !reviewed[props.id])}
      >
        {reviewed[props.id] ? '✓ Reviewed' : 'Mark reviewed'}
      </button>
      <InfoTip label="What Mark reviewed does">
        Marks this category as looked at, so the list on the left shows which flags have been
        checked. It changes only the label: the checks, pass or fail, and later steps are not
        affected.
      </InfoTip>
    </div>
  );
}

/** What each pass/fail limit is, why it is checked, and what a failure does to results. */
export const TOL_INFO: Record<
  keyof typeof tol,
  { label: string; unit: string; step: number; why: string; ifFails: string }
> = {
  lostPct: {
    label: 'Lost position frames',
    unit: '% of frames',
    step: 1,
    why: 'Position places the animal in the arena at every neural frame. A frame the tracker lost has no position.',
    ifFails:
      'Place and speed measures use fewer frames. If the losses cluster in one part of the arena or one part of the session, those places or times are under-sampled, which biases occupancy maps and place fields.',
  },
  jumpPct: {
    label: 'Jump steps',
    unit: '% of steps',
    step: 0.01,
    why: 'An animal cannot move faster than about 60 cm/s between frames. A faster step means the tracker lost the animal, locked onto a reflection, or swapped identity.',
    ifFails:
      'One jump draws a false path across the arena. It inflates speed and distance and smears place fields over places the animal never visited.',
  },
  annotPct: {
    label: 'Problem epochs',
    unit: '% of epochs',
    step: 1,
    why: 'Epochs that end before they start, fall outside the session, or overlap another epoch with the same label are mistakes in the annotation file.',
    ifFails:
      'CaBaNA turns epochs into a label for every frame. Mistakes put the label on the wrong frames, which blurs or shifts the neural response to that behavior.',
  },
  poorCellPct: {
    label: 'Flagged cells',
    unit: '% of cells',
    step: 1,
    why: 'Cells are flagged for low signal to noise, strong correlation with a neighbor, or too few or too many events. Flagged cells can be rejected one by one, so this is the share of cells at which the whole dataset is judged poor.',
    ifFails:
      'Noisy cells add random variation that weakens real effects. A cell split in two counts one neuron twice, which makes responses look more common and population results more consistent than they are. Cells with no events, or events on most frames, give unreliable tuning.',
  },
  overlapPct: {
    label: 'Overlapping footprint pairs',
    unit: '% of cells',
    step: 1,
    why: 'Footprints that share most of their pixels usually mean one cell was split in two, or that two cells contaminate each other. Footprint overlap above about 50%, with correlated traces, is a common screen for split cells (Miniscope guide, miniscope.org/wiki/Guide/Data_processing_considerations).',
    ifFails:
      'Cells that share pixels share signal, so the same activity is counted twice. This biases correlations, population analyses and decoding.',
  },
  riseLowPct: {
    label: 'Cells whose events sit at noise level',
    unit: '% of cells',
    step: 1,
    why: 'After a real event the fluorescence rises. For these cells it barely does, so their events line up with noise.',
    ifFails:
      'Events that are really noise make a cell look active at random times, which dilutes tuning and inflates event counts.',
  },
  minBoutS: {
    label: 'Shortest bout kept',
    unit: 's',
    step: 0.05,
    why: 'A bout this short covers only a few frames (at 30 Hz, 0.1 s is 3 frames). Some behaviors really are brief, so the default is small.',
    ifFails:
      'A slip of a frame or two in manual scoring is a large share of a very short bout, so its label may sit on the wrong frames. The neural average over so few frames is also hard to tell from noise, so short bouts add noise to the response for that behavior.',
  },
  mergeGapS: {
    label: 'Shortest gap between bouts of one label',
    unit: 's',
    step: 0.1,
    why: 'Two bouts with the same label that overlap or sit this close together are usually one bout split by a pause in scoring.',
    ifFails:
      'One response is cut in two, and the frames in the gap count as not showing the behavior. Overlapping epochs would count the same frames twice.',
  },
  minPve: {
    label: 'Least variance explained',
    unit: '%',
    step: 5,
    why: 'Reconvolving the events with the indicator kernel should rebuild the trace. If it explains little, the events do not match the data: the kernel is wrong or the events are fitting noise.',
    ifFails:
      'Event timing and size are unreliable. Anything built on events, such as tuning and decoding, is less accurate, and a wrong kernel shifts event times.',
  },
};

export type TolKey = keyof typeof tol;

/** The numbers that decide pass or fail for a category, edited in a popover. */
export function Limits(props: { keys: TolKey[] }): JSX.Element {
  const changed = () => props.keys.some((k) => tol[k] !== DEFAULT_TOL[k]);
  return (
    <div class="cb-limits-row">
      <span>
        Pass/fail limits <span class="cb-muted">{changed() ? '(changed)' : '(defaults)'}</span>
      </span>
      <PopButton
        label="Edit pass/fail limits"
        title="Pass/fail limits"
        width={400}
        class="cb-link"
        button="Edit limits"
      >
        <LimitsForm keys={props.keys} />
      </PopButton>
    </div>
  );
}

function LimitsForm(props: { keys: TolKey[] }): JSX.Element {
  const [draft, setDraft] = createStore<Partial<Record<TolKey, number>>>(
    untrack(() => Object.fromEntries(props.keys.map((k) => [k, tol[k]]))),
  );
  const [saved, setSaved] = createSignal(false);
  const apply = (values: Partial<Record<TolKey, number>>) => {
    props.keys.forEach((k) => setTol(k, values[k] ?? tol[k]));
    setSaved(true);
  };
  return (
    <div class="cb-limits">
      <p class="cb-muted">
        These numbers set when a section fails. Change a number, then press Set limits. Defaults
        were chosen for CaBaNA and are not published standards; change them to suit the dataset.
      </p>
      <For each={props.keys}>
        {(k) => (
          <div class="cb-param">
            <label>
              <span>{TOL_INFO[k].label}</span>
              <input
                type="number"
                min="0"
                step={TOL_INFO[k].step}
                value={draft[k]}
                onInput={(e) => {
                  setDraft(k, Math.max(0, +e.currentTarget.value));
                  setSaved(false);
                }}
              />
              <span class="cb-muted">
                {TOL_INFO[k].unit}, default {DEFAULT_TOL[k]}
              </span>
            </label>
            <details>
              <summary>Why this is checked, and what a failure does</summary>
              <p>
                <b>Why:</b> {TOL_INFO[k].why}
              </p>
              <p>
                <b>If the data fails:</b> {TOL_INFO[k].ifFails}
              </p>
            </details>
          </div>
        )}
      </For>
      <div class="cb-controls">
        <button class="btn-secondary btn-small" onClick={() => apply(draft)}>
          Set limits
        </button>
        <button
          class="btn-secondary btn-small"
          onClick={() => {
            props.keys.forEach((k) => setDraft(k, DEFAULT_TOL[k]));
            apply(DEFAULT_TOL);
          }}
        >
          Reset to defaults
        </button>
        <Show when={saved()}>
          <span class="cb-muted">Applied.</span>
        </Show>
      </div>
    </div>
  );
}

/** Title row of a category: its name and result. */
export function CategoryHead(props: {
  title: string;
  checks: Check[];
  flagged?: string;
  children?: JSX.Element;
}): JSX.Element {
  const s = () => worst(props.checks);
  const word = () =>
    ({ pass: 'Passed', warn: 'Passed, with notes', fail: 'Failed', none: 'Not checked' })[s()];
  return (
    <div class="cb-cat-head">
      <h2>{props.title}</h2>
      <span class={`cb-chip-status cb-chip-status--${s()}`}>
        {word()}
        <Show when={props.flagged}> · {props.flagged}</Show>
      </span>
      {props.children}
    </div>
  );
}
