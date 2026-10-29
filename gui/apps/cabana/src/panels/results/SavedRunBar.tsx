import { Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { openRunOf } from '../../lib/results-nav.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { PopButton } from '../QcParts.tsx';
import { RunBadges } from './RunBanner.tsx';

/**
 * Shown while an older saved result is open. Viewing it never changes the current settings;
 * "Load these settings" is a separate, explicit action.
 */
export function SavedRunBar(props: {
  analysis: AnalysisId;
  record: RunRecord;
  onLoadSettings?: () => void;
}): JSX.Element {
  return (
    <div class="cb-srb" role="status">
      <span>
        Viewing a saved result from{' '}
        {new Date(props.record.created_utc).toLocaleString([], {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        . Your current settings are unchanged.
      </span>
      <RunBadges record={props.record} />
      <span class="cb-srb__side">
        <PopButton
          label="Settings used"
          title="Settings used"
          width={420}
          class="btn-secondary"
          button="Settings used"
        >
          <pre class="cb-rd__pre">
            {JSON.stringify(
              (props.record.gui.settings as { analysis?: unknown })?.analysis ??
                props.record.gui.settings,
              null,
              1,
            )}
          </pre>
        </PopButton>
        <Show when={props.onLoadSettings}>
          <button
            type="button"
            class="btn-secondary"
            title="Copies these settings into the setup. Results from the current settings then show as changed."
            onClick={props.onLoadSettings}
          >
            Load these settings
          </button>
        </Show>
        <button
          type="button"
          class="btn-primary"
          onClick={() => openRunOf(props.analysis, undefined)}
        >
          Back to latest
        </button>
      </span>
    </div>
  );
}
