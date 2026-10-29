import { For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { CAPABILITY_TEXT, capabilities } from '../../lib/bridge-status.ts';
import { frameworkNote } from '../../lib/results-overview.ts';
import { PopButton } from '../QcParts.tsx';

const Row = (p: { k: string; children: JSX.Element }) => (
  <tr>
    <th scope="row">{p.k}</th>
    <td>{p.children}</td>
  </tr>
);

/** The content of Result details: inputs, settings, engine and framework version, warnings, errors. */
export function RunDetailsBody(props: { record: RunRecord; pipeline?: string }): JSX.Element {
  const r = () => props.record;
  const fw = () => r().framework;
  const note = () => frameworkNote(r(), capabilities()?._info?.commit);
  return (
    <div class="cb-rd">
      <table class="cb-rd__t">
        <tbody>
          <Row k="Engine">
            {r().engine === 'framework'
              ? 'Python framework (same command as `cabana run`)'
              : 'Browser engine (TypeScript port of framework 57c0c4b, with approved GUI extensions)'}
          </Row>
          <Show when={note()}>
            <Row k="Framework version">{note()}. Rerun to make a result with the current one.</Row>
          </Show>
          <Show when={fw()}>
            <Row k="Framework">
              {fw()!.cabana_version} · commit {fw()!.commit?.slice(0, 7) ?? 'unknown'}
            </Row>
          </Show>
          <Row k="Run">
            {r().run_id} · {r().status} ·{' '}
            {r().scope === 'preview' ? 'quick preview (50 shuffles)' : 'full analysis'}
          </Row>
          <Row k="Seed">{r().seeds?.base ?? 'not set'}</Row>
          <Row k="Inputs">
            <For each={r().session.inputs}>
              {(i) => (
                <div title={i.sha256}>
                  {i.name ?? i.key} <span class="cb-muted">{i.sha256.slice(0, 12)}</span>
                </div>
              )}
            </For>
          </Row>
          <Show when={r().session.withheld?.length}>
            <Row k="Left out of the run">
              {r().session.withheld!.join(', ')}: the installed framework does not read these
              sections. They are kept in the saved config and never change the computation.
            </Row>
          </Show>
          <Show when={r().null_not_kept}>
            <Row k="Null draws">
              Not kept (large run). P-values are unchanged; null histograms are unavailable.
            </Row>
          </Show>
          <Show when={r().rejected_cell_ids?.length}>
            <Row k="Rejected cells">{r().rejected_cell_ids!.join(', ')}</Row>
          </Show>
          <Show when={props.pipeline}>
            <Row k="Pipeline">
              <pre class="cb-rd__pre">{props.pipeline}</pre>
            </Row>
          </Show>
          <Show when={r().framework?.capabilities}>
            <Row k="Framework features">
              <For each={Object.entries(r().framework!.capabilities)}>
                {([k, v]) => (
                  <div>
                    {v ? 'present' : 'absent'}:{' '}
                    {CAPABILITY_TEXT[k as keyof typeof CAPABILITY_TEXT]?.replace(/^Needs /, '') ??
                      k}
                  </div>
                )}
              </For>
            </Row>
          </Show>
          <Show when={r().warnings.length}>
            <Row k="Warnings">
              <For each={r().warnings}>{(w) => <div>{w.message}</div>}</For>
            </Row>
          </Show>
          <Show when={r().errors.length}>
            <Row k="Errors">
              <For each={r().errors}>
                {(e) => (
                  <div>
                    {e.message?.split('\n').filter(Boolean).at(-1) ?? 'Unknown error'}
                    <Show when={e.traceback ?? (e.message?.includes('\n') ? e.message : undefined)}>
                      <details>
                        <summary>Traceback</summary>
                        <pre class="cb-rd__pre">{e.traceback ?? e.message}</pre>
                      </details>
                    </Show>
                  </div>
                )}
              </For>
            </Row>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

/** Result details: a button that opens the details in a popover. */
export function RunDetails(props: { record: RunRecord; pipeline?: string }): JSX.Element {
  return (
    <PopButton
      label="Result details"
      title="Result details"
      width={560}
      class="cb-link"
      button="Result details"
    >
      <RunDetailsBody record={props.record} pipeline={props.pipeline} />
    </PopButton>
  );
}
