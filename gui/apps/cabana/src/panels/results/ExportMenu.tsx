import { createSignal, For, Show, type JSX } from 'solid-js';
import { Popover } from '../Popover.tsx';

export interface ExportItem {
  label: string;
  /** Short note under the label, e.g. "Reflects the current plot settings". */
  note?: string;
  run: () => void | Promise<void>;
  /** Why the item is unavailable (shown instead of failing silently). */
  unavailable?: string;
}
export interface ExportGroup {
  title: string;
  items: ExportItem[];
}

/** An Export menu. Every item says whether it reflects the current plot styling. */
export function ExportMenu(props: { groups: ExportGroup[]; label?: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal('');
  let btn!: HTMLButtonElement;
  const run = async (i: ExportItem) => {
    setError('');
    try {
      await i.run();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {props.label ?? 'Export'} ▾
      </button>
      <Show when={open()}>
        <Popover anchor={btn} onClose={() => setOpen(false)} width={300} label="Export">
          <div class="cb-xm" role="menu">
            <For each={props.groups}>
              {(g) => (
                <>
                  <div class="cb-xm__group">{g.title}</div>
                  <For each={g.items}>
                    {(i) => (
                      <button
                        type="button"
                        role="menuitem"
                        class="cb-xm__item"
                        disabled={!!i.unavailable}
                        title={i.unavailable}
                        onClick={() => void run(i)}
                      >
                        <span>{i.label}</span>
                        <span class="cb-muted">{i.unavailable ?? i.note}</span>
                      </button>
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={error()}>
              <p class="cb-xm__err" role="alert">
                {error()}
              </p>
            </Show>
          </div>
        </Popover>
      </Show>
    </>
  );
}
