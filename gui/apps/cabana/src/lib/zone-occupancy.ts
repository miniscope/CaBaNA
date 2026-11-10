// Which zone each position sample is in, as the framework's `zone_occupancy` transform decides it
// (cabana/_transform/_behavior.py, ZoneOccupancy): polygons by even-odd ray casting, rectangles
// with inclusive edges, polygons listed before rectangles, and with `exclusive` a sample inside
// several zones goes to the first listed. Samples with a NaN coordinate are in no zone and are not
// counted as tracked. Tested against the framework in zone-occupancy.test.ts.

/** A zone as config.yaml writes it: a rectangle [x0, y0, x1, y1] or polygon vertices. */
export type ZoneShape = number[] | number[][];

const isRect = (z: ZoneShape): z is number[] => typeof z[0] === 'number';

function inPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

const inRect = (x: number, y: number, [x0, y0, x1, y1]: number[]) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Zones in the framework's state order: every polygon, then every rectangle, each in given order. */
export function zoneOrder(zones: [string, ZoneShape][]): [string, ZoneShape][] {
  return [...zones.filter(([, z]) => !isRect(z)), ...zones.filter(([, z]) => isRect(z))];
}

/**
 * Per sample, the index (in `zoneOrder` order) of the zone it is in, -1 for tracked but in no
 * zone, and -2 for an untracked (NaN) sample. Overlapping zones without `exclusive` are not
 * representable here; the framework's default is exclusive, which is what the bars show.
 */
export function zoneOccupancy(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  zones: [string, ZoneShape][],
): Int32Array {
  const order = zoneOrder(zones).map(([, z]) => z);
  const out = new Int32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const [xi, yi] = [x[i], y[i]];
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) {
      out[i] = -2;
      continue;
    }
    out[i] = order.findIndex((z) => (isRect(z) ? inRect(xi, yi, z) : inPolygon(xi, yi, z)));
  }
  return out;
}

/** Share of tracked samples in each zone (`zoneOrder` order), and outside every zone. */
export function zoneShares(occ: Int32Array, nZones: number): { zones: number[]; outside: number } {
  const counts = new Array<number>(nZones).fill(0);
  let tracked = 0;
  let outside = 0;
  for (const k of occ) {
    if (k === -2) continue;
    tracked++;
    if (k === -1) outside++;
    else counts[k]++;
  }
  const d = tracked || 1;
  return { zones: counts.map((c) => c / d), outside: outside / d };
}
