// Spatial setup before any arena exists: one place to load an image or video, a quieter way to
// start on a blank canvas, and the steps that follow. All three lead to the same stages.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { pendingZones } from '../lib/arena.ts';
import { configReport } from '../lib/config-import.ts';
import { busy, loadBackground, loadError, useBlankCanvas } from '../lib/spatial-background.ts';
import { EXAMPLES, exampleMedia, loaded, source } from '../lib/store.ts';

export function SpatialLanding(): JSX.Element {
  const [over, setOver] = createSignal(false);
  const [blankHint, setBlankHint] = createSignal(false);
  const configArena = () => configReport()?.values.arena;
  const steps = (): [string, string][] => [
    blankHint()
      ? [
          'Start from a blank canvas',
          'The arena outline is drawn to the size entered in the next steps.',
        ]
      : [
          'Load an arena image or video',
          'Gives a background to draw on and to check the setup against.',
        ],
    ['Draw the arena outline', 'Mark the boundaries of the recording area.'],
    ['Set the scale', 'Convert picture pixels to real-world units (cm).'],
    ['Add zones (optional)', 'Regions for analysis, such as center, corners or reward areas.'],
  ];
  return (
    <div class="cb-sl">
      <div class="cb-sl-main">
        <Show when={configArena() || pendingZones()?.length}>
          <div class="cb-note">
            {loaded.config?.name ?? 'config.yaml'} describes{' '}
            {configArena()
              ? `a ${configArena()!.width} × ${configArena()!.height} cm arena`
              : 'the arena'}
            {pendingZones()?.length ? ` with ${pendingZones()!.length} regions` : ''}.{' '}
            {source.positionUnit === 'px'
              ? 'Positions are in video pixels, so the outline has to be drawn on a picture from the same camera: load an image or video from it.'
              : 'Load a picture to place it on, or continue without a file.'}
          </div>
        </Show>
        <label
          class="cb-sl-drop"
          classList={{ 'cb-sl-drop--over': over() }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void loadBackground(e.dataTransfer?.files?.[0]);
          }}
        >
          <svg class="cb-sl-drop__icon" viewBox="0 0 64 40" aria-hidden="true">
            <rect x="2" y="4" width="34" height="28" rx="3" />
            <circle cx="11" cy="13" r="3" />
            <path d="M4 30l11-11 8 8 5-5 8 8" />
            <rect x="30" y="12" width="32" height="24" rx="3" fill="#fff" />
            <path d="M42 19v10l8-5z" />
          </svg>
          <strong>Upload arena image or video</strong>
          <span class="cb-muted">Use a photo of your arena or a video from your recording.</span>
          <span class="btn-primary cb-sl-drop__btn">
            <span aria-hidden="true">⇪</span> Choose file (image or video)
          </span>
          <input
            type="file"
            hidden
            accept="image/*,video/*"
            onChange={(e) => void loadBackground(e.currentTarget.files?.[0])}
          />
          <span class="cb-muted">or drag and drop a file here</span>
        </label>
        <Show when={busy()}>
          <div class="cb-muted" role="status">
            {busy()}
          </div>
        </Show>
        <Show when={loadError()}>
          <div class="cb-error" role="alert">
            {loadError()}
          </div>
        </Show>
        <Show when={exampleMedia()?.frame || exampleMedia()?.video ? exampleMedia() : undefined}>
          {(m) => (
            <div class="cb-sl-example">
              <span class="cb-muted">
                Example data: {EXAMPLES.find((x) => x.id === m().id)?.label ?? m().id}.
              </span>
              <Show when={m().frame}>
                <button class="cb-link" onClick={() => void loadBackground(m().frame)}>
                  Use the example picture
                </button>
              </Show>
              <Show when={m().video}>
                <button class="cb-link" onClick={() => void loadBackground(m().video)}>
                  Use the example video
                </button>
              </Show>
            </div>
          )}
        </Show>
        <div class="cb-sl-or">
          <span>or</span>
        </div>
        <button
          class="cb-sl-blank"
          onClick={useBlankCanvas}
          onMouseEnter={() => setBlankHint(true)}
          onMouseLeave={() => setBlankHint(false)}
          onFocus={() => setBlankHint(true)}
          onBlur={() => setBlankHint(false)}
        >
          <b>Continue without a file</b>
          <span>Draw the arena on a blank canvas.</span>
        </button>
      </div>
      <aside class="cb-sl-steps" aria-label="What you'll do">
        <h4>What you'll do</h4>
        <ol>
          <For each={steps()}>
            {([title, text], i) => (
              <li>
                <span class="cb-sl-num">{i() + 1}</span>
                <div>
                  <b>{title}</b>
                  <span>{text}</span>
                </div>
              </li>
            )}
          </For>
        </ol>
      </aside>
    </div>
  );
}
