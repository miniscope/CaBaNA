import { Show, type JSX } from 'solid-js';
import { CompactHeader } from '@calab/ui';
import pkg from '../../package.json';
import {
  clearAll,
  deconvolved,
  experiment,
  experimentId,
  samplingRate,
  sessionDuration,
  sessionName,
  source,
  traceMatrix,
} from '../lib/store.ts';
import { headerLine, type SessionFacts } from '../lib/header-line.ts';

/** What is known about the open session; undefined while no neural data is loaded. */
function facts(): SessionFacts | undefined {
  const m = traceMatrix() ?? deconvolved();
  if (!m) return undefined;
  const dur = sessionDuration();
  return {
    name: sessionName() || source.subjectId || undefined,
    task: experimentId() === 'custom' ? undefined : experiment().label,
    cells: m.cells,
    frames: m.frames,
    hz: samplingRate(),
    minutes: dur === undefined ? undefined : dur / 60,
  };
}

export function Header(): JSX.Element {
  return (
    <CompactHeader
      title="CaBaNA"
      version={`CaLab v${pkg.version}`}
      info={<span class="cb-hd-line">{headerLine(facts())}</span>}
      actions={
        <Show when={facts()}>
          <button type="button" class="btn-secondary btn-small cb-hd-btn" onClick={clearAll}>
            Change data
          </button>
        </Show>
      }
    />
  );
}
