import { For, Show, type JSX } from 'solid-js';
import { START_COMMAND, bridgeState, connectBridge } from '../../lib/bridge-status.ts';

/** Why an analysis cannot run, written on the page: the engine, framework features, user input. */
export function Unavailable(props: {
  engineOff?: boolean;
  framework?: { text: string; code?: string }[];
  input?: string[];
}): JSX.Element {
  const engineOff = () => props.engineOff && bridgeState().kind !== 'ready';
  return (
    <Show when={engineOff() || props.framework?.length || props.input?.length}>
      <div class="cb-un" role="status">
        <Show when={engineOff()}>
          <div class="cb-un__item cb-un__engine">
            <strong>Python engine not running</strong>
            <span>Start it with</span>
            <code class="cb-un__cmd">{START_COMMAND}</code>
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => void connectBridge()}
            >
              Retry
            </button>
            <span class="cb-muted">Saved results stay available.</span>
          </div>
        </Show>
        <Show when={props.framework?.length}>
          <div class="cb-un__item">
            <strong>Framework update required</strong>
            <For each={props.framework}>{(f) => <p>{f.text}</p>}</For>
            <details>
              <summary>Technical details</summary>
              <For each={props.framework}>{(f) => <p>{f.code ?? ''}</p>}</For>
            </details>
          </div>
        </Show>
        <Show when={props.input?.length}>
          <div class="cb-un__item">
            <strong>Needs input</strong>
            <For each={props.input}>{(t) => <p>{t}</p>}</For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
