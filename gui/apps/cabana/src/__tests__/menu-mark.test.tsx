// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { ActionsMenu } from '../components/ActionsMenu.tsx';

describe('menu marks', () => {
  it('draws ✓ on data types already added and a hint after the label', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(
      () => (
        <ActionsMenu
          label="Add"
          items={[
            { kind: 'header', label: 'Add neural data' },
            {
              kind: 'action',
              label: 'Denoised traces',
              hint: 'recommended',
              mark: true,
              onSelect: () => {},
            },
            {
              kind: 'action',
              label: 'Raw traces',
              hint: 'optional',
              mark: false,
              onSelect: () => {},
            },
            { kind: 'action', label: 'View data', onSelect: () => {} },
          ]}
        />
      ),
      host,
    );
    host.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 0));
    const rows = [...document.querySelectorAll('.cb-menu__row')];
    expect(rows.map((r) => r.querySelector('.cb-menu__mark')?.textContent ?? null)).toEqual([
      '✓',
      '',
      null,
    ]);
    expect(rows[0].getAttribute('aria-label')).toBe('Denoised traces (added)');
    expect(rows[1].querySelector('.cb-menu__hint')?.textContent).toBe('optional');
  });
});
