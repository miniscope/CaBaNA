// Keeps a settings store across reloads (localStorage, per-viewer). Missing fields take the
// defaults and a newer settings version is ignored, so an old browser copy never breaks a page.

import { createEffect, on } from 'solid-js';
import { reconcile, type SetStoreFunction } from 'solid-js/store';

export function persistStore<T extends { settingsVersion: number }>(
  key: string,
  store: T,
  set: SetStoreFunction<T>,
  defaults: T,
): void {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<T>;
      if ((saved.settingsVersion ?? 1) <= defaults.settingsVersion)
        set(reconcile({ ...structuredClone(defaults), ...saved } as T));
    }
  } catch {
    // unreadable or blocked storage: start from the defaults
  }
  createEffect(
    on(
      () => JSON.stringify(store),
      (text) => {
        try {
          localStorage.setItem(key, text);
        } catch {
          // not remembered
        }
      },
      { defer: true },
    ),
  );
}
