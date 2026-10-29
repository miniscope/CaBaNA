import { Show, type Component } from 'solid-js';
import { GuidedShell, type Step } from './shell/GuidedShell.tsx';
import { SidebarShell } from './shell/SidebarShell.tsx';
import { layout } from './lib/store.ts';
import { LoadPanel } from './panels/LoadPanel.tsx';
import { SetupPanel } from './panels/SetupPanel.tsx';
import { PreprocessPanel } from './panels/PreprocessPanel.tsx';
import { QcPanel } from './panels/QcPanel.tsx';
import { VizPanel } from './panels/VizPanel.tsx';
import { AnalyzePanel } from './panels/AnalyzePanel.tsx';

const STEPS: Step[] = [
  { id: 'load', label: 'Load data', panel: LoadPanel },
  { id: 'setup', label: 'Experimental Setup', panel: SetupPanel },
  { id: 'viz', label: 'Data visualization', panel: VizPanel },
  { id: 'qc', label: 'Data QC', panel: QcPanel },
  { id: 'prep', label: 'Preprocess', panel: PreprocessPanel },
  { id: 'analyze', label: 'Analyze', panel: AnalyzePanel },
];

const App: Component = () => {
  return (
    <Show when={layout() === 'sidebar'} fallback={<GuidedShell steps={STEPS} />}>
      <SidebarShell steps={STEPS} />
    </Show>
  );
};

export default App;
