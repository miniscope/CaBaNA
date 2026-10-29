import type { JSX } from 'solid-js';
import { CompactHeader } from '@calab/ui';
import { layout, setLayout } from '../lib/store.ts';

export function Header(): JSX.Element {
  return (
    <CompactHeader
      title="CaBaNA"
      info={<span>Calcium Behavioral and Neural Analysis</span>}
      actions={
        <label class="cb-layout-select">
          Layout{' '}
          <select
            value={layout()}
            onChange={(e) => setLayout(e.currentTarget.value as 'steps' | 'sidebar')}
          >
            <option value="steps">Steps</option>
            <option value="sidebar">Sidebar</option>
          </select>
        </label>
      }
    />
  );
}
