import { kernelChecks } from '../lib/decon-state.ts';
import { deconvolved, footprints, traceMatrix } from '../lib/store.ts';
import { cellChecks, footprintCheckList } from './NeuralQcShared.tsx';
import type { Category } from './QcPanel.tsx';
import { DeconSettings } from './DeconSettings.tsx';
import type { SettingsGroup } from './QcParts.tsx';

/** The neural tests with their checks; none when nothing neural is loaded. */
export function neuralTests(): Category[] {
  if (!traceMatrix() && !deconvolved() && !footprints()) return [];
  return [
    { id: 'cells', name: 'Cells', checks: cellChecks() },
    ...(footprints()
      ? [{ id: 'footprints', name: 'Footprints', checks: footprintCheckList() }]
      : []),
    ...(deconvolved() ? [{ id: 'decon', name: 'Deconvolution', checks: kernelChecks() }] : []),
  ];
}

export const cellSettings = (): SettingsGroup[] => [
  { title: 'Cells', keys: ['poorCellPct', 'riseLowPct'] },
  {
    title: 'Deconvolution',
    keys: ['minPve'],
    children: (
      <div class="cb-controls cb-controls--rail">
        <DeconSettings />
      </div>
    ),
  },
];

export const footprintSettings = (): SettingsGroup[] => [
  { title: 'Footprints', keys: ['overlapPct'] },
];
