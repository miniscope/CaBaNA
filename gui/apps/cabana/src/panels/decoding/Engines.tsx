// The Engine section of Review: for each engine, which requested settings it applies and what a
// missing one means for the result. Read from the framework's capabilities, never assumed.

import { For, Show, type JSX } from 'solid-js';
import { hasCapability } from '../../lib/bridge-status.ts';
import {
  ENGINE_NAMES,
  engineLines,
  type EngineId,
  type EngineLine,
  type Request,
} from './engines.ts';

const MARK: Record<EngineLine['status'], [string, string]> = {
  applied: ['✓', 'Applied'],
  unavailable: ['!', 'Unavailable'],
  none: ['–', 'Not requested'],
};

function EngineCard(props: {
  engine: EngineId;
  request: Request;
  note: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <section class="cb-dg-eng">
      <h4>{ENGINE_NAMES[props.engine]}</h4>
      <p class="cb-muted">{props.note}</p>
      <ul>
        <For each={engineLines(props.engine, props.request, hasCapability)}>
          {(l) => (
            <li classList={{ 'cb-dg-eng--bad': l.status === 'unavailable' }}>
              <span class="cb-dg-eng__mark" aria-hidden="true">
                {MARK[l.status][0]}
              </span>
              <span>
                <b>{l.label}.</b> <span class="cb-sr">{MARK[l.status][1]}. </span>
                {l.text}
              </span>
            </li>
          )}
        </For>
      </ul>
      {props.children}
    </section>
  );
}

/** Both engines side by side, with the browser engine's own run button when it is offered. */
export function EngineSection(props: {
  request: Request;
  frameworkRunning: boolean;
  /** The browser engine is offered because the Python framework cannot run the analysis. */
  browserOffered: boolean;
  browserBlock: string;
  busy: boolean;
  onBrowserRun: () => void;
  runLabel: string;
}): JSX.Element {
  return (
    <div class="cb-dg-engines">
      <h3>Engine</h3>
      <div class="cb-dg-engines__grid">
        <EngineCard
          engine="framework"
          request={props.request}
          note={
            props.frameworkRunning
              ? 'Runs the full analysis and the Quick preview.'
              : 'Not running. Start it from Checks below to use it.'
          }
        />
        <EngineCard
          engine="browser"
          request={props.request}
          note="Runs only when chosen with its own button, never as a fallback."
        >
          <Show when={props.browserOffered}>
            <button
              type="button"
              class="btn-secondary"
              disabled={props.busy || props.browserBlock !== ''}
              onClick={() => props.onBrowserRun()}
            >
              {props.runLabel}
            </button>
            <Show when={props.browserBlock}>
              <p class="cb-warn">{props.browserBlock}</p>
            </Show>
          </Show>
        </EngineCard>
      </div>
    </div>
  );
}
