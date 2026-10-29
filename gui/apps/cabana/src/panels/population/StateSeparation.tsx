import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from 'solid-js';
import type { SeparationView } from '../../lib/population-results.ts';
import { Bars, Scatter } from './charts.tsx';
import { fmt, matrixCsv, pageCount, seriesCsv } from './logic.ts';
import {
  currentFigure,
  Figure,
  FigureTabs,
  MatrixFigure,
  Message,
  Row,
  Summary,
  recorded,
  useFittingRows,
  useView,
  type ViewProps,
} from './shared.tsx';
import { plotSettings, setPlotSettings } from './view-store.ts';

const LIMIT = 'Descriptive: PCA is fitted on all included frames; no held-out evaluation';

/** State separation: distances between states, and (with PCA) variance, state means and loadings. */
export function StateSeparation(p: ViewProps): JSX.Element {
  const { view, meta } = useView<SeparationView>(p, 'separation');
  const pca = () => String(meta()?.params.name) === 'pca_population';
  const options = () => [
    { id: 'distance', label: 'Distance matrix' },
    ...(pca()
      ? [
          { id: 'scree', label: 'Variance explained' },
          { id: 'means', label: 'State means' },
          { id: 'loadings', label: 'Top-loading cells' },
        ]
      : []),
  ];
  const distance = () => String(meta()?.params.distance ?? 'euclidean');
  return (
    <Switch>
      <Match when={view.error}>
        <Message>{String(view.error)}</Message>
      </Match>
      <Match when={view()}>
        {(v) => {
          const fig = () => currentFigure('separation', options());
          const comps = () => Array.from({ length: v().nComponents }, (_, i) => i);
          const pcLabel = (i: number) =>
            `PC${i + 1} (${fmt((v().varianceExplained[i] ?? 0) * 100, 1)}%)`;
          const means = createMemo(() => {
            const sm = v().stateMeans;
            if (!sm) return [];
            const c = sm.shape[1];
            const x = Math.min(plotSettings.pcX, c - 1);
            const y = Math.min(plotSettings.pcY, c - 1);
            return v().states.map((name, i) => ({
              name,
              x: Number(sm.data[i * c + x]),
              y: Number(sm.data[i * c + y]),
            }));
          });
          const top = createMemo(() =>
            v().topLoadings(Math.min(plotSettings.component, v().nComponents - 1), 20),
          );
          return (
            <div class="cb-pn-view">
              <div class="cb-pn-viewhead">
                <FigureTabs id="separation" options={options()} />
                <Summary
                  meta={meta()}
                  method="separation"
                  nStates={v().states.length}
                  details={v().label}
                  limits={
                    pca() ? [LIMIT] : ['Descriptive: all included frames, no held-out evaluation']
                  }
                />
              </div>
              <div class="cb-pn-fig">
                <Switch>
                  <Match when={fig() === 'distance'}>
                    <MatrixFigure
                      view={v()}
                      props={p}
                      resultName="state_separation"
                      title="State separation: distance between states"
                      scaleTitle={`${distance()} distance`}
                      alpha={recorded(meta()).alpha}
                      file="state_separation_distance"
                      howTo={
                        <>
                          <p>
                            Each cell is the {distance()} distance between the mean population
                            vectors of two states
                            {pca()
                              ? ` in the first ${v().nComponents} principal components`
                              : ' over all cells'}
                            . Darker means the states are farther apart; the diagonal is 0.
                          </p>
                          <p>
                            An asterisk marks a pair farther apart than the shuffled null
                            (uncorrected p below alpha). Distances are in z-scored units and depend
                            on the number of components, so compare them only within this figure.
                          </p>
                        </>
                      }
                    />
                  </Match>
                  <Match when={fig() === 'scree'}>
                    <Figure
                      title="Variance explained by each component"
                      view={p}
                      resultName="state_separation"
                      file="state_separation_variance"
                      csv={() =>
                        seriesCsv('component', {
                          variance_explained: v().varianceExplained,
                          cumulative: v().cumulative,
                        })
                      }
                      howTo={
                        <p>
                          Bars: the fraction of total variance (z-scored cells, all included frames)
                          explained by each principal component. Line: the running total on the
                          right axis. PCA is fitted on all included frames, so this describes the
                          data and does not test generalization.
                        </p>
                      }
                    >
                      {(r) => (
                        <Bars
                          label="Variance explained by component"
                          svgRef={r.svgRef}
                          bars={comps().map((i) => ({
                            name: String(i + 1),
                            value: v().varianceExplained[i],
                          }))}
                          line={{ values: v().cumulative, title: 'Cumulative variance explained' }}
                          xTitle="Principal component"
                          yTitle="Variance explained (fraction)"
                        />
                      )}
                    </Figure>
                  </Match>
                  <Match when={fig() === 'means'}>
                    <Figure
                      title="State means in principal component space"
                      view={p}
                      resultName="state_separation"
                      file="state_separation_means"
                      csv={() => matrixCsv(v().states, v().stateMeans?.data ?? [], v().nComponents)}
                      settings={
                        <>
                          <Row label="x axis">
                            <PcSelect k="pcX" n={v().nComponents} label={pcLabel} />
                          </Row>
                          <Row label="y axis">
                            <PcSelect k="pcY" n={v().nComponents} label={pcLabel} />
                          </Row>
                        </>
                      }
                      howTo={
                        <p>
                          Each point is one state: the mean of its frames projected on the chosen
                          principal components (axes in Plot settings, with the variance each
                          explains). States that sit far apart are separated along these components.
                          The axes are z-scored units; the plot shows means only, not spread.
                        </p>
                      }
                    >
                      {(r) => (
                        <Scatter
                          label="State means in principal component space"
                          svgRef={r.svgRef}
                          labels
                          points={means()}
                          xTitle={pcLabel(Math.min(plotSettings.pcX, v().nComponents - 1))}
                          yTitle={pcLabel(Math.min(plotSettings.pcY, v().nComponents - 1))}
                        />
                      )}
                    </Figure>
                  </Match>
                  <Match when={fig() === 'loadings'}>
                    <Figure
                      title="Top-loading cells"
                      view={p}
                      resultName="state_separation"
                      file="state_separation_loadings"
                      csv={() => ({
                        header: ['component', 'cell', 'loading'],
                        rows: top().map((t) => [plotSettings.component + 1, t.id, t.loading]),
                      })}
                      settings={
                        <Row label="Component">
                          <PcSelect k="component" n={v().nComponents} label={pcLabel} />
                        </Row>
                      }
                      howTo={
                        <p>
                          The 20 cells with the largest absolute loading on the chosen component
                          (set in Plot settings). A loading is the weight of a cell in the
                          component; positive and negative signs are opposite directions along it.
                          Loadings describe the fit to all included frames.
                        </p>
                      }
                    >
                      {() => <LoadingsTable top={top()} component={plotSettings.component} />}
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
        <Message>This run holds no state separation.</Message>
      </Match>
    </Switch>
  );
}

function PcSelect(p: {
  k: 'pcX' | 'pcY' | 'component';
  n: number;
  label: (i: number) => string;
}): JSX.Element {
  return (
    <select
      value={plotSettings[p.k]}
      onChange={(e) => setPlotSettings(p.k, +e.currentTarget.value)}
    >
      <For each={Array.from({ length: p.n }, (_, i) => i)}>
        {(i) => <option value={i}>{p.label(i)}</option>}
      </For>
    </select>
  );
}

/** The top-loading cells, a page at a time as many rows as fit the box. */
function LoadingsTable(p: {
  top: { id: number | string; loading: number }[];
  component: number;
}): JSX.Element {
  const [page, setPage] = createSignal(0);
  const [perPage, fitRef] = useFittingRows();
  const last = () => pageCount(p.top.length, perPage()) - 1;
  const at = () => Math.min(page(), last());
  return (
    <div class="cb-pn-tablebox">
      <div class="cb-pn-tablescroll" ref={fitRef}>
        <table class="cb-auroc-table cb-as-tbl">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Cell</th>
              <th class="cb-as-num">Loading on PC{p.component + 1}</th>
            </tr>
          </thead>
          <tbody>
            <For each={p.top.slice(at() * perPage(), (at() + 1) * perPage())}>
              {(t, i) => (
                <tr>
                  <td>{at() * perPage() + i() + 1}</td>
                  <td>{t.id}</td>
                  <td class="cb-as-num">{fmt(t.loading, 3)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={last() > 0}>
        <div class="cb-pn-pager">
          <button class="btn-secondary" disabled={at() === 0} onClick={() => setPage(at() - 1)}>
            Previous
          </button>
          <span class="cb-muted">
            Page {at() + 1} of {last() + 1} · {p.top.length} cells
          </span>
          <button class="btn-secondary" disabled={at() >= last()} onClick={() => setPage(at() + 1)}>
            Next
          </button>
        </div>
      </Show>
    </div>
  );
}
