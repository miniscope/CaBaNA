import { Match, Switch, type JSX } from 'solid-js';
import { qcPopup } from '../lib/qc-popup-view.ts';
import { FootprintsQcPopup } from './FootprintsQcPopup.tsx';
import { NeuralPrepPopup } from './NeuralPrepPopup.tsx';
import { NeuralQcPopup } from './NeuralQcPopup.tsx';

/** The QC or Preprocess pop-up opened from a Data visualization box. */
export function QcPopups(): JSX.Element {
  return (
    <Switch>
      <Match when={qcPopup() === 'neural-qc'}>
        <NeuralQcPopup />
      </Match>
      <Match when={qcPopup() === 'footprints-qc'}>
        <FootprintsQcPopup />
      </Match>
      <Match when={qcPopup() === 'neural-prep'}>
        <NeuralPrepPopup />
      </Match>
    </Switch>
  );
}
