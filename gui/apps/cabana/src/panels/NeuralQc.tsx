import type { JSX } from 'solid-js';
import { kernelChecks } from '../lib/decon-state.ts';
import { deconvolved, footprints, rejected, traceMatrix } from '../lib/store.ts';
import { DeconCorrection, DeconPlots, DeconSettings } from './DeconQc.tsx';
import { CellsCorrection, CellsFlagged, CellsPlot } from './NeuralQcCells.tsx';
import { FootprintsFlagged, FootprintsPlot } from './NeuralQcFootprints.tsx';
import { cellsMetrics, deconMetrics, footprintMetrics } from './NeuralQcMetrics.tsx';
import { cellChecks, flaggedCells, footprintCheckList, overlapPairs } from './NeuralQcShared.tsx';
import type { Category } from './QcPanel.tsx';
import { Advice, QcSettings } from './QcParts.tsx';

/** The count shown in the summary: cells flagged for review, and cells the user rejected. */
export const neuralNote = () =>
  traceMatrix()
    ? `${flaggedCells().length} cells flagged for review · ${rejected().size} rejected by you`
    : undefined;

/** Every limit and kernel setting of the Neural tab, grouped by test. */
export function neuralSettings(): JSX.Element {
  return (
    <QcSettings
      groups={[
        { title: 'Cells', keys: ['poorCellPct', 'riseLowPct'] },
        { title: 'Footprints', keys: ['overlapPct'] },
        {
          title: 'Deconvolution',
          keys: ['minPve'],
          children: (
            <div class="cb-controls cb-controls--rail">
              <DeconSettings />
            </div>
          ),
        },
      ]}
    />
  );
}

/** The Neural tab's tests; none when nothing neural is loaded. */
export function neuralCategories(): Category[] {
  if (!traceMatrix() && !deconvolved() && !footprints()) return [];
  return [
    {
      id: 'cells',
      name: 'Cells',
      description: 'Signal to noise and events per cell',
      checks: cellChecks(),
      flagged: flaggedCells().length,
      flaggedWord: 'cells',
      section: 'cells',
      tabs: [{ id: 'cells', label: 'Cells' }],
      plot: () => <CellsPlot />,
      metrics: cellsMetrics,
      flaggedList: CellsFlagged,
      correction: CellsCorrection,
      correctionHint: 'Reject cells you will not analyze',
    },
    ...(footprints()
      ? [
          {
            id: 'footprints',
            name: 'Footprints',
            description: 'Footprints match the traces, overlap and empty footprints',
            checks: footprintCheckList(),
            flagged: overlapPairs().length,
            flaggedWord: 'pairs',
            section: 'cells' as const,
            tabs: [{ id: 'map', label: 'Footprints' }],
            plot: () => <FootprintsPlot />,
            metrics: footprintMetrics,
            flaggedList: FootprintsFlagged,
            correction: () => <Advice checks={footprintCheckList()} />,
            correctionHint: 'Reject one cell of an overlapping pair',
          },
        ]
      : []),
    ...(deconvolved()
      ? [
          {
            id: 'decon',
            name: 'Deconvolution',
            description: 'Whether the events, reconvolved, explain the trace',
            checks: kernelChecks(),
            flagged: kernelChecks().filter((c) => c.status !== 'pass').length,
            flaggedWord: 'notes',
            section: 'decon' as const,
            tabs: [{ id: 'plots', label: 'Deconvolution' }],
            plot: () => <DeconPlots />,
            metrics: deconMetrics,
            correction: DeconCorrection,
            correctionHint: 'Match the kernel or rerun deconvolution',
          },
        ]
      : []),
  ];
}
