// Behavioral QC annotations: the epoch plot, per-label stats and the flagged-epoch list.
import { Show, type JSX } from 'solid-js';
import { denomText } from '../lib/metrics.ts';
import type { MetricCard } from '../components/MetricCards.tsx';
import { sessionDuration } from '../lib/store.ts';
import { picked, setPicked } from '../lib/qc-view.ts';
import { Advice, Help, PagedList, PlotCard, RailBox } from './QcParts.tsx';
import { AnnotationFixes, Ethogram, fileOf, StatsTable } from './BehaviorQc.tsx';

export const flaggedOf = (id: string) =>
  (fileOf(id)?.epochs ?? []).filter((e) => e.flags.length || e.notes.length);
const listIdOf = (id: string) => `epochs-${id}`;
const selOf = (id: string) => Math.min(picked[listIdOf(id)] ?? -1, flaggedOf(id).length - 1);

export function AnnotationPlot(props: { id: string; tab: string }): JSX.Element {
  const a = () => fileOf(props.id);
  return (
    <>
      <Show when={a()?.error}>
        <div class="cb-error">
          {a()!.name}: {a()!.error}
        </div>
      </Show>
      <Show when={a() && !a()!.error && props.tab === 'epochs'}>
        <PlotCard
          title="Epochs over the session"
          class="cb-plot--grow3"
          legend={
            <>
              <span class="cb-key cb-key--box-red" />
              Error
              <span class="cb-key cb-key--box-amber" />
              Short or close bout
              <span class="cb-key cb-key--dash-gray" />
              Session end
            </>
          }
          help={
            <>
              <Help k="What is plotted">
                One row per label and one bar per epoch, from its start to its stop, as read from
                the annotation file (after any merge or remove fixes).
              </Help>
              <Help k="Axes">
                Time across the whole session, left to right. Rows are the labels in the order they
                first appear.
              </Help>
              <Help k="Colors">
                Bar colors only tell labels apart. Red outline: an error, such as a stop before its
                start or an epoch outside the session. Amber outline: a bout that is very short, or
                close to another bout of the same label. Black outline: the epoch selected in
                Flagged epochs. Dashed line: the end of the session.
              </Help>
              <Help k="Limits">
                Very short epochs are drawn at least 2 pixels wide so they stay visible, so a bar
                can look longer than it is. Expand the plot for more detail.
              </Help>
            </>
          }
        >
          {(size) => (
            <Ethogram
              epochs={a()!.epochs}
              duration={sessionDuration() ?? 0}
              selected={flaggedOf(props.id)[selOf(props.id)]}
              rowH={Math.max(
                24,
                Math.min(64, (size().h - 12) / new Set(a()!.epochs.map((e) => e.label)).size),
              )}
            />
          )}
        </PlotCard>
      </Show>
      <Show when={a() && !a()!.error && props.tab === 'stats'}>
        <section class="cb-plot">
          <div class="cb-plot__head">
            <h3>Epochs per label</h3>
          </div>
          <div class="cb-plot__scroll">
            <StatsTable epochs={a()!.epochs} />
          </div>
        </section>
      </Show>
    </>
  );
}

export function AnnotationFlagged(props: { id: string }): JSX.Element {
  return (
    <RailBox title="Flagged epochs" grow>
      <PagedList
        id={listIdOf(props.id)}
        rowH={46}
        items={flaggedOf(props.id)}
        selected={selOf(props.id)}
        onSelect={(i) => setPicked(listIdOf(props.id), i)}
        empty="No flagged epochs in this file."
      >
        {(e) => (
          <span class="cb-epochrow" title={[...e.flags, ...e.notes].join(', ')}>
            <span>
              {e.label} {e.start.toFixed(2)} to {e.stop.toFixed(2)} s
            </span>
            <span class={e.flags.length ? 'cb-error' : 'cb-warn'}>
              {[...e.flags, ...e.notes].join(', ')}
            </span>
          </span>
        )}
      </PagedList>
    </RailBox>
  );
}

export const AnnotationCorrection = (props: { id: string }) => (
  <>
    <Advice checks={fileOf(props.id)?.checks ?? []} />
    <AnnotationFixes />
  </>
);

export const annotationMetrics = (id: string): MetricCard[] => {
  const e = fileOf(id)?.epochs;
  if (!e) return [];
  const flagged = flaggedOf(id).length;
  return [
    { label: 'Epochs', value: String(e.length), denom: 'in this file', tone: 'blue' },
    {
      label: 'Labels',
      value: String(new Set(e.map((x) => x.label)).size),
      denom: 'distinct labels',
      tone: 'blue',
    },
    {
      label: 'Flagged epochs',
      value: String(flagged),
      denom: denomText(flagged, e.length, 'epochs', 'with an error or a note'),
      tone: flagged ? 'orange' : 'ok',
    },
  ];
};
