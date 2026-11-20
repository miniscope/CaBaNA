import { render } from 'solid-js/web';
import { configureStorageKey } from '@calab/tutorials';
import App from './App.tsx';
import '@calab/ui/styles/base.css';
import '@calab/ui/styles/app-global.css';
import './styles/global.css';
import './styles/results.css';
import './styles/shell.css';
import './styles/population.css';
import './styles/decoding.css';
import './styles/labels.css';
import './styles/setup.css';
import './styles/guided.css';
import './styles/overlays.css';
import './styles/analyze.css';
import './styles/qc.css';
import './styles/auroc-results.css';
import './styles/auroc-setup.css';
import './styles/peth.css';
import './styles/decoding-guided.css';
import './styles/results-hub.css';
import './styles/results-window.css';
import './styles/experimental-setup.css';
import './styles/data-setup.css';
import './styles/parts.css';
import './styles/projects.css';
import './styles/setup-page.css';
import './styles/load-data.css';
import './styles/setup-view.css';
import './styles/setup-edit.css';
import './styles/viz.css';
import './styles/qc-popup.css';

// Per-app localStorage key for tutorial progress. Bump the suffix when a
// tutorial change should reset everyone's progress.
configureStorageKey(`${__APP_ID__}-tutorial-progress-v1`);

render(() => <App />, document.getElementById('root')!);

// Python engine: register the framework analyses and look for the bridge (only when the page was
// opened with ?bridge=). Everything else works without it.
void Promise.all([
  import('./lib/analysis-registry.ts'),
  import('./lib/bridge-status.ts'),
  import('./lib/runs.ts'),
]).then(async ([registry, status, runs]) => {
  registry.registerAnalyses();
  await status.connectBridge();
  if (status.bridgeReady()) await runs.refreshHistory().catch(() => undefined);
});

// Dev only: load an example on start so a restart doesn't need the Load step.
// ?example=<id> picks one (default simulated_3chamber), ?example=none skips it,
// ?step=analyze opens that step (default: Data setup).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const id = q.get('example') ?? 'simulated_3chamber';
  if (id !== 'none')
    void Promise.all([import('./lib/store.ts'), import('./lib/example-session.ts')]).then(
      async ([s, ex]) => {
        const got = await s.fetchExample(id);
        if (!got.files.length) return console.warn(`Example ${id}: no files in example_data/${id}/`);
        await ex.startExample(id, got);
        s.goToStep(q.get('step') ?? 'data');
      },
    );
}
