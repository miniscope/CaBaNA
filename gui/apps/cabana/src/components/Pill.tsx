import { Show, type JSX } from 'solid-js';
import type { RunType } from '../lib/preview.ts';
import type { RunKind, SettingsStatus } from '../lib/results-runs.ts';

export type PillTone = 'flag' | 'ok' | 'fail' | 'prep' | 'corr' | 'neutral' | 'outline';

/** A small status label. Always carries words: color alone never says the status. */
export function Pill(props: {
  tone?: PillTone;
  title?: string;
  onClick?: () => void;
  children: JSX.Element;
}): JSX.Element {
  const cls = () => `cb-pill cb-pill--${props.tone ?? 'neutral'}`;
  return (
    <Show
      when={props.onClick}
      fallback={
        <span class={cls()} title={props.title}>
          {props.children}
        </span>
      }
    >
      <button
        type="button"
        class={`${cls()} cb-pill--button`}
        title={props.title}
        onClick={() => props.onClick?.()}
      >
        {props.children}
      </button>
    </Show>
  );
}

const SETTINGS_TONE: Record<RunKind, PillTone> = {
  running: 'flag',
  failed: 'fail',
  partial: 'flag',
  cancelled: 'flag',
  current: 'ok',
  needs_rerun: 'corr',
  older: 'neutral',
  saved: 'neutral',
};

/** The Settings status of a run: Current, Needs rerun, Older settings, or the run's own state. */
export function SettingsPill(props: { status: SettingsStatus; reason?: string }): JSX.Element {
  return (
    <Pill
      tone={SETTINGS_TONE[props.status.kind]}
      title={
        props.reason ??
        props.status.reason ??
        (props.status.kind === 'saved' ? 'Cannot be compared with the settings now' : undefined)
      }
    >
      {props.status.text}
    </Pill>
  );
}

/** The Type of a run, outlined and neutral: "Full analysis · 1,000 shuffles", "Preview · 50 shuffles". */
export const RunTypePill = (props: { type: RunType }): JSX.Element => (
  <Pill tone="outline">{props.type.text}</Pill>
);
