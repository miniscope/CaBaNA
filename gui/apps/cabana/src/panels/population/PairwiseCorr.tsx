import { Match, Show, Switch, type JSX } from 'solid-js';
import type { PairwiseView } from '../../lib/population-results.ts';
import { CanvasMatrix, Histogram } from './charts.tsx';
import { colorLimits, fmt, histogram, matrixCsv } from './logic.ts';
import {
  currentFigure,
  Figure,
  FigureTabs,
  MatrixSettings,
  Message,
  Summary,
  useView,
  type ViewProps,
} from './shared.tsx';
import { plotSettings } from './view-store.ts';

const TABS = [
  { id: 'matrix', label: 'Cells by cells' },
  { id: 'histogram', label: 'Histogram' },
];

/** Pairwise correlations: the cells by cells matrix and the distribution of its off-diagonal values. */
export function PairwiseCorr(p: ViewProps): JSX.Element {
  const { view, meta } = useView<PairwiseView>(p, 'pairwise');
  const kind = () => String(meta()?.params.kind ?? 'total');
  const method = () => String(meta()?.params.method ?? 'pearson');
  return (
    <Switch>
      <Match when={view.error}>
        <Message>{String(view.error)}</Message>
      </Match>
      <Match when={view()}>
        {(v) => {
          const limits = () =>
            colorLimits('diverging', {
              values: v().offDiagonal,
              fixed:
                plotSettings.limits === 'fixed'
                  ? { lo: plotSettings.fixedLo, hi: plotSettings.fixedHi }
                  : undefined,
            });
          const hist = () => histogram(v().offDiagonal, 40);
          const title = `${kind()[0].toUpperCase()}${kind().slice(1)} ${method()} correlation`;
          return (
            <div class="cb-pn-view">
              <div class="cb-pn-viewhead">
                <FigureTabs id="pairwise" options={TABS} />
                <Summary
                  meta={meta()}
                  method="pairwise"
                  nStates={0}
                  details="Descriptive; no significance test. Pairwise correlations are not tested because a session has thousands of cell pairs and no defensible family for correcting them."
                  limits={[
                    `Mean of the off-diagonal values (from the framework): ${fmt(v().meanOffDiagonal, 4)}`,
                  ]}
                />
              </div>
              <div class="cb-pn-fig">
                <Show
                  when={currentFigure('pairwise', TABS) === 'matrix'}
                  fallback={
                    <Figure
                      title="Distribution of pairwise correlations"
                      view={p}
                      resultName="pairwise"
                      file="pairwise_histogram"
                      csv={() => ({
                        header: ['bin_low', 'bin_high', 'pairs'],
                        rows: hist().counts.map((c, i) => [
                          hist().edges[i],
                          hist().edges[i + 1],
                          c,
                        ]),
                      })}
                      howTo={
                        <p>
                          Each bar counts cell pairs whose correlation falls in that range (every
                          pair once, diagonal left out). The dashed line is the mean off-diagonal
                          value computed by the framework. Descriptive; no significance test.
                        </p>
                      }
                    >
                      {(r) => (
                        <Histogram
                          label="Distribution of pairwise correlations"
                          svgRef={r.svgRef}
                          edges={hist().edges}
                          counts={hist().counts}
                          mean={v().meanOffDiagonal}
                          xTitle={`${title} (r)`}
                        />
                      )}
                    </Figure>
                  }
                >
                  <Figure
                    title={`Pairwise correlations: ${title.toLowerCase()}`}
                    view={p}
                    resultName="pairwise"
                    file="pairwise_matrix"
                    csv={() =>
                      matrixCsv(
                        meta()?.state_names ??
                          Array.from({ length: v().cells }, (_, i) => String(i + 1)),
                        v().values.data,
                      )
                    }
                    settings={<MatrixSettings cells />}
                    howTo={
                      <>
                        <p>
                          Each pixel is the {method()} correlation between two kept cells across the
                          included time bins ({kind()} correlation
                          {kind() === 'signal'
                            ? ': shared across states, computed on state means'
                            : kind() === 'noise'
                              ? ': what remains after removing state means'
                              : ': all variation'}
                          ). Cells keep the order of the recording; red is positive, blue negative.
                        </p>
                        <p>
                          The diagonal (1) is included in the matrix; automatic color limits come
                          from the off-diagonal range, so the diagonal saturates. Descriptive; no
                          significance test.
                        </p>
                      </>
                    }
                  >
                    {(r) => (
                      <CanvasMatrix
                        label="Pairwise correlation matrix"
                        svgRef={r.svgRef}
                        canvasRef={r.canvasRef}
                        values={v().values.data}
                        n={v().cells}
                        kind="diverging"
                        limits={limits()}
                        scaleTitle={`${method()} correlation (r)`}
                        xTitle="Cell (kept cells, in order)"
                        yTitle="Cell"
                      />
                    )}
                  </Figure>
                </Show>
              </div>
            </div>
          );
        }}
      </Match>
      <Match when={view.loading}>
        <Message>Loading the saved values</Message>
      </Match>
      <Match when={true}>
        <Message>This run holds no pairwise correlations.</Message>
      </Match>
    </Switch>
  );
}
