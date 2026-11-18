// One confirmation or message at a time, shown by ConfirmHost in a Modal. Replaces the browser's
// confirm and alert, which cannot be styled and block the page.

import { createSignal } from 'solid-js';

export interface Question {
  title: string;
  message: string;
  /** Button that goes ahead. Without `onConfirm` the window only shows the message. */
  confirmLabel?: string;
  /** Red button for something that cannot be undone. */
  danger?: boolean;
  onConfirm?: () => void;
}

export const [question, setQuestion] = createSignal<Question>();

/** Ask before an action; the action runs only when the confirm button is pressed. */
export function confirmAction(q: Question & { onConfirm: () => void }): void {
  setQuestion(q);
}

/** Show a message, such as an error, that the user closes with ×. */
export function showMessage(title: string, message: string): void {
  setQuestion({ title, message });
}

/** Text of an unknown thrown value. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
