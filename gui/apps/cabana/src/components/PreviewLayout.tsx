// The body of an analysis's Preview window: the result (or an empty state) on the left; on the
// right the current settings with a link to Configure settings, the number of shuffles, Run
// preview and a note on how to read the preview. Each analysis supplies its own settings, run
// function and result.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { openAnalysisWindow } from '../lib/analysis-window.ts';
import { previewRange, previewShufflesIssue } from '../lib/preview.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { placePopover, ShuffleReach } from '../panels/parts.tsx';
import type { SummaryGroup } from './GuidedReview.tsx';

const SHOWN = 6;

/** The current settings as one list (the first few; the rest on request): every item of the groups, without their headings. */
export function CurrentSettings(props: { id: AnalysisItem; groups: SummaryGroup[] }): JSX.Element {
  const [all, setAll] = createSignal(false);
  const items = () => props.groups.flatMap((g) => g.items);
  const shown = () => (all() ? items() : items().slice(0, SHOWN));
  return (
    <section class="cb-pv-side__block">
      <h4 class="cb-pv-side__label">Current settings</h4>
      <dl class="cb-pv-settings">
        <For each={shown()}>
          {(it) => (
            <>
              <dt>{it.label}</dt>
              <dd>{it.value}</dd>
            </>
          )}
        </For>
      </dl>
      <Show when={items().length > SHOWN}>
        <button
          type="button"
          class="cb-link cb-pv-link"
          aria-expanded={all()}
          onClick={() => setAll(!all())}
        >
          {all() ? 'Show fewer settings' : `Show all ${items().length} settings`}
        </button>
      </Show>
      <button
        type="button"
        class="cb-link cb-pv-link"
        onClick={() => openAnalysisWindow(props.id, 'configure')}
      >
        Edit in Configure settings
      </button>
    </section>
  );
}

export function PreviewLayout(props: {
  id: AnalysisItem;
  /** The result, or the empty state when `ran` is false. */
  children: JSX.Element;
  groups: SummaryGroup[];
  /** The full analysis's shuffle count; undefined when the analysis has no shuffle test. */
  full?: number;
  /** The test's significance level, to warn when the shuffle counts cannot reach it. */
  alpha?: number;
  shuffles: number;
  onShuffles: (n: number) => void;
  /** Why a preview cannot run now (the button and field are off). */
  blocked?: string;
  /** Shown beside the disabled field when the engine is what is missing. */
  fieldNote?: string;
  running: boolean;
  /** Progress or error line under the button. */
  status?: JSX.Element;
  ran: boolean;
  onRun: () => void;
  /** The text under the button, default: the Preview run note. */
  note?: JSX.Element;
  howTitle?: string;
  how: JSX.Element;
}): JSX.Element {
  const [draft, setDraft] = createSignal<string>();
  const text = () => draft() ?? String(props.shuffles);
  const issue = () =>
    props.full === undefined ? undefined : previewShufflesIssue(+text(), props.full);
  const locked = () => !!props.blocked || props.running;
  return (
    <div class="cb-pv">
      <div class="cb-pv-main">{props.children}</div>
      <aside class="cb-pv-side" aria-label="Preview settings">
        <CurrentSettings id={props.id} groups={props.groups} />
        <section class="cb-pv-side__block">
          <h4 class="cb-pv-side__label">Preview</h4>
          <Show when={props.full !== undefined}>
            <label class="cb-pv-shuffles">
              Number of shuffles
              <input
                type="number"
                min={previewRange(props.full!)[0]}
                max={previewRange(props.full!)[1]}
                step="1"
                value={text()}
                disabled={locked()}
                aria-invalid={!!issue()}
                onInput={(e) => {
                  setDraft(e.currentTarget.value);
                  if (!previewShufflesIssue(+e.currentTarget.value, props.full!))
                    props.onShuffles(+e.currentTarget.value);
                }}
                onBlur={() => setDraft(undefined)}
              />
            </label>
            <p class="cb-pv-hint" classList={{ 'cb-warn': !!issue() }}>
              {issue() ??
                `${previewRange(props.full!)[0].toLocaleString()} to ${previewRange(props.full!)[1].toLocaleString()} · at most the full analysis's ${props.full!.toLocaleString()}`}
            </p>
            <Show when={props.fieldNote}>
              <p class="cb-pv-hint">{props.fieldNote}</p>
            </Show>
          </Show>
          <button
            type="button"
            class="btn-primary cb-pv-run"
            disabled={locked() || !!issue()}
            onClick={() => props.onRun()}
          >
            {props.running ? 'Running preview…' : props.ran ? 'Run preview again' : 'Run preview'}
          </button>
          <Show when={props.blocked}>
            <p class="cb-pv-hint cb-warn">{props.blocked}</p>
          </Show>
          <Show when={props.full !== undefined && props.alpha !== undefined}>
            <p class="cb-pv-hint cb-warn">
              <ShuffleReach shuffles={props.full!} alpha={props.alpha!} chosen={props.shuffles} />
            </p>
          </Show>
          {props.status}
          <p class="cb-pv-hint">
            {props.note ??
              "Saved as a Preview run. The full analysis runs from the card's Run button."}
          </p>
        </section>
        <details class="cb-notebox cb-howto cb-notepop" onToggle={placePopover}>
          <summary>{props.howTitle ?? 'How to read this preview'}</summary>
          <div class="cb-muted">{props.how}</div>
        </details>
      </aside>
    </div>
  );
}

/** The left side before a preview has run. */
export function NoPreview(props: { children?: JSX.Element }): JSX.Element {
  return (
    <div class="cb-pv-empty">
      <strong>No preview yet</strong>
      <p>
        {props.children ??
          'Set the number of shuffles and choose Run preview. A preview runs the same analysis with fewer shuffles, to check the settings before the full run.'}
      </p>
    </div>
  );
}
