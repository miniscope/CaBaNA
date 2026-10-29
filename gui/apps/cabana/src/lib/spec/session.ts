// Getting the loaded session to the Python bridge: upload each input file once (by hash), then
// register the same config the Download Config button writes (plan D-4).

import { bridge, type Capabilities } from '../bridge-client.ts';
import { buildSessionConfig, type Section } from '../session-config.ts';
import { slotFile } from '../store.ts';
import { SLOTS, type SlotId } from '../slots.ts';

type Obj = Record<string, unknown>;

/** Dotted config path of every input file, with the slot that holds it. */
export function configFileKeys(
  config: Obj,
  fileOf: (id: SlotId) => string | undefined,
): Record<string, SlotId> {
  const byName = new Map<string, SlotId>();
  for (const { id } of SLOTS) {
    const name = fileOf(id);
    if (name && !byName.has(name)) byName.set(name, id);
  }
  const out: Record<string, SlotId> = {};
  const walk = (node: unknown, trail: string[]) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Obj)) {
      const here = [...trail, k];
      const underAlt = trail.at(-1) === 'alternatives';
      if (
        typeof v === 'string' &&
        (k === 'file' || k === 'timestamps' || underAlt) &&
        byName.has(v)
      )
        out[here.join('.')] = byName.get(v)!;
      else if (k !== 'metadata') walk(v, here);
    }
  };
  walk(config, []);
  return out;
}

export interface UploadedSession {
  sessionId: string;
  withheld: string[];
  problems: string[];
  inputs: Record<string, string>;
}

/** Sections the installed framework cannot read; they stay in the stored full config. */
export const sectionsToOmit = (caps: Capabilities): Section[] => [
  ...(caps.session_metadata ? [] : (['metadata'] as Section[])),
  ...(caps.session_markers ? [] : (['markers'] as Section[])),
  ...(caps.frame_labels ? [] : (['frame_labels'] as Section[])),
];

/**
 * Upload inputs and register the session. The full config goes to the bridge, which writes the
 * copy the framework loads (leaving out sections it cannot read) and reports what it left out.
 */
export async function uploadSession(): Promise<UploadedSession> {
  const config = buildSessionConfig();
  const keys = configFileKeys(config, (id) => slotFile(id)?.name);
  const inputs: Record<string, string> = {};
  for (const [key, slot] of Object.entries(keys)) {
    const file = slotFile(slot);
    if (file) inputs[key] = await bridge.upload(file);
  }
  const res = await bridge.registerSession(config, inputs);
  return { sessionId: res.session_id, withheld: res.withheld, problems: res.problems, inputs };
}
