// The configuration file viewer: one of the project's yaml files with numbered lines, its status
// and what uses it. Compare with a run marks the lines that changed since that run. The same
// window shows the copy frozen with a run (Settings used). Editing happens through the pop-ups or
// in a text editor; a file edited into something invalid is not used until it is fixed.

import { createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Modal } from '../../components/Modal.tsx';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { openProject } from '../../lib/open-project.ts';
import { configViewer, setConfigViewer } from '../../lib/project-dialogs.ts';
import { differenceTexts, viewLines } from '../../lib/project-view.ts';
import { projects, type ConfigFile, type FileName } from '../../lib/projects-client.ts';
import { formatWhen } from '../../lib/results-overview.ts';
import { history } from '../../lib/runs.ts';
import { clockText } from '../../lib/save-status.ts';
import { downloadYaml } from '../../lib/session-config.ts';
import { tidyPath } from '../../lib/project-session.ts';

const USED_BY: Record<FileName, string> = {
  'project.yaml': 'the project: its name, data file references and storage settings',
  'experiment.yaml': 'all of the project',
  'processing.yaml': 'every analysis that reads neural or position data',
  'analysis.yaml': 'each analysis reads its own section',
};
const REWRITABLE: FileName[] = ['experiment.yaml', 'processing.yaml', 'analysis.yaml'];
const EDITING =
  'Edit through the pop-ups, or open the file in any text editor. A file edited outside CaBaNA is checked before it is used; a problem is shown with its line and the last valid version stays in use.';

function Lines(props: { text: string; changes?: ReturnType<typeof viewLines>; badLine?: number }) {
  const rows = () => props.changes ?? viewLines(props.text);
  return (
    <div class="cb-cv__lines" role="region" aria-label="File contents">
      <For each={rows()}>
        {(l) => (
          <>
            <For each={l.was}>
              {(w) => (
                <div class="cb-cv__line cb-cv__line--was">
                  <span class="cb-cv__n">−</span>
                  <span class="cb-cv__t">{w}</span>
                </div>
              )}
            </For>
            <div
              class="cb-cv__line"
              classList={{
                'cb-cv__line--new': l.changed,
                'cb-cv__line--bad': props.badLine === l.n,
                'cb-cv__line--note': l.text.trim().startsWith('#'),
              }}
            >
              <span class="cb-cv__n">{l.changed ? '+' : l.n}</span>
              <span class="cb-cv__t">{l.text}</span>
            </div>
          </>
        )}
      </For>
    </div>
  );
}

