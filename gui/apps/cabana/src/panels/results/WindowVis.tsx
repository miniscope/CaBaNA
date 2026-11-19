// Visualizations: the Plot type drop-down, that plot's own controls, How to read this plot and
// Expand. The plot takes most of the window; the expanded view keeps the same selection.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { openPlotEditor } from './PlotEditor.tsx';
import { PagePlot } from './PagePlot.tsx';
import type { PlotChoice } from './plot-choice.ts';

/** The drop-down, controls and plot of the current choice. `expanded` is the large window's copy. */
function PlotBody(props: {
  record: RunRecord;
  choices: PlotChoice[];
  current: PlotChoice | undefined;
  onPick: (id: string) => void;
  loading: boolean;
  note?: string;
  onEdit: () => void;
  expanded: boolean;
  onExpand: () => void;
}): JSX.Element {
  const views = () => props.choices.filter((c) => c.view);
  const pages = () => props.choices.filter((c) => c.page);
  const view = () => props.current?.view;
  const blocked = () => pages().find((c) => c.disabled)?.disabled;
  return (
    <>
      <div class="cb-wv__bar">
        <label class="cb-wv__lab" for={props.expanded ? 'cb-plot-type-x' : 'cb-plot-type'}>
          Plot type
        </label>
        <select
          id={props.expanded ? 'cb-plot-type-x' : 'cb-plot-type'}
          class="cb-rx__pick cb-wv__pick"
          value={props.current?.id ?? ''}
          disabled={!props.choices.length}
          onChange={(e) => props.onPick(e.currentTarget.value)}
        >
          <For each={views()}>{(c) => <option value={c.id}>{c.label}</option>}</For>
          <Show when={pages().length}>
            <optgroup label="More plots of this analysis">
              <For each={pages()}>
                {(c) => (
                  <option value={c.id} disabled={!!c.disabled} title={c.disabled}>
                    {c.label}
                    {c.disabled ? ' (not available)' : ''}
                  </option>
                )}
              </For>
            </optgroup>
          </Show>
        </select>
        <Show when={view()?.help}>{(h) => h()()}</Show>
        <Show when={view()?.switcher}>
          {(s) => (
            <span class="cb-wv__sw">
              <span class="cb-wv__lab">{s().label}</span>
              <span class="cb-seg" role="group" aria-label={s().label}>
                <For each={s().options}>
                  {(name, i) => (
                    <button
                      type="button"
                      classList={{ 'cb-seg__on': s().index() === i() }}
                      aria-pressed={s().index() === i()}
                      onClick={() => s().set(i())}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </span>
            </span>
          )}
        </Show>
        <span class="cb-spacer" />
        <Show when={!props.expanded}>
          <button
            type="button"
            class="btn-secondary btn-small cb-wv__expand"
            title="Expand this plot"
            aria-label="Expand this plot"
            onClick={() => props.onExpand()}
          >
            ⤢
          </button>
        </Show>
      </div>
      <Show when={view()?.subtitle}>{(s) => <p class="cb-muted cb-rx__sub">{s()()}</p>}</Show>
      <Show when={blocked() && !props.expanded}>
        <p class="cb-ex__note" role="note">
          More plots of this analysis are not available for this run: {blocked()}
        </p>
      </Show>
      <div class="cb-wv__body">
        <Show
          when={props.current}
          fallback={
            <p class="cb-muted" role="status">
              {props.loading
                ? 'Reading the saved run.'
                : (props.note ?? 'The saved tables this view needs are not available.')}
            </p>
          }
        >
          {(c) => (
            <Show when={c().page} fallback={c().view!.main()}>
              {(p) => <PagePlot record={props.record} plot={p()} onEdit={props.onEdit} />}
            </Show>
          )}
        </Show>
      </div>
    </>
  );
}

export function VisPane(props: {
  record: RunRecord;
  choices: PlotChoice[];
  current: PlotChoice | undefined;
  onPick: (id: string) => void;
  loading: boolean;
  note?: string;
  onEdit: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const spec = () => props.current?.view?.editSpec?.();
  const body = (isExpanded: boolean) => (
    <PlotBody {...props} expanded={isExpanded} onExpand={() => setExpanded(true)} />
  );
  return (
    <>
      <section class="cb-rx__card cb-wv" aria-label="Plot">
        <Show
          when={!expanded()}
          fallback={<p class="cb-muted cb-wv__open">This plot is open in the expanded view.</p>}
        >
          {body(false)}
        </Show>
      </section>
      <Show when={expanded()}>
        <Modal
          label="Plot"
          title={props.current?.label ?? 'Plot'}
          inset={{ x: 64, y: 40 }}
          onClose={() => setExpanded(false)}
          actions={
            <button
              type="button"
              class="btn-secondary btn-small"
              disabled={!spec()}
              title={spec() ? undefined : 'This plot has no plot editor.'}
              onClick={() => {
                const s = spec();
                if (s) openPlotEditor(s);
              }}
            >
              Edit plot
            </button>
          }
        >
          <div class="cb-wv cb-wv--expanded">{body(true)}</div>
        </Modal>
      </Show>
    </>
  );
}
