import { describe, expect, it } from 'vitest';
import { analysisListRows, analysisSummary } from '../lib/analysis-list.ts';
import { badge } from '../lib/analyze-view.ts';
import type { AnalysisItem, Status } from '../lib/readiness.ts';

const needs: Status = { ...badge('needs_input'), input: [{ text: 'Load a position file.' }] };

describe('analysis list', () => {
  it('lists the five analyses with status words and reasons', () => {
    const rows = analysisListRows((id: AnalysisItem) =>
      id === 'peth' ? badge('outdated') : id === 'place' ? needs : badge('ready'),
    );
    expect(rows.map((r) => r.id)).toEqual(['place', 'auroc', 'peth', 'decoding', 'population']);
    expect(rows[0]).toMatchObject({ status: 'Needs input', reason: 'Load a position file.' });
    expect(rows[2].status).toBe('Needs rerun');
    expect(rows[1]).toMatchObject({ status: 'Ready', reason: '' });
  });

  it('summarizes for the sidebar', () => {
    const r = badge('ready');
    expect(analysisSummary([r, r, needs])).toBe('2 of 3 ready');
    expect(analysisSummary([r, badge('outdated'), badge('outdated')])).toBe('2 need rerun');
    expect(analysisSummary([r, badge('running')])).toBe('Running');
    expect(analysisSummary([needs, needs])).toBe('Needs input');
  });
});
