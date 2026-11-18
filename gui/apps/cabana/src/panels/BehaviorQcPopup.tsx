// Behavior and position · QC in the shared pop-up frame: the flags of the annotation files, the
// epochs plot with the two limits marked, and the merge / remove fixes as sliders with live
// counts. Ticked fixes run on Apply changes through editAnnotations, as before.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { FlagsBox, QcPopup, SideHead } from '../components/QcPopup.tsx';
import { SliderNumber } from '../components/SliderNumber.tsx';
import { fixCounts, marksFor } from '../lib/behavior-marks.ts';
import {
  annotationPlan,
  pendingAnnotations,
  startAnnotationDraft,
  type AnnotationDraft,
} from '../lib/qc-draft.ts';
import { itemFlagLines } from '../lib/qc-flags.ts';
import { closeQcPopup, markPopupReviewed } from '../lib/qc-popup-view.ts';
import {
  annotationLog,
  annotationResults,
  editAnnotations,
  sessionDuration,
  setTol,
  tol,
  undoAnnotationEdits,
} from '../lib/store.ts';
import { DEFAULT_TOL } from '../lib/store.ts';
import { flaggedOf, PALETTE, ticks } from './BehaviorQc.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Help, PlotCard } from './QcParts.tsx';

const LABEL_W = 150;
const ROW = 22;
const W = 760;

/** One row per label of every annotation file: bouts, red boxes for short ones, rings for close gaps. */
function EpochRows(props: { draft: AnnotationDraft; width: number }): JSX.Element {
  const files = () => annotationResults().filter((a) => !a.error);
  const end = () =>
    sessionDuration() ?? Math.max(1, ...files().flatMap((a) => a.epochs.map((e) => e.stop)));
  const x = (t: number) => LABEL_W + (t / end()) * (W - LABEL_W);
  const rows = createMemo(() =>
    files().flatMap((a) => {
      const marks = marksFor(a.epochs, props.draft.minBoutS, props.draft.mergeGapS);
      return [...new Set(a.epochs.map((e) => e.label))].map((label) => ({
        label: files().length > 1 ? `${label} (${a.name})` : label,
        epochs: a.epochs.filter((e) => e.label === label),
        short: new Set(marks.short),
        closeStarts: new Set(marks.closeStarts),
      }));
    }),
  );
  const height = () => rows().length * ROW + 24;
  return (
    <svg
      viewBox={`0 0 ${W} ${height()}`}
      style={{ width: '100%', 'max-height': `${height() * 1.6}px` }}
      role="img"
      aria-label="Epochs of every label over the whole session"
    >
      <For each={rows()}>
        {(r, i) => (
          <g>
            <text x="0" y={i() * ROW + 13} font-size="11" fill="#616161">
              {r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}
            </text>
            <For each={r.epochs}>
              {(e) => (
                <>
                  <rect
                    x={x(e.start)}
                    y={i() * ROW + 3}
                    width={Math.max(2, x(e.stop) - x(e.start))}
                    height={12}
                    fill={PALETTE[i() % PALETTE.length]}
                  />
                  <Show when={r.short.has(e)}>
                    <rect
                      x={x(e.start) - 2}
                      y={i() * ROW}
                      width={Math.max(2, x(e.stop) - x(e.start)) + 4}
                      height={18}
                      fill="none"
                      stroke="#c62828"
                      stroke-width="1.5"
                    />
                  </Show>
                  <Show when={r.closeStarts.has(e.start)}>
                    <circle
                      cx={x(e.start)}
                      cy={i() * ROW + 9}
                      r="5.5"
                      fill="none"
                      stroke="#1a1a1a"
                      stroke-width="1.5"
                    />
                  </Show>
                </>
              )}
            </For>
          </g>
        )}
      </For>
      <For each={ticks(0, end(), 6)}>
        {(t) => (
          <text x={x(t)} y={height() - 6} font-size="10" fill="#616161" text-anchor="middle">
            {t}
          </text>
        )}
      </For>
    </svg>
  );
}

