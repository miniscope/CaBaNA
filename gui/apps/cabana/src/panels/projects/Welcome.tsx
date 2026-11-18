// The first page: what CaBaNA is, and where to start or continue a project.

import type { JSX } from 'solid-js';
import { goToStep } from '../../lib/store.ts';

export function Welcome(): JSX.Element {
  return (
    <div class="cb-welcome">
      <h2>Welcome to CaBaNA</h2>
      <p class="cb-muted cb-welcome__lede">
        CaBaNA is an open-source tool for visualizing, preprocessing and analyzing calcium imaging
        and behavioral data: from loading and checking a session to place cells, event-aligned
        responses (PETH), auROC, decoding and population analyses.
      </p>
      <button
        type="button"
        class="btn-secondary cb-welcome__learn"
        onClick={() => goToStep('about')}
      >
        Learn more
      </button>
      <div class="cb-welcome__start">
        <h3>Start a new project</h3>
        <p class="cb-muted">Load your data or try an example dataset.</p>
        <button type="button" class="btn-primary cb-welcome__new" onClick={() => goToStep('new')}>
          + New Project
        </button>
      </div>
      <div class="cb-muted cb-welcome__open">Or open an existing project</div>
      <button type="button" class="btn-secondary" onClick={() => goToStep('library')}>
        Browse project library
      </button>
    </div>
  );
}
