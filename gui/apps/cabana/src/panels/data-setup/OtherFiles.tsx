// Files no data type matched, one row each: name, what the file holds, an Identify file menu and
// the result. A valid choice moves the file into its card (see lib/other-files.ts).

import { createEffect, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { factsLine } from '../../lib/file-format.ts';
import {
  BEHAVIOR_CHOICES,
  describe,
  identifiedAs,
  identify,
  infoOf,
  NEURAL_CHOICES,
  slotName,
} from '../../lib/other-files.ts';
import type { SlotId } from '../../lib/slots.ts';
import { unrecognized } from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';

function Row(props: { file: File }): JSX.Element {
  createEffect(() => void describe(props.file));
  const picked = () => identifiedAs(props.file);
  const choose = (c: SlotId | 'supplementary') => () => void identify(props.file, c);
  const items = (): MenuItem[] => [
    { kind: 'header', label: 'neural data' },
    ...NEURAL_CHOICES.map((id): MenuItem => ({
      kind: 'action',
      label: slotName(id),
      onSelect: choose(id),
    })),
    { kind: 'header', label: 'behavior data' },
    ...BEHAVIOR_CHOICES.map((id): MenuItem => ({
      kind: 'action',
      label: slotName(id),
      onSelect: choose(id),
    })),
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Supplementary (not used in analysis)',
      onSelect: choose('supplementary'),
    },
  ];
  const label = () => {
    const c = picked()?.choice;
    return !c ? 'Select file type' : c === 'supplementary' ? 'Supplementary' : slotName(c);
  };
  return (
    <div class="cb-sp-other__row">
      <span class="cb-sp-mono" title={props.file.name}>
        {props.file.name}
      </span>
      <span class="cb-sp-row__desc">
        {infoOf(props.file) ? factsLine(infoOf(props.file)!) : ''}
      </span>
      <span>
        <ActionsMenu label={label()} items={items} class="btn-secondary cb-sp-other__pick" />
      </span>
      <span class="cb-sp-other__result">
        <Show when={picked()} fallback={<span class="cb-muted">Not used until identified.</span>}>
          <Show
            when={picked()!.reason}
            fallback={<span class="cb-muted">Supplementary: not used in analysis.</span>}
          >
            <span class="cb-ds-tone--warn">{picked()!.reason}</span>
          </Show>
        </Show>
      </span>
    </div>
  );
}

/** Shown only while some file is unmatched. */
export function OtherFiles(): JSX.Element {
  const n = () => unrecognized().length;
  return (
    <section class="cb-sp-other" aria-label="Other uploaded files">
      <header class="cb-sp-card__head">
        <h3>Other uploaded files</h3>
        <span class="cb-muted">
          {n()} {n() === 1 ? 'file' : 'files'} not matched
        </span>
        <InfoTip label="About other uploaded files">
          CaBaNA matches files to data types by name. A file that matched none is listed here.
          Choose its type and the file is checked against what that type needs; if it fits, it moves
          into its card.
        </InfoTip>
        <span class="cb-muted cb-sp-other__hint">
          Identify each file so it can be used in the analysis.
        </span>
      </header>
      <div class="cb-sp-other__rows">
        <For each={unrecognized().filter((u) => u.file)}>{(u) => <Row file={u.file!} />}</For>
      </div>
    </section>
  );
}
