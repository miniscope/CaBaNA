// Population setup, section 3: the shuffle test settings and, beside them, what is tested and
// corrected for each selected analysis.

import { createMemo, For, Show, type JSX } from 'solid-js';
import {
  DEFAULT_POPULATION,
  populationSettings as s,
  setPopulationSettings as set,
} from '../../lib/population-settings.ts';
import { shufflesFor } from '../../lib/preview.ts';
import { AdvancedSeed } from '../parts.tsx';
import { stateCount } from './data.ts';
import { Field, Num, Select } from './fields.tsx';
import { maxStatNote, statsTable, type StatStatus } from './setup-logic.ts';

const STATUS: Record<StatStatus, string> = {
  corrected: 'Corrected',
  uncorrected: 'Uncorrected',
  descriptive: 'Descriptive',
};

export function StatsSection(): JSX.Element {
  const rows = createMemo(() => statsTable(s, stateCount()));
  return (
    <div class="cb-pn-twocol cb-pn-stats">
      <div class="cb-pn-side">
        <div class="cb-pn-fields">
          <Field
            label="Shuffles"
            tip="Number of shuffled sessions. More shuffles give finer p-values. A quick preview uses up to 50 and is marked Preliminary."
          >
            <Num k="shuffles" label="Shuffles" step={50} whole />
          </Field>
          <Field
            label="Minimum shift"
            tip="Shortest circular shift applied to a cell. It should be longer than the time scale of the neural events. The starting value is 20 s."
          >
            <Num k="minShiftS" label="Minimum shift (s)" unit="s" step={1} />
          </Field>
          <Field
            label="Pair separation"
            tip="Minimum difference between the shifts of two cells, so that pairs of cells are not shifted together."
          >
            <Num k="pairSeparationS" label="Pair separation (s)" unit="s" step={0.5} />
          </Field>
          <Field
            label="Alpha"
            tip="Significance level for the marks in the figures. It also sets the null range: the α to 1 − α percentile of the shuffled values (one-sided tests), or α/2 to 1 − α/2 (two-sided)."
          >
            <Num k="alpha" label="Alpha" step={0.01} />
          </Field>
          <Field
            label="Correction"
            tip="Max-stat compares each state with the largest value among all states in every shuffle, which controls the chance of any false positive across states. It applies only to results with one value per state."
          >
            <Select
              k="correction"
              label="Correction"
              options={[
                ['none', 'None'],
                ['max_stat', 'Max-stat (per-state results only)'],
              ]}
            />
          </Field>
        </div>
        <p class="cb-muted">
          Each shuffle shifts every cell's events in time by its own random amount (a circular
          shift). That keeps the cell's own timing but breaks its link to the states. The observed
          value is compared with the shuffled values. Quick preview uses{' '}
          {shufflesFor('preview', s.shuffles)} shuffles and is marked Preliminary.
        </p>
        <AdvancedSeed seed={s.seed} def={DEFAULT_POPULATION.seed} onSet={(v) => set('seed', v)} />
      </div>
      <div class="cb-pn-side">
        <h4 class="cb-pn-h4">What is tested</h4>
        <Show when={rows().length} fallback={<p class="cb-muted">No method is selected.</p>}>
          <table class="cb-auroc-table cb-as-tbl cb-pn-scope">
            <thead>
              <tr>
                <th>Analysis</th>
                <th>Compared</th>
                <th>Null</th>
                <th>Correction</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r) => (
                  <tr>
                    <td>{r.label}</td>
                    <td>{r.comparisons}</td>
                    <td>{r.nullText}</td>
                    <td>
                      {r.correction}
                      <Show when={maxStatNote(s, r)}>
                        {(note) => <div class="cb-muted cb-pn-scopenote">{note()}</div>}
                      </Show>
                    </td>
                    <td>
                      <span
                        class="cb-pill"
                        classList={{ 'cb-pill--good': r.status === 'corrected' }}
                      >
                        {STATUS[r.status]}
                      </span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
        <p class="cb-muted">
          Max-stat applies to stability and per-state participation ratio only. Similarity and
          separation compare every pair of states and stay uncorrected whatever is chosen here;
          pairwise correlations have no test. Corrected, uncorrected and descriptive results are
          labeled as such in the results.
        </p>
      </div>
    </div>
  );
}
