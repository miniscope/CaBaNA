import type { Component } from 'solid-js';
import { SidebarShell } from './shell/SidebarShell.tsx';
import type { Step } from './shell/types.ts';
import { DataSetupPanel } from './panels/data-setup/DataSetupPanel.tsx';
import { VizPanel } from './panels/VizPanel.tsx';
import { AnalyzePanel } from './panels/AnalyzePanel.tsx';
import { ResultsPage } from './panels/ResultsPage.tsx';
import { PlotEditor } from './panels/results/PlotEditor.tsx';

const STEPS: Step[] = [
  { id: 'data', label: 'Data setup', panel: DataSetupPanel },
  { id: 'viz', label: 'Data visualization', panel: VizPanel },
  { id: 'analyze', label: 'Analyze', panel: AnalyzePanel },
  { id: 'results', label: 'Results', panel: ResultsPage },
];

const App: Component = () => (
  <>
    <SidebarShell steps={STEPS} />
    <PlotEditor />
  </>
);

export default App;
