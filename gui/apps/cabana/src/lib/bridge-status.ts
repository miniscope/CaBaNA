// Whether the Python engine is reachable, and what the installed framework can do.

import { createSignal } from 'solid-js';
import { bridge, bridgeConfig, type Capabilities, type CapabilityName } from './bridge-client.ts';

export type BridgeState =
  | { kind: 'offline'; reason: string }
  | { kind: 'connecting' }
  | { kind: 'ready'; capabilities: Capabilities };

export const START_COMMAND =
  'uv run --project gui/bridge cabana-bridge --project-dir gui/.project-dev --port 8791';

const initial = (): BridgeState =>
  bridgeConfig()
    ? { kind: 'connecting' }
    : { kind: 'offline', reason: 'The page was opened without ?bridge=' };
export const [bridgeState, setBridgeState] = createSignal<BridgeState>(initial());

/** Ask the bridge for its capabilities. Call on load and from the Retry button. */
export async function connectBridge(): Promise<void> {
  if (!bridgeConfig()) {
    setBridgeState(initial());
    return;
  }
  setBridgeState({ kind: 'connecting' });
  try {
    setBridgeState({ kind: 'ready', capabilities: await bridge.capabilities() });
  } catch (e) {
    setBridgeState({
      kind: 'offline',
      reason: e instanceof Error ? e.message : 'Python engine not running',
    });
  }
}

export const bridgeReady = () => bridgeState().kind === 'ready';
export const capabilities = (): Capabilities | undefined => {
  const s = bridgeState();
  return s.kind === 'ready' ? s.capabilities : undefined;
};
export const hasCapability = (name: CapabilityName) => capabilities()?.[name] === true;

/** Plain-language text for a missing framework feature (contract id from the plan, section 7). */
export const CAPABILITY_TEXT: Record<CapabilityName, string> = {
  session_metadata: 'Needs framework support for `metadata:` in session configs (F0a).',
  session_markers: 'Needs framework support for time markers (`behavior.markers`, F0b).',
  peth_markers: 'Needs framework support for aligning PETH to time markers (F0b).',
  frame_labels: 'Needs framework support for frame-label files (`behavior.frame_labels`, F0c).',
  decoding_fold_gap: 'Needs framework F1: fold-local test window and fold gap for decoding.',
  decoding_fold_local_window:
    'Needs framework F1: fold-local test window for the Bayesian decoder.',
  decoding_overall_test:
    'Needs framework F2: overall decoding test. The overall value is shown without a p-value.',
  overlap_policy: 'Needs framework F3: overlap policy for behaviors (exclude overlapping frames).',
  bayes_input_check: 'Needs framework F4: input-kind check for the Bayesian decoder.',
  bin_eligibility: 'Needs framework F5: minimum occupancy per bin from training data.',
  preview_flag: 'Needs framework F7: preview flag on shuffle results.',
  cli_rejects_recipes: 'Framework F8: `cabana run` should reject recipe files.',
  peth_gui_extensions: 'Needs framework F9: PETH offset/both alignment and same-direction latency.',
};
export const missingText = (names: CapabilityName[]) =>
  names.filter((n) => !hasCapability(n)).map((n) => CAPABILITY_TEXT[n]);
