import { For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { placePopover } from '../parts.tsx';

export interface Match {
  matches: boolean;
  diff: string[];
}

const when = (utc: string | null) =>
  utc ? new Date(utc).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

/**
 * The state of a result, as separate badges: how many shuffles it used (Preliminary or Full) and
 * whether it matches the current settings are different properties and never share a badge.
 */
export function RunBadges(props: {
  record: RunRecord;
  match?: Match;
  saved?: boolean;
}): JSX.Element {
  const r = () => props.record;
  return (
    <span class="cb-rb-badges">
      <Show when={r().scope === 'preview'}>
        <span class="cb-badge cb-badge--warn" title="Quick preview with reduced shuffles">
          Preliminary: 50 shuffles
        </span>
      </Show>
      <Show when={r().scope === 'full' && r().status === 'ok'}>
        <span class="cb-badge">Full analysis</span>
      </Show>
      <Show when={r().status === 'partial'}>
        <span class="cb-badge cb-badge--warn">Partial: some analyses failed</span>
      </Show>
      <Show when={r().status === 'cancelled'}>
        <span class="cb-badge cb-badge--warn">Cancelled: partial results</span>
      </Show>
      <Show when={r().status === 'failed'}>
        <span class="cb-badge cb-badge--bad">Failed</span>
      </Show>
      <Show when={r().status === 'ok' || r().status === 'partial' ? props.match : undefined}>
        {(m) => (
          <span
            class="cb-badge"
            classList={{ 'cb-badge--ok': m().matches, 'cb-badge--warn': !m().matches }}
          >
            {m().matches ? 'Matches current settings' : 'Settings changed since this run'}
          </span>
        )}
      </Show>
      <Show when={props.saved}>
        <span class="cb-badge">Saved result</span>
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
          <span
            class="cb-badge"
            title="The Python engine is not running; values come from the copy saved in this browser"
          >
            Viewing the saved copy
          </span>
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
