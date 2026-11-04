import { describe, expect, it } from 'vitest';
import { guided, pFloor, pFloorText } from '../lib/guided.ts';
import { clearAll } from '../lib/store.ts';

const ORDER = ['maps', 'tests', 'fields', 'occupancy'];

describe('guided setup state', () => {
  it('opens sections, marks them reviewed and steps through them', () => {
    const g = guided('test-nav', 'maps');
    expect(g.section()).toBe('maps');
    expect(g.reviewed('maps')).toBe(true);
    expect(g.reviewed('tests')).toBe(false);
    expect(g.step(ORDER, -1)).toBeUndefined();
    g.open(g.step(ORDER, 1)!);
    expect(g.section()).toBe('tests');
    expect(g.reviewed('tests')).toBe(true);
    g.open('occupancy');
    expect(g.step(ORDER, 1)).toBeUndefined();
    expect(g.step(ORDER, -1)).toBe('fields');
  });

  it('keeps its state for the page and resets when the dataset is cleared', () => {
    const g = guided('test-keep', 'maps');
    g.open('fields');
    g.setStage('review');
    // the same page gets the same state back, as after a visit to the results
    expect(guided('test-keep', 'maps')).toBe(g);
    expect(g.stage()).toBe('review');
    clearAll();
    expect(g.stage()).toBe('configure');
    expect(g.section()).toBe('maps');
    expect(g.reviewed('fields')).toBe(false);
  });
});

describe('p floor', () => {
  it('is 1 / (shuffles + 1)', () => {
    expect(pFloor(50)).toBeCloseTo(1 / 51);
    expect(pFloorText(50)).toBe('minimum p = 1/51 = 0.0196');
    expect(pFloorText(1000)).toBe('minimum p = 1/1001 = 0.000999');
  });
});
