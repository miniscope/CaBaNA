// Population setup, section 1: what the states are, the time bin and a summary of the data.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { binGrid, effectiveBin } from '../../lib/arena.ts';
import {
  populationSettings as s,
  setPopulationSettings as set,
  type PopulationTarget,
} from '../../lib/population-settings.ts';
import { prep } from '../../lib/preprocess.ts';
import { goToStep } from '../../lib/store.ts';
import { Note } from '../parts.tsx';
import { labelRows, neuralSummary, stateCount } from './data.ts';
import { Field, Num } from './fields.tsx';
import { TargetSchematic } from './Schematics.tsx';
import { binsOf } from './logic.ts';
import { StatesChart } from './StatesChart.tsx';

const TARGETS: { id: PopulationTarget; label: string; text: string }[] = [
  {
    id: 'behaviors',
    label: 'Behaviors',
    text: 'Compare the neural population across annotated behaviors. Behaviors may overlap in time.',
  },
  {
    id: 'zones',
    label: 'Zones',
    text: 'Compare the neural population across annotated arena zones. Zones do not overlap.',
  },
  {
    id: 'position',
    label: 'Position bins',
    text: 'Each open bin of the arena grid is a state; compare the population across places.',
  },
];

function TargetCards(): JSX.Element {
  return (
    <div class="cb-pn-targets" role="radiogroup" aria-label="Target">
      <For each={TARGETS}>
        {(t) => (
          <button
            type="button"
            role="radio"
            aria-checked={s.target === t.id}
            class="cb-pn-tcard"
            classList={{ 'cb-pn-tcard--on': s.target === t.id }}
            onClick={() => set('target', t.id)}
          >
            <b>{t.label}</b>
            <span class="cb-muted">{t.text}</span>
            <TargetSchematic target={t.id} />
          </button>
        )}
      </For>
    </div>
  );
}

/** Counts of the data the methods will read. */
function DataSummary(): JSX.Element {
  const n = neuralSummary;
  const states = () => (s.target === 'position' ? openBins() : stateCount());
  const grid = createMemo(() => binGrid(effectiveBin()));
  const openBins = () => grid()?.open.filter(Boolean).length ?? 0;
  return (
    <Show when={n()} fallback={<div class="cb-note">No deconvolved events are loaded.</div>}>
      {(d) => (
        <dl class="cb-pn-data">
          <dt>Neural data</dt>
          <dd>
            deconvolved events,{' '}
            {prep.eventSigmaS ? `smoothed with σ ${prep.eventSigmaS} s` : 'not smoothed'} (
            <button class="cb-link" onClick={() => goToStep('prep')}>
              Preprocess
            </button>
            )
          </dd>
          <dt>Cells</dt>
          <dd>
            {d().kept} of {d().total} kept
          </dd>
          <dt>Time</dt>
          <dd>
            {d().fs
              ? `${d().frames.toLocaleString()} frames, ${(d().frames / d().fs!).toFixed(0)} s, ${binsOf(d().frames, d().fs!, s.binS).toLocaleString()} bins of ${s.binS} s`
              : `${d().frames.toLocaleString()} frames`}
          </dd>
          <dt>States</dt>
          <dd>{states() ?? 0} selected</dd>
          <dt>Session</dt>
          <dd>Single session; cells are not matched across sessions</dd>
        </dl>
      )}
    </Show>
  );
}

export function TargetSection(): JSX.Element {
  return (
    <div class="cb-pn-sec">
      <TargetCards />
      <div class="cb-pn-twocol">
        <div class="cb-pn-statebox">
          <Show
            when={s.target !== 'position'}
            fallback={
              <div class="cb-pn-posinfo">
                <p>
                  Each open bin of the arena grid ({effectiveBin()} cm bins) is a state. Frames
                  below the speed threshold set in Preprocess are left out.
                </p>
                <p class="cb-muted">
                  Arena outline and bin size come from Experimental setup.{' '}
                  <button class="cb-link" onClick={() => goToStep('setup')}>
                    Go to Experimental setup
                  </button>
                </p>
              </div>
            }
          >
            <Show
              when={labelRows().length}
              fallback={
                <div class="cb-empty">
                  No {s.target === 'zones' ? 'zone' : 'behavior'} annotations are loaded.{' '}
                  <button class="cb-link" onClick={() => goToStep('load')}>
                    Go to Load data
                  </button>
                </div>
              }
            >
              <StatesChart rows={labelRows()} />
            </Show>
          </Show>
        </div>
        <div class="cb-pn-side">
          <Field
            label="Time bin"
            tip="Neural frames are grouped into bins of this length before any population analysis. It applies only to this page and is never changed without a request."
          >
            <Num k="binS" label="Time bin (s)" unit="s" step={0.1} />
          </Field>
          <Note title="About the time bin">
            <p>
              Frames are grouped into bins of this length. Deconvolved events are summed within a
              bin, and a bin counts as being in a state when at least half of its frames are.
            </p>
            <p>
              Short bins keep temporal resolution but hold few events per cell, so population
              vectors are noisy. Long bins give more events per bin but fewer bins per state, which
              lowers the number of samples every method has to work with. Similarity, stability,
              separation, dimensionality and pairwise correlations all use these bins.
            </p>
          </Note>
          <DataSummary />
        </div>
      </div>
    </div>
  );
}
