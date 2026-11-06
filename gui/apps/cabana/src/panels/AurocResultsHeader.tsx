// The auROC results header: run title and actions, the four summary cards and the significance note.

import { createMemo, type JSX } from 'solid-js';
import { MetricCards } from '../components/MetricCards.tsx';
import { aurocCards } from '../lib/auroc-population.ts';
import { MIN_FRAMES } from '../lib/auroc.ts';
import { type AurocOutcome } from '../lib/auroc-run.ts';
import { summarize } from '../lib/auroc-view.ts';
import { exportGroups } from './AurocResults.tsx';
import { InfoTip } from './InfoTip.tsx';
import { ExportMenu } from './results/ExportMenu.tsx';

export function Header(props: {
  out: AurocOutcome;
  /** The selected behavior, which the Higher, Lower and Not significant cards follow. */
  b: number;
  onEdit: () => void;
  onDetails: () => void;
}): JSX.Element {
  const s = createMemo(() => summarize(props.out));
  const o = () => props.out;
  const method = () =>
    `${o().settings.method === 'speed' ? 'Speed-matched circular shift' : 'Circular shift'}, ${o().settings.nShuffles.toLocaleString()} shuffles`;
  const maxStat = () => o().settings.correction === 'max_stat';
  return (
    <>
      <div class="cb-ar-head">
        <div>
          <h2 class="cb-restitle">auROC results</h2>
        </div>
        <div class="cb-controls">
          <button class="btn-secondary" aria-haspopup="dialog" onClick={props.onDetails}>
            Run details
          </button>
          <button class="btn-secondary" onClick={props.onEdit}>
            Edit settings
          </button>
          <ExportMenu label="Export results" groups={exportGroups(o())} />
        </div>
      </div>
      <MetricCards label="auROC results" cards={aurocCards(o(), props.b)} />
      <p class="cb-muted cb-ar-note">
        Significant = adjusted p &lt; {o().settings.alpha}.{' '}
        {maxStat()
          ? `Max-stat correction across the ${o().labels.length} selected behaviors within each cell, not across cells.`
          : 'No correction for multiple comparisons.'}{' '}
        Higher, Lower and Not significant follow the behavior selected below; Responsive counts
        unique cells across all behaviors. Completed in {Math.max(1, Math.round(o().seconds))} s ·{' '}
        {method()}
        <InfoTip label="Why a cell may not be evaluated">
          <p>
            auROC is left undefined, and the result is marked <strong>Not evaluated</strong>, in two
            cases:
          </p>
          <ul>
            <li>
              <strong>Missing neural values:</strong> the cell has a missing value in any included
              frame. All of its behaviors are not evaluated. {s().missingCells} cell
              {s().missingCells === 1 ? '' : 's'} in this run.
            </li>
            <li>
              <strong>Too few frames:</strong> a behavior has fewer than {MIN_FRAMES} included
              frames during it or outside it. That behavior is not evaluated for any cell.
              {s().tooFewFrames.length
                ? ` In this run: ${s().tooFewFrames.join(', ')}.`
                : ' None in this run.'}
            </li>
          </ul>
          <p>
            Not evaluated is not zero and not nonsignificant. These results are left out of every
            count of evaluated cells.
          </p>
        </InfoTip>
        <InfoTip label="About the significance test and correction">
          <p>
            Significance compares the observed auROC with auROC values from time-shifted copies of
            the cell's neural data.
          </p>
          <p>
            {maxStat()
              ? 'Max-stat correction accounts for testing the selected behaviors within each cell; it does not correct across cells. Adding or removing behaviors can change adjusted p-values.'
              : 'No correction is applied: p-values are uncorrected for the number of behaviors and cells tested.'}
          </p>
        </InfoTip>
      </p>
    </>
  );
}
