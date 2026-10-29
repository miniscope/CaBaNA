import type { Component } from 'solid-js';
import { SidebarShell } from './shell/SidebarShell.tsx';
import type { Step } from './shell/types.ts';
import { LoadPanel } from './panels/LoadPanel.tsx';
import { SetupPanel } from './panels/SetupPanel.tsx';
import { PreprocessPanel } from './panels/PreprocessPanel.tsx';
import { QcPanel } from './panels/QcPanel.tsx';
import { VizPanel } from './panels/VizPanel.tsx';
import { AnalyzePanel } from './panels/AnalyzePanel.tsx';
import { ResultsPage } from './panels/ResultsPage.tsx';

const STEPS: Step[] = [
  { id: 'load', label: 'Load data', panel: LoadPanel },
  { id: 'setup', label: 'Experimental setup', panel: SetupPanel },
  { id: 'viz', label: 'Data visualization', panel: VizPanel },
  { id: 'qc', label: 'Data QC', panel: QcPanel },
  { id: 'prep', label: 'Preprocess', panel: PreprocessPanel },
  { id: 'analyze', label: 'Analyze', panel: AnalyzePanel },
  { id: 'results', label: 'Results', panel: ResultsPage },
];

const App: Component = () => <SidebarShell steps={STEPS} />;

export default App;
