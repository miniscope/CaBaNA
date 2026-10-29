import { createSignal, For, Show, type JSX } from 'solid-js';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { openItem } from '../components/Requirements.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { PREVIEW_DECODING_SHUFFLES } from '../lib/decoding-settings.ts';
import { PREVIEW_SHUFFLES } from '../lib/population-settings.ts';
import { FRAMEWORK_ENGINE, statusOfItem } from '../lib/readiness-snapshot.ts';
import type { AnalysisItem, Status } from '../lib/readiness.ts';
import { active, cancelRun, runAll } from '../lib/runs.ts';
import { experiment } from '../lib/store.ts';

type Scope = 'full' | 'preview';
const RUNNABLE = ['ready', 'outdated', 'failed'];
const label = (id: AnalysisItem) => ANALYSES.find((a) => a.id === id)!.label;

/** One line saying why an analysis cannot run (or nothing when it can). */
function reasonLine(s: Status): string {
  if (s.input.length)
    return s.input[0].text + (s.input.length > 1 ? ` (+${s.input.length - 1} more)` : '');
  if (s.engineOff) return 'Start the Python engine to run this analysis.';
  if (s.framework.length) return s.framework[0].text;
  if (s.kind === 'outdated') return 'Settings changed since the last run.';
  if (s.kind === 'failed') return 'The last run failed.';
  return '';
}

/** Why an analysis is left out of Run all. */
function skipReason(id: AnalysisItem, s: Status): string {
  if (!FRAMEWORK_ENGINE[id]) return 'Runs from its own page; not included in Run all yet.';
  if (s.kind === 'complete') return 'Complete: settings unchanged since the last run.';
  if (s.kind === 'running') return 'Already running.';
  return reasonLine(s) || s.text;
}

/** Overview of the five analyses with their status, and Run all with a summary before anything starts. */
export function AnalyzeOverview(): JSX.Element {
  const [summary, setSummary] = createSignal(false);
  const [scope, setScope] = createSignal<Scope>('full');
  const [batch, setBatch] = createSignal(false);
  const ids = ANALYSES.map((a) => a.id as AnalysisItem);
  const willRun = () =>
    ids.filter((id) => FRAMEWORK_ENGINE[id] && RUNNABLE.includes(statusOfItem(id).kind));
  /** Only worth saying when the experiment type narrows the list. */
  const suggested = (id: AnalysisItem) =>
    experiment().recommended.length < ids.length && experiment().recommended.includes(id);
  // Fixed when Start is pressed, so the summary keeps listing the queue while it runs.
  const [queue, setQueue] = createSignal<AnalysisItem[]>([]);
  const queued = () => (batch() ? queue() : willRun());
  const skipped = () => ids.filter((id) => !queued().includes(id));

  const start = async () => {
    setQueue(willRun());
    setBatch(true);
    try {
      await runAll(queue(), scope());
    } finally {
      setBatch(false);
      setSummary(false);
    }
  };
  const progress = () => {
    const a = active();
    if (!a) return 'Preparing';
    const pct = a.phase === 'running' && a.fraction > 0 ? ` ${Math.round(a.fraction * 100)}%` : '';
    return `${label(a.id)}: ${a.phase}${pct}`;
  };

  return (
    <div class="cb-panel cb-panel--wide cb-ov">
      <div class="cb-ov__head">
        <h2>Analyze</h2>
        <button
          type="button"
          class="btn-primary cb-ov__all"
          disabled={summary() || batch()}
          onClick={() => setSummary(true)}
        >
          Run all
        </button>
      </div>

      <Show
        when={summary()}
        fallback={
          <table class="cb-ov__table">
            <thead>
              <tr>
                <th>Analysis</th>
                <th>Engine</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <For each={ids}>
                {(id) => (
                  <tr>
                    <td>
                      <button type="button" class="cb-link" onClick={() => openItem(id)}>
                        {label(id)}
                      </button>
                      <Show when={suggested(id)}>
                        <span class="cb-muted"> · suggested</span>
                      </Show>
                    </td>
                    <td class="cb-muted">{FRAMEWORK_ENGINE[id] ? 'Python engine' : 'Browser'}</td>
                    <td>
                      <StatusBadge status={statusOfItem(id)} />
                    </td>
                    <td class="cb-muted">{reasonLine(statusOfItem(id))}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        }
      >
        <section class="cb-ov__sum" aria-label="Run all summary">
          <h3>What Run all will do</h3>
          <div class="cb-ov__cols">
            <div>
              <h4>Will run, in this order</h4>
              <Show
                when={queued().length}
                fallback={<p class="cb-muted">Nothing can run right now.</p>}
              >
                <ol>
                  <For each={queued()}>
                    {(id) => (
                      <li>
                        {label(id)}
                        <Show when={batch() && active()?.id === id}>
                          <span class="cb-muted"> · running</span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
              <h4>Scope</h4>
              <label class="cb-ov__opt">
                <input
                  type="radio"
                  name="scope"
                  checked={scope() === 'full'}
                  disabled={batch()}
                  onChange={() => setScope('full')}
                />
                Full analysis (shuffle counts from each analysis's settings)
              </label>
              <label class="cb-ov__opt">
                <input
                  type="radio"
                  name="scope"
                  checked={scope() === 'preview'}
                  disabled={batch()}
                  onChange={() => setScope('preview')}
                />
                Quick preview ({PREVIEW_SHUFFLES} shuffles for Population activity,{' '}
                {PREVIEW_DECODING_SHUFFLES} for Decoding; results are marked Preliminary)
              </label>
            </div>
            <div>
              <h4>Not included</h4>
              <ul class="cb-ov__skip">
                <For each={skipped()}>
                  {(id) => (
                    <li>
                      <strong>{label(id)}</strong>
                      <span class="cb-muted"> {skipReason(id, statusOfItem(id))}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
          <div class="cb-ov__actions">
            <Show when={batch()}>
              <span class="cb-muted" role="status">
                {progress()}
              </span>
            </Show>
            <Show
              when={batch()}
              fallback={
                <>
                  <button type="button" class="btn-secondary" onClick={() => setSummary(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="btn-primary"
                    disabled={!willRun().length}
                    onClick={() => void start()}
                  >
                    Start
                  </button>
                </>
              }
            >
              <button type="button" class="btn-secondary" onClick={() => void cancelRun()}>
                Cancel run
              </button>
            </Show>
          </div>
        </section>
      </Show>
    </div>
  );
}
