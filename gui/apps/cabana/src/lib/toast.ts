// One short message at the bottom of the window that goes away on its own, for something that
// happened without the user asking at that moment (a run finished). Shown by components/Toast.tsx.

import { createSignal } from 'solid-js';

const SHOWN_MS = 8000;
export const [toast, setToast] = createSignal<string>();
let timer: number | undefined;

export function showToast(text: string): void {
  clearTimeout(timer);
  setToast(text);
  timer = window.setTimeout(() => setToast(undefined), SHOWN_MS);
}

export function dismissToast(): void {
  clearTimeout(timer);
  setToast(undefined);
}
