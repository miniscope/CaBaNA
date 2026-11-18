// The notice shown in the arena editor when regions were drawn before the outline, scale or
// picture changed.

import { Show, type JSX } from 'solid-js';
import {
  keepInCm,
  keepOnPicture,
  regionNotice,
  removeRegions,
  reprojected,
  setPreviewRegions,
  undoChange,
  type ChangeKind,
} from '../lib/region-notice.ts';

const CHANGED: Record<ChangeKind, string> = {
  outline: 'The arena outline changed',
  scale: 'The arena scale changed',
  picture: 'The arena picture changed',
};

/** What happens to regions drawn before the outline, scale or picture changed. Stays until a choice is made. */
export function RegionNoticeBox(): JSX.Element {
  return (
    <Show when={regionNotice()}>
      {(n) => {
        const moved = () => reprojected(n());
        const count = () => n().regionsCm.length;
        const regions = () => `${count()} region${count() === 1 ? '' : 's'}`;
        const preview = (on: boolean) => setPreviewRegions(on ? moved() : undefined);
        return (
          <div class="cb-region-notice" role="alert">
            <b>
              <span aria-hidden="true">⚠</span> {CHANGED[n().kind]}
            </b>
            <p>
              {regions()} {count() === 1 ? 'was' : 'were'} drawn before this change. Choose what
              happens to them. Until you choose, analyses that use the arena are blocked.
            </p>
            <button
              class="cb-region-notice__choice"
              disabled={!moved()}
              onClick={keepInCm}
              onMouseEnter={() => preview(true)}
              onMouseLeave={() => preview(false)}
              onFocus={() => preview(true)}
              onBlur={() => preview(false)}
            >
              <b>Keep position in cm</b>
              <span>
                {moved()
                  ? 'Regions move with the new outline. Their coordinates in the config stay the same.'
                  : 'Draw the new outline and scale first; regions then move with it.'}
              </span>
            </button>
            <button class="cb-region-notice__choice" onClick={keepOnPicture}>
              <b>Keep on the picture</b>
              <span>Regions stay where they were drawn. Their cm coordinates change.</span>
            </button>
            <button class="cb-region-notice__choice" onClick={removeRegions}>
              <b>Remove and redraw</b>
              <span>Deletes the {regions()} so you can draw them again.</span>
            </button>
            <button class="btn-secondary btn-small" onClick={undoChange}>
              Undo the {n().kind} change
            </button>
          </div>
        );
      }}
    </Show>
  );
}
