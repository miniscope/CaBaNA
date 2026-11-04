// The Review stage of the guided setup: a summary of every setting, the Quick preview / Full
// analysis choice with live shuffle counts and the p floor, and the "How it works" button.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { pFloorText, type Guided } from '../lib/guided.ts';
import { Popover } from '../panels/Popover.tsx';

export interface SummaryGroup {
  title: string;
  /** The section the group's settings are edited in. */
  section?: string;
  items: { label: string; value: string; note?: string }[];
}

/** Every setting a run uses, grouped by section, each group linking back to where it is edited. */
export function SettingsSummary(props: { g: Guided; groups: SummaryGroup[] }): JSX.Element {
  return (
    <div class="cb-gs-summary">
      <For each={props.groups}>
        {(grp) => (
          <section class="cb-gs-summary__grp">
            <h4>
              {grp.title}
              <Show when={grp.section}>
                <button
                  type="button"
                  class="cb-link"
                  onClick={() => {
                    props.g.open(grp.section!);
                    props.g.setStage('configure');
                  }}
                >
                  Edit
                </button>
              </Show>
            </h4>
            <dl>
              <For each={grp.items}>
                {(it) => (
                  <>
                    <dt>{it.label}</dt>
                    <dd>
                      {it.value}
                      <Show when={it.note}>
                        <span class="cb-muted"> · {it.note}</span>
                      </Show>
                    </dd>
                  </>
                )}
              </For>
            </dl>
          </section>
        )}
      </For>
    </div>
  );
}

/**
 * The two ways to run: Quick preview (fewer shuffles, saved as Preliminary) and the full analysis
 * with the configured count. Each says when to use it and the smallest p its shuffle count allows.
 */
export function RunChoice(props: {
  full: number;
  preview: number;
  /** Why Quick preview can't run here (e.g. it needs the framework engine), if it can't. */
  previewBlocked?: string;
  /** The analysis has no reduced-shuffle run at all, so the card only says why (with `previewBlocked`). */
  noPreview?: boolean;
  /** Why neither can run, if neither can. */
  blocked?: string;
  /** Text for a test that has no shuffles (PETH curves only, say); replaces the shuffle lines. */
  noTest?: string;
  onPreview: () => void;
  onFull: () => void;
}): JSX.Element {
  return (
    <div class="cb-gs-choice">
      <div class="cb-gs-card" classList={{ 'cb-gs-card--off': !!props.previewBlocked }}>
        <h4>Quick preview</h4>
        <Show when={!props.noPreview}>
          <p>
            The full analysis with up to {props.preview} shuffles ({pFloorText(props.preview)}).
            For checking settings, not for reporting or ranking cells. Saved as Preliminary.
          </p>
        </Show>
        <Show when={props.previewBlocked}>
          <p class="cb-warn">{props.previewBlocked}</p>
        </Show>
        <button
          type="button"
          class="btn-secondary"
          disabled={!!props.previewBlocked || !!props.blocked}
          onClick={() => props.onPreview()}
        >
          Run Quick preview ({props.preview} shuffles)
        </button>
      </div>
      <div class="cb-gs-card">
        <h4>Full analysis</h4>
        <p>
          <Show when={!props.noTest} fallback={props.noTest}>
            {props.full.toLocaleString()} shuffles ({pFloorText(props.full)}). Use for results you
            report.
          </Show>
        </p>
        <button
          type="button"
          class="btn-primary"
          disabled={!!props.blocked}
          onClick={() => props.onFull()}
        >
          Run full analysis
        </button>
      </div>
      <Show when={props.blocked}>
        <p class="cb-warn cb-gs-choice__why">{props.blocked}</p>
      </Show>
    </div>
  );
}

/** A "How it works" button by a page title, opening the method text in an anchored panel. */
export function HowItWorks(props: { title: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="cb-link cb-gs-how"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        How it works
      </button>
      <Show when={open()}>
        <Popover
          anchor={btn}
          onClose={() => setOpen(false)}
          role="dialog"
          label={props.title}
          width={520}
          class="cb-gs-how__body"
        >
          <h4>{props.title}</h4>
          {props.children}
        </Popover>
      </Show>
    </>
  );
}
