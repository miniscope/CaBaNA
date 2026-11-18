// The Footprints test of Neural QC: the map and the overlapping pairs.
import type { JSX } from 'solid-js';
import { cell, overlapPartner, selectCell } from '../lib/store.ts';
import { RejectButton } from './RejectReason.tsx';
import { ColorBy, FOOTPRINT_HELP, overlapPairs, SquareMap } from './NeuralQcShared.tsx';
import { PagedList, PlotCard, RailBox } from './QcParts.tsx';

export function FootprintsPlot(): JSX.Element {
  return (
    <PlotCard
      title="Footprint map"
      class="cb-plot--grow3"
      tools={<ColorBy />}
      help={FOOTPRINT_HELP}
    >
      {(s) => <SquareMap w={s().w} h={s().h} />}
    </PlotCard>
  );
}

export function FootprintsFlagged(): JSX.Element {
  const pairs = overlapPairs;
  return (
    <RailBox title="Overlapping pairs" grow>
      <PagedList
        id="pairs"
        items={pairs()}
        selected={pairs().findIndex((p) => p.a === cell() && p.b === overlapPartner())}
        onSelect={(i) => selectCell(pairs()[i].a, pairs()[i].b)}
        empty="No cell pairs share over half of the smaller footprint."
        after={(p) => (
          <span class="cb-list__after">
            <RejectButton
              class="cb-link"
              cells={() => [p.a]}
              label={`Reject ${p.a + 1}`}
              suggest="Duplicate of another cell"
              note={`overlaps cell ${p.b + 1}`}
            />
            <RejectButton
              class="cb-link"
              cells={() => [p.b]}
              label={`Reject ${p.b + 1}`}
              suggest="Duplicate of another cell"
              note={`overlaps cell ${p.a + 1}`}
            />
          </span>
        )}
      >
        {(p) => (
          <span>
            Cell {p.a + 1} and cell {p.b + 1}, {p.note}
          </span>
        )}
      </PagedList>
    </RailBox>
  );
}
