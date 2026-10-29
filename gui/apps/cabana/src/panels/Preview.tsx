import { For, Show, type JSX } from 'solid-js';
import { SLOTS, type SlotId } from '../lib/slots.ts';
import {
  annotationResults,
  addFiles,
  assignFile,
  cell,
  deconvolved,
  denoisedTrace,
  footprints,
  goToStep,
  levelOf,
  loaded,
  positionResult,
  rawTrace,
  sessionDuration,
  timingResults,
} from '../lib/store.ts';
import { setQcCategory, setQcTab } from '../lib/qc-view.ts';
import { Ethogram } from './BehaviorQc.tsx';
import { CellTraces } from './CellTraces.tsx';
import { ConfigReport, fileMismatch } from './ConfigReport.tsx';
import { FootprintViewer } from './FootprintViewer.tsx';
import { CellPicker } from './parts.tsx';
import { Help, PlotCard } from './QcParts.tsx';
import { Trajectory } from './Trajectory.tsx';
import { HELP } from './VizHelp.tsx';

/** Add or Replace: picks one file for `slot`. */
export function FileButton(props: { slot: SlotId; primary?: boolean }): JSX.Element {
  return (
    <label class={`${props.primary ? 'btn-primary' : 'btn-secondary'} btn-small cb-file`}>
      {loaded[props.slot] && loaded[props.slot]!.size ? 'Replace' : 'Add'}
      <input
        type="file"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void addFiles([f], props.slot);
        }}
      />
    </label>
  );
}

/** What the preview shows: a slot, or a file that matched none. */
export type PreviewItem = { slot: SlotId } | { file: File };

const LEVEL = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
  unused: 'Not needed',
};

const nCells = () => (rawTrace() ?? denoisedTrace() ?? deconvolved())?.cells ?? 0;

/** A panel is unreadable below this height (uPlot even draws it upside down), see DeconQc. */
const MIN_TRACE = 70;

function Traces(props: { mark: string }): JSX.Element {
  return (
    <PlotCard
      title="Calcium traces"
      help={
        <>
          {HELP.raw.text}
          {HELP.denoised.text}
          {HELP.events.text}
          <Help k="Interaction">
            Drag to zoom; the three panels share the time axis and cursor. The bold label is the
            file selected in the list.
          </Help>
        </>
      }
      tools={<CellPicker n={nCells()} compact />}
    >
      {(size) => {
        const n = () => [rawTrace(), denoisedTrace(), deconvolved()].filter(Boolean).length || 1;
        return (
          <div class="cb-fill cb-fill--col">
            <CellTraces
              mark={props.mark}
              height={Math.max(MIN_TRACE, Math.floor((size().h - 24 * n()) / n()))}
            />
          </div>
        );
      }}
    </PlotCard>
  );
}

function Footprints(): JSX.Element {
  return (
    <PlotCard
      title="Footprints"
      help={HELP.footprints.text}
      tools={<CellPicker n={footprints()?.cells ?? 0} compact />}
    >
      {(size) => {
        const side = () => Math.max(0, Math.min(size().w, size().h - 22));
        return (
          <div class="cb-fpcard">
            <div style={{ width: `${side()}px`, height: `${side()}px` }}>
              <FootprintViewer />
            </div>
            <div class="cb-muted">
              Click a cell to select it. White = selected (cell {cell() + 1}).
            </div>
          </div>
        );
      }}
    </PlotCard>
  );
}

function Timing(props: { slot: SlotId }): JSX.Element {
  const name = () => (props.slot === 'neural_timestamps' ? 'Miniscope' : 'Behavior camera');
  const r = () => timingResults().find((t) => t.name === name());
  const stats = (): [string, string][] => {
    const t = r()!;
    return [
      ['Frames', t.nFrames.toLocaleString()],
      ['Duration', `${((t.nFrames - 1) / t.fsMean).toFixed(1)} s`],
      ['Median frame interval', `${(1000 / t.fsMedian).toFixed(1)} ms`],
    ];
  };
  return (
    <Box title={SLOTS.find((s) => s.id === props.slot)!.label}>
      <Show
        when={r()}
        fallback={<p class="cb-muted">The time stamps could not be read for a summary.</p>}
      >
        <div class="cb-tiles">
          <For each={stats()}>
            {([k, v]) => (
              <div class="cb-tile">
                <span class="cb-muted">{k}</span>
                <strong>{v}</strong>
              </div>
            )}
          </For>
        </div>
        <button
          class="cb-linkbtn"
          onClick={() => {
            setQcTab('behavior');
            setQcCategory('behavior', 'timing');
            goToStep('qc');
          }}
        >
          View timing checks in Data QC →
        </button>
      </Show>
    </Box>
  );
}

