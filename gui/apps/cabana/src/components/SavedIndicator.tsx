import { createSignal, For, Show, type JSX } from 'solid-js';
import { Popover } from '../panels/Popover.tsx';
import { clockText, SAVE_STATES, saveStatus, saveText } from '../lib/save-status.ts';

/** The save state as a short line in the header; click for what was saved, when and where. */
export function SavedIndicator(): JSX.Element {
  const [anchor, setAnchor] = createSignal<HTMLButtonElement>();
  const [open, setOpen] = createSignal(false);
  const line = () => saveText(saveStatus());
  const saved = () => {
    const s = saveStatus();
    return s.kind === 'saved' ? s : null;
  };
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        class={`cb-saved cb-saved--${line().tone}`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {line().text}
      </button>
      <Show when={open() && anchor()}>
        <Popover anchor={anchor()!} width={430} label="Save status" onClose={() => setOpen(false)}>
          <div class="cb-saved__title">{line().text}</div>
          <Show when={saved()}>
            {(s) => (
              <>
                <div class="cb-saved__sub">Saved automatically to</div>
                <div class="cb-saved__dir">{s().dir}</div>
                <div class="cb-saved__files">
                  <For each={s().files}>
                    {(f) => (
                      <>
                        <span class="cb-saved__file">{f.name}</span>
                        <span class="cb-muted">{clockText(f.at)}</span>
                      </>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
          <div class="cb-saved__head">the indicator can read</div>
          <For each={SAVE_STATES}>
            {(s) => (
              <div class="cb-saved__state">
                <span class={`cb-saved__text cb-saved__text--${s.tone}`}>{s.text}</span>
                <span class="cb-muted">{s.detail}</span>
              </div>
            )}
          </For>
        </Popover>
      </Show>
    </>
  );
}
