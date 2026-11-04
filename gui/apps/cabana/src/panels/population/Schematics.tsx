// Small drawings that explain what a target or method does. They are schematics, labeled
// "Example", and carry no numbers: nothing here is drawn from the loaded data except the block
// diagram of stability, which follows the block count setting.

import { For, type JSX } from 'solid-js';
import type { PopulationMethod, PopulationTarget } from '../../lib/population-settings.ts';
import { stabilityBlocks } from './setup-logic.ts';

const BLUE = '#60a5fa';
const DEEP = '#2563eb';
const AMBER = '#f59e0b';
const GRAY = '#cbd5e1';
const INK = '#475569';

function Frame(props: { label: string; children: JSX.Element; w?: number; h?: number }) {
  return (
    <figure class="cb-pn-ex">
      <svg
        viewBox={`0 0 ${props.w ?? 120} ${props.h ?? 44}`}
        role="img"
        aria-label={`Example: ${props.label}`}
      >
        {props.children}
      </svg>
      <figcaption>Example: {props.label}</figcaption>
    </figure>
  );
}

/** The target cards: a strip of labeled stretches, a zone map, a grid of position bins. */
export function TargetSchematic(props: { target: PopulationTarget }): JSX.Element {
  return (
    <>
      {props.target === 'behaviors' && (
        <Frame label="behavior epochs over time">
          <rect x="4" y="6" width="112" height="9" rx="2" fill="#f1f5f9" />
          <rect x="8" y="6" width="20" height="9" fill={BLUE} />
          <rect x="52" y="6" width="26" height="9" fill={BLUE} />
          <rect x="30" y="19" width="18" height="9" fill={AMBER} />
          <rect x="84" y="19" width="26" height="9" fill={AMBER} />
          <line x1="4" y1="38" x2="116" y2="38" stroke={INK} stroke-width="1" />
        </Frame>
      )}
      {props.target === 'zones' && (
        <Frame label="arena zones">
          <rect x="30" y="3" width="60" height="38" rx="3" fill="none" stroke={INK} />
          <rect x="52" y="12" width="16" height="20" rx="2" fill={BLUE} opacity="0.55" />
        </Frame>
      )}
      {props.target === 'position' && (
        <Frame label="arena grid, one bin per state">
          <For each={[0, 1, 2, 3, 4, 5]}>
            {(c) => (
              <For each={[0, 1, 2]}>
                {(r) => (
                  <rect
                    x={30 + c * 10}
                    y={4 + r * 12}
                    width="10"
                    height="12"
                    fill={(c + r) % 3 === 0 ? BLUE : '#f8fafc'}
                    stroke={GRAY}
                  />
                )}
              </For>
            )}
          </For>
        </Frame>
      )}
    </>
  );
}

/** The method cards: what is compared, in a few shapes. */
export function MethodSchematic(props: {
  method: PopulationMethod;
  /** Blocks setting, for the real layout of the stability diagram. */
  blocks: number;
}): JSX.Element {
  return (
    <>
      {props.method === 'similarity' && (
        <Frame label="two population vectors compared">
          <For each={[0, 1, 2, 3, 4]}>
            {(i) => (
              <>
                <rect
                  x={8 + i * 8}
                  y={30 - [14, 22, 8, 18, 12][i]}
                  width="6"
                  height={[14, 22, 8, 18, 12][i]}
                  fill={BLUE}
                />
                <rect
                  x={72 + i * 8}
                  y={30 - [12, 20, 10, 16, 14][i]}
                  width="6"
                  height={[12, 20, 10, 16, 14][i]}
                  fill={AMBER}
                />
              </>
            )}
          </For>
          <path d="M52 20 h14 m-4 -4 l4 4 l-4 4" fill="none" stroke={INK} stroke-width="1.2" />
        </Frame>
      )}
      {props.method === 'stability' && <StabilityDiagram blocks={props.blocks} />}
      {props.method === 'separation' && (
        <Frame label="two groups of frames in a plane">
          <ellipse
            cx="42"
            cy="24"
            rx="20"
            ry="10"
            fill="none"
            stroke={BLUE}
            stroke-width="2"
            transform="rotate(-15 42 24)"
          />
          <ellipse
            cx="80"
            cy="22"
            rx="18"
            ry="9"
            fill="none"
            stroke={AMBER}
            stroke-width="2"
            transform="rotate(15 80 22)"
          />
          <path d="M42 24 L80 22" stroke={INK} stroke-dasharray="3 2" />
        </Frame>
      )}
      {props.method === 'dimensionality' && (
        <Frame label="variance spread over components">
          <For each={[0, 1, 2, 3, 4, 5, 6]}>
            {(i) => (
              <rect
                x={14 + i * 14}
                y={36 - [30, 18, 11, 7, 5, 3, 2][i]}
                width="9"
                height={[30, 18, 11, 7, 5, 3, 2][i]}
                fill={DEEP}
                opacity="0.75"
              />
            )}
          </For>
        </Frame>
      )}
      {props.method === 'pairwise' && (
        <Frame label="every cell paired with every other">
          <For each={[0, 1, 2, 3, 4]}>
            {(r) => (
              <For each={[0, 1, 2, 3, 4]}>
                {(c) => (
                  <rect
                    x={34 + c * 10}
                    y={2 + r * 8}
                    width="10"
                    height="8"
                    fill={r === c ? '#f1f5f9' : (r + c) % 2 ? BLUE : '#dbeafe'}
                    stroke="#fff"
                  />
                )}
              </For>
            )}
          </For>
        </Frame>
      )}
    </>
  );
}

/**
 * The stability scheme as the framework applies it: the used frames in order, cut into equal
 * contiguous blocks that alternate between half A and half B.
 */
export function StabilityDiagram(props: { blocks: number }): JSX.Element {
  const spans = () => stabilityBlocks(1000, props.blocks);
  const x = (v: number) => 4 + (v / 1000) * 112;
  return (
    <Frame label={`${spans().length} blocks of the used frames, alternating A and B`}>
      <For each={spans()}>
        {(b) => (
          <>
            <rect
              x={x(b.start)}
              y="8"
              width={x(b.end) - x(b.start) - 0.6}
              height="14"
              fill={b.half === 'A' ? BLUE : AMBER}
            />
            <text
              x={(x(b.start) + x(b.end)) / 2}
              y="18"
              font-size="7"
              text-anchor="middle"
              fill="#fff"
            >
              {spans().length <= 12 ? b.half : ''}
            </text>
          </>
        )}
      </For>
      <text x="4" y="36" font-size="6.5" fill={INK}>
        used frames in time order
      </text>
    </Frame>
  );
}
