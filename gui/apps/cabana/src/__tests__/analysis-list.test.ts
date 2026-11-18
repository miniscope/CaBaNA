import { describe, expect, it } from 'vitest';
import { analysisSummary } from '../lib/analysis-list.ts';
import { badge } from '../lib/analyze-view.ts';
import type { Status } from '../lib/readiness.ts';

const needs: Status = { ...badge('needs_input'), input: [{ text: 'Load a position file.' }] };

describe('analysis list', () => {
  it('summarizes for the sidebar', () => {
    const r = badge('ready');
    expect(analysisSummary([r, r, needs])).toBe('2 of 3 ready');
    expect(analysisSummary([r, badge('outdated'), badge('outdated')])).toBe('2 need rerun');
    expect(analysisSummary([r, badge('running')])).toBe('Running');
    expect(analysisSummary([needs, needs])).toBe('Needs input');
  });
});
