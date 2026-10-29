import { render } from 'solid-js/web';
import { configureStorageKey } from '@calab/tutorials';
import App from './App.tsx';
import '@calab/ui/styles/base.css';
import '@calab/ui/styles/app-global.css';
import './styles/global.css';

// Per-app localStorage key for tutorial progress. Bump the suffix when a
// tutorial change should reset everyone's progress.
configureStorageKey(`${__APP_ID__}-tutorial-progress-v1`);

render(() => <App />, document.getElementById('root')!);

// Dev only: load an example on start so a restart doesn't need the Load step.
// ?example=<id> picks one (default simulated_3chamber), ?example=none skips it,
// ?step=analyze opens that step.
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const id = q.get('example') ?? 'simulated_3chamber';
  if (id !== 'none')
    void import('./lib/store.ts').then(async (s) => {
      await s.loadExample(id);
      const step = q.get('step');
      if (step) s.goToStep(step);
    });
}
