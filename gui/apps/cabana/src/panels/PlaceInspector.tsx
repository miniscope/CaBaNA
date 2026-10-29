import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { HowToRead } from './parts.tsx';
import { OVERALL, TEST_ICON, whyUndefined, type Test } from '../lib/place-outcome.ts';
import { displayMap, gradientCss, maxOf, placeDisplay } from '../lib/place-display.ts';
import { SORTS, type SortKey } from '../lib/place-table.ts';
import { fieldCentroid } from '../lib/placecells.ts';
import { cell } from '../lib/store.ts';
import { FootprintStrip } from './FootprintStrip.tsx';
import { InfoTip } from './InfoTip.tsx';
import { MapAppearance } from './MapAppearance.tsx';
import type { PlaceOutcome } from '../lib/place-run.ts';
import { num, outcomeClass, p3, pText, testsOf, type ResultsCtx } from './place-ctx.ts';
import { ShuffleHistogram } from './PlaceCharts.tsx';
import { RateMap } from './RateMap.tsx';

const VERDICT: Record<Test, string> = {
  pass: 'Significant',
  fail: 'Not significant',
  undef: 'Not evaluated',
};

/** An outcome with its symbol, so it never depends on color. */
export const Outcome = (props: { o: keyof typeof OVERALL }): JSX.Element => (
  <span class={outcomeClass(props.o)}>
    <span aria-hidden="true">{OVERALL[props.o].icon}</span> {OVERALL[props.o].label}
  </span>
);

