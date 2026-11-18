// The arena editor works on a draft: a stack of earlier states for Undo, the state when the editor
// opened, and a check for unsaved changes. States are plain copies, so the logic needs no store.

export interface Draft<T> {
  /** The state when the editor opened; Cancel and a discarded close go back to it. */
  start: T;
  /** States before each edit, oldest first. */
  past: T[];
}

export const newDraft = <T>(start: T): Draft<T> => ({ start, past: [] });

/** Record the state an edit is about to change. */
export const recordEdit = <T>(d: Draft<T>, before: T): Draft<T> => ({
  ...d,
  past: [...d.past, before],
});

/** Step back one edit: the draft without it, and the state to restore (undefined when none). */
export function undoEdit<T>(d: Draft<T>): { draft: Draft<T>; restore: T | undefined } {
  if (!d.past.length) return { draft: d, restore: undefined };
  return { draft: { ...d, past: d.past.slice(0, -1) }, restore: d.past[d.past.length - 1] };
}

/** Saving makes the current state the new start, so closing afterwards asks nothing. */
export const markSaved = <T>(current: T): Draft<T> => newDraft(current);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the current state differs from the one the editor opened with. */
export const isDirty = <T>(d: Draft<T>, current: T): boolean => !same(d.start, current);

/** A plain deep copy of a store value, for keeping a state. */
export const copyState = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
