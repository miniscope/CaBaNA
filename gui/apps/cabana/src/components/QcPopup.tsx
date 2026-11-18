// The frame shared by every QC and Preprocess pop-up: a tinted title row with the note and one
// Actions menu (Apply changes, Continue without changes), the flags (or what the settings do)
// above the plot on the left, and every control in a grey column on the right. Either action
// marks the section reviewed and closes; × closes without marking it, and asks first when choices
// are pending. Choices are a draft the caller keeps: nothing changes until Apply changes.

import { For, Show, type JSX } from 'solid-js';
import { InfoTip } from '../panels/InfoTip.tsx';
import type { MenuItem } from '../lib/actions-menu.ts';
import { ActionsMenu } from './ActionsMenu.tsx';
import { Modal } from './Modal.tsx';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function QcPopup(props: {
  /** qc: amber flags; prep: purple settings. */
  kind: 'qc' | 'prep';
  title: string;
  /** Mono sub-title after the title, e.g. "13 cells flagged · 1 note". */
  sub: string;
  /** How to read the window, in the help marker. */
  help: JSX.Element;
  /** Above the plot: the flags box (qc) or what the settings do (prep). */
  top: JSX.Element;
  /** The plot. */
  children: JSX.Element;
  /** The controls, top of the right column. */
  right: JSX.Element;
  /** Restore original data (qc) or Reset to defaults (prep): a draft state, applied with the rest. */
  resetChecked: boolean;
  onReset: (on: boolean) => void;
  /** Under the reset checkbox. */
  resetNote?: string;
  status: string;
  /** Choices not yet applied; × asks before discarding them. */
  pending: number;
  /** What a pending choice is called in the question: "correction", "setting". */
  pendingWord?: string;
  width?: number;
  height?: number;
  onApply: () => void;
  onContinue: () => void;
  /** Closes the window without marking the section reviewed. */
  onClose: () => void;
  /** Prep only: the item that imports settings from another project. */
  onImport?: () => void;
}): JSX.Element {
  const qc = () => props.kind === 'qc';
  const word = () => props.pendingWord ?? (qc() ? 'correction' : 'setting');
  const items = (): MenuItem[] => [
    // Each action closes the window, so no separate close call is needed after it.
    { kind: 'action', label: 'Apply changes', onSelect: () => (props.onApply(), props.onClose()) },
    {
      kind: 'action',
      label: 'Continue without changes',
      onSelect: () => (props.onContinue(), props.onClose()),
    },
    ...(!qc() && props.onImport
      ? [
          { kind: 'separator' } as MenuItem,
          {
            kind: 'action',
            label: 'Import settings from another project…',
            onSelect: () => props.onImport?.(),
          } as MenuItem,
        ]
      : []),
  ];
  const n = () => props.pending;
  return (
    <Modal
      label={props.title}
      title={props.title}
      headClass={`cb-qp__head cb-qp__head--${props.kind}`}
      head={<span class="cb-qp__sub">{props.sub}</span>}
      width={props.width ?? 1120}
      height={props.height ?? 590}
      closeLabel="Close without marking this section reviewed"
      confirmTitle="Close without applying?"
      discardLabel="Discard and close"
      confirmClose={() =>
        n()
          ? `${plural(n(), word())} ${n() === 1 ? 'is' : 'are'} ${qc() ? 'selected' : 'changed'} but not applied. Closing discards ${n() === 1 ? 'it' : 'them'} and leaves this section not reviewed.`
          : undefined
      }
      actions={
        <>
          <InfoTip label={`About ${props.title}`}>{props.help}</InfoTip>
          <span class="cb-qp__note">
            Either action marks this section reviewed and closes the window.
          </span>
          <ActionsMenu items={items()} />
        </>
      }
      onClose={props.onClose}
    >
      <div class="cb-qp">
        <div class="cb-qp__main">
          {props.top}
          <div class="cb-qp__plot">{props.children}</div>
        </div>
        <aside class="cb-qp__side" aria-label="Controls">
          {props.right}
          <label class="cb-qp__reset">
            <input
              type="checkbox"
              checked={props.resetChecked}
              onChange={(e) => props.onReset(e.currentTarget.checked)}
            />
            <span>
              {qc() ? 'Restore original data' : 'Reset to defaults'}
              <span class="cb-muted">
                {props.resetNote ??
                  (qc()
                    ? 'Shows this data with no corrections. Takes effect on Apply changes.'
                    : 'Shows the default settings. Takes effect on Apply changes.')}
              </span>
            </span>
          </label>
          <Show when={props.status}>
            <div class="cb-qp__status cb-muted" role="status">
              Status: {props.status}
            </div>
          </Show>
        </aside>
      </div>
    </Modal>
  );
}

/** The flags box: numbered flags and the line of what passed. */
export function FlagsBox(props: {
  flags: { n: number; title: string; detail: string }[];
  passed: string;
}): JSX.Element {
  return (
    <div class="cb-qp__flags">
      <Show when={props.flags.length} fallback={<div class="cb-qp__noflags">No flags</div>}>
        <For each={props.flags}>
          {(f) => (
            <div class="cb-qp__flag">
              <span class="cb-qp__num">{f.n}</span>
              <span>{f.title}</span>
              <Show when={f.detail}>
                <span class="cb-muted">{f.detail}</span>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.passed}>
        <div class="cb-qp__passed cb-muted">{props.passed}</div>
      </Show>
    </div>
  );
}

/** Heading of a group of controls in the right column. */
export const SideHead = (props: { children: JSX.Element }): JSX.Element => (
  <div class="cb-qp__sh">{props.children}</div>
);