/** The searchable, sortable cell list. */
const ROW_PX = 28; // one table row, in px
function CellList(props: { ctx: ResultsCtx }): JSX.Element {
  const c = () => props.ctx;
  // The list is paged to the rows that fit, so it never scrolls inside its box.
  const [perPage, setPerPage] = createSignal(7);
  const [page, setPage] = createSignal(0);
  const pages = () => Math.max(1, Math.ceil(c().list().length / perPage()));
  const shown = createMemo(() => {
    const at = Math.min(page(), pages() - 1);
    return c()
      .list()
      .slice(at * perPage(), (at + 1) * perPage());
  });
  // Turn to the page of the selected cell when it changes.
  createEffect(() => {
    const k = c()
      .list()
      .findIndex((row) => row.id === cell());
    if (k >= 0) setPage(Math.floor(k / perPage()));
  });
  let box!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(([e]) =>
      setPerPage(Math.max(3, Math.floor((e.contentRect.height - ROW_PX) / ROW_PX))),
    );
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });
  const head = (key: SortKey, label: string) => (
    <th
      class="cb-sortable"
      aria-sort={c().sort() === key ? (c().desc() ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        class="cb-link"
        onClick={() =>
          c().sort() === key
            ? c().setSort(key, !c().desc())
            : c().setSort(key, SORTS.find((s) => s.key === key)!.desc)
        }
      >
        {label}
        {c().sort() === key ? (c().desc() ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  const sortLabel = () => SORTS.find((s) => s.key === c().sort())?.label ?? '';
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    c().step(e.key === 'ArrowDown' ? 1 : -1);
    queueMicrotask(() => document.getElementById(`pc-row-${cell()}`)?.focus());
  };
  return (
    <div class="cb-inspect__list">
      <input
        class="cb-search"
        type="search"
        inputmode="numeric"
        placeholder="Find cell…"
        aria-label="Find cell number"
        value={c().query()}
        onInput={(e) => c().setQuery(e.currentTarget.value.replace(/\D/g, ''))}
      />
      <label class="cb-sortpick">
        Sort by
        <select
          value={c().sort()}
          onChange={(e) => {
            const s = SORTS.find((x) => x.key === e.currentTarget.value)!;
            c().setSort(s.key, s.desc);
          }}
        >
          <For each={SORTS}>{(s) => <option value={s.key}>{s.label}</option>}</For>
        </select>
      </label>
      <div class="cb-table-page" ref={box}>
        <table class="cb-stats">
          <thead>
            <tr>
              {head('cell', 'Cell')}
              {head('overall', 'Outcome')}
              {head('pInformation', 'Information p')}
              {head('pStability', 'Stability p')}
            </tr>
          </thead>
          <tbody onKeyDown={onKey}>
            <For each={shown()}>
              {(row) => (
                <tr
                  id={`pc-row-${row.id}`}
                  class="cb-row-pick"
                  classList={{ 'cb-row-pick--on': row.id === cell() }}
                  tabindex={row.id === cell() ? 0 : -1}
                  aria-selected={row.id === cell()}
                  onClick={() => c().pick(row.i)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && c().pick(row.i)}
                >
                  <td>{row.id + 1}</td>
                  <td>
                    <span class={outcomeClass(row.overall)} title={OVERALL[row.overall].label}>
                      <span aria-hidden="true">{OVERALL[row.overall].icon}</span>
                      <span class="cb-sr">{OVERALL[row.overall].label}</span>
                    </span>
                  </td>
                  <td>{p3(c().out.result.pInformation[row.i])}</td>
                  <td>{p3(c().out.result.pStability[row.i])}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={!c().list().length}>
          <div class="cb-empty">No cells match this filter or search.</div>
        </Show>
      </div>
      <div class="cb-pager">
        <span class="cb-muted">
          {c().list().length} of {c().rows().length} cells · sorted by {sortLabel().toLowerCase()}{' '}
          {c().desc() ? '↓' : '↑'}
        </span>
        <span class="cb-pager__btns">
          <button
            class="btn-secondary btn-small"
            aria-label="Previous cells"
            disabled={page() === 0}
            onClick={() => setPage(Math.max(0, page() - 1))}
          >
            ‹
          </button>
          <span class="cb-muted">
            {Math.min(page(), pages() - 1) + 1} / {pages()}
          </span>
          <button
            class="btn-secondary btn-small"
            aria-label="Next cells"
            disabled={page() >= pages() - 1}
            onClick={() => setPage(Math.min(pages() - 1, page() + 1))}
          >
            ›
          </button>
        </span>
      </div>
    </div>
  );
}

/** One test of the place-cell call: the score, its p, and whether it is significant. */
function Stat(props: {
  name: string;
  info: string;
  test: Test;
  value: string;
  unit: string;
  p: number;
  why: string | undefined;
}): JSX.Element {
  return (
    <div class="cb-stat">
      <div class="cb-stat__name">
        {props.name}
        <InfoTip label={`About ${props.name.toLowerCase()}`}>{props.info}</InfoTip>
      </div>
      <div class="cb-stat__value">
        {props.value} <span>{props.unit}</span>
      </div>
      <div class={`cb-o cb-o--${props.test}`}>
        {pText(props.p)} · <span aria-hidden="true">{TEST_ICON[props.test]}</span>{' '}
        {VERDICT[props.test]}
      </div>
      <Show when={props.test === 'undef'}>
        <div class="cb-muted">{props.why ?? 'No valid shifted values to compare with.'}</div>
      </Show>
    </div>
  );
}

type CellProps = { out: PlaceOutcome; i: number };

/** The two tests of the place-cell call for one cell. */
export function TestStats(props: CellProps): JSX.Element {
  const r = () => props.out.result;
  const i = () => props.i;
  const alpha = () => props.out.settings.alpha;
  const out = () => props.out;
  return (
    <div class="cb-tests">
      <Stat
        name="Spatial information"
        info={`How concentrated this cell’s events are across bins. It is significant when it is higher than the value from shifted copies of the cell’s neural data (p < ${alpha()}).`}
        test={testsOf(out(), i()).info}
        value={num(r().information[i()], 3)}
        unit="bits/event"
        p={r().pInformation[i()]}
        why={whyUndefined(out(), i(), 'information')}
      />
      <Stat
        name="Spatial stability"
        info={`How well the first-half and second-half maps correlate. It is significant when the correlation is higher than the one from shifted copies of the cell’s neural data (p < ${alpha()}).`}
        test={testsOf(out(), i()).stab}
        value={num(r().stability[i()])}
        unit="r"
        p={r().pStability[i()]}
        why={whyUndefined(out(), i(), 'stability')}
      />
    </div>
  );
}

/** Field outlines measured for one cell, folded. Descriptive only. */
export function FieldDetails(props: CellProps): JSX.Element {
  const r = () => props.out.result;
  const i = () => props.i;
  const s = () => props.out.settings;
  const out = () => props.out;
  const nf = () => r().nFields[i()];
  return (
    <section>
      <div class="cb-muted">Descriptive · not used for classification</div>
      <div>
        <div class="cb-fieldstats">
          <div>
            <div class="cb-muted">Outlined regions</div>
            <strong>{Number.isNaN(nf()) ? '–' : nf()}</strong>
          </div>
          <div>
            <div class="cb-muted">Inside / outside rate</div>
            <strong>{num(r().inOut[i()])}</strong>
          </div>
          <div>
            <div class="cb-muted">Ratio p-value</div>
            <strong>{p3(r().pFields[i()])}</strong>
          </div>
        </div>
        <Show when={whyUndefined(out(), i(), 'inOut')}>{(w) => <p class="cb-muted">{w()}</p>}</Show>
        <p class="cb-muted">
          Outlines mark connected bins above {s().fieldThreshold * 100}% of this cell’s peak rate,
          at least {s().minFieldBins} bins in size. Regions are not tested one by one, and a cell
          can have outlines without meeting the place-cell criteria.
        </p>
        <details class="cb-notebox">
          <summary>How fields are defined</summary>
          <div class="cb-muted">
            <p>
              Bins visited for under {s().minOccFieldsS} s are left out. Bins at or above{' '}
              {s().fieldThreshold * 100}% of the cell’s peak rate that touch each other form one
              region; regions under {s().minFieldBins} bins are dropped. The cross marks the center
              of the largest region.
            </p>
            <p>
              The inside / outside rate is the mean rate inside all outlines over the mean outside.
              Its p-value comes from the same shifted copies as the two tests, and it is not used
              for the place-cell call.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

/** The cell's real scores against its shifted copies, folded. */
export function ShuffleDetails(props: CellProps): JSX.Element {
  const r = () => props.out.result;
  const i = () => props.i;
  const alpha = () => props.out.settings.alpha;
  const nulls = (a: Float32Array) => a.subarray(i() * r().nShifts, (i() + 1) * r().nShifts);
  return (
    <section>
      <Show when={!props.out.nullKept}>
        <p class="cb-muted">
          {props.out.record?.null_not_kept
            ? 'Null draws were not kept for this run.'
            : 'Null draws are not in the copy saved in this browser. Start the Python engine to see them.'}
        </p>
      </Show>
      <Show when={props.out.nullKept}>
        <div>
          <div class="cb-hists">
            <ShuffleHistogram
              title="Spatial information"
              unit="bits/event"
              nullValues={nulls(r().nullInformation)}
              observed={r().information[i()]}
              alpha={alpha()}
              p={p3(r().pInformation[i()])}
            />
            <ShuffleHistogram
              title="Spatial stability"
              unit="r"
              nullValues={nulls(r().nullStability)}
              observed={r().stability[i()]}
              alpha={alpha()}
              p={p3(r().pStability[i()])}
            />
            <ShuffleHistogram
              title="In/out ratio (not in the call)"
              unit=""
              nullValues={nulls(r().nullInOut)}
              observed={r().inOut[i()]}
              alpha={alpha()}
              p={p3(r().pFields[i()])}
            />
          </div>
          <HowToRead>
            <p>
              Each plot compares one real score with the scores obtained after circular time shifts
              of the cell’s neural data. Grey bars show how often each shifted score occurred. The
              red line is the real score. A red line to the right of the dashed line means the real
              score is higher than almost all shifted scores, which is what p &lt; {alpha()} means
              here. The in/out ratio is shown for reference and is not used for the call.
            </p>
          </HowToRead>
          <div class="cb-muted">
            Grey bars: this cell’s value after each of {r().nShifts} circular shifts of its neural
            data. Red line: the real value. Dashed line: the value only {alpha() * 100}% of shifted
            values reach, so a red line to its right means p &lt; {alpha()}.
          </div>
        </div>
      </Show>
    </section>
  );
}

const INSPECTOR_VIEWS = [
  ['tests', 'Tests'],
  ['maps', 'Maps'],
  ['fields', 'Fields'],
  ['trace', 'Footprint & trace'],
  ['shuffles', 'Shuffled scores'],
] as const;
const [part, setPart] = createSignal<(typeof INSPECTOR_VIEWS)[number][0]>('tests');

/** The cell list beside the selected cell: scores, maps, field measurements, footprint, shuffled scores. */
export function PlaceInspector(props: {
  ctx: ResultsCtx;
  outlines: boolean;
  setOutlines: (v: boolean) => void;
}): JSX.Element {
  const c = () => props.ctx;
  const out = () => c().out;
  const r = () => out().result;
  const i = () => c().selected();
  const s = () => out().settings;
  const { nx, ny, open, bin } = props.ctx.out.data.grid;
  const mapProps = { nx, ny, open, bin, arenaCm: props.ctx.out.arenaCm };
  const shape: [number, number] = [ny, nx];
  const slice = (a: Float32Array, k: number) => a.subarray(k * r().nStates, (k + 1) * r().nStates);
  const maps = () =>
    [
      ['Full-session event rate', displayMap(slice(r().rate, i()), shape)],
      ['First half', displayMap(slice(r().rateA, i()), shape)],
      ['Second half', displayMap(slice(r().rateB, i()), shape)],
    ] as const;
  const shared = () => maxOf(...maps().map(([, m]) => m));
  const max = (m: Float32Array) => (placeDisplay.scale === 'shared' ? shared() : maxOf(m));
  const fields = () => r().fieldLabels.subarray(i() * r().nStates, (i() + 1) * r().nStates);
  const centroid = () => fieldCentroid(slice(r().rate, i()), fields(), nx);
  const overall = () =>
    c()
      .rows()
      .find((row) => row.i === i())!.overall;
  const sizeCm = (b: number) => num(b * bin, 1);

  return (
    <div class="cb-inspect">
      <CellList ctx={c()} />
      <Show when={i() >= 0}>
        <div class="cb-inspect__main">
          <div class="cb-inspector__head">
            <h4>Cell {cell() + 1}</h4>
            <Outcome o={overall()} />
            <span class="cb-inspector__nav">
              <button
                class="btn-secondary btn-small"
                onClick={() => c().step(-1)}
                aria-label="Previous cell"
              >
                ‹ Previous
              </button>
              <button
                class="btn-secondary btn-small"
                onClick={() => c().step(1)}
                aria-label="Next cell"
              >
                Next ›
              </button>
            </span>
          </div>
          <Show when={c().position() < 0}>
            <p class="cb-muted">This cell is hidden by the current filter or search.</p>
          </Show>

          <div class="cb-seg" role="tablist" aria-label="Cell inspector views">
            <For each={INSPECTOR_VIEWS}>
              {([id, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={part() === id}
                  classList={{ 'cb-seg__on': part() === id }}
                  onClick={() => setPart(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>

          <div class="cb-inspect__part">
            <Show when={part() === 'tests'}>
              <TestStats out={out()} i={i()} />
            </Show>

            <Show when={part() === 'maps'}>
              <div class="cb-inspect-maps">
                <For each={maps()}>
                  {([title, values], k) => (
                    <figure classList={{ 'cb-inspect-maps__main': k() === 0 }}>
                      <figcaption>{title}</figcaption>
                      <RateMap
                        values={values}
                        max={max(values)}
                        size={k() === 0 ? 122 : 58}
                        fields={props.outlines && k() === 0 ? fields() : undefined}
                        centroid={props.outlines && k() === 0 ? centroid() : undefined}
                        {...mapProps}
                      />
                    </figure>
                  )}
                </For>
              </div>
              <div class="cb-legend" role="img" aria-label="Color scale">
                <span class="cb-legend__item">Event rate 0</span>
                <span class="cb-legend__bar" style={{ background: gradientCss('right') }} />
                <span class="cb-legend__item">
                  {num(shared(), 1)} events/s
                  {placeDisplay.scale === 'own' ? ' (each map on its own scale)' : ''}
                </span>
                <label class="cb-check-inline">
                  <input
                    type="checkbox"
                    checked={props.outlines}
                    onChange={(e) => props.setOutlines(e.currentTarget.checked)}
                  />
                  Show field outlines
                </label>
                <MapAppearance limits />
                <HowToRead>
                  <p>
                    Each map is the arena seen from above. Color shows the cell’s event rate in each
                    bin: events divided by the time spent there, then smoothed. The large map uses
                    the whole session; the two small maps use the first and second half. A stable
                    place cell has a similar pattern in both halves. Grey bins (visited under{' '}
                    {s().minOccFieldsS} s in the whole session, {s().minOccS} s in each half) have
                    no rate; white bins are outside the arena. Bins are {num(bin, 1)} cm; maps are
                    smoothed by {out().sigma} bins ({sizeCm(out().sigma)} cm)
                    {placeDisplay.sigma > 0 ? `, drawn with ${placeDisplay.sigma} more` : ''}.
                    Outlines mark connected bins above the chosen fraction of the cell’s peak rate.
                  </p>
                </HowToRead>
              </div>
            </Show>

            <Show when={part() === 'fields'}>
              <FieldDetails out={out()} i={i()} />
            </Show>
            <Show when={part() === 'trace'}>
              <FootprintStrip out={out()} i={i()} />
            </Show>
            <Show when={part() === 'shuffles'}>
              <ShuffleDetails out={out()} i={i()} />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
