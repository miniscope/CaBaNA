import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { aurocData, aurocSettings, seedAurocSelection } from '../lib/auroc-run.ts';
import { behaviorDecoding, decodeTarget } from '../lib/decoding-settings.ts';
import type { LabelRole } from '../lib/labels.ts';
import {
  activeLabel,
  blockedReason,
  clampPage,
  countText,
  pageSlice,
  selectedIn,
  selectedInText,
  shortName,
  showLabel,
  sourceText,
  takeFocus,
  type Selection,
} from '../lib/label-view.ts';
import { pethData, pethSettings, seedPethSelection } from '../lib/peth-run.ts';
import { populationSettings } from '../lib/population-settings.ts';
import { setSetupCard } from '../lib/setup-status.ts';
import { annotationResults, frameAgreement, labelRegistry, roleOf, setRole } from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { LabelPager, useRowsFit } from './LabelPager.tsx';

/** Which view of the Stimuli & cues card is open: the stimulus list or the label roles. */
export const [stimuliView, setStimuliView] = createSignal<'stimuli' | 'roles'>('stimuli');

const MAX_PER_PAGE = 10;
const ROW_PX = 28;

/** The labels the behavior analyses see: epoch labels of the behavior annotation file. */
const behaviorLabels = () => {
  const a = annotationResults().find((r) => r.id === 'behavior_annotations');
  return a && !a.error ? [...new Set(a.epochs.map((e) => e.label))] : [];
};

/** What each analysis has selected right now, read from the analyses' own settings. */
function currentSelections(): Selection[] {
  const names = labelRegistry()
    .filter((e) => !e.blocked && e.source !== 'markers')
    .map((e) => e.name);
  return [
    { analysis: 'auROC', available: behaviorLabels(), exclude: [...aurocSettings.unselected] },
    { analysis: 'PETH', available: behaviorLabels(), exclude: [...pethSettings.unselected] },
    ...(populationSettings.target === 'behaviors'
      ? [{ analysis: 'Population activity', available: names, include: [...populationSettings.labels] }]
      : []),
    ...(decodeTarget.type === 'behaviors'
      ? [{ analysis: 'Decoding', available: names, include: [...behaviorDecoding.labels] }]
      : []),
  ];
}

/** The explanation of roles, shown beside the view tabs. */
export const RolesHelp = (): JSX.Element => (
  <InfoTip label="About label roles">
    A role only sets the default selection: auROC preselects measured labels and PETH preselects
    controlled ones. It never decides whether a label can be used. Selected in shows where the label
    is selected right now.
  </InfoTip>
);

/** Every loaded label with its source, role and where it is selected. Roles only set the starting selection. */
export function LabelRoles(): JSX.Element {
  const [page, setPage] = createSignal(0);
  const { rows: perPage, ref: fitRef } = useRowsFit(MAX_PER_PAGE, 155, ROW_PX, 4);
  let wrap!: HTMLDivElement;
  const rows = createMemo(() => labelRegistry());
  const selections = createMemo(currentSelections);
  // Start from the same defaults the auROC and PETH pages use, even if they were never opened.
  createEffect(() => {
    const a = aurocData();
    if (!('error' in a)) seedAurocSelection(a);
    const p = pethData();
    if (!('error' in p)) seedPethSelection(p.labels);
  });
  const where = (name: string, blocked: boolean) => (blocked ? [] : selectedIn(name, selections()));

  // A link from Load data: open this section, show the page with the label, and scroll to it.
  createEffect(() => {
    const f = takeFocus('setup');
    if (!f) return;
    setSetupCard('stimuli');
    setStimuliView('roles');
    const at = rows().findIndex((e) => e.name === f.name && (!f.file || e.file === f.file));
    if (at >= 0) setPage(Math.floor(at / perPage()));
    queueMicrotask(() => {
      wrap?.querySelector('.cb-lbl-row--on')?.scrollIntoView({ block: 'nearest' });
    });
  });

  return (
    <div
      class="cb-lbl-roles"
      ref={(e) => {
        wrap = e;
        fitRef(e);
      }}
    >
      <Show
        when={rows().length}
        fallback={
          <p class="cb-muted">
            No labels loaded. Add annotation, time-marker or frame-label files on Load data.
          </p>
        }
      >
        <table class="cb-lbl-table cb-lbl-table--roles">
          <thead>
            <tr>
              <th>Label</th>
              <th>Source</th>
              <th>Count</th>
              <th>Role</th>
              <th>Selected in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <For each={pageSlice(rows(), page(), perPage())}>
              {(e) => (
                <tr classList={{ 'cb-lbl-row--on': activeLabel()?.name === e.name }}>
                  <td class="cb-lbl-name">
                    <button
                      class="cb-linkbtn"
                      title={`${e.name}: review in Load data`}
                      onClick={() => showLabel('load', e.name, e.file)}
                    >
                      {shortName(e.name, 22)}
                    </button>
                  </td>
                  <td class="cb-lbl-name" title={`${e.file}, ${sourceText(e.source)}`}>
                    {shortName(e.file, 18)}
                    <span class="cb-muted"> · {sourceText(e.source)}</span>
                  </td>
                  <td>{countText(e)}</td>
                  <td>
                    <select
                      class="cb-lbl-select"
                      aria-label={`Role of ${e.name}`}
                      value={roleOf(e.name)}
                      onChange={(ev) => setRole(e.name, ev.currentTarget.value as LabelRole)}
                    >
                      <option value="measured">Measured</option>
                      <option value="controlled">Controlled</option>
                    </select>
                  </td>
                  <td
                    class="cb-lbl-name"
                    classList={{ 'cb-muted': !where(e.name, e.blocked).length }}
                    title={selectedInText(where(e.name, e.blocked))}
                  >
                    {selectedInText(where(e.name, e.blocked))}
                  </td>
                  <td>
                    <Show
                      when={e.blocked}
                      fallback={
                        <span
                          class={e.problems.length ? 'cb-warn' : 'cb-muted'}
                          title={e.problems.join(' ')}
                        >
                          {e.problems.length ? 'Note' : 'Ready'}
                        </span>
                      }
                    >
                      <span class="cb-error" title={blockedReason(e, frameAgreement())}>
                        Blocked
                      </span>{' '}
                      <button
                        class="cb-linkbtn"
                        title={blockedReason(e, frameAgreement())}
                        onClick={() => showLabel('load', e.name, e.file)}
                      >
                        Review in Load data
                      </button>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <LabelPager
          page={clampPage(page(), rows().length, perPage())}
          total={rows().length}
          perPage={perPage()}
          noun="labels"
          onPage={setPage}
        />
      </Show>
    </div>
  );
}
