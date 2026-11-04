// Spatial setup as stages (frame, outline, scale, zones, review) and its checks. Plain functions of a
// snapshot, so the rules can be tested without a picture. Each check says at which level it holds:
// a value is set, the value is internally valid, or it was verified against the loaded data.

export type Stage = 'frame' | 'outline' | 'scale' | 'zones' | 'review';

export const STAGE_LABEL: Record<Stage, string> = {
  frame: 'Video frame',
  outline: 'Arena outline',
  scale: 'Scale',
  zones: 'Zones',
  review: 'Review',
};

export interface SpatialSnapshot {
  frameKind?: 'image' | 'video' | 'blank';
  /** A video's background frame (one frame or the empty-arena median) has been chosen. */
  videoFrameChosen: boolean;
  outline: boolean;
  shape: 'rectangle' | 'circle';
  /** Width over height of the drawn outline. */
  boxAspect?: number;
  scaleMode: 'arena' | 'distance';
  lineDrawn: boolean;
  /** The arena's real size was typed or read from config.yaml, not left at the starting value. */
  sizeEntered: boolean;
  sizeCm: [number, number];
  pxPerCm?: number;
  positionUnit: 'cm' | 'px';
  positionsLoaded: boolean;
  /** Share (0 to 1) of tracked positions inside the arena, once positions can be put in cm. */
  insideShare?: number;
  zones: number;
  excluded: number;
  /** Regions from config.yaml still waiting for the outline. */
  pending: number;
  /** Regions from config.yaml placed on the picture whose placement has not been checked. */
  unverified: number;
  /** Regions that reach outside the arena outline. */
  outside: number;
  /** An unreadable arena in the config, or regions waiting for a choice after the arena changed. */
  problem?: string;
  bodyLength?: number;
}

export type CheckState = 'ok' | 'todo' | 'warn' | 'block' | 'info';
export type CheckLevel = 'set' | 'valid' | 'verified';

export interface SpatialCheck {
  key:
    | 'background'
    | 'outline'
    | 'scale'
    | 'proportions'
    | 'position'
    | 'zones'
    | 'animal'
    | 'problem';
  state: CheckState;
  level: CheckLevel;
  text: string;
  /** The stage where it is fixed. */
  stage: Stage;
}

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const size = (s: SpatialSnapshot) =>
  s.shape === 'circle'
    ? `${n1(s.sizeCm[0])} cm across`
    : `${n1(s.sizeCm[0])} × ${n1(s.sizeCm[1])} cm`;

/** Where to start: the landing screen until there is a background or an outline. */
export const entryOf = (s: SpatialSnapshot): 'landing' | 'workspace' =>
  s.frameKind || s.outline ? 'workspace' : 'landing';

export const stagesFor = (s: SpatialSnapshot): Stage[] =>
  s.frameKind === 'video'
    ? ['frame', 'outline', 'scale', 'zones', 'review']
    : ['outline', 'scale', 'zones', 'review'];

/** The scale is set: a known distance is drawn, or the arena's real size was entered. */
export const scaleSet = (s: SpatialSnapshot) =>
  !!s.pxPerCm && (s.scaleMode === 'distance' ? s.lineDrawn : s.sizeEntered);

export function stageDone(stage: Stage, s: SpatialSnapshot): boolean {
  switch (stage) {
    case 'frame':
      return s.frameKind !== 'video' || s.videoFrameChosen;
    case 'outline':
      return s.outline;
    case 'scale':
      return s.outline && scaleSet(s);
    case 'zones':
      return s.pending === 0 && s.unverified === 0;
    case 'review':
      return !blocked(spatialChecks(s));
  }
}

/** The first stage with something left to do, or Review when everything is done. */
export const openStage = (s: SpatialSnapshot): Stage =>
  stagesFor(s).find((st) => st !== 'review' && !stageDone(st, s)) ?? 'review';

