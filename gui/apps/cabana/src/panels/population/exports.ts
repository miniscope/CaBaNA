// The export menu of a Population figure: figure files from the displayed SVG (current plot
// settings), the framework's own figures and tables (default styling) and the run bundle.

import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeState } from '../../lib/bridge-status.ts';
import { download, exportNotes, serializeSvg, svgToPng, toCsv } from '../../lib/export-figure.ts';
import type { ExportGroup } from '../results/ExportMenu.tsx';

const NEEDS_ENGINE = 'Needs the Python engine';
export const SHOWN = 'Reflects the current plot settings';
export const DEFAULT_STYLE = 'Default styling; ignores the plot settings';

export interface ExportSource {
  record: RunRecord;
  resultName: string;
  /** Framework figure kinds listed for this result in the manifest. */
  plots: string[];
  svg: () => SVGSVGElement | undefined;
  canvases?: () => HTMLCanvasElement[];
  csv: () => { header: string[]; rows: (string | number | null)[][] };
  file: string;
}

export function exportGroups(o: ExportSource): ExportGroup[] {
  const engine = () => (bridgeState().kind === 'ready' ? undefined : NEEDS_ENGINE);
  const svgText = () => {
    const el = o.svg();
    if (!el) throw new Error('The figure is not drawn yet.');
    return serializeSvg(el, { canvases: o.canvases?.(), background: '#fff' });
  };
  const runId = o.record.run_id;
  return [
    {
      title: 'Figure as shown',
      items: [
        {
          label: 'Figure (SVG)',
          note: SHOWN,
          run: () => download(`${o.file}.svg`, svgText(), 'image/svg+xml'),
        },
        {
          label: 'Figure (PNG, 2x)',
          note: SHOWN,
          run: async () => {
            const box = o.svg()!.getBoundingClientRect();
            download(`${o.file}.png`, await svgToPng(svgText(), box.width, box.height, 2));
          },
        },
      ],
    },
    {
      title: 'Framework files',
      items: [
        ...o.plots.flatMap((kind) =>
          (['svg', 'png'] as const).map((fmt) => ({
            label: `Framework figure ${kind.replace(/_/g, ' ')} (${fmt.toUpperCase()})`,
            note: DEFAULT_STYLE,
            unavailable: engine(),
            run: async () =>
              download(
                `${runId}_${o.resultName}_${kind}.${fmt}`,
                await bridge.figure(runId, o.resultName, kind, fmt),
              ),
          })),
        ),
        {
          label: 'Data (CSV)',
          note: 'Default order and columns; includes the run notes',
          run: () => {
            const { header, rows } = o.csv();
            download(`${o.file}.csv`, toCsv(header, rows, exportNotes(o.record)), 'text/csv');
          },
        },
        {
          label: 'Framework table (CSV)',
          note: DEFAULT_STYLE,
          unavailable: engine(),
          run: async () =>
            download(
              `${runId}_${o.resultName}.csv`,
              await bridge.tableCsv(runId, o.resultName),
              'text/csv',
            ),
        },
        {
          label: 'Run bundle (zip)',
          note: 'All results of this run; not affected by plot settings',
          unavailable: engine(),
          run: async () => download(`${runId}.zip`, await bridge.bundle(runId)),
        },
      ],
    },
  ];
}
