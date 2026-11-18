// Small windows anchored under the arena editor's toolbar, so they never cover the arena itself:
// Set scale, Animal size and the video frame.

import { batch, createEffect, createSignal, on, onCleanup, Show, type JSX } from 'solid-js';
import { arena, frame, pxPerCm, setArena } from '../lib/arena.ts';
import { scaleFromLine, toCmFrom } from '../lib/arena-geometry.ts';
import type { ArenaEditor } from '../lib/arena-editor.ts';
import {
  busy,
  keepChosenFrame,
  scrubT,
  setArenaSize,
  showVideoAt,
  useEmptyArena,
  useShownFrame,
} from '../lib/spatial-background.ts';
import { videoChoice } from '../lib/spatial-state.ts';
import { source } from '../lib/store.ts';
import { CloseX } from '../components/CloseX.tsx';

function Pop(props: { title: string; onClose: () => void; children: JSX.Element }): JSX.Element {
  return (
    <div class="cb-ae-win" role="dialog" aria-label={props.title}>
      <div class="cb-ae-win__head">
        <b>{props.title}</b>
        <CloseX label="Close" onClick={props.onClose} />
      </div>
      {props.children}
    </div>
  );
}

/** Scale from a known distance drawn on the picture, or from the arena's real size. */
export function ScalePopup(props: { ed: ArenaEditor }): JSX.Element {
  // The editor object is created once and does not change for this window.
  // eslint-disable-next-line solid/reactivity
  const ed = props.ed;
  const [mode, setMode] = createSignal<'distance' | 'size'>(
    arena.scaleMode === 'arena' ? 'size' : 'distance',
  );
  const [unit, setUnit] = createSignal<'cm' | 'mm'>('cm');
  const [text, setText] = createSignal(String(arena.lineCm));
  const [width, setWidth] = createSignal(arena.width);
  const [height, setHeight] = createSignal(arena.height);
  ed.setScaleLine(arena.line);
  // The line is drawn by dragging on the arena, so the draw tool is on while this method is shown.
  createEffect(() => ed.setTool(mode() === 'distance' ? 'distance' : 'select'));
  onCleanup(() => {
    ed.setTool('select');
    ed.setScaleLine(undefined);
  });
  const close = () => ed.setPopup(undefined);
  const cm = () => toCmFrom(parseFloat(text()), unit());
  const drawn = () => {
    const l = ed.scaleLine();
    return l ? Math.hypot(l[0][0] - l[1][0], l[0][1] - l[1][1]) : undefined;
  };
  const perCm = () => scaleFromLine(ed.scaleLine(), cm());
  const sizeOk = () => width() > 0 && (arena.shape === 'circle' || height() > 0);
  const apply = () => {
    if (mode() === 'distance') {
      const line = ed.scaleLine();
      if (!line || !perCm()) return;
      ed.edit(() => batch(() => setArena({ scaleMode: 'distance', line, lineCm: cm() })));
    } else {
      ed.edit(() => {
        setArena('scaleMode', 'arena');
        setArenaSize(width(), arena.shape === 'circle' ? width() : height());
      });
    }
    close();
  };
  return (
    <Pop title="Set scale" onClose={close}>
      <Show when={source.positionUnit === 'cm'}>
        <p class="cb-ae-note">Positions are already in cm; no scale is needed.</p>
      </Show>
      <Show
        when={mode() === 'distance'}
        fallback={
          <>
            <p class="cb-muted">Inside size of the arena, in cm, along the boundary just drawn.</p>
            <div class="cb-ae-row">
              <label>
                {arena.shape === 'circle' ? 'Diameter' : 'Width'}
                <input
                  type="number"
                  min="1"
                  value={width()}
                  onInput={(e) => setWidth(+e.currentTarget.value)}
                />{' '}
                cm
              </label>
              <Show when={arena.shape === 'rectangle'}>
                <label>
                  Height
                  <input
                    type="number"
                    min="1"
                    value={height()}
                    onInput={(e) => setHeight(+e.currentTarget.value)}
                  />{' '}
                  cm
                </label>
              </Show>
            </div>
          </>
        }
      >
        <div class="cb-ae-step">
          <span class="cb-ae-num">1</span>
          <div>
            <div>Enter a known distance</div>
            <div class="cb-ae-row">
              <input
                type="number"
                min="0"
                step="any"
                value={text()}
                aria-label="Known distance"
                onInput={(e) => setText(e.currentTarget.value)}
              />
              <div class="cb-seg" role="group" aria-label="Unit">
                <UnitButtons unit={unit()} set={setUnit} />
              </div>
            </div>
          </div>
        </div>
        <div class="cb-ae-step">
          <span class="cb-ae-num">2</span>
          <div>
            <div>Draw a line across that distance</div>
            <div class="cb-muted">
              Click and drag on the arena.
              {drawn() !== undefined ? ` Drawn: ${drawn()!.toFixed(0)} px.` : ''}
            </div>
          </div>
        </div>
        <Show when={perCm()}>
          <div class="cb-ae-result" role="status">
            {drawn()!.toFixed(0)} px ÷ {cm()} cm = {perCm()!.toFixed(2)} px/cm
          </div>
        </Show>
      </Show>
      <button
        class="cb-link cb-ae-or"
        onClick={() => setMode(mode() === 'distance' ? 'size' : 'distance')}
      >
        {mode() === 'distance' ? "or: enter the arena's real size" : 'or: draw a known distance'}
      </button>
      <div class="cb-ae-actions">
        <button class="btn-secondary btn-small" onClick={close}>
          Cancel
        </button>
        <button
          class="btn-primary btn-small"
          disabled={mode() === 'distance' ? !perCm() : !sizeOk()}
          onClick={apply}
        >
          Set scale
        </button>
      </div>
    </Pop>
  );
}

