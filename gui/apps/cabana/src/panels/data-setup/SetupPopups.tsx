// The pop-ups of the Data setup page. The view frame (look only), the Experimental setup and the
// arena editor are new; anything else an entry can be (timestamp alignment, an empty slot to load,
// the Preprocess section) is still the earlier pop-up in EntryView.tsx, which Data visualization
// also uses.

import { Match, Switch, type JSX } from 'solid-js';
import { entry, popupOpen, sectionOf } from '../../lib/data-setup-view.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import { loaded } from '../../lib/store.ts';
import { ArenaEditor } from '../ArenaEditor.tsx';
import { closeArenaEditor } from './arena-editor.ts';
import { EntryPopup } from './EntryView.tsx';
import { ExperimentalSetup } from './ExperimentalSetup.tsx';
import { ViewDataPopup } from './ViewData.tsx';

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

export function SetupPopups(props: { onApplied: (text: string) => void }): JSX.Element {
  const slot = () => SLOTS.find((s) => s.id === entry() && s.id !== 'config')?.id;
  const open = () => popupOpen() && entry() !== 'start';
  const arena = () => open() && slot() === 'position' && sectionOf('position') === 'arena';
  const view = () => {
    const id = slot();
    return open() && id && isLoaded(id) && ['overview', 'qc'].includes(sectionOf(id))
      ? id
      : undefined;
  };
  return (
    <Switch fallback={<EntryPopup />}>
      <Match when={open() && entry() === 'config'}>
        <ExperimentalSetup onApplied={props.onApplied} />
      </Match>
      <Match when={arena()}>
        <ArenaEditor onClose={closeArenaEditor} />
      </Match>
      <Match when={view()}>{(id) => <ViewDataPopup id={id()} />}</Match>
    </Switch>
  );
}
