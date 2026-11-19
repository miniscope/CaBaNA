// "View results ▾": the saved runs of one analysis, latest first, each with its settings status,
// type and headline; choosing one opens it in the Results window. The last item opens the whole
// list (Previous results). Disabled until the analysis has a run. Used by the Analysis cards and
// the Results page. A menu of its own because its rows hold pills and two lines.

import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { SettingsPill } from '../components/Pill.tsx';
import { openAnalysisWindow } from '../lib/analysis-window.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import { stepFocus } from '../lib/actions-menu.ts';
import { resultIndex } from '../lib/result-index.ts';
import { hasResults, shortWhen } from '../lib/results-overview.ts';
import { openExplorer } from '../lib/results-nav.ts';
import { isNewestOfType, runType, settingsStatus } from '../lib/results-runs.ts';
import { headlineOf } from '../lib/results-table.ts';
import { newestMatches } from '../lib/run-match.ts';
import type { AnalysisId } from '../lib/runs.ts';
import { savedData } from './results/run-data.ts';

/** Runs listed before "All previous results…". */
const SHOWN = 6;
const ROWS = '[role="menuitem"]';
export const NO_RESULTS_TIP = 'No results yet: run the analysis first';

function Row(props: {
  record: RunRecord;
  latest: boolean;
  settings: JSX.Element;
  onPick: () => void;
}): JSX.Element {
  const [headline] = createResource(
    () => props.record,
    async (r) => {
      try {
        return headlineOf(r.analysis as AnalysisId, await savedData(r));
      } catch {
        return undefined;
      }
    },
  );
  const type = () => runType(props.record).text;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      class="cb-menu__row cb-vr__row"
      onClick={() => props.onPick()}
    >
      <span class="cb-vr__line">
        <Show when={props.latest}>
          <b>Latest</b>
          <span class="cb-vr__dot" aria-hidden="true">
            ·
          </span>
        </Show>
        <span>{shortWhen(props.record.created_utc)}</span>
        <span class="cb-vr__pill">{props.settings}</span>
      </span>
      <span class="cb-menu__sub">
        {type()}
        {headline() ? ` · ${headline()}` : ''}
      </span>
    </button>
  );
}

export function ViewResultsMenu(props: { analysis: AnalysisId }): JSX.Element {
  let button!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  // One menu per analysis: the id never changes while it is mounted.
  // eslint-disable-next-line solid/reactivity
  const analysis = props.analysis;
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ left: 0, top: 0 });

  const runs = createMemo(() =>
    resultIndex().filter((r) => r.analysis === analysis && r.status === 'ok' && hasResults(r)),
  );
  const matches = newestMatches(analysis);
  const statusOf = (r: RunRecord) =>
    settingsStatus(r, isNewestOfType(r, runs()), matches().get(r.run_id));

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.focus();
  };
  const place = () => {
    if (!menu) return;
    const a = button.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const up = innerHeight - a.bottom < h + 12 && a.top > innerHeight - a.bottom;
    setPos({
      left: Math.min(Math.max(8, a.left), innerWidth - w - 8),
      top: up ? Math.max(8, a.top - 4 - h) : a.bottom + 4,
    });
  };
  const outside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!menu?.contains(t) && !button.contains(t)) close(false);
  };
  const toggle = () => {
    if (open()) return close();
    setOpen(true);
    document.addEventListener('pointerdown', outside, true);
    addEventListener('resize', place);
    requestAnimationFrame(() => {
      place();
      menu?.querySelector<HTMLElement>(ROWS)?.focus();
    });
  };
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', place);
  });
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
    else {
      const rows = Array.from(menu!.querySelectorAll<HTMLElement>(ROWS));
      const next = stepFocus(
        rows.indexOf(document.activeElement as HTMLElement),
        rows.length,
        e.key,
      );
      if (next !== null) {
        e.preventDefault();
        rows[next]?.focus();
      }
    }
  };
  const pick = (r: RunRecord) => {
    close(false);
    openExplorer(analysis, r.run_id);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class="btn-secondary btn-small"
        aria-haspopup="menu"
        aria-expanded={open()}
        disabled={!runs().length}
        title={runs().length ? undefined : NO_RESULTS_TIP}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open()) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        View results ▾
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class="cb-menu cb-vr"
            style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
            onKeyDown={key}
          >
            <div class="cb-menu__panel" role="menu" aria-label="View results">
              <For each={runs().slice(0, SHOWN)}>
                {(r, i) => (
                  <Row
                    record={r}
                    latest={i() === 0}
                    settings={<SettingsPill status={statusOf(r)} />}
                    onPick={() => pick(r)}
                  />
                )}
              </For>
              <hr class="cb-menu__sep" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                class="cb-menu__row"
                onClick={() => {
                  close(false);
                  openAnalysisWindow(analysis, 'previous');
                }}
              >
                All previous results…
              </button>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
