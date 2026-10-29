// The Export menu of each decoding figure: the figure as drawn (reflects the plot settings), the
// framework's own figure, the table behind it, and the run bundle.

import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { download, serializeSvg, svgToPng } from '../../lib/export-figure.ts';
import type { ExportGroup } from '../results/ExportMenu.tsx';

export interface ExportSpec {
  /** Short name used in file names. */
  name: string;
  svg: () => SVGSVGElement | undefined;
  csv: () => string;
  record?: RunRecord;
  /** Framework result name and plot kind of the same figure, when the framework has one. */
  frameworkPlot?: { result: string; kind: string };
}

const STYLED = 'Reflects the current plot settings';

export function plotExports(o: ExportSpec): ExportGroup[] {
  const stem = `decoding_${o.name}${o.record ? `_${o.record.run_id}` : ''}`;
  const svg = () => {
    const el = o.svg();
    if (!el) throw new Error('The figure is not drawn yet.');
    return el;
  };
  const noRun = o.record ? undefined : 'Needs a saved run (not available for a test fixture).';
  const fw = (fmt: 'svg' | 'png') => async () => {
    const plot = o.frameworkPlot!;
    download(
      `${stem}_framework.${fmt}`,
      await bridge.figure(o.record!.run_id, plot.result, plot.kind, fmt),
    );
  };
  const frameworkNote =
    noRun ?? (o.frameworkPlot ? undefined : 'The framework has no figure for this view.');
  return [
    {
      title: 'Figure as shown',
      items: [
        {
          label: 'SVG',
          note: STYLED,
          run: () =>
            download(`${stem}.svg`, serializeSvg(svg(), { background: '#fff' }), 'image/svg+xml'),
        },
        {
          label: 'PNG (2x)',
          note: STYLED,
          run: async () => {
            const el = svg();
            const box = el.getBoundingClientRect();
            download(
              `${stem}.png`,
              await svgToPng(serializeSvg(el, { background: '#fff' }), box.width, box.height, 2),
            );
          },
        },
      ],
    },
    {
      title: 'Framework figure',
      items: [
        {
          label: 'SVG',
          note: 'Framework default styling; ignores the plot settings',
          run: fw('svg'),
          unavailable: frameworkNote,
        },
        {
          label: 'PNG',
          note: 'Framework default styling; ignores the plot settings',
          run: fw('png'),
          unavailable: frameworkNote,
        },
      ],
    },
    {
      title: 'Data',
      items: [
        {
          label: 'CSV',
          note: 'All values of the result; independent of plot settings',
          run: () => download(`${stem}.csv`, o.csv(), 'text/csv'),
        },
        {
          label: 'Run bundle (zip)',
          note: 'Results, settings and inputs of the run',
          run: async () => download(`${stem}_bundle.zip`, await bridge.bundle(o.record!.run_id)),
          unavailable: noRun,
        },
      ],
    },
  ];
}
