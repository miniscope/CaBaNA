import { describe, expect, it } from 'vitest';
import { resolvePanel, stepFocus, type MenuItem } from '../lib/actions-menu.ts';
import { saveText } from '../lib/save-status.ts';
import { clamp, formatValue, parseEntry } from '../lib/slider-number.ts';

const noop = () => {};
const menu: MenuItem[] = [
  { kind: 'action', label: 'Rename', onSelect: noop },
  {
    kind: 'category',
    label: 'Display',
    items: [
      { kind: 'one', label: 'Heat', checked: true, onSelect: noop },
      {
        kind: 'category',
        label: 'Signal',
        items: [{ kind: 'many', label: 'Raw', checked: false, onToggle: noop }],
      },
    ],
  },
];

describe('resolvePanel', () => {
  it('shows only the menu with an empty path', () => {
    expect(resolvePanel(menu, []).items).toBeNull();
  });
  it('opens the second panel for a category of the menu', () => {
    const p = resolvePanel(menu, ['Display']);
    expect(p.items).toHaveLength(2);
    expect(p).toMatchObject({ title: null, canGoBack: false, owner: 'Display' });
  });
  it('replaces the panel contents for a nested category, with Back', () => {
    const p = resolvePanel(menu, ['Display', 'Signal']);
    expect(p.items?.[0]).toMatchObject({ label: 'Raw' });
    expect(p).toMatchObject({ title: 'Signal', canGoBack: true, owner: 'Display' });
  });
  it('stops at a category that is gone', () => {
    expect(resolvePanel(menu, ['Display', 'Missing']).title).toBeNull();
    expect(resolvePanel(menu, ['Missing']).items).toBeNull();
  });
});

describe('stepFocus', () => {
  it('wraps and handles Home and End', () => {
    expect(stepFocus(2, 3, 'ArrowDown')).toBe(0);
    expect(stepFocus(0, 3, 'ArrowUp')).toBe(2);
    expect(stepFocus(-1, 3, 'ArrowDown')).toBe(0);
    expect(stepFocus(1, 3, 'End')).toBe(2);
    expect(stepFocus(1, 3, 'a')).toBeNull();
    expect(stepFocus(0, 0, 'ArrowDown')).toBeNull();
  });
});

describe('slider number', () => {
  it('clamps typed values to the range', () => {
    expect(clamp(9, 0, 5)).toBe(5);
    expect(parseEntry('-2', 1, 0, 5)).toBe(0);
    expect(parseEntry('2.5', 1, 0, 5)).toBe(2.5);
  });
  it('keeps the current value for unreadable text', () => {
    expect(parseEntry('abc', 1.5, 0, 5)).toBe(1.5);
    expect(parseEntry('', 1.5, 0, 5)).toBe(1.5);
  });
  it('reads and shows the zero word', () => {
    expect(parseEntry('Off', 1, 0, 5, 'off')).toBe(0);
    expect(formatValue(0, 0.05, 'off')).toBe('off');
    expect(formatValue(0, 0.05)).toBe('0.00');
    expect(formatValue(0.4, 0.05, 'off')).toBe('0.40');
    expect(formatValue(0.5, 0.1, undefined, 2)).toBe('0.50');
    expect(formatValue(0.5, 0.1)).toBe('0.5');
  });
});

describe('saveText', () => {
  it('words each state', () => {
    expect(
      saveText({ kind: 'saved', at: new Date(2026, 10, 18, 10, 42), dir: '/p', files: [] }).text,
    ).toBe('Saved 10:42');
    expect(saveText({ kind: 'saving' }).text).toBe('Saving…');
    expect(saveText({ kind: 'engine-off' })).toEqual({
      text: 'Not saved: engine off',
      tone: 'flag',
    });
    expect(saveText({ kind: 'unsaved' }).text).toBe('Unsaved changes · Save project');
  });
});
