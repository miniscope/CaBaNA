import { createMemo, Match, Switch, type JSX } from 'solid-js';
import type { StabilityView } from '../../lib/population-results.ts';
import { DotPlot, Scatter } from './charts.tsx';
import { fmt, perStateCsv } from './logic.ts';
import { Figure, Message, Row, Summary, recorded, useView, type ViewProps } from './shared.tsx';
import { plotSettings, setPlotSettings } from './view-store.ts';

/** Population vector stability: one dot per state, and the two halves for the selected state. */
export function PvStability(p: ViewProps): JSX.Element {
  const { view, meta } = useView<StabilityView>(p, 'stability');
  const alpha = () => recorded(meta()).alpha ?? 0.05;
  const corrected = () => !!recorded(meta()).correction && recorded(meta()).correction !== 'none';
  return (
    <Switch>
      <Match when={view.error}>
        <Message>{String(view.error)}</Message>
      </Match>
      <Match when={view()}>
        {(v) => {
          const order = createMemo(() => {
            const idx = v().states.map((_, i) => i);
            return plotSettings.order === 'name'
              ? idx.sort((a, b) => v().states[a].localeCompare(v().states[b]))
              : plotSettings.order === 'mean'
                ? idx.sort((a, b) => (v().r[b] ?? -Infinity) - (v().r[a] ?? -Infinity))
                : idx;
          });
          const rows = createMemo(() =>
            order().map((i) => {
              const pv = corrected() ? (v().pAdj?.[i] ?? null) : v().p[i];
              return {
                name: v().states[i],
                value: v().r[i],
                nullLo: v().nullLo[i],
                nullHi: v().nullHi[i],
                significant: pv != null && pv <= alpha(),
              };
            }),
          );
          const state = () => Math.min(plotSettings.state, v().states.length - 1);
          const halves = createMemo(() => v().halves(state()));
          const csv = () =>
            perStateCsv(v().states, {
              stability_r: v().r,
              null_low: v().nullLo,
              null_high: v().nullHi,
              p_value: v().p,
              ...(v().pAdj ? { p_adjusted: v().pAdj! } : {}),
            });
          return (
            <div class="cb-pn-view">
              <div class="cb-pn-viewhead">
                <Summary
                  meta={meta()}
                  method="stability"
                  nStates={v().states.length}
                  details={v().label}
                  limits={[
                    'Correlation of each state between the first and second half of the session',
                  ]}
                />
              </div>
              <div class="cb-pn-fig cb-pn-fig--pair">
                <Figure
                  title="Population vector stability"
                  view={p}
                  resultName="pv_stability"
                  file="population_vector_stability"
                  csv={csv}
                  settings={
                    <Row label="State order">
                      <select
                        value={plotSettings.order}
                        onChange={(e) =>
                          setPlotSettings(
                            'order',
                            e.currentTarget.value as 'listed' | 'name' | 'mean',
                          )
                        }
                      >
                        <option value="listed">As listed</option>
                        <option value="name">By name</option>
                        <option value="mean">By stability r, highest first</option>
                      </select>
                    </Row>
                  }
                  howTo={
                    <>
                      <p>
                        For each state, the population vector (mean neural value of each cell) in
                        the first block of the session is correlated with the one in the second
                        block. A high r means the pattern of the state is reproducible.
                      </p>
                      <p>
                        The dot is the observed r; the gray bar is the middle 95% of the shuffled
                        (cell-shift) null. Filled dots with * are above the null (
                        {corrected() ? 'max-stat adjusted p' : 'uncorrected p'} below alpha). Click
                        a state to see its two halves on the right.
                      </p>
                    </>
                  }
                >
                  {(r) => (
                    <DotPlot
                      label="Population vector stability by state"
                      svgRef={r.svgRef}
                      rows={rows()}
                      xTitle="Stability: correlation between first and second half (r)"
                      selected={order().indexOf(state())}
                      onSelect={(row) => setPlotSettings('state', order()[row])}
                    />
                  )}
                </Figure>
                <Figure
                  title={`Halves: ${v().states[state()]}`}
                  view={p}
                  resultName="pv_stability"
                  file="population_vector_halves"
                  csv={() => ({
                    header: ['cell', 'first_half', 'second_half'],
                    rows: halves().a.map((a, i) => [
                      i + 1,
                      Number.isFinite(a) ? a : null,
                      Number.isFinite(halves().b[i]) ? halves().b[i] : null,
                    ]),
                  })}
                  howTo={
                    <p>
                      Each dot is one cell. x is the cell's mean neural value in the state during
                      the first block, y during the second block. Points near the dashed identity
                      line mean the cell behaves the same in both halves; the correlation r on the
                      left is computed over these cells ({fmt(v().r[state()], 3)} for this state).
                    </p>
                  }
                >
                  {(r) => (
                    <Scatter
                      label="First half versus second half population vector"
                      svgRef={r.svgRef}
                      points={halves().a.map((a, i) => ({
                        x: a,
                        y: halves().b[i],
                        name: `Cell ${i + 1}`,
                      }))}
                      xTitle="Mean neural value, first half"
                      yTitle="Mean neural value, second half"
                      diagonal
                    />
                  )}
                </Figure>
              </div>
            </div>
          );
        }}
      </Match>
      <Match when={view.loading}>
        <Message>Loading the saved values</Message>
      </Match>
      <Match when={true}>
        <Message>This run holds no population vector stability.</Message>
      </Match>
    </Switch>
  );
}
