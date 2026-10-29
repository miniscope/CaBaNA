import { describe, expect, it } from 'vitest';
import { exportNotes, serializeSvg, toCsv } from '../lib/export-figure.ts';
import { emptyProject, ProjectTooNew, readProject, PROJECT_VERSION } from '../lib/project.ts';

describe('figure export', () => {
  it('keeps axis labels as text and embeds canvas layers as images', () => {
    document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="5" y="10">Time (s)</text></svg>';
    const svg = document.querySelector('svg') as SVGSVGElement;
    const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    canvas.toDataURL = () => 'data:image/png;base64,AAAA';
    const out = serializeSvg(svg, { canvases: [canvas], background: '#fff' });
    expect(out).toContain('<svg');
    expect(out).toContain('>Time (s)</text>');
    expect(out).toContain('<image');
    expect(out).toContain('data:image/png;base64,AAAA');
    // the raster sits under the text so the axes stay vector
    expect(out.indexOf('<image')).toBeLessThan(out.indexOf('<text'));
  });
  it('writes csv with notes, quoting and a preliminary marker', () => {
    const csv = toCsv(['state', 'value'], [['a,b', 1.5], ['c', null]], exportNotes({ scope: 'preview', analysis: 'population', run_id: 'r1' }));
    expect(csv.split('\n')).toEqual(['# run r1 (population)', '# Preliminary: quick preview with 50 shuffles', 'state,value', '"a,b",1.5', 'c,', '']);
  });
});

describe('project state', () => {
  it('fills missing fields and round-trips', () => {
    const p = { ...emptyProject(), rejectedCells: [3], labelRoles: { tone: 'controlled' as const } };
    expect(readProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(readProject({ rejectedCells: [1] }).labelRoles).toEqual({});
  });
  it('refuses a project from a newer GUI', () => {
    expect(() => readProject({ projectVersion: PROJECT_VERSION + 1 })).toThrow(ProjectTooNew);
  });
});
