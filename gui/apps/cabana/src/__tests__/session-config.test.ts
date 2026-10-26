import { describe, expect, it } from 'vitest';
import { preprocessYaml } from '../lib/session-config.ts';
import { setPrep } from '../lib/preprocess.ts';

describe('preprocess.yaml', () => {
  it('always writes the minimum speed, 2 cm/s by default', () => {
    expect(preprocessYaml()).toContain('"min_speed":2');
  });
  it('writes the Preprocess value after it is changed', () => {
    setPrep('minSpeed', 5);
    expect(preprocessYaml()).toContain('"min_speed":5');
  });
});
