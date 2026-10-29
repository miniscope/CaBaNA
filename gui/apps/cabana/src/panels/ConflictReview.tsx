import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import {
  blockedReason,
  clampPage,
  conflictRows,
  frameTime,
  pageSlice,
  setReviewingConflicts,
  shortName,
} from '../lib/label-view.ts';
import {
  cameraClock,
  cameraFrameNumbers,
  frameAgreement,
  frameLabelData,
  goToStep,
  labelRegistry,
} from '../lib/store.ts';
import { mss, setHoverT, setWinStartClamped, win } from '../lib/viz.ts';
import { LabelPager } from './LabelPager.tsx';

const PER_PAGE = 50;

/** Moves the shared session window so the time is in its middle, puts the cursor there, and opens Data visualization. */
function showOnTimeline(t: number): void {
  const half = (win()[1] - win()[0]) / 2;
  setWinStartClamped(t - half);
  setHoverT(t);
  goToStep('viz');
}

/** Frame-level detail of the binary/categorical conflicts, one row per frame, with a link to each on the timeline. */
export function ConflictReview(): JSX.Element {
  const [page, setPage] = createSignal(0);
  const [only, setOnly] = createSignal('');
  const labels = () => frameAgreement().filter((a) => a.conflicts > 0);
  const rows = createMemo(() => {
    const d = frameLabelData();
    if (!d || d.errors.length) return [];
    const names = only() ? [only()] : labels().map((a) => a.label);
    return conflictRows(d.frames, d.binary, d.categorical, names);
  });
  const timeOf = (frame: number) => frameTime(frame, cameraFrameNumbers(), cameraClock());
  const reasons = () => [
    ...new Set(
      labelRegistry()
        .filter((e) => e.blocked && e.source.startsWith('frame_'))
        .map((e) => blockedReason(e, frameAgreement())),
    ),
  ];
  const current = () => clampPage(page(), rows().length, PER_PAGE);

  return (
    <section class="cb-lbl-review" aria-label="Review conflicts">
      <div class="cb-lbl-review__head">
        <button class="btn-secondary btn-small" onClick={() => setReviewingConflicts(false)}>
          ‹ Back to Load data
        </button>
        <h3>Review conflicts</h3>
        <span class="cb-muted">
          {rows().length.toLocaleString()} {rows().length === 1 ? 'frame' : 'frames'} where the
          binary column and the categorical column disagree
        </span>
        <span class="cb-spacer" />
        <Show when={labels().length > 1}>
          <label class="cb-lbl-inline">
            Label
            <select
              class="cb-lbl-select"
              value={only()}
              onChange={(e) => {
                setOnly(e.currentTarget.value);
                setPage(0);
              }}
            >
              <option value="">All labels</option>
              <For each={labels()}>{(a) => <option value={a.label}>{a.label}</option>}</For>
            </select>
          </label>
        </Show>
      </div>
      <For each={reasons()}>{(r) => <p class="cb-warn cb-lbl-reason">Blocked: {r}</p>}</For>
      <Show
        when={rows().length}
        fallback={<p class="cb-muted">No conflicts. Go back to Load data.</p>}
      >
        <div class="cb-lbl-review__table">
          <table class="cb-lbl-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Frame</th>
                <th>Time</th>
                <th>Binary column</th>
                <th>Categorical column</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={pageSlice(rows(), current(), PER_PAGE)}>
                {(r) => (
                  <tr>
                    <td class="cb-lbl-name" title={r.label}>
                      {shortName(r.label, 24)}
                    </td>
                    <td>{r.frame}</td>
                    <td>{timeOf(r.frame) === undefined ? '—' : mss(timeOf(r.frame)!)}</td>
                    <td>
                      {r.label} = {r.binary}
                    </td>
                    <td>{r.categorical}</td>
                    <td>
                      <Show
                        when={timeOf(r.frame) !== undefined}
                        fallback={
                          <span class="cb-muted" title="The frame is not in the camera timestamps.">
                            No time
                          </span>
                        }
                      >
                        <button class="cb-linkbtn" onClick={() => showOnTimeline(timeOf(r.frame)!)}>
                          Show on timeline
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <LabelPager
          page={current()}
          total={rows().length}
          perPage={PER_PAGE}
          noun="conflicts"
          onPage={setPage}
        />
      </Show>
    </section>
  );
}
