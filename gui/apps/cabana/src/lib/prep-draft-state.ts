// The draft of a Preprocess pop-up as a small reactive object: what the pop-up reads and sets,
// and Apply changes, which commits through the same setters the Preprocess step used.

import { createSignal } from 'solid-js';
import type { PrepKey } from './prep-deps.ts';
import { setValue, type NumKey } from './prep-view.ts';
import { prep, setPrep } from './preprocess.ts';
import {
  commitPrep,
  draftValue,
  importPrepValues,
  modifiedKeys,
  setPrepValue,
  setResetToDefaults,
  startPrepDraft,
  type PrepValues,
} from './qc-draft.ts';

export function createPrepDraft<K extends PrepKey>(keys: readonly K[]) {
  const [draft, setDraft] = createSignal(startPrepDraft());
  const applied = () => prep as PrepValues;
  return {
    keys,
    applied,
    value: <Key extends K>(k: Key) => draftValue(applied(), draft(), k),
    set: <Key extends K>(k: Key, v: PrepValues[Key]) => setDraft(setPrepValue(draft(), keys, k, v)),
    modified: () => modifiedKeys(applied(), draft(), keys).length,
    resetChecked: () => draft().resetToDefaults,
    setReset: (on: boolean) => setDraft(setResetToDefaults(draft(), on)),
    importValues: (values: Partial<PrepValues>) =>
      setDraft(importPrepValues(applied(), draft(), keys, values)),
    /** Make the draft the session's settings. */
    commit: () =>
      commitPrep(applied(), draft(), keys, (k, v) =>
        k === 'posMethod'
          ? setPrep('posMethod', v as 'median' | 'gaussian')
          : setValue(k as NumKey, v as number),
      ),
  };
}
