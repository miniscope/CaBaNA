import { For, Show, type JSX } from 'solid-js';
import { pendingZones } from '../lib/arena.ts';
import { configReport } from '../lib/config-import.ts';
import { SLOTS, type SlotId } from '../lib/slots.ts';
import { configFiles, goToStep, loaded } from '../lib/store.ts';
import { PopButton } from './QcParts.tsx';

const label = (id: SlotId) => SLOTS.find((s) => s.id === id)?.label ?? id;

/** The file the loaded config names for a slot, when a different file (or none) is loaded there. */
export function fileMismatch(id: SlotId): string | undefined {
  const want = configReport() && configFiles()[id];
  return want && loaded[id]?.name !== want ? want : undefined;
}

/** A setup problem: a short title for the summary, and the full sentence for the list. */
export interface SetupItem {
  short: string;
  text: string;
}

/** Everything about the setup that needs the user's attention, most actionable first. */
export function setupItems(): SetupItem[] {
  const r = configReport();
  if (!r) return [];
  const zones = pendingZones()?.length;
  const files = SLOTS.flatMap((s) => {
    const want = fileMismatch(s.id);
    if (!want) return [];
    const got = loaded[s.id]?.name;
    return [
      {
        short: `${label(s.id)}: file differs from config`,
        text: `${label(s.id)}: the config names ${want}, but ${got ? `${got} is loaded` : 'it is not loaded'}.`,
      },
    ];
  });
  return [
    ...(zones
      ? [
          {
            short: 'Arena outline needed',
            text: `Zones and excluded regions waiting to be placed: ${zones}. Outline the arena, or use a blank arena, under Spatial setup.`,
          },
        ]
      : []),
    ...files,
    ...r.problems.map((p) => ({ short: p, text: p })),
    ...(r.unknown.length
      ? [
          {
            short: 'Unknown config keys ignored',
            text: `Not part of the framework's config, so ignored here, and the framework would refuse the file: ${r.unknown.join(', ')}.`,
          },
        ]
      : []),
  ];
}

/** What the loaded config.yaml filled in, and everything in it that is missing, wrong or unused. */
export function ConfigReport(): JSX.Element {
  const r = () => configReport()!;
  return (
    <div class="cb-config-report">
      <p class="cb-muted">
        {r().read.length} settings were filled in from {loaded.config?.name ?? 'config.yaml'}.
        Anything changed by hand afterwards replaces them.
      </p>
      <Show when={setupItems().length}>
        <ul class="cb-warn">
          <For each={setupItems()}>{(w) => <li>{w.text}</li>}</For>
        </ul>
      </Show>
      <p>
        <b>Filled in:</b> <For each={r().read}>{(k) => <code>{k} </code>}</For>
      </p>
      <Show when={r().kept.length}>
        <p>
          <b>Kept but not used by CaBaNA</b> (written back unchanged when the config is downloaded):{' '}
          <For each={r().kept}>{(k) => <code>{k.path.join('.')} </code>}</For>
        </p>
      </Show>
    </div>
  );
}

/** The two-part box under the file list: what the config set, and the first setup problem. */
export function ConfigSummary(): JSX.Element {
  const items = setupItems;
  return (
    <div class="cb-cfgsum">
      <div class="cb-cfgsum__part">
        <Show
          when={configReport()}
          fallback={
            <>
              <strong>
                {loaded.config ? 'Settings entered by hand' : 'No configuration file'}
              </strong>
              <span class="cb-muted">
                {loaded.config
                  ? 'Arena and timing settings come from Experimental setup.'
                  : 'Load config.yaml, or enter the settings in Experimental setup.'}
              </span>
            </>
          }
        >
          <strong>Configuration loaded</strong>
          <span class="cb-muted">
            {configReport()!.read.length} settings applied to Experimental setup
          </span>
        </Show>
      </div>
      <div class="cb-cfgsum__part">
        <Show
          when={items().length}
          fallback={
            <>
              <strong>Setup</strong>
              <span class="cb-muted">
                {configReport() ? 'Nothing in the config needs attention.' : 'Not checked yet.'}
              </span>
            </>
          }
        >
          <strong class="cb-warn" title={items()[0].text}>
            ⚠ {items()[0].short}
          </strong>
          <span class="cb-muted">
            {items().length} {items().length === 1 ? 'warning' : 'warnings'} ·{' '}
            <PopButton
              label="Review all warnings"
              title="Configuration warnings"
              width={460}
              class="cb-linkbtn"
              button="Review all warnings"
            >
              {(close) => (
                <>
                  <ConfigReport />
                  <button
                    class="btn-primary btn-small"
                    onClick={() => {
                      close();
                      goToStep('setup');
                    }}
                  >
                    Open Experimental setup →
                  </button>
                </>
              )}
            </PopButton>
          </span>
        </Show>
      </div>
    </div>
  );
}
