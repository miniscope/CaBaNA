import { createSignal, Show, type JSX } from 'solid-js';
import { HowTo } from '../AurocResults.tsx';
import { ExportMenu, type ExportGroup } from './ExportMenu.tsx';

/**
 * A figure with its title, "How to read this plot", an Expand control and an Export menu. The
 * figure is drawn by `children(expanded)`; the view state lives in the caller, so expanding keeps
 * the selection, range and settings.
 */
export function PlotFrame(props: {
  title: string;
  howTo: JSX.Element;
  exports: ExportGroup[];
  /** Compact controls shown beside the title (for example the Plot settings button). */
  controls?: JSX.Element;
  children: (expanded: boolean) => JSX.Element;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const head = () => (
    <div class="cb-pf__head">
      <h3>{props.title}</h3>
      <HowTo title={props.title}>{props.howTo}</HowTo>
      <span class="cb-pf__side">
        {props.controls}
        <button
          type="button"
          class="btn-secondary"
          aria-pressed={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'Close' : 'Expand'}
        </button>
        <ExportMenu groups={props.exports} />
      </span>
    </div>
  );
  return (
    <section class="cb-pf" classList={{ 'cb-pf--expanded': expanded() }} aria-label={props.title}>
      {head()}
      <div class="cb-pf__body">{props.children(expanded())}</div>
      <Show when={expanded()}>
        <div class="cb-pf__scrim" onClick={() => setExpanded(false)} />
      </Show>
    </section>
  );
}