export function spatialChecks(s: SpatialSnapshot): SpatialCheck[] {
  const out: SpatialCheck[] = [];
  const add = (c: SpatialCheck) => out.push(c);

  if (s.problem)
    add({ key: 'problem', state: 'block', level: 'valid', text: s.problem, stage: 'outline' });

  if (!s.frameKind)
    add({
      key: 'background',
      state: s.outline ? 'info' : 'todo',
      level: 'set',
      text: 'No background picture. Load an image or video, or draw on a blank canvas.',
      stage: 'outline',
    });
  else if (s.frameKind === 'video' && !s.videoFrameChosen)
    add({
      key: 'background',
      state: 'todo',
      level: 'set',
      text: 'Choose the video frame to draw on.',
      stage: 'frame',
    });
  else
    add({
      key: 'background',
      state: s.frameKind === 'blank' ? 'info' : 'ok',
      level: 'set',
      text:
        s.frameKind === 'blank'
          ? 'Blank canvas: the outline and zones are placed by size, not on a picture.'
          : `Background: ${s.frameKind === 'video' ? 'video frame' : 'image'}.`,
      stage: s.frameKind === 'video' ? 'frame' : 'outline',
    });

  add(
    s.outline
      ? {
          key: 'outline',
          state: 'ok',
          level: 'set',
          text: `Arena outline drawn (${s.shape}).`,
          stage: 'outline',
        }
      : {
          key: 'outline',
          state: 'block',
          level: 'set',
          text: 'The arena outline has not been drawn.',
          stage: 'outline',
        },
  );

  if (s.outline) {
    if (scaleSet(s))
      add({
        key: 'scale',
        state: 'ok',
        level: 'valid',
        text: `Scale set: ${s.pxPerCm!.toFixed(2)} picture pixels per cm; arena ${size(s)}.`,
        stage: 'scale',
      });
    else
      add({
        key: 'scale',
        state: 'block',
        level: 'set',
        text:
          s.scaleMode === 'distance'
            ? 'The arena outline is complete, but the known distance has not been drawn. Distances in cm stay unavailable until it is.'
            : `The arena outline is complete, but the arena's real size has not been entered. Distances in cm use the starting size of ${size(s)} until it is.`,
        stage: 'scale',
      });
    const want = s.sizeCm[0] / s.sizeCm[1];
    if (
      s.shape === 'rectangle' &&
      s.scaleMode === 'arena' &&
      s.boxAspect !== undefined &&
      Math.abs(s.boxAspect / want - 1) > 0.05
    )
      add({
        key: 'proportions',
        state: 'warn',
        level: 'valid',
        text: `The drawn outline (${n1(s.boxAspect)} : 1) and the entered size (${n1(want)} : 1) have different proportions. Redraw the outline or check the size.`,
        stage: 'scale',
      });
  }

  if (!s.positionsLoaded)
    add({
      key: 'position',
      state: 'info',
      level: 'verified',
      text: 'No position file loaded, so the fit with tracking has not been checked.',
      stage: 'scale',
    });
  else if (s.positionUnit === 'px' && s.frameKind === 'blank')
    add({
      key: 'position',
      state: 'block',
      level: 'verified',
      text: 'Positions are in video pixels, but the arena is on a blank canvas, which has no video pixels. Load a frame from the tracking video and draw the outline on it.',
      stage: 'outline',
    });
  else if (s.insideShare !== undefined)
    add(
      s.insideShare >= 0.95
        ? {
            key: 'position',
            state: 'ok',
            level: 'verified',
            text: `${Math.round(s.insideShare * 100)}% of tracked positions fall inside the arena.`,
            stage: 'scale',
          }
        : {
            key: 'position',
            state: 'warn',
            level: 'verified',
            text: `Only ${Math.round(s.insideShare * 100)}% of tracked positions fall inside the arena. Check the arena size, the position units, and which way y increases (Tracking & coordinates).`,
            stage: 'scale',
          },
    );

  const regions = s.zones + s.excluded;
  if (s.pending)
    add({
      key: 'zones',
      state: 'todo',
      level: 'set',
      text: `${plural(s.pending, 'region')} from config.yaml wait for the arena outline and scale.`,
      stage: 'outline',
    });
  if (s.unverified)
    add({
      key: 'zones',
      state: 'warn',
      level: 'verified',
      text: `${plural(s.unverified, 'region')} loaded from config.yaml; placement not yet checked against the ${s.frameKind === 'blank' ? 'arena' : 'picture'}.`,
      stage: 'zones',
    });
  if (s.outside)
    add({
      key: 'zones',
      state: 'warn',
      level: 'valid',
      text: `${plural(s.outside, 'region')} reach${s.outside === 1 ? 'es' : ''} outside the arena outline.`,
      stage: 'zones',
    });
  if (!s.pending && !s.unverified && !s.outside)
    add({
      key: 'zones',
      state: regions ? 'ok' : 'info',
      level: 'valid',
      text: regions
        ? `${plural(s.zones, 'zone')}, ${plural(s.excluded, 'excluded region')}.`
        : 'No zones or excluded regions (optional).',
      stage: 'zones',
    });

  add({
    key: 'animal',
    state: 'info',
    level: 'set',
    text: s.bodyLength
      ? `Animal size: ${n1(s.bodyLength)} cm, nose tip to tail base.`
      : 'Animal size not set (optional; saved in the config, not used by any analysis yet).',
    stage: 'review',
  });
  return out;
}

/** Something must be done before the card can read Complete. Information alone never blocks. */
export const blocked = (checks: SpatialCheck[]) =>
  checks.some((c) => c.state === 'block' || c.state === 'todo' || c.state === 'warn');

/** The most important open point, in one sentence, or undefined when nothing is open. */
export const firstOpenCheck = (checks: SpatialCheck[]) =>
  (['block', 'todo', 'warn'] as const)
    .map((st) => checks.find((c) => c.state === st))
    .find(Boolean);
export const firstOpen = (checks: SpatialCheck[]) => firstOpenCheck(checks)?.text;
