// zone-occupancy.ts against the framework's ZoneOccupancy (zone_reference.json, written by
// make_zone_reference.py): same zone for every sample, same state order.

import { describe, expect, it } from 'vitest';
import { zoneOccupancy, zoneOrder, zoneShares, type ZoneShape } from '../lib/zone-occupancy.ts';
import ref from './zone_reference.json';

const x = ref.x.map((v) => v ?? NaN);
const zones = ref.zones as [string, ZoneShape][];

describe('zone occupancy', () => {
  it('orders polygons before rectangles, as the framework does', () => {
    expect(zoneOrder(zones).map(([n]) => n)).toEqual(ref.state_names);
  });

  it('puts every sample in the same zone as the framework', () => {
    expect(Array.from(zoneOccupancy(x, ref.y, zones))).toEqual(ref.zone);
  });

  it('shares count tracked samples only', () => {
    const occ = zoneOccupancy(x, ref.y, zones);
    const s = zoneShares(occ, zones.length);
    const tracked = ref.zone.filter((k) => k !== -2).length;
    expect(s.outside).toBeCloseTo(ref.zone.filter((k) => k === -1).length / tracked);
    expect(s.zones.reduce((a, b) => a + b, 0) + s.outside).toBeCloseTo(1);
  });
});
