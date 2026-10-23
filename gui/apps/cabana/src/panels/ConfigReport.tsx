import { For, Show, type JSX } from 'solid-js';
import { pendingZones } from '../lib/arena.ts';
import { configReport } from '../lib/config-import.ts';
import { SLOTS, type SlotId } from '../lib/slots.ts';
import { loaded } from '../lib/store.ts';

const label = (id: SlotId) => SLOTS.find((s) => s.id === id)?.label ?? id;

/** What the loaded config.yaml filled in, and anything in it that is missing, wrong or unused. */
export function ConfigReport(): JSX.Element {
  const r = configReport;
  // Files the config names that are not the ones loaded for that slot.
  const files = () =>
    Object.entries(r()?.files ?? {})
      .filter(([id, name]) => loaded[id as SlotId]?.name !== name)
      .map(([id, name]) => {
        const got = loaded[id as SlotId]?.name;
        return `${label(id as SlotId)}: the config names ${name}, but ${got ? `${got} is loaded` : 'it is not loaded'}.`;
      });
  const warnings = () => [...(r()?.problems ?? []), ...files()];
  return (
    <Show when={r()}>
      <div class="cb-notebox cb-config-report">
        <div>
          <strong>Settings from {loaded.config?.name ?? 'config.yaml'}</strong>
          <p class="cb-muted">
            {r()!.read.length} settings were filled in from the config. Anything changed by hand
            afterwards replaces them.
          </p>
          <Show when={warnings().length}>
            <ul class="cb-warn">
              <For each={warnings()}>{(w) => <li>{w}</li>}</For>
            </ul>
          </Show>
          <Show when={pendingZones()?.length}>
            <p class="cb-warn">
              Zones and excluded regions waiting to be placed: {pendingZones()!.length}. Outline the
              arena, or use a blank arena, under Spatial setup.
            </p>
          </Show>
          <Show when={r()!.unknown.length}>
            <p class="cb-warn">
              Not part of the framework's config, so ignored here, and the framework would refuse
              the file: <For each={r()!.unknown}>{(k) => <code>{k} </code>}</For>
            </p>
          </Show>
          <details>
            <summary>What was read</summary>
            <p>
              Filled in: <For each={r()!.read}>{(k) => <code>{k} </code>}</For>
            </p>
            <Show when={r()!.kept.length}>
              <p>
                Kept but not used by CaBaNA; written back unchanged when the config is downloaded:{' '}
                <For each={r()!.kept}>{(k) => <code>{k.path.join('.')} </code>}</For>
              </p>
            </Show>
          </details>
        </div>
      </div>
    </Show>
  );
}
