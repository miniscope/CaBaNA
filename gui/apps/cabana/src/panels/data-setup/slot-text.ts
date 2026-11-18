// Short texts about a data type on the Data setup page: its name, accepted file types, and why a
// loaded file needs a look.

import { fileMismatch } from '../ConfigReport.tsx';
import type { Slot, SlotId } from '../../lib/slots.ts';
import { loaded } from '../../lib/store.ts';

/** The name a data type has on this page; the config file is the experiment's config. */
export const slotLabel = (s: Slot) => (s.id === 'config' ? 'Experiment config' : s.label);

/** File types each data type is read from. */
export const accepted = (s: Slot) =>
  s.file.endsWith('.yaml') ? '.yaml, .yml' : `.${s.file.split('.').pop()}`;

/** Why a loaded file needs a look: an error, a note from loading, or a name the config disagrees with. */
export function noteOf(id: SlotId): string | undefined {
  const info = loaded[id];
  if (!info) return undefined;
  const m = fileMismatch(id);
  return info.error ?? (m ? `Config names ${m}` : info.warning);
}
