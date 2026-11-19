import { Show, type JSX } from 'solid-js';
import { dismissToast, toast } from '../lib/toast.ts';

/** The current toast (lib/toast.ts), a status line the user can dismiss. */
export function Toast(): JSX.Element {
  return (
    <Show when={toast()}>
      {(text) => (
        <div class="cb-toast" role="status">
          <span>{text()}</span>
          <button type="button" class="cb-link" onClick={dismissToast}>
            Dismiss
          </button>
        </div>
      )}
    </Show>
  );
}
