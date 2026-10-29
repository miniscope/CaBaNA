// Keeps the decoding settings across page reloads (browser storage, this viewer only).

import { createEffect, createRoot, on } from 'solid-js';
import {
  behaviorDecoding,
  DEFAULT_BEHAVIOR_DECODING,
  DEFAULT_POSITION_DECODING,
  decodeTarget,
  positionDecoding,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
} from '../../lib/decoding-settings.ts';
import { persistStore } from '../../lib/persist-settings.ts';

const TARGET_KEY = 'cabana.decoding.target';

createRoot(() => {
  persistStore('cabana.decoding.position', positionDecoding, setPositionDecoding, {
    ...DEFAULT_POSITION_DECODING,
  });
  persistStore('cabana.decoding.behaviors', behaviorDecoding, setBehaviorDecoding, {
    ...DEFAULT_BEHAVIOR_DECODING,
    labels: [],
  });
  try {
    const saved = localStorage.getItem(TARGET_KEY);
    if (saved === 'position' || saved === 'behaviors') setDecodeTarget('type', saved);
  } catch {
    // unreadable storage: start with position
  }
  createEffect(
    on(
      () => decodeTarget.type,
      (type) => {
        try {
          localStorage.setItem(TARGET_KEY, type);
        } catch {
          // not remembered
        }
      },
      { defer: true },
    ),
  );
});
