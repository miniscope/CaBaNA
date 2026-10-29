import { createEffect, createSignal, For, Show, type JSX } from 'solid-js';
import type { ColumnRole } from '../lib/frame-labels.ts';
import {
  activeLabel,
  blockedReason,
  clampPage,
  columnSample,
  conflictSummary,
  oneSourceText,
  pageSlice,
  setReviewingConflicts,
  shortName,
  showLabel,
} from '../lib/label-view.ts';
import {
  frameAgreement,
  frameLabelData,
  frameLabelsOnCamera,
  frameMapping,
  frameRoles,
  frameTable,
  labelRegistry,
  resetFrameRoles,
  setFrameRole,
} from '../lib/store.ts';
import { InfoTip } from './InfoTip.tsx';
import { LabelPager, useRowsFit } from './LabelPager.tsx';

const MAX_PER_PAGE = 12;

const ROLES: [Exclude<ColumnRole, 'frame'>, string][] = [
  ['signal', 'Signal'],
  ['binary', 'Binary label (0/1)'],
  ['categorical', 'Categorical label'],
  ['ignore', 'Ignore'],
];

/** Import mapping for the loaded frame-label file: what each column is, and the conflicts that follow from it. */
export function FrameLabelMapping(): JSX.Element {
  const [page, setPage] = createSignal(0);
  // Head, header row, pager, summary and the Load data bottom bar take about 330 px.
  const { rows: perPage, ref: fitRef } = useRowsFit(MAX_PER_PAGE, 330);
  const columns = () => frameTable()?.columns ?? [];
  const frameColumn = () => frameMapping().frameColumn;
  const sample = (i: number) => columnSample(frameTable()!.rows.map((r) => r[i] ?? ''));
  const rows = () => columns().map((name, i) => ({ name, i }));
  const visible = () => pageSlice(rows(), page(), perPage());

  // Open the page holding the column of the label that was linked to.
  createEffect(() => {
    const at = columns().indexOf(activeLabel()?.name ?? '');
    if (at >= 0) setPage(Math.floor(at / perPage()));
  });

  // A label that is both a binary column and a category appears twice; its reason is the same.
  const reasons = () => [
    ...new Set(
      labelRegistry()
        .filter((e) => e.source.startsWith('frame_') && e.blocked)
        .map((e) => blockedReason(e, frameAgreement())),
    ),
  ];
  const conflicts = () => conflictSummary(frameAgreement());
  const labelCount = (kind: 'binary' | 'categorical') => frameMapping()[kind].length;

  return (
    <Show
      when={frameTable()}
      fallback={<p class="cb-muted">The file could not be read as a table.</p>}
    >
      <div class="cb-lbl-map" ref={fitRef}>
        <div class="cb-lbl-map__head">
          <label class="cb-lbl-inline">
            Frame column
            <select
              class="cb-lbl-select"
              aria-label="Frame column"
              value={frameColumn()}
              onChange={(e) => setFrameRole(e.currentTarget.value, 'frame')}
            >
              <Show when={!frameColumn()}>
                <option value="" disabled>
                  Choose a column
                </option>
              </Show>
              <For each={columns()}>{(c) => <option value={c}>{c}</option>}</For>
            </select>
          </label>
          <InfoTip label="About the import mapping">
            Roles are suggested from the values: text is categorical, only 0, 1 or blank is binary,
            other numbers are signals. Change a role if the guess is wrong. Rows are matched to
            camera frames by frame number; frames missing from the file are unscored.
          </InfoTip>
          <span class="cb-spacer" />
          <button class="btn-secondary btn-small" onClick={resetFrameRoles}>
            Reset to suggested
          </button>
        </div>

        <table class="cb-lbl-table cb-lbl-table--map">
          <thead>
            <tr>
              <th>Column</th>
              <th>Values</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            <For each={visible()}>
              {(c) => (
                <tr classList={{ 'cb-lbl-row--on': activeLabel()?.name === c.name }}>
                  <td class="cb-lbl-name" title={c.name}>
                    {shortName(c.name, 22)}
                  </td>
                  <td class="cb-muted cb-lbl-name" title={sample(c.i)}>
                    {sample(c.i)}
                  </td>
                  <td>
                    <Show
                      when={c.name !== frameColumn()}
                      fallback={<span class="cb-lbl-fixed">Frame number</span>}
                    >
                      <select
                        class="cb-lbl-select"
                        aria-label={`Role of ${c.name}`}
                        value={frameRoles()[c.name] ?? 'ignore'}
                        onChange={(e) => setFrameRole(c.name, e.currentTarget.value as ColumnRole)}
                      >
                        <For each={ROLES}>{([v, t]) => <option value={v}>{t}</option>}</For>
                      </select>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <LabelPager
          page={clampPage(page(), columns().length, perPage())}
          total={columns().length}
          perPage={perPage()}
          noun="columns"
          extra={
            <button
              class="cb-linkbtn"
              onClick={() =>
                showLabel(
                  'setup',
                  activeLabel()?.name ??
                    labelRegistry().find((e) => e.source.startsWith('frame_'))?.name ??
                    '',
                )
              }
            >
              Set role in Experimental setup →
            </button>
          }
          onPage={setPage}
        />

        <Show when={frameLabelData()?.errors.length}>
          <For each={frameLabelData()!.errors}>{(e) => <p class="cb-error">{e}</p>}</For>
        </Show>
        <Show when={frameLabelData() && !frameLabelData()!.errors.length}>
          <div class="cb-lbl-summary">
            <p class="cb-muted">
              {labelCount('binary')} binary, {labelCount('categorical')} categorical,{' '}
              {frameMapping().signals.length} signal columns.
              <Show when={frameLabelsOnCamera()}>
                {(j) => (
                  <>
                    {' '}
                    {j().unscored.toLocaleString()} camera frames are unscored (not in the file).
                    {j().notInCamera ? ` ${j().notInCamera} rows are not camera frames.` : ''}
                  </>
                )}
              </Show>{' '}
              {oneSourceText(frameAgreement())}
            </p>
            <Show
              when={conflicts()}
              fallback={<p class="cb-muted">No conflicts between binary and categorical labels.</p>}
            >
              <p class="cb-error cb-lbl-conflict">
                <span>{conflicts()}</span>
                <button class="btn-secondary btn-small" onClick={() => setReviewingConflicts(true)}>
                  Review conflicts
                </button>
              </p>
            </Show>
            <For each={reasons()}>{(r) => <p class="cb-warn cb-lbl-reason">Blocked: {r}</p>}</For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
