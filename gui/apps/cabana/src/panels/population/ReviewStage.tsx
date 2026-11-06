// The Review and preview stage of the guided Population page: settings summary, data preview and run choice.
import { Show, type JSX } from 'solid-js';
import type { Guided } from '../../lib/guided.ts';
import { RunChoice, SettingsSummary } from '../../components/GuidedReview.tsx';
import { populationSettings as s } from '../../lib/population-settings.ts';
import { shufflesFor } from '../../lib/preview.ts';
import { ShuffleReach } from '../parts.tsx';
import { PopButton } from '../QcParts.tsx';
import { Unavailable } from '../results/FrameworkNotice.tsx';
import { DataPreview } from './DataPreview.tsx';
import { populationSummary } from './SetupSummary.tsx';

export function ReviewStage(props: {
  g: Guided;
  engineOff: boolean;
  issues: string[];
  blockedText?: string;
  onStart: (scope: 'full' | 'preview') => void;
}): JSX.Element {
  return (
    <div class="cb-gs-review">
      <SettingsSummary g={props.g} groups={populationSummary()} />
      <DataPreview />
      <Show when={props.engineOff}>
        <Unavailable engineOff />
      </Show>
      <RunChoice
        full={s.shuffles}
        preview={shufflesFor('preview', s.shuffles)}
        blocked={props.blockedText}
        onPreview={() => props.onStart('preview')}
        onFull={() => props.onStart('full')}
      />
      <ShuffleReach shuffles={s.shuffles} alpha={s.alpha} />
      <Show when={props.issues.length > 1}>
        <PopButton
          label="Why the run is blocked"
          title="Why the run is blocked"
          width={420}
          class="cb-link"
          button={`All ${props.issues.length} reasons`}
        >
          <Unavailable
            engineOff={props.engineOff}
            input={props.issues.filter((i) => !/engine/i.test(i))}
          />
        </PopButton>
      </Show>
    </div>
  );
}