function UnitButtons(props: { unit: 'cm' | 'mm'; set: (u: 'cm' | 'mm') => void }): JSX.Element {
  return (
    <>
      <button classList={{ 'cb-seg__on': props.unit === 'cm' }} onClick={() => props.set('cm')}>
        cm
      </button>
      <button classList={{ 'cb-seg__on': props.unit === 'mm' }} onClick={() => props.set('mm')}>
        mm
      </button>
    </>
  );
}

/** The animal's length, typed or measured nose to base of tail on the picture. Saved in the config. */
export function AnimalPopup(props: { ed: ArenaEditor }): JSX.Element {
  // The editor object is created once and does not change for this window.
  // eslint-disable-next-line solid/reactivity
  const ed = props.ed;
  onCleanup(() => ed.setTool('select'));
  return (
    <Pop title="Animal size (optional)" onClose={() => ed.setPopup(undefined)}>
      <p class="cb-muted">
        Measure from the tip of the nose to the base of the tail, without the tail, on a frame where
        the animal is walking and stretched out.
      </p>
      <div class="cb-ae-row">
        <label>
          Length
          <input
            type="number"
            min="0"
            step="0.5"
            placeholder="8"
            value={arena.bodyLength?.toFixed(1) ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              ed.edit(() => {
                setArena('bodyLine', undefined);
                setArena('bodyLength', v ? +v : undefined);
              });
            }}
          />{' '}
          cm
        </label>
        <button
          class="btn-secondary btn-small"
          classList={{ 'btn-primary': ed.tool() === 'animal' }}
          onClick={() => ed.setTool(ed.tool() === 'animal' ? 'select' : 'animal')}
        >
          Measure on the picture
        </button>
      </div>
      <Show when={ed.tool() === 'animal'}>
        <p class="cb-muted">Click the tip of the nose, then the base of the tail.</p>
      </Show>
      <Show when={arena.bodyLine && !pxPerCm()}>
        <p class="cb-ae-note">The line is drawn, but the length needs the scale.</p>
      </Show>
      <p class="cb-muted">Saved in the config; no analysis uses it yet.</p>
    </Pop>
  );
}

/** Choose the frame of the video that is the background, or the empty arena (median of 15 frames). */
export function FramePopup(props: { ed: ArenaEditor }): JSX.Element {
  const close = () => props.ed.setPopup(undefined);
  // Choosing a frame is the point of this window: it closes once the background is chosen.
  createEffect(on(videoChoice, (c, prev) => c && c !== prev && close(), { defer: true }));
  return (
    <Pop title="Video frame" onClose={close}>
      <p class="cb-muted">
        Scrub to a frame where the whole arena is visible. The empty arena is the median of 15
        frames spread across the video; the animal moves, so it drops out. Only the frames shown are
        decoded.
      </p>
      <label class="cb-ae-scrub">
        <span>
          Frame at <b>{scrubT().toFixed(1)} s</b> of {(frame()?.duration ?? 0).toFixed(1)} s
        </span>
        <input
          type="range"
          min="0"
          max={frame()?.duration ?? 0}
          step="0.1"
          value={scrubT()}
          onInput={(e) => void showVideoAt(+e.currentTarget.value)}
        />
      </label>
      <div class="cb-ae-actions">
        <button class="btn-primary btn-small" disabled={!!busy()} onClick={useShownFrame}>
          Use this frame
        </button>
        <button
          class="btn-secondary btn-small"
          disabled={!!busy()}
          onClick={() => void useEmptyArena()}
        >
          Use the empty arena
        </button>
      </div>
      <Show when={busy()}>
        <p class="cb-muted" role="status">
          {busy()}
        </p>
      </Show>
      <Show when={videoChoice()}>
        {(c) => (
          <p class="cb-muted">
            Background now: {c().median ? 'the empty arena' : `the frame at ${c().t!.toFixed(1)} s`}
            .{' '}
            <button class="cb-link" onClick={() => void keepChosenFrame().then(close)}>
              Keep it
            </button>
          </p>
        )}
      </Show>
    </Pop>
  );
}
