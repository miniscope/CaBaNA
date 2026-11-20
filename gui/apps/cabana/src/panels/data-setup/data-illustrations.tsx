// Small line drawings of each data type for the Data requirements window.

import { For, type JSX } from 'solid-js';
import type { SlotId } from '../../lib/slots.ts';

const Ill = (props: { children: JSX.Element }) => (
  <svg
    width="72"
    height="34"
    viewBox="0 0 72 34"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {props.children}
  </svg>
);
const Ticks = () => (
  <>
    <path d="M4 24h64" />
    <For each={[8, 18, 28, 38, 48, 58, 68]}>{(x) => <path d={`M${x - 2} 20v8`} />}</For>
  </>
);
const ARENA = <rect x="14" y="3" width="44" height="28" rx="2" />;
const shade = { fill: 'currentColor', opacity: '.25' };

export const ILLUSTRATION: Record<SlotId | 'other', () => JSX.Element> = {
  neural_timestamps: () => (
    <Ill>
      <Ticks />
    </Ill>
  ),
  behavior_timestamps: () => (
    <Ill>
      <Ticks />
    </Ill>
  ),
  neural_deconvolved: () => (
    <Ill>
      <path d="M4 28h64" />
      <path d="M12 28v-14M20 28v-6M34 28v-20M40 28v-8M54 28v-12M62 28v-5" />
    </Ill>
  ),
  neural_denoised: () => (
    <Ill>
      <path d="M4 26h6c2 0 3-16 5-16s4 12 9 14 6 2 10 2c2 0 3-12 5-12s5 10 10 11 8 1 18 1" />
    </Ill>
  ),
  neural_raw: () => (
    <Ill>
      <path d="M4 25l3-2 2 3 3-4 2 2 2-13 3 9 2-2 3 7 2-3 3 3 2-1 2 2 2-10 2 6 3-1 2 5 3-3 3 3 2-2 3 2 3-1 3 2" />
    </Ill>
  ),
  footprints: () => (
    <Ill>
      <ellipse cx="16" cy="12" rx="6" ry="5" />
      <ellipse cx="34" cy="20" rx="5" ry="6" />
      <ellipse cx="52" cy="11" rx="6" ry="4" />
      <ellipse cx="58" cy="25" rx="4" ry="4" />
      <ellipse cx="22" cy="26" rx="4" ry="3" />
    </Ill>
  ),
  position: () => (
    <Ill>
      {ARENA}
      <path d="M20 26c4-6 2-14 10-16s6 10 14 8 6-10 8-12" stroke-dasharray="2 2" />
      <circle cx="52" cy="6" r="2" fill="currentColor" />
    </Ill>
  ),
  behavior_annotations: () => (
    <Ill>
      <path d="M4 28h64" />
      <rect x="10" y="14" width="12" height="10" {...shade} />
      <rect x="34" y="14" width="7" height="10" {...shade} />
      <rect x="52" y="14" width="10" height="10" {...shade} />
    </Ill>
  ),
  zone_annotations: () => (
    <Ill>
      {ARENA}
      <path d="M29 3v28M43 3v28" />
      <rect x="43" y="3" width="15" height="28" fill="currentColor" opacity=".2" stroke="none" />
    </Ill>
  ),
  head_orientation: () => (
    <Ill>
      <circle cx="36" cy="17" r="12" />
      <path d="M36 17l8-7" />
      <path d="M40 9h5v5" />
    </Ill>
  ),
  time_markers: () => (
    <Ill>
      <path d="M4 28h64" />
      <path d="M16 28v-16M38 28v-16M58 28v-16" />
      <path d="M13 9h6l-3 4zM35 9h6l-3 4zM55 9h6l-3 4z" fill="currentColor" />
    </Ill>
  ),
  frame_labels: () => (
    <Ill>
      <rect x="4" y="12" width="64" height="10" />
      <For
        each={[
          [10, 6],
          [22, 4],
          [30, 10],
          [46, 4],
          [54, 8],
        ]}
      >
        {([x, w]) => (
          <rect x={x} y="12" width={w} height="10" fill="currentColor" opacity=".3" stroke="none" />
        )}
      </For>
    </Ill>
  ),
  behavior_frame: () => (
    <Ill>
      {ARENA}
      <rect x="22" y="9" width="28" height="16" rx="1" stroke-dasharray="2 2" />
      <circle cx="30" cy="17" r="2" fill="currentColor" />
    </Ill>
  ),
  config: () => <Ill>{ARENA}</Ill>,
  other: () => (
    <Ill>
      <rect x="22" y="4" width="28" height="26" rx="2" stroke-dasharray="3 2" />
      <path d="M33 13a3 3 0 1 1 4 3v3M36 23v.5" />
    </Ill>
  ),
};

/** Line icons of the Getting started page (24 px grid). */
export function Icon(props: { name: keyof typeof ICONS; size?: number }): JSX.Element {
  return (
    <svg
      width={props.size ?? 28}
      height={props.size ?? 28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICONS[props.name]()}
    </svg>
  );
}
const ICONS = {
  filePlus: () => (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  folder: () => (
    <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" />
  ),
  book: () => (
    <>
      <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
      <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
      <path d="M3 6v13M12 6v13M21 6v13" />
    </>
  ),
  sliders: () => (
    <>
      <path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h11M19 18h1" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  play: () => <path d="M7 4v16l13-8z" />,
  arrow: () => <path d="M5 12h14M13 18l6-6M13 6l6 6" />,
};
