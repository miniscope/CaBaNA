import { describe, expect, it } from 'vitest';
import { nullHistogram } from '../lib/plot-builders.ts';
import {
  classifyChange,
  DEFAULT_STYLE,
  PLOT_SPEC_VERSION,
  specCsv,
  type PlotSpec,
} from '../lib/plot-spec.ts';
import { dataExtent, niceTicks, renderSvg } from '../lib/plot-svg.ts';

const hist = (): PlotSpec => ({
  version: PLOT_SPEC_VERSION,
  source: {
    analysis: 'auroc',
    runId: 'r1',
    engine: 'browser-ts',
    label: 'auROC null, cell 3, sniff',
    settings: { shuffles: 4, alpha: 0.05 },
  },
  data: {
    type: 'histogram',
    edges: [0.4, 0.45, 0.5, 0.55],
    counts: [1, 2, 1],
    markers: [{ x: 0.6, label: 'Observed 0.600' }],
    band: { lo: 0.42, hi: 0.53, label: 'Central 95% of the null (unadjusted)' },
  },
  axes: { x: 'auROC of time-shifted data', y: 'Shifts' },
  display: {},
  style: { ...DEFAULT_STYLE, title: 'A <title> & more' },
});

describe('plot spec', () => {
  it('classes changes so analytical ones are never edited as appearance', () => {
    expect(classifyChange('style.fontSize')).toBe('cosmetic');
    expect(classifyChange('axes.x')).toBe('cosmetic');
    expect(classifyChange('display.xMin')).toBe('display');
    expect(classifyChange('data.counts')).toBe('analytical');
    expect(classifyChange('source.settings.shuffles')).toBe('analytical');
  });

  it('writes the saved numbers as CSV with their source', () => {
    const csv = specCsv(hist());
    expect(csv).toContain('# auROC null, cell 3, sniff');
    expect(csv).toContain('run=r1');
    expect(csv).toContain('bin_start,bin_stop,count\n0.4,0.45,1\n');
  });
});

describe('SVG renderer', () => {
  it('draws one bar per bin, the band and the marker, with text kept as text', () => {
    const svg = renderSvg(hist());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.match(/fill-opacity="0.75"/g)?.length).toBe(3 + 1); // bars + legend swatch
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(svg).toContain('A &lt;title&gt; &amp; more');
    expect(svg).toContain('>auROC of time-shifted data</text>');
    expect(svg).not.toContain('<image');
  });

  it('includes markers in the x extent and starts histograms at 0', () => {
    expect(dataExtent(hist().data)).toEqual({ x: [0.4, 0.6], y: [0, 2] });
  });

  it('picks round ticks', () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-4, 4, 4)).toEqual([-4, -2, 0, 2, 4]);
  });
});

describe('auROC null histogram builder', () => {
  it('bins every finite draw and takes the central interval like the cell inspector', () => {
    const draws = [0.45, 0.48, 0.5, 0.52, 0.55, NaN];
    const h = nullHistogram(draws, 0.6, 0.05);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(h.edges.length).toBe(h.counts.length + 1);
    expect(h.edges[0]).toBeLessThan(0.45);
    expect(h.edges[h.edges.length - 1]).toBeGreaterThan(0.6);
    expect(h.band!.lo).toBeCloseTo(0.453, 9); // 2.5th percentile, linear interpolation
    expect(h.band!.hi).toBeCloseTo(0.547, 9);
  });
});