function Position(): JSX.Element {
  return (
    <PlotCard title="Position" help={HELP.trajectory.text}>
      {() => (
        <div class="cb-fill">
          <Show
            when={positionResult() && 'x' in positionResult()!}
            fallback={
              <div class="cb-note">
                Load the behavior camera timestamps as well to see the path. Position rows are
                matched to camera frames by frame number.
              </div>
            }
          >
            <Trajectory bare mode="path" />
          </Show>
        </div>
      )}
    </PlotCard>
  );
}

function Annotations(props: { slot: SlotId }): JSX.Element {
  const a = () => annotationResults().find((x) => x.id === props.slot);
  return (
    <PlotCard title={SLOTS.find((s) => s.id === props.slot)!.label} help={HELP.behavior.text}>
      {() => (
        <Show
          when={a() && !a()!.error}
          fallback={<div class="cb-note">{a()?.error ?? 'The epochs could not be read.'}</div>}
        >
          <Ethogram epochs={a()!.epochs} duration={sessionDuration() ?? 0} />
        </Show>
      )}
    </PlotCard>
  );
}

/** A preview box with a title and no plot. */
function Box(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="cb-plot">
      <div class="cb-plot__head">
        <h3>{props.title}</h3>
      </div>
      <div class="cb-plot__body cb-preview__text">{props.children}</div>
    </section>
  );
}

/** Previews by slot. A slot left out shows its file summary; add new data types here. */
const VIEWS: Partial<Record<SlotId, (slot: SlotId) => JSX.Element>> = {
  neural_timestamps: (s) => <Timing slot={s} />,
  behavior_timestamps: (s) => <Timing slot={s} />,
  neural_raw: () => <Traces mark="Raw fluorescence" />,
  neural_denoised: () => <Traces mark="Denoised trace" />,
  neural_deconvolved: () => <Traces mark="Deconvolved events" />,
  footprints: () => <Footprints />,
  position: () => <Position />,
  zone_annotations: (s) => <Annotations slot={s} />,
  behavior_annotations: (s) => <Annotations slot={s} />,
  config: () => (
    <Box title="Configuration">
      <ConfigReport />
    </Box>
  ),
};

function SlotPreview(props: { slot: SlotId }): JSX.Element {
  const s = () => SLOTS.find((x) => x.id === props.slot)!;
  const info = () => loaded[props.slot];
  return (
    <Show
      when={info()?.summary && !(props.slot === 'config' && !info()!.size)}
      fallback={
        <Box title={s().label}>
          <Show
            when={info()}
            fallback={
              <>
                <p>
                  <strong>Not added.</strong> {LEVEL[levelOf(props.slot)]} for this experiment.
                </p>
                <p class="cb-muted">
                  Expected <code>{s().file}</code>: {s().format}
                </p>
              </>
            }
          >
            <p>
              <code>{info()!.name}</code>
            </p>
            <p class={info()!.error ? 'cb-error' : 'cb-muted'}>
              {info()!.error ?? info()!.summary}
            </p>
          </Show>
          <div class="cb-controls">
            <FileButton slot={props.slot} primary />
            <Show when={props.slot === 'config'}>
              <button class="btn-secondary btn-small" onClick={() => goToStep('setup')}>
                Enter in Experimental setup
              </button>
            </Show>
          </div>
        </Box>
      }
    >
      <Show when={fileMismatch(props.slot)}>
        <p class="cb-warn cb-preview__note">
          The config names {fileMismatch(props.slot)}, but {info()!.name} is loaded.
        </p>
      </Show>
      {(
        VIEWS[props.slot] ??
        (() => (
          <Box title={s().label}>
            <p>
              <code>{info()!.name}</code> · {info()!.summary}
            </p>
            <p class="cb-muted">No preview for this data type yet.</p>
          </Box>
        ))
      )(props.slot)}
    </Show>
  );
}

/** The selected file, drawn the way that suits its data type. */
export function Preview(props: { item: PreviewItem }): JSX.Element {
  return (
    <div class="cb-preview">
      <Show
        when={'slot' in props.item && props.item.slot}
        keyed
        fallback={
          <Box title="Unmatched file">
            <p>
              <code>{(props.item as { file: File }).file.name}</code> did not match any data type by
              name. If it holds data, choose its type; otherwise leave it. Unassigned files are
              ignored.
            </p>
            <select
              aria-label="Assign a data type"
              onChange={(e) => {
                const f = (props.item as { file: File }).file;
                if (e.currentTarget.value) void assignFile(f, e.currentTarget.value as SlotId);
              }}
            >
              <option value="">Assign to…</option>
              <For each={SLOTS}>{(s) => <option value={s.id}>{s.label}</option>}</For>
            </select>
          </Box>
        }
      >
        {(slot) => <SlotPreview slot={slot} />}
      </Show>
    </div>
  );
}
