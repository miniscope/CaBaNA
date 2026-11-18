import { Match, Switch, type JSX } from 'solid-js';
import { qcPopup } from '../lib/qc-popup-view.ts';
import { FootprintsQcPopup } from './FootprintsQcPopup.tsx';
import { NeuralPrepPopup } from './NeuralPrepPopup.tsx';
import { BehaviorPrepPopup } from './BehaviorPrepPopup.tsx';
import { BehaviorQcPopup } from './BehaviorQcPopup.tsx';
import { PositionPrepPopup } from './PositionPrepPopup.tsx';
import { PositionQcPopup } from './PositionQcPopup.tsx';
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
      <Match when={qcPopup() === 'position-qc'}>
        <PositionQcPopup />
      </Match>
      <Match when={qcPopup() === 'position-prep'}>
        <PositionPrepPopup />
      </Match>
      <Match when={qcPopup() === 'behavior-qc'}>
        <BehaviorQcPopup />
      </Match>
      <Match when={qcPopup() === 'behavior-prep'}>
        <BehaviorPrepPopup />
      </Match>
    </Switch>
  );
}
