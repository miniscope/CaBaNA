// The parts of the Experiment config view: a section block with a header bar, number and choice
// fields, and the Spatial setup and Experiment & subjects sections. ConfigView.tsx has the rest.

import { For, Show, type JSX } from 'solid-js';
import { arena, setArena } from '../../lib/arena.ts';
import {
  configAll,
  configOpen,
  openEntry,
  toggleAllFields,
  toggleConfigSection,
} from '../../lib/data-setup-view.ts';
import { INDICATORS } from '../../lib/decon.ts';
import { indicatorId, setIndicator } from '../../lib/decon-state.ts';
import { PARADIGMS } from '../../lib/experiments.ts';
import {
  experimentId,
  sessionName,
  setExperiment,
  setSessionName,
  setSource,
  source,
} from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { BRAIN_REGIONS, Text } from '../SetupPanel.tsx';

export function Num(props: {
  label: string;
  unit: string;
  value: number | undefined;
  set: (v: number | undefined) => void;
  step?: number;
}): JSX.Element {
  return (
    <label class="cb-setup-field">
      {props.label}
      <span class="cb-controls">
        <input
          type="number"
          min="0"
          step={props.step ?? 1}
          value={props.value ?? ''}
          onInput={(e) => props.set(e.currentTarget.value ? +e.currentTarget.value : undefined)}
        />{' '}
        {props.unit}
      </span>
    </label>
  );
}

export function Select<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string][];
  set: (v: T) => void;
}): JSX.Element {
  return (
    <label class="cb-setup-field">
      {props.label}
      <select value={props.value} onChange={(e) => props.set(e.currentTarget.value as T)}>
        <For each={props.options}>{([v, t]) => <option value={v}>{t}</option>}</For>
      </select>
    </label>
  );
}

/**
 * One section: a header bar (name, Required, Show all fields, and at the far right why it
 * matters) over its fields. One section is open at a time: clicking a bar opens that section on
 * its key fields and folds the others to their bar with a one-line `summary`; clicking the open
 * section's name folds it. `wide` fields take the whole width instead of the three columns.
 */
export function Section(props: {
  id: string;
  title: string;
  why: string;
  summary: string;
  required?: boolean;
  keyFields: JSX.Element;
  more?: JSX.Element;
  wide?: boolean;
}): JSX.Element {
  const isOpen = () => configOpen() === props.id;
  const all = () => isOpen() && configAll();
  return (
    <section class="cb-ds-cfg" classList={{ 'cb-ds-cfg--folded': !isOpen() }}>
      <header class="cb-ds-cfg__bar">
        <button
          type="button"
          class="cb-ds-cfg__open"
          aria-expanded={isOpen()}
          onClick={() => toggleConfigSection(props.id)}
        >
          <span aria-hidden="true" class="cb-ds-cfg__caret">
            {isOpen() ? '▾' : '▸'}
          </span>
          <h4>{props.title}</h4>
          <Show when={props.required}>
            <span class="cb-warn">Required</span>
          </Show>
          <Show when={!isOpen()}>
            <span class="cb-ds-cfg__sum">{props.summary}</span>
          </Show>
        </button>
        <Show when={props.more}>
          <button class="cb-linkbtn" onClick={() => toggleAllFields(props.id)}>
            {all() ? 'Show fewer fields' : 'Show all fields'}
          </button>
        </Show>
        <InfoTip label={`Why ${props.title} matters`}>{props.why}</InfoTip>
      </header>
      <Show when={isOpen()}>
        <div class="cb-ds-cfg__body">
          <Show when={!props.wide} fallback={props.keyFields}>
            <div class="cb-setup-grid cb-ds-cfg__grid">{props.keyFields}</div>
          </Show>
          <Show when={all() && props.more}>
            <div class="cb-setup-grid cb-ds-cfg__grid cb-ds-cfg__more">{props.more}</div>
          </Show>
        </div>
      </Show>
    </section>
  );
}

