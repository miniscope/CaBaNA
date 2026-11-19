import { For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { placePopover } from '../parts.tsx';
import { runType } from '../../lib/preview.ts';
import { Pill, RunTypePill } from '../../components/Pill.tsx';

export interface Match {
  matches: boolean;
  diff: string[];
}

const when = (utc: string | null) =>
  utc ? new Date(utc).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

/**
 * The state of a result, as separate badges: its Type (Full analysis or Preview, with the shuffle
 * count) and whether it matches the current settings are different properties and never share one.
 */
export function RunBadges(props: {
  record: RunRecord;
  match?: Match;
  saved?: boolean;
}): JSX.Element {
  const r = () => props.record;
  return (
    <span class="cb-rb-badges">
      <Show when={r().status === 'ok' || r().scope === 'preview'}>
        <RunTypePill type={runType(r())} />
      </Show>
      <Show when={r().status === 'partial'}>
        <Pill tone="flag">Partial: some analyses failed</Pill>
      </Show>
      <Show when={r().status === 'cancelled'}>
        <Pill tone="flag">Cancelled: partial results</Pill>
      </Show>
      <Show when={r().status === 'failed'}>
        <Pill tone="fail">Failed</Pill>
      </Show>
      <Show when={r().status === 'ok' || r().status === 'partial' ? props.match : undefined}>
        {(m) => (
          <Pill tone={m().matches ? 'ok' : 'flag'}>
            {m().matches ? 'Current' : r().scope === 'preview' ? 'Older settings' : 'Needs rerun'}
          </Pill>
        )}
      </Show>
      <Show when={props.saved}>
        <Pill>Saved result</Pill>
      </Show>
    </span>
  );
}

/** Header of a results view: when it was made, its badges, and what changed since. */
export function RunBanner(props: {
  record: RunRecord;
  match?: Match;
  saved?: boolean;
  offline?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-rb">
      <div class="cb-rb__row">
        <span class="cb-muted">{when(props.record.created_utc)}</span>
        <RunBadges record={props.record} match={props.match} saved={props.saved} />
        <Show when={props.offline}>
          <Pill title="The Python engine is not running; values come from the copy saved in this browser">
            Viewing the saved copy
          </Pill>
        </Show>
        <Show when={props.match && !props.match.matches && props.match.diff.length}>
          <details class="cb-rb__diff cb-notepop" onToggle={placePopover}>
            <summary>What changed ({props.match!.diff.length})</summary>
            <div>
              <ul>
                <For each={props.match!.diff}>{(d) => <li>{d}</li>}</For>
              </ul>
            </div>
          </details>
        </Show>
        <span class="cb-rb__side">{props.children}</span>
      </div>
    </div>
  );
}
