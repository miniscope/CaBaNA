// The Preview window of the Population page: the preview run's result, the shuffle count and Run preview.
import { Show, type JSX } from 'solid-js';
import { populationSettings as s } from '../../lib/population-settings.ts';
import { PopButton } from '../QcParts.tsx';
import { ENGINE_NEEDED, PreviewBody } from '../PreviewBody.tsx';
import { Unavailable } from '../results/FrameworkNotice.tsx';
import { populationSummary } from './SetupSummary.tsx';

export function ReviewStage(props: {
  engineOff: boolean;
  issues: string[];
  blockedText?: string;
}): JSX.Element {
  return (
    <>
      <PreviewBody
        id="population"
        groups={populationSummary()}
        full={s.shuffles}
        alpha={s.alpha}
        blocked={props.engineOff ? ENGINE_NEEDED : props.blockedText}
        how={
          <>
            <p>
              A preview runs the selected methods with fewer shuffles, so its p-values are coarser
              than the full analysis's: the smallest p it can give is 1 / (shuffles + 1). Use it to
              check the settings, not to report.
            </p>
            <p>
              The Python engine runs the preview and saves it as a Preview run. Its plots and
              tables open from Previous results.
            </p>
          </>
        }
      />
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
    </>
  );
}
