// The guided setup shared by the analysis pages: a stage bar (configure, review, run), a section
// list with reviewed / needs-attention / optional marks, and Back and Next. The Review stage parts
// are in GuidedReview.tsx. Review is encouraged, never required.

import { For, Show, type JSX } from 'solid-js';
import { STAGES, type Guided, type Stage } from '../lib/guided.ts';

export interface GuidedSection {
  id: string;
  title: string;
  /** Current values, shown under the title. */
  summary?: string;
  optional?: boolean;
  /** Why the section needs attention (shown with a warning mark). */
  attention?: string;
}

/** The three stages as a bar; any stage can be opened at any time. */
export function StageBar(props: {
  g: Guided;
  done?: Partial<Record<Stage, boolean>>;
}): JSX.Element {
  return (
    <ol class="cb-gs-stages" aria-label="Setup stages">
      <For each={STAGES}>
        {(s, i) => (
          <li>
            <button
              type="button"
              class="cb-gs-stage"
              classList={{
                'cb-gs-stage--on': props.g.stage() === s.id,
                'cb-gs-stage--done': !!props.done?.[s.id],
              }}
              aria-current={props.g.stage() === s.id ? 'step' : undefined}
              onClick={() => props.g.setStage(s.id)}
            >
              <span class="cb-gs-stage__n">{props.done?.[s.id] ? '✓' : i() + 1}</span>
              {s.title}
            </button>
          </li>
        )}
      </For>
    </ol>
  );
}

function Mark(props: { s: GuidedSection; reviewed: boolean }): JSX.Element {
  return (
    <Show
      when={!props.s.attention}
      fallback={
        <span class="cb-gs-mark cb-gs-mark--warn" aria-hidden="true">
          !
        </span>
      }
    >
      <span class="cb-gs-mark" classList={{ 'cb-gs-mark--ok': props.reviewed }} aria-hidden="true">
        {props.reviewed ? '✓' : ''}
      </span>
    </Show>
  );
}

/** Configure stage: the section list on the left, the open section beside it. */
export function SectionList(props: {
  g: Guided;
  label: string;
  sections: GuidedSection[];
  children: (id: string) => JSX.Element;
  /** Shown to the right of the open section (a preview), when given. */
  aside?: JSX.Element;
}): JSX.Element {
  const order = () => props.sections.map((s) => s.id);
  return (
    <div class="cb-gs-body" classList={{ 'cb-gs-body--aside': !!props.aside }}>
      <nav class="cb-gs-list" aria-label={props.label}>
        <For each={props.sections}>
          {(s) => (
            <button
              type="button"
              class="cb-gs-item"
              classList={{ 'cb-gs-item--on': props.g.section() === s.id }}
              aria-current={props.g.section() === s.id ? 'page' : undefined}
              onClick={() => props.g.open(s.id)}
            >
              <Mark s={s} reviewed={props.g.reviewed(s.id)} />
              <span class="cb-gs-item__text">
                <span class="cb-gs-item__title">
                  {s.title}
                  <Show when={s.optional}>
                    <span class="cb-muted"> · optional</span>
                  </Show>
                </span>
                <Show when={s.attention ?? s.summary}>
                  <span
                    class="cb-gs-item__sum"
                    classList={{ 'cb-warn': !!s.attention }}
                    title={s.attention ?? s.summary}
                  >
                    {s.attention ? `Needs attention: ${s.attention}` : s.summary}
                  </span>
                </Show>
                <span class="cb-sr">
                  {s.attention
                    ? 'needs attention'
                    : props.g.reviewed(s.id)
                      ? 'reviewed'
                      : 'not opened yet'}
                </span>
              </span>
            </button>
          )}
        </For>
        <p class="cb-muted cb-gs-list__note">
          A section is marked reviewed once opened. None has to be reviewed before running.
        </p>
      </nav>
      <div class="cb-gs-section">
        <For each={props.sections}>
          {(s) => (
            <Show when={props.g.section() === s.id}>
              <div>{props.children(s.id)}</div>
            </Show>
          )}
        </For>
        <div class="cb-gs-section__nav">
          <Show when={props.g.step(order(), -1)}>
            {(id) => (
              <button type="button" class="btn-secondary" onClick={() => props.g.open(id())}>
                ← {props.sections.find((s) => s.id === id())!.title}
              </button>
            )}
          </Show>
          <span class="cb-spacer" />
          <Show when={props.g.step(order(), 1)}>
            {(id) => (
              <button type="button" class="btn-secondary" onClick={() => props.g.open(id())}>
                {props.sections.find((s) => s.id === id())!.title} →
              </button>
            )}
          </Show>
        </div>
      </div>
      <Show when={props.aside}>
        <div class="cb-gs-aside">{props.aside}</div>
      </Show>
    </div>
  );
}

/** The bar under the stages: what comes next, Back and Continue. No run button on Configure. */
export function StageFooter(props: {
  g: Guided;
  /** Status text on the left (running, needs attention, ready). */
  status?: JSX.Element;
  /** Buttons shown on the right in the Review and Run stages (Cancel while running, say). */
  actions?: JSX.Element;
}): JSX.Element {
  const NEXT: Record<Stage, string> = {
    configure: 'Next: review the settings and choose a Quick preview or the full analysis.',
    review: 'Next: run the analysis from the choices above.',
    run: 'Results open from here when the run finishes; settings can be changed and run again.',
  };
  const i = () => STAGES.findIndex((s) => s.id === props.g.stage());
  return (
    <div class="cb-gs-foot">
      <span class="cb-gs-foot__text">
        {props.status}
        <span class="cb-muted">{NEXT[props.g.stage()]}</span>
      </span>
      <Show when={i() > 0}>
        <button
          type="button"
          class="btn-secondary"
          onClick={() => props.g.setStage(STAGES[i() - 1].id)}
        >
          ← Back
        </button>
      </Show>
      {props.actions}
      <Show when={props.g.stage() === 'configure'}>
        <button type="button" class="btn-primary" onClick={() => props.g.setStage('review')}>
          Continue →
        </button>
      </Show>
    </div>
  );
}