export function Spatial(): JSX.Element {
  const zones = () => arena.zones.filter((z) => z.kind === 'zone');
  return (
    <Section
      id="spatial"
      title="Spatial setup"
      summary={[
        arena.shape === 'circle'
          ? `Circle, ${arena.width} cm`
          : `${arena.width} × ${arena.height} cm`,
        `${zones().length} ${zones().length === 1 ? 'zone' : 'zones'}`,
      ].join(' · ')}
      required
      why="Turns positions into centimeters and defines the zones. Place cells, speed in cm/s, zone epochs and position decoding depend on it. Type the arena size here, or draw the outline, a known distance and the zones in the arena editor. Written to arena in config.yaml."
      keyFields={
        <>
          <Select
            label="Arena shape"
            value={arena.shape}
            options={[
              ['rectangle', 'Rectangle'],
              ['circle', 'Circle'],
            ]}
            set={(v) => setArena('shape', v)}
          />
          <Num
            label={arena.shape === 'circle' ? 'Diameter' : 'Width'}
            unit="cm"
            value={arena.width}
            set={(v) => v !== undefined && setArena('width', v)}
          />
          <Show when={arena.shape !== 'circle'}>
            <Num
              label="Height"
              unit="cm"
              value={arena.height}
              set={(v) => v !== undefined && setArena('height', v)}
            />
          </Show>
          <p class="cb-ds-cfg__wide cb-muted">
            {zones().length
              ? `${zones().length} ${zones().length === 1 ? 'zone' : 'zones'}: ${zones()
                  .map((z) => z.name)
                  .join(', ')}.`
              : 'No zones yet.'}{' '}
            <button class="cb-linkbtn" onClick={() => openEntry('position', 'arena')}>
              Open arena editor
            </button>
          </p>
        </>
      }
      more={
        <>
          <Select
            label="Scale from"
            value={arena.scaleMode}
            options={[
              ['arena', 'Arena size'],
              ['distance', 'Known distance'],
            ]}
            set={(v) => setArena('scaleMode', v)}
          />
          <Num
            label="Known distance"
            unit="cm"
            value={arena.lineCm}
            set={(v) => v !== undefined && setArena('lineCm', v)}
            step={0.1}
          />
          <Num
            label="Body length"
            unit="cm"
            value={arena.bodyLength}
            set={(v) => setArena('bodyLength', v)}
            step={0.1}
          />
          <Num
            label="Spatial bin size"
            unit="cm"
            value={arena.binCm}
            set={(v) => setArena('binCm', v)}
            step={0.5}
          />
          <Num
            label="Minimum time per bin"
            unit="s"
            value={arena.minOccupancy}
            set={(v) => v !== undefined && setArena('minOccupancy', v)}
            step={0.01}
          />
        </>
      }
    />
  );
}

export function Experiment(): JSX.Element {
  return (
    <Section
      id="experiment"
      title="Experiment & subjects"
      summary={
        [PARADIGMS.find((x) => x.id === experimentId())?.label, sessionName(), source.subjectId]
          .filter(Boolean)
          .join(' · ') || 'Nothing entered'
      }
      why="Identifies the session so saved results can be traced back to it. The paradigm decides which files are marked required for this kind of experiment, and the calcium indicator sets the decay time deconvolution QC uses. Nothing else here changes a calculation."
      keyFields={
        <>
          <Select
            label="Experimental paradigm"
            value={experimentId()}
            options={PARADIGMS.map((x) => [x.id, x.label])}
            set={setExperiment}
          />
          <Text label="Session name" value={sessionName() ?? ''} onInput={setSessionName} />
          <Text
            label="Subject ID"
            value={source.subjectId}
            onInput={(v) => setSource('subjectId', v)}
          />
        </>
      }
      more={
        <>
          <label class="cb-setup-field">
            Session date
            <input
              type="date"
              value={source.sessionDate}
              onInput={(e) => setSource('sessionDate', e.currentTarget.value)}
            />
          </label>
          <Text
            label="Species"
            value={source.species}
            onInput={(v) => setSource('species', v)}
            placeholder="Mouse"
          />
          <Text
            label="Brain region"
            value={source.brainRegion}
            onInput={(v) => setSource('brainRegion', v)}
            list={BRAIN_REGIONS}
          />
          <Select
            label="Calcium indicator"
            value={indicatorId()}
            options={INDICATORS.map((i) => [i.id, i.label])}
            set={setIndicator}
          />
          <Text
            label="Group or condition"
            value={source.group}
            onInput={(v) => setSource('group', v)}
          />
          <Text label="Notes" value={source.notes} onInput={(v) => setSource('notes', v)} />
        </>
      }
    />
  );
}
