// The result of a preview run, on the left of the Preview window. Place cells shows the cells
// that passed with their maps, as the gallery does; the other analyses show the saved headline
// and a pointer to the full view. Only what the run saved is shown; nothing is computed here.

import { createResource, For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../lib/bridge-client.ts';
import { displayMap, maxOf } from '../lib/place-display.ts';
import { placeOutcome, placeOutcomeFromRun, type PlaceOutcome } from '../lib/place-run.ts';
import { buildRows, countOutcomes, listRows } from '../lib/place-table.ts';
import { executedShuffles } from '../lib/preview.ts';
import { headlineOf } from '../lib/results-table.ts';
import { savedData } from './results/run-data.ts';
import { RateMap } from './RateMap.tsx';

const MAPS = 12;

function PlaceMaps(props: { out: PlaceOutcome; record: RunRecord }): JSX.Element {
  const rows = () => buildRows(props.out);
  const counts = () => countOutcomes(rows());
  const best = () =>
    listRows(rows(), props.out, { filter: 'all', query: '', sort: 'information', desc: true }).slice(
      0,
      MAPS,
    );
  const grid = () => props.out.data.grid;
  const r = () => props.out.result;
  const slice = (k: number) => r().rate.subarray(k * r().nStates, (k + 1) * r().nStates);
  const shuffles = () => executedShuffles(props.record);
  return (
    <div class="cb-pv-place">
      <p>
        <strong>
          {counts().both} of {rows().length - counts().cannot} cells
        </strong>{' '}
        passed both tests in the preview{' '}
        <span class="cb-muted">
          (α = {props.out.settings.alpha}
          {shuffles() === undefined ? '' : `, ${shuffles()!.toLocaleString()} shuffles`})
        </span>
      </p>
      <p class="cb-muted">Highest spatial information first; each map scaled to its own peak.</p>
      <div class="cb-pv-maps">
        <For each={best()}>
          {(row) => {
            const m = () => displayMap(slice(row.i), [grid().ny, grid().nx]);
            return (
              <figure>
                <RateMap
                  values={m()}
                  max={maxOf(m())}
                  size={100}
                  nx={grid().nx}
                  ny={grid().ny}
                  open={grid().open}
                  bin={grid().bin}
                  arenaCm={props.out.arenaCm}
                />
                <figcaption>Cell {row.id + 1}</figcaption>
              </figure>
            );
          }}
        </For>
      </div>
    </div>
  );
}

/** The newest browser-session outcome when it is this run's, else the saved run read back. */
function PlaceResult(props: { record: RunRecord }): JSX.Element {
  const [out] = createResource(
    () => props.record,
    async (rec) => {
      const live = placeOutcome();
      if (live?.record?.run_id === rec.run_id) return live;
      try {
        return await placeOutcomeFromRun(rec);
      } catch {
        return undefined;
      }
    },
  );
  return (
    <Show when={out()} fallback={<Saved record={props.record} />}>
      {(o) => <PlaceMaps out={o()} record={props.record} />}
    </Show>
  );
}

/** The saved headline of a run, for analyses whose full view is in Results. */
function Saved(props: { record: RunRecord }): JSX.Element {
  const [line] = createResource(
    () => props.record,
    async (rec) => {
      try {
        const data = await savedData(rec);
        return headlineOf(rec.analysis as Parameters<typeof headlineOf>[0], data);
      } catch {
        return undefined;
      }
    },
  );
  return (
    <div class="cb-pv-saved">
      <p>
        <strong>{line() ?? 'The preview finished.'}</strong>
      </p>
      <p class="cb-muted">
        The preview run is saved. Open it from Previous results to see its plots and tables.
      </p>
    </div>
  );
}

export function PreviewResult(props: { record: RunRecord }): JSX.Element {
  return (
    <Show when={props.record.analysis === 'place'} fallback={<Saved record={props.record} />}>
      <PlaceResult record={props.record} />
    </Show>
  );
}
