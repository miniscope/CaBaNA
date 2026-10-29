import { Match, Switch, type JSX } from 'solid-js';
import type { DimensionalityView } from '../../lib/population-results.ts';
import { Bars, Spectrum } from './charts.tsx';
import { fmt, perStateCsv, seriesCsv } from './logic.ts';
import {
  Check,
  currentFigure,
  Figure,
  FigureTabs,
  Message,
  Summary,
  useView,
  type ViewProps,
} from './shared.tsx';
import { plotSettings, setPlotSettings } from './view-store.ts';

const TABS = [
  { id: 'value', label: 'Participation ratio' },
  { id: 'spectrum', label: 'Eigenvalue spectrum' },
];

/** Dimensionality: participation ratio with its null range, and the eigenvalue spectrum. */
export function Dimensionality(p: ViewProps): JSX.Element {
  const { view, meta } = useView<DimensionalityView>(p, 'dimensionality');
  const perState = () => !!meta()?.params.per_state;
  return (
    <Switch>
      <Match when={view.error}>
        <Message>{String(view.error)}</Message>
      </Match>
      <Match when={view()}>
        {(v) => {
          const names = () => (perState() ? v().states : ['Session (all frames)']);
          const pr = () => v().participationRatio;
          const eig = () => Array.from(v().eigenvalues.data, (x) => Number(x ?? NaN));
          const first = () =>
            `Participation ratio ${fmt(pr()[0], 2)}${perState() ? ' (first state)' : ''}; null range ${fmt(v().nullLo[0], 2)} to ${fmt(v().nullHi[0], 2)}; two-sided p ${fmt(v().p[0], 3)}`;
          return (
            <div class="cb-pn-view">
              <div class="cb-pn-viewhead">
                <FigureTabs id="dimensionality" options={TABS} />
                <Summary
                  meta={meta()}
                  method="dimensionality"
                  perState={perState()}
                  nStates={v().states.length}
                  details={v().label}
                  limits={[
                    ...(perState() ? [] : [first()]),
                    'Descriptive: fitted on all included frames',
                  ]}
                />
              </div>
              <div class="cb-pn-fig">
                <Switch>
                  <Match when={currentFigure('dimensionality', TABS) === 'value'}>
                    <Figure
                      title="Participation ratio"
                      view={p}
                      resultName="dimensionality"
                      file="participation_ratio"
                      csv={() =>
                        perStateCsv(names(), {
                          participation_ratio: pr(),
                          null_low: v().nullLo,
                          null_high: v().nullHi,
                          p_value: v().p,
                        })
                      }
                      howTo={
                        <>
                          <p>
                            The participation ratio estimates how many dimensions the population
                            uses: (sum of eigenvalues)^2 divided by the sum of squared eigenvalues
                            of the covariance of z-scored cells. It is 1 when one pattern dominates
                            and approaches the number of cells when variance is spread evenly.
                          </p>
                          <p>
                            The black line is the middle 95% of the shuffled (cell-shift) null; the
                            test is two-sided. It is computed on all included frames and says
                            nothing about generalization.
                          </p>
                        </>
                      }
                    >
                      {(r) => (
                        <Bars
                          label="Participation ratio"
                          svgRef={r.svgRef}
                          bars={names().map((name, i) => ({
                            name,
                            value: pr()[i],
                            nullLo: v().nullLo[i],
                            nullHi: v().nullHi[i],
                          }))}
                          xTitle={perState() ? 'State' : 'Session'}
                          yTitle="Participation ratio (dimensions)"
                        />
                      )}
                    </Figure>
                  </Match>
                  <Match when={true}>
                    <Figure
                      title="Eigenvalue spectrum"
                      view={p}
                      resultName="dimensionality"
                      file="eigenvalue_spectrum"
                      csv={() =>
                        seriesCsv('component', {
                          eigenvalue: eig(),
                          cumulative_variance: v().cumulativeVariance,
                        })
                      }
                      settings={
                        <Check
                          label="Logarithmic y axis"
                          checked={plotSettings.logAxis}
                          onChange={(on) => setPlotSettings('logAxis', on)}
                        />
                      }
                      howTo={
                        <p>
                          Eigenvalues of the covariance of the z-scored cells, largest first: the
                          variance along each principal axis. A steep fall means a few patterns
                          carry most of the variance. Use the logarithmic axis in Plot settings to
                          see the small components. All included frames, descriptive.
                        </p>
                      }
                    >
                      {(r) => (
                        <Spectrum
                          label="Eigenvalue spectrum"
                          svgRef={r.svgRef}
                          values={eig()}
                          log={plotSettings.logAxis}
                          xTitle="Component (largest first)"
                          yTitle="Eigenvalue (variance, z-scored units)"
                        />
                      )}
                    </Figure>
                  </Match>
                </Switch>
              </div>
            </div>
          );
        }}
      </Match>
      <Match when={view.loading}>
        <Message>Loading the saved values</Message>
      </Match>
      <Match when={true}>
        <Message>This run holds no dimensionality result.</Message>
      </Match>
    </Switch>
  );
}
