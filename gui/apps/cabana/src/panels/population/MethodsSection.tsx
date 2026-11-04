// Population setup, section 2: one card per method with a plain explanation, the question it
// answers, an example drawing, its settings (while selected) and whether it can run.

import { Show, type JSX } from 'solid-js';
import {
  populationSettings as s,
  setPopulationSettings as set,
  type PopulationMethod,
} from '../../lib/population-settings.ts';
import { InfoTip } from '../InfoTip.tsx';
import { readiness } from './data.ts';
import { Field, Num, Select } from './fields.tsx';
import { MethodSchematic } from './Schematics.tsx';

export const METHOD_NAME: Record<PopulationMethod, string> = {
  similarity: 'Population vector (PV) similarity',
  stability: 'Population vector (PV) stability',
  separation: 'State separation',
  dimensionality: 'Dimensionality (participation ratio)',
  pairwise: 'Pairwise correlations',
};

function MethodCard(props: {
  id: PopulationMethod;
  /** What the method measures, in plain words. */
  what: string;
  /** The question it answers. */
  question: string;
  tip: JSX.Element;
  children?: JSX.Element;
  limit?: string;
}): JSX.Element {
  const ready = () => readiness()[props.id];
  return (
    <div class="cb-pn-mcard" classList={{ 'cb-pn-mcard--off': !s.methods[props.id] }}>
      <label class="cb-as-check cb-pn-mcard__head">
        <input
          type="checkbox"
          checked={s.methods[props.id]}
          onChange={(e) => set('methods', props.id, e.currentTarget.checked)}
        />
        <b>{METHOD_NAME[props.id]}</b>
        <InfoTip label={`About ${METHOD_NAME[props.id].toLowerCase()}`}>{props.tip}</InfoTip>
        <Show when={s.methods[props.id]}>
          <span class="cb-pn-method__state">
            <Show when={ready().ready} fallback={<span class="cb-pill cb-pill--bad">Blocked</span>}>
              <span class="cb-pill cb-pill--good">✓ Ready</span>
            </Show>
          </span>
        </Show>
      </label>
      <div class="cb-pn-mcard__text">
        <span>{props.what}</span>
        <span class="cb-muted">{props.question}</span>
      </div>
      <MethodSchematic method={props.id} blocks={s.stabilityBlocks} />
      <div class="cb-pn-mcard__opts">
        <Show when={s.methods[props.id]}>
          <Show when={props.children}>
            <div class="cb-pn-opts">{props.children}</div>
          </Show>
          <Show when={!ready().ready}>
            <div class="cb-pn-method__why">{ready().reason}</div>
          </Show>
          <Show when={props.limit}>
            <div class="cb-muted cb-pn-method__limit">{props.limit}</div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export function MethodsSection(): JSX.Element {
  return (
    <div class="cb-pn-mcards">
      <p class="cb-muted cb-pn-intro">
        A population vector (PV) is the mean neural value of every cell while the animal is in a
        state. All selected methods share the target, the time bin and the states, and run together
        in one run.
      </p>
      <MethodCard
        id="similarity"
        what="How alike the population vectors of two states are, for every pair of states."
        question="Does the population respond in a similar pattern in two states?"
        tip="Cosine similarity compares the direction of the vectors; Pearson correlation also removes each vector's mean."
      >
        <Field label="Measure">
          <Select
            k="similarity"
            label="Similarity measure"
            options={[
              ['cosine', 'Cosine similarity'],
              ['pearson', 'Pearson correlation'],
            ]}
          />
        </Field>
        <Field
          label="Minimum time in state"
          tip="Shortest time a state must be occupied in a block for its population vector to be used. Also used by stability."
        >
          <Num k="pvMinOccupancyS" label="Minimum time in state (s)" unit="s" step={0.05} />
        </Field>
      </MethodCard>
      <MethodCard
        id="stability"
        what="Correlates each state's population vector between half A and half B of the session."
        question="Is the pattern of a state reproducible within the session?"
        tip="The used frames are cut into equal consecutive blocks; even blocks form half A and odd blocks half B. High values mean the pattern of the state is reproducible."
      >
        <Field
          label="Blocks"
          tip="Equal consecutive parts of the used frames. Even-numbered blocks form half A, odd-numbered blocks half B, so at least 2 are needed."
        >
          <Num k="stabilityBlocks" label="Blocks" step={1} whole />
        </Field>
      </MethodCard>
      <MethodCard
        id="separation"
        what="Distance between the mean population vectors of two states, in principal components or over all cells."
        question="How well does the population tell the states apart?"
        limit={
          s.space === 'pca'
            ? 'Descriptive: PCA is fitted on all included frames; no held-out evaluation.'
            : 'Descriptive: all included frames, no held-out evaluation.'
        }
        tip="With principal component analysis (PCA) the distance is measured in the first components; without it, over all cells. Both are z-scored."
      >
        <Field label="Space">
          <Select
            k="space"
            label="Space"
            options={[
              ['pca', 'Principal component analysis'],
              ['all', 'All cells (no PCA)'],
            ]}
          />
        </Field>
        <Show when={s.space === 'pca'}>
          <Field
            label="Components"
            tip="Number of principal components kept for the distances. It cannot exceed the number of kept cells."
          >
            <Num k="components" label="Number of components" step={1} whole />
          </Field>
          <Field label="Distance">
            <Select
              k="pcaDistance"
              label="Distance"
              options={[
                ['euclidean', 'Euclidean'],
                ['mahalanobis', 'Mahalanobis'],
              ]}
            />
          </Field>
        </Show>
        <Show when={s.space === 'all'}>
          <Field label="Distance">
            <Select
              k="allDistance"
              label="Distance"
              options={[
                ['euclidean', 'Euclidean'],
                ['correlation', 'Correlation'],
              ]}
            />
          </Field>
        </Show>
      </MethodCard>
      <MethodCard
        id="dimensionality"
        what="The participation ratio of the covariance of z-scored cells, for the whole session or each state."
        question="How many dimensions of variance does the population use?"
        limit="Descriptive: fitted on all included frames. The value is not a count of ensembles."
        tip="It runs from 1 (one pattern dominates) up to the number of cells (variance spread evenly). It does not count ensembles or assemblies."
      >
        <label class="cb-as-check">
          <input
            type="checkbox"
            checked={s.perStateParticipation}
            onChange={(e) => set('perStateParticipation', e.currentTarget.checked)}
          />
          Also compute it for each state
        </label>
      </MethodCard>
      <MethodCard
        id="pairwise"
        what="Correlation between every pair of cells across the time bins."
        question="How strongly do cells vary together? This is not connectivity."
        limit="Descriptive; no significance test."
        tip="Total uses all variation; signal keeps what is shared across states; noise keeps what remains after removing state means and needs exclusive states."
      >
        <Field label="Kind">
          <Select
            k="pairwiseKind"
            label="Kind of correlation"
            options={[
              ['total', 'Total'],
              ['signal', 'Signal'],
              ['noise', 'Noise'],
            ]}
          />
        </Field>
        <Field label="Method">
          <Select
            k="pairwiseMethod"
            label="Correlation method"
            options={[
              ['pearson', 'Pearson'],
              ['spearman', 'Spearman'],
            ]}
          />
        </Field>
      </MethodCard>
    </div>
  );
}