export function BehaviorQcPopup(): JSX.Element {
  const [draft, setDraft] = createSignal(
    startAnnotationDraft({ mergeGapS: tol.mergeGapS, minBoutS: tol.minBoutS }),
  );
  const files = () => annotationResults().filter((a) => !a.error);
  const counts = createMemo(() =>
    fixCounts(
      files().map((a) => a.epochs),
      draft().mergeGapS,
      draft().minBoutS,
    ),
  );
  const earlier = () => annotationLog().length > 0;
  const pending = () => pendingAnnotations(draft(), counts(), earlier());
  const patch = (p: Partial<AnnotationDraft>) => setDraft({ ...draft(), ...p });

  const lines = createMemo(() => {
    const all = annotationResults();
    const many = all.length > 1;
    const items = all.flatMap((a) => [
      ...(a.error ? [{ title: `${a.name}: ${a.error}`, detail: '' }] : []),
      ...(flaggedOf(a.id).length
        ? [{ title: `${a.name}: ${flaggedOf(a.id).length} flagged epochs`, detail: '' }]
        : []),
    ]);
    const checks = all.flatMap((a) =>
      a.error ? [] : a.checks.map((c) => (many ? { ...c, title: `${c.title} (${a.name})` } : c)),
    );
    return itemFlagLines(items, checks);
  });
  const checkCount = () => annotationResults().reduce((n, a) => n + a.checks.length, 0);

  const done = () => markPopupReviewed('behavior-qc', 'behavior');
  const apply = () => {
    const plan = annotationPlan(draft(), counts(), earlier());
    if (plan.undo) undoAnnotationEdits();
    // The fixes run with the limits in QC settings, which the config also records, so the sliders set them.
    for (const f of plan.fixes) {
      setTol(f.kind === 'merge' ? 'mergeGapS' : 'minBoutS', f.limit);
      editAnnotations(f.kind);
    }
    done();
  };

  const fix = (
    kind: 'merge' | 'drop',
    label: string,
    max: number,
    step: number,
    help: string,
  ): JSX.Element => {
    const limit = () => (kind === 'merge' ? draft().mergeGapS : draft().minBoutS);
    const n = () => counts()[kind];
    return (
      <>
        <SliderNumber
          label={label}
          help={<InfoTip label={`About ${label.toLowerCase()}`}>{help}</InfoTip>}
          value={limit()}
          min={0}
          max={Math.max(max, limit())}
          step={step}
          unit="s"
          defaultText={`${kind === 'merge' ? DEFAULT_TOL.mergeGapS : DEFAULT_TOL.minBoutS} s`}
          onInput={(v) => patch(kind === 'merge' ? { mergeGapS: v } : { minBoutS: v })}
        />
        <label class="cb-qp__opt">
          <input
            type="checkbox"
            disabled={n() === 0}
            checked={(kind === 'merge' ? draft().merge : draft().drop) && n() > 0}
            onChange={(e) =>
              patch(
                kind === 'merge'
                  ? { merge: e.currentTarget.checked }
                  : { drop: e.currentTarget.checked },
              )
            }
          />
          {kind === 'merge' ? 'Merge' : 'Remove'} {n()} {n() === 1 ? 'bout' : 'bouts'}
        </label>
      </>
    );
  };

  return (
    <>
      <QcPopup
        kind="qc"
        settings="behavior"
        title="Behavior and position · QC"
        sub={
          lines().flags.length
            ? `annotation files · ${lines().flags.length} flagged`
            : 'annotation files · none flagged'
        }
        help={
          <Help k="What this is">
            The annotation checks and the epochs they read. Merge or remove short bouts for every
            annotation file; ticked fixes run on Actions, Apply changes and are undone in Changes.
            The annotation files themselves are not changed.
          </Help>
        }
        top={<FlagsBox flags={lines().flags} passed={lines().passed} />}
        right={
          <>
            <SideHead>fixes for all bouts</SideHead>
            {fix(
              'merge',
              'Merge bouts of one label closer than',
              2,
              0.1,
              'Bouts of one label that overlap or are closer than this are joined into one. Most likely one bout split by a pause in scoring.',
            )}
            {fix(
              'drop',
              'Remove bouts under',
              1,
              0.05,
              'Bouts shorter than this are dropped. Some behaviors really are brief, so check before removing.',
            )}
            <div class="cb-qp__small">
              Applies to every annotation file. Ticked fixes take effect on Actions, Apply changes.
              The annotation files are not changed.
            </div>
          </>
        }
        resetChecked={draft().restoreOriginal}
        onReset={(on) => patch({ restoreOriginal: on })}
        resetNote="Shows the annotations as loaded, without earlier merge or remove fixes. Takes effect on Apply changes."
        status={
          lines().flags.length
            ? `${lines().flags.length} flags · ${checkCount()} checks`
            : `Passed · ${checkCount()} checks`
        }
        pending={pending()}
        onApply={apply}
        onContinue={done}
        onClose={closeQcPopup}
      >
        <PlotCard
          title="Epochs over the session"
          help={
            <>
              <Help k="What is plotted">
                One row per label of every annotation file, one bar per bout, as annotated (after
                any fixes applied earlier).
              </Help>
              <Help k="Axes">Whole session in seconds, left to right.</Help>
              <Help k="Marks">
                Red boxes: bouts under the remove limit. Black rings: where a bout starts closer to
                the one before it than the merge limit. They move with the sliders.
              </Help>
            </>
          }
        >
          {() => (
            <Show
              when={files().length}
              fallback={<div class="cb-empty">Load annotation files to check them.</div>}
            >
              <EpochRows draft={draft()} width={W} />
            </Show>
          )}
        </PlotCard>
      </QcPopup>
    </>
  );
}
