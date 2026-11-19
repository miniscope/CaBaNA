// The run picker of the Results window: a button with the run's date and a menu of the analysis's
// runs (settings status, type and headline on a second line), ending in Compare settings with….

import { createResource, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { SettingsPill } from '../../components/Pill.tsx';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { matchOfRecord } from '../../lib/results-match.ts';
import { formatWhen } from '../../lib/results-overview.ts';
import { isNewestOfType, settingsStatus } from '../../lib/results-runs.ts';
import { headlineOf, reasonText } from '../../lib/results-table.ts';
import { runType } from '../../lib/preview.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { savedData } from './run-data.ts';

function RunRow(props: {
  run: RunRecord;
  records: RunRecord[];
  current: boolean;
  onPick: () => void;
}): JSX.Element {
  const r = () => props.run;
  const newest = () => isNewestOfType(r(), props.records);
  const [match] = createResource(
    () => r(),
    (x) => matchOfRecord(x, newest()).catch(() => undefined),
  );
  const [headline] = createResource(
    () => r(),
    async (x) => {
      try {
        return headlineOf(x.analysis as AnalysisId, await savedData(x));
      } catch {
        return undefined;
      }
    },
  );
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.current}
      class="cb-rp__row"
      onClick={() => props.onPick()}
    >
      <span class="cb-rp__top">
        <span class="cb-rp__mark" aria-hidden="true">
          {props.current ? '✓' : ''}
        </span>
        {formatWhen(r().created_utc)}
        <SettingsPill
          status={settingsStatus(r(), newest(), match())}
          reason={match() && !match()!.matches ? reasonText(match()!.diff) : undefined}
        />
      </span>
      <span class="cb-muted cb-rp__sub">
        {runType(r()).text}
        {headline() ? ` · ${headline()}` : ''}
      </span>
    </button>
  );
}

export function RunPicker(props: {
  runs: RunRecord[];
  records: RunRecord[];
  current: RunRecord;
  onPick: (r: RunRecord) => void;
  onCompare: () => void;
}): JSX.Element {
  let root!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const outside = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', outside, true);
  onCleanup(() => document.removeEventListener('pointerdown', outside, true));
  return (
    <div
      class="cb-rp"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open()) {
          e.preventDefault(); // the window behind does not close with it
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        class="cb-rp__btn"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label="Run"
        onClick={() => setOpen(!open())}
      >
        {formatWhen(props.current.created_utc)} <span aria-hidden="true">▾</span>
      </button>
      <Show when={open()}>
        <div class="cb-rp__menu" role="menu" aria-label="Runs">
          <For each={props.runs}>
            {(r) => (
              <RunRow
                run={r}
                records={props.records}
                current={r.run_id === props.current.run_id}
                onPick={() => {
                  setOpen(false);
                  props.onPick(r);
                }}
              />
            )}
          </For>
          <hr class="cb-menu__sep" />
          <button
            type="button"
            role="menuitem"
            class="cb-rp__row cb-rp__compare"
            onClick={() => {
              setOpen(false);
              props.onCompare();
            }}
          >
            Compare settings with…
          </button>
        </div>
      </Show>
    </div>
  );
}