export function ConfigViewer(): JSX.Element {
  const target = configViewer()!;
  const project = openProject()!;
  const frozen = !!target.run;
  const [version, setVersion] = createSignal(0);
  const [comparing, setComparing] = createSignal(!!(target.run ?? target.compare));
  const [runId, setRunId] = createSignal<string | undefined>(
    (target.run ?? target.compare)?.run_id,
  );
  const [message, setMessage] = createSignal('');
  const [file] = createResource(version, () => projects.readFile(project.id, target.name));
  const runs = () =>
    history().filter(
      (r) => ['framework', 'browser-ts'].includes(r.engine) && r.status !== 'failed',
    );
  const [diff] = createResource(
    () => (comparing() && !frozen && runId() ? runId() : undefined),
    (run) => projects.compare(project.id, target.name, run).catch(() => undefined),
  );
  const compareRun = (): RunRecord | undefined => runs().find((r) => r.run_id === runId());
  // The copy a run froze comes from the engine; otherwise the file as it is now.
  const [frozenCopy] = createResource(
    () => (frozen ? target.run!.run_id : undefined),
    (run) => projects.runConfig(run, target.name).catch(() => undefined),
  );
  const text = createMemo(() => (frozen ? (frozenCopy() ?? '') : (file()?.text ?? '')));
  const marks = () =>
    !frozen && comparing() && diff() ? viewLines(text(), diff()!.changes) : undefined;
  const invalid = (f: ConfigFile) => !f.valid;

  // The engine keeps the last valid copy; writing it back makes it the file again.
  const restore = async () => {
    setMessage('');
    try {
      await projects.writeFile(
        project.id,
        target.name,
        { text: await projects.lastValid(project.id, target.name) },
        'Restored the last valid version',
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const items = () => [
    {
      kind: 'action' as const,
      label: 'Open in text editor',
      sub: 'Shows the project folder in Finder',
      onSelect: () => void projects.reveal(project.id),
    },
    ...(frozen
      ? []
      : [
          {
            kind: 'action' as const,
            label: 'Compare with a run…',
            disabled: !REWRITABLE.includes(target.name)
              ? 'Runs freeze experiment, processing and analysis only.'
              : runs().length
                ? undefined
                : 'No run in this project yet.',
            onSelect: () => {
              setComparing(true);
              setRunId(runs()[0]?.run_id);
            },
          },
          {
            kind: 'action' as const,
            label: 'Import…',
            disabled:
              'Import where the settings live: Apply settings from, Import preprocessing settings, Load configuration.',
            onSelect: () => undefined,
          },
        ]),
    { kind: 'separator' as const },
    {
      kind: 'action' as const,
      label: 'Export a copy…',
      onSelect: () => downloadYaml(text(), target.name),
    },
  ];

  const status = () => {
    const f = file();
    if (!f) return undefined;
    if (invalid(f))
      return (
        <div class="cb-cv__bad">
          <b>Not used: changed outside CaBaNA at {clockText(new Date(f.modified))}.</b>
          <div>
            Line {f.error?.line}: {f.error?.message.replace(/^Line \d+:\s*/, '')}
          </div>
        </div>
      );
    return (
      <p>
        {frozen
          ? `Frozen with the run · ${formatWhen(target.run!.finished_utc ?? target.run!.created_utc)}`
          : `In use · saved ${clockText(new Date(f.modified))} · valid`}
      </p>
    );
  };

  return (
    <Modal
      label={target.name}
      title={<span class="cb-sp-mono">{target.name}</span>}
      head={<span class="cb-muted cb-vw-facts">{tidyPath(project.path)}/</span>}
      width={1000}
      height={560}
      onClose={() => setConfigViewer(undefined)}
      actions={<ActionsMenu items={items()} />}
    >
      <div class="cb-cv">
        <Show
          when={file()}
          fallback={
            <p class="cb-muted cb-cv__wait">
              {file.error ? 'The file could not be read.' : 'Reading the file…'}
            </p>
          }
        >
          {(f) => <Lines text={text()} changes={marks()} badLine={f().error?.line} />}
        </Show>
        <aside class="cb-cv__side">
          <div class="sc">status</div>
          {status()}
          <Show when={file() && invalid(file()!)}>
            <p class="cb-muted">The last valid version stays in use until the file is fixed.</p>
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => setVersion((v) => v + 1)}
            >
              Check the file again
            </button>
            <button type="button" class="btn-secondary btn-small" onClick={() => void restore()}>
              Restore the last valid version
            </button>
          </Show>
          <Show when={comparing() && !frozen}>
            <div class="sc">compared with</div>
            <select
              aria-label="Run to compare with"
              value={runId()}
              onChange={(e) => setRunId(e.currentTarget.value)}
            >
              <For each={runs()}>
                {(r) => (
                  <option value={r.run_id}>
                    {r.analysis} run · {formatWhen(r.finished_utc ?? r.created_utc)}
                  </option>
                )}
              </For>
            </select>
            <Show when={diff()}>
              {(d) => (
                <>
                  <p>
                    {d().identical
                      ? 'No differences since that run.'
                      : `${d().changes.length} ${d().changes.length === 1 ? 'difference' : 'differences'} since that run:`}
                  </p>
                  <ul>
                    <For each={differenceTexts(d().changes)}>{(t) => <li>{t}</li>}</For>
                  </ul>
                  <Show when={!d().identical}>
                    <p class="cb-muted">
                      These are why {compareRun()?.analysis ?? 'the analysis'} shows needs rerun.
                      The run keeps its own copy, so its results stay reproducible.
                    </p>
                  </Show>
                </>
              )}
            </Show>
            <Show when={comparing() && runId() && !diff.loading && !diff()}>
              <p class="cb-muted">That run has no frozen copy of this file.</p>
            </Show>
          </Show>
          <Show when={!comparing()}>
            <div class="sc">used by</div>
            <p>{USED_BY[target.name]}</p>
            <div class="sc">editing</div>
            <p class="cb-muted">{EDITING}</p>
          </Show>
          <Show when={message()}>
            <p class="cb-warn">{message()}</p>
          </Show>
        </aside>
      </div>
    </Modal>
  );
}
