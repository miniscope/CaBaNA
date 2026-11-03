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

/** Plain-language text for a missing framework feature. */
export const CAPABILITY_TEXT: Record<CapabilityName, string> = {
  session_metadata: 'Needs framework support for session metadata in config files.',
  session_markers: 'Needs framework support for time marker files.',
  peth_markers: 'Needs framework support for aligning PETH to time markers.',
  frame_labels: 'Needs framework support for frame-label files.',
  decoding_fold_gap: 'Needs a framework update: fold-local test window and fold gap for decoding.',
  decoding_fold_local_window:
    'Needs a framework update: fold-local test window for the Bayesian decoder.',
  decoding_overall_test:
    'Needs a framework update: overall decoding test. The overall value is shown without a p-value.',
  overlap_policy:
    'Needs a framework update: overlap policy for behaviors (exclude overlapping frames).',
  bayes_input_check: 'Needs a framework update: input-kind check for the Bayesian decoder.',
  bin_eligibility: 'Needs a framework update: minimum occupancy per bin from training data.',
  preview_flag: 'Needs a framework update: preview flag on shuffle results.',
  cli_rejects_recipes: 'Needs a framework update: the command line should reject recipe files.',
  peth_gui_extensions:
    'Needs a framework update: PETH offset and both-ends alignment, and same-direction latency.',
};
export const missingText = (names: CapabilityName[]) =>
  names.filter((n) => !hasCapability(n)).map((n) => CAPABILITY_TEXT[n]);
