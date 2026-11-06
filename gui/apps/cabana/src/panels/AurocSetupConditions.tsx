// auROC setup: the conditions section (reference group, condition picker and live frame counts).
import { For, Show, type JSX } from 'solid-js';
import { MIN_FRAMES } from '../lib/auroc.ts';
import { aurocSettings, setAurocSettings, type AurocData } from '../lib/auroc-run.ts';
import {
  conditionGroups,
  percentOf,
  referenceChoices,
  type groupCounts,
} from '../lib/auroc-setup.ts';
import { InfoTip } from './InfoTip.tsx';
import { Field } from './AurocSetupFields.tsx';
import { behaviorColor } from './AurocPanel.tsx';

interface RowCounts {
  n: AurocData['info'][number];
  enough: boolean;
}

export function AurocConditionsSection(props: {
  ok: () => AurocData;
  pairMode: () => boolean;
  pair: () => number[];
  counts: () => ReturnType<typeof groupCounts>;
  eligible: () => number;
  rowCounts: (i: number) => RowCounts | undefined;
  tooFew: (i: number) => boolean;
  insufficient: () => { label: string; during: number; outside: number }[];
  toggle: (label: string) => void;
}): JSX.Element {
  const { ok, pairMode, pair, counts, eligible, rowCounts, tooFew, insufficient, toggle } = props;
  return (
    <>
      <Field
        title="Reference group"
        tip="The frames Condition A is compared with. Excluded frames are left out of both groups."
      >
        <div class="cb-au-refs" role="radiogroup" aria-label="Reference group">
          <For each={referenceChoices(ok()!.labels)}>
            {(c) => (
              <label class="cb-au-ref" classList={{ 'cb-au-ref--off': !!c.unavailable }}>
                <input
                  type="radio"
                  name="auroc-reference"
                  disabled={!!c.unavailable}
                  checked={c.id === (pairMode() ? 'behavior' : 'rest')}
                  onChange={() => c.id !== 'unlabeled' && setAurocSettings('compare', c.id)}
                />
                <span>
                  <b>{c.title}</b>
                  <span class="cb-muted">{c.blurb}</span>
                  <Show when={c.unavailable}>
                    <span class="cb-muted">
                      {c.title}: {c.unavailable}
                    </span>
                  </Show>
                </span>
              </label>
            )}
          </For>
        </div>
      </Field>
      <Show when={pairMode()}>
        <div class="cb-controls">
          <For each={[0, 1]}>
            {(k) => (
              <label class="cb-prep-field">
                {k === 0 ? 'Condition A' : 'Reference behavior'}{' '}
                <select
                  value={ok()!.labels[pair()[k]]}
                  onChange={(e) =>
                    setAurocSettings(k === 0 ? 'pairA' : 'pairB', e.currentTarget.value)
                  }
                >
                  <For each={ok()!.labels}>
                    {(l, i) => (
                      <option
                        value={l}
                        selected={i() === pair()[k]}
                        disabled={i() === pair()[1 - k]}
                      >
                        {l}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            )}
          </For>
        </div>
      </Show>
      <div class="cb-as-scope">
        {pairMode()
          ? `Compares neural events in frames labeled ${ok()!.labels[pair()[0]]} only with frames labeled ${ok()!.labels[pair()[1]]} only. Frames in both or neither are left out. auROC above 0.5 means higher neural events during ${ok()!.labels[pair()[0]]}.`
          : 'Compares neural events during each selected behavior with all other eligible frames: unlabeled frames and frames with other behaviors. auROC above 0.5 means higher neural events during the behavior.'}
      </div>
      <div class="cb-au-counts" role="status">
        <Show
          when={counts().length === 1}
          fallback={
            <span>
              {counts().length
                ? `${counts().length} behaviors selected; frame counts for each are in the table.`
                : 'No behavior selected.'}{' '}
              Eligible frames: <b>{eligible().toLocaleString()}</b>
            </span>
          }
        >
          <span>
            Behavior frames: <b>{counts()[0].behavior.toLocaleString()}</b> (
            {percentOf(counts()[0].behavior, eligible())})
          </span>
          <span>
            Comparison frames: <b>{counts()[0].comparison.toLocaleString()}</b> (
            {percentOf(counts()[0].comparison, eligible())})
          </span>
          <Show when={pairMode()}>
            <span>
              Left out: <b>{counts()[0].leftOut.toLocaleString()}</b> (in neither or both)
            </span>
          </Show>
          <span>
            Eligible frames: <b>{eligible().toLocaleString()}</b>
          </span>
        </Show>
      </div>
      <div class="cb-au-pickhead">
        <b>Condition A</b>
        <InfoTip label="About condition A">
          Each selected behavior gets its own auROC per cell. Frame counts include only eligible
          frames. Overlapping behaviors are tested independently: a frame in two behaviors counts as
          inside for both. Merging behaviors is done in annotation setup, not here.
        </InfoTip>
        <span class="cb-as-spacer" />
        <Show when={!pairMode()}>
          <button
            class="btn-secondary btn-small"
            onClick={() => setAurocSettings('unselected', [])}
          >
            Select all
          </button>
          <button
            class="btn-secondary btn-small"
            onClick={() => setAurocSettings('unselected', [...ok()!.labels])}
          >
            Clear
          </button>
        </Show>
      </div>
      <div class="cb-au-pick">
        <table class="cb-auroc-table cb-as-tbl">
          <thead>
            <tr>
              <th aria-label="Selected" />
              <th>Condition</th>
              <th class="cb-as-num">Annotated (s)</th>
              <th class="cb-as-num">Bouts</th>
              <th class="cb-as-num">Behavior frames</th>
              <th class="cb-as-num">Comparison frames</th>
              <th>Status</th>
            </tr>
          </thead>
          <For each={conditionGroups(ok()!.labels)}>
            {(grp) => (
              <tbody>
                <tr class="cb-au-pick__src">
                  <th colSpan={7}>
                    {grp.source}
                    <Show when={grp.disabled}>
                      <span class="cb-muted"> · {grp.disabled}</span>
                    </Show>
                  </th>
                </tr>
                <For each={grp.conditions}>
                  {(label) => {
                    const i = () => ok()!.labels.indexOf(label);
                    const c = () => rowCounts(i());
                    return (
                      <tr classList={{ 'cb-muted': pairMode() && !pair().includes(i()) }}>
                        <td>
                          <Show when={!pairMode()}>
                            <input
                              type="checkbox"
                              aria-label={`Include ${label}`}
                              checked={!aurocSettings.unselected.includes(label)}
                              onChange={() => toggle(label)}
                            />
                          </Show>
                        </td>
                        <td>
                          <span
                            class="cb-dot"
                            style={{
                              background: tooFew(i()) ? '#999' : behaviorColor(i()),
                            }}
                          />{' '}
                          {label}
                        </td>
                        <td class="cb-as-num">{ok()!.info[i()].duration.toFixed(1)}</td>
                        <td class="cb-as-num">{ok()!.info[i()].bouts}</td>
                        <td class="cb-as-num">{c() ? c()!.n.during.toLocaleString() : '–'}</td>
                        <td class="cb-as-num">{c() ? c()!.n.outside.toLocaleString() : '–'}</td>
                        <td>
                          <Show
                            when={c()}
                            fallback={
                              <span class="cb-muted">
                                {pairMode() && i() === pair()[1] ? 'Reference' : '–'}
                              </span>
                            }
                          >
                            <Show
                              when={c()!.enough}
                              fallback={
                                <span class="cb-pill cb-pill--warn">Insufficient data</span>
                              }
                            >
                              <span class="cb-pill cb-pill--good">OK</span>
                            </Show>
                          </Show>
                        </td>
                      </tr>
                    );
                  }}
                </For>
                <Show when={grp.disabled}>
                  <tr class="cb-muted">
                    <td>
                      <input type="checkbox" disabled aria-label={`${grp.source} unavailable`} />
                    </td>
                    <td colSpan={6}>Not selectable. {grp.disabled}</td>
                  </tr>
                </Show>
              </tbody>
            )}
          </For>
        </table>
      </div>
      <div class="cb-muted">
        <Show
          when={insufficient().length}
          fallback={`${MIN_FRAMES} frames required in the behavior and in the comparison group.`}
        >
          {insufficient()
            .map(
              (b) =>
                `${b.label}: ${Math.min(b.during, b.outside)} frames; ${MIN_FRAMES} required in each group`,
            )
            .join(' · ')}
        </Show>
      </div>
    </>
  );
}
