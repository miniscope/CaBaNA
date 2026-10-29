import type { JSX } from 'solid-js';
import { CompactHeader } from '@calab/ui';

export function Header(): JSX.Element {
  return (
    <CompactHeader title="CaBaNA" info={<span>Calcium Behavioral and Neural Analysis</span>} />
  );
}
