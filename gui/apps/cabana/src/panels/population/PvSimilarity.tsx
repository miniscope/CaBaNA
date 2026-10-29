import { Match, Show, Switch, type JSX } from 'solid-js';
import type { MatrixView } from '../../lib/population-results.ts';
import {
  FigureTabs,
  Figure,
  MatrixFigure,
  Message,
  PairsTable,
  Summary,
  recorded,
  useView,
  currentFigure,
  type ViewProps,
} from './shared.tsx';
import { pairsCsv } from './logic.ts';

const TABS = [
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'pairs', label: 'Pairs table' },
];

/** Population vector similarity: states by states matrix and the pair table. */
export function PvSimilarity(p: ViewProps): JSX.Element {
  const { view, meta } = useView<MatrixView>(p, 'similarity');
  const similarity = () => String(meta()?.params.similarity ?? 'cosine');
  const name = () => (similarity() === 'pearson' ? 'Pearson correlation' : 'Cosine similarity');
  return (
    <Switch>
      <Match when={view.error}>
        <Message>{String(view.error)}</Message>
      </Match>
      <Match when={view()}>
        {(v) => (
          <div class="cb-pn-view">
            <div class="cb-pn-viewhead">
              <FigureTabs id="similarity" options={TABS} />
              <Summary
                meta={meta()}
                method="similarity"
                nStates={v().states.length}
                details={v().label}
                limits={[]}
              />
            </div>
            <div class="cb-pn-fig">
              <Show
                when={currentFigure('similarity', TABS) === 'heatmap'}
                fallback={
                  <Figure
                    title="Population vector similarity: state pairs"
                    view={p}
                    resultName="pv_similarity"
                    file="population_vector_similarity_pairs"
                    csv={() => pairsCsv(v().pairs)}
                    howTo={
                      <p>
                        One row per pair of different states: the {name().toLowerCase()} of their
                        population vectors, the middle 95% of the shuffled values (null range) and
                        the uncorrected p-value. An asterisk marks p below alpha. Pairs are not
                        corrected for the number of pairs tested.
                      </p>
                    }
                  >
                    {() => <PairsTable pairs={v().pairs} alpha={recorded(meta()).alpha} />}
                  </Figure>
                }
              >
                <MatrixFigure
                  view={v()}
                  props={p}
                  resultName="pv_similarity"
                  title="Population vector similarity"
                  scaleTitle={name()}
                  similarity={similarity()}
                  alpha={recorded(meta()).alpha}
                  file="population_vector_similarity"
                  howTo={
                    <>
                      <p>
                        Each cell compares two states. A state's population vector is the mean
                        neural value of every cell while the animal is in that state. The color is
                        the {name().toLowerCase()} between the two vectors (
                        {similarity() === 'pearson'
                          ? '-1 to 1, red positive, blue negative'
                          : '0 to 1, darker is more similar'}
                        ); the diagonal compares a state with itself.
                      </p>
                      <p>
                        An asterisk marks a pair whose value is above the shuffled (cell-shift)
                        null, uncorrected p below alpha. Hover a cell for its value, null range and
                        p. Order, values and color limits are in Plot settings.
                      </p>
                      <p>Similar vectors do not show that the same cells encode both states.</p>
                    </>
                  }
                />
              </Show>
            </div>
          </div>
        )}
      </Match>
      <Match when={view.loading}>
        <Message>Loading the saved values</Message>
      </Match>
      <Match when={true}>
        <Message>This run holds no population vector similarity.</Message>
      </Match>
    </Switch>
  );
}
