import { Show, type JSX } from 'solid-js';
import {
  BROWSER_RUN_LABEL,
  browserReason,
  engineFor,
  frameworkReady,
  type EngineMode,
} from '../../lib/engine.ts';
import { FRAMEWORK_ENGINE, statusOfItem } from '../../lib/readiness-snapshot.ts';
import { Unavailable } from './FrameworkNotice.tsx';

/**
 * Which engine the page will use, and what to do when the Python engine is off. Nothing runs on
 * the browser engine unless the user presses its own button.
 */
export function EngineNotice(props: {
  mode: EngineMode;
  busy: boolean;
  onBrowserRun: () => void;
}): JSX.Element {
  const off = () => engineFor(props.mode) === 'framework' && !frameworkReady();
  return (
    <>
      <Show when={browserReason(props.mode)}>
        {(why) => (
          <div class="cb-note" role="status">
            {why()} Results say Browser engine.
          </div>
        )}
      </Show>
      <Show when={off()}>
        {/* The Requirements block at the top of the page already shows this once readiness counts the mode as a framework analysis. */}
        <Show when={!FRAMEWORK_ENGINE[props.mode] && !statusOfItem(props.mode).engineOff}>
          <Unavailable engineOff />
        </Show>
        <div class="cb-note" role="status">
          <button
            type="button"
            class="btn-secondary"
            disabled={props.busy}
            title="Runs the TypeScript port in this browser. Random draws differ from the framework, so p-values differ slightly; observed values are the same."
            onClick={() => props.onBrowserRun()}
          >
            {BROWSER_RUN_LABEL}
          </button>
        </div>
      </Show>
    </>
  );
}

/** A progress bar that fills when the run reports how far along it is, and is indeterminate when it does not. */
export function RunProgress(props: { done: number; total: number }): JSX.Element {
  return (
    <Show when={props.total > 1} fallback={<progress class="cb-progress" />}>
      <progress class="cb-progress" value={props.done} max={props.total} />
    </Show>
  );
}
