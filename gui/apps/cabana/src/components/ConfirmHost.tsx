// The window for lib/confirm.ts: a question with a confirm button, or a message with only the ×.

import { Show, type JSX } from 'solid-js';
import { question, setQuestion } from '../lib/confirm.ts';
import { Modal } from './Modal.tsx';

export function ConfirmHost(): JSX.Element {
  const close = () => setQuestion(undefined);
  return (
    <Show when={question()}>
      {(q) => (
        <Modal
          label={q().title}
          title={q().title}
          width={460}
          onClose={close}
          footer={
            <Show when={q().onConfirm}>
              <span class="cb-spacer" />
              <button type="button" class="btn-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                classList={{
                  'btn-primary': !q().alternative,
                  'btn-secondary cb-btn-danger-outline': !!q().alternative,
                  'cb-btn-danger': q().danger && !q().alternative,
                }}
                onClick={() => {
                  const go = q().onConfirm!;
                  close();
                  go();
                }}
              >
                {q().confirmLabel ?? 'Confirm'}
              </button>
              <Show when={q().alternative}>
                {(alt) => (
                  <button
                    type="button"
                    class="btn-primary"
                    onClick={() => {
                      close();
                      alt().onSelect();
                    }}
                  >
                    {alt().label}
                  </button>
                )}
              </Show>
            </Show>
          }
        >
          <p class="cb-rx__p">{q().message}</p>
        </Modal>
      )}
    </Show>
  );
}
