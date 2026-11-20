// Every way of leaving the open session (a new project, another project, an example, the project
// pages) asks first about unsaved example work, then about an unsaved draft project.

import { closeEntry } from './data-setup-view.ts';
import { guardExample, startExample } from './example-session.ts';
import { guardDraft } from './project-session.ts';
import { clearAll, EXAMPLES, fetchExample, goToStep } from './store.ts';

export const guardLeave = (next: () => void): void => guardExample(() => guardDraft(next));

/** An empty Data setup for a new project; whatever was open is closed. */
export function startNewProject(): void {
  guardLeave(() => {
    clearAll();
    closeEntry();
    goToStep('data');
  });
}

/** Load an example into Data setup, unsaved. Returns why it could not be loaded, if it could not. */
export async function openExample(id: string): Promise<string | undefined> {
  const got = await fetchExample(id).catch(() => undefined);
  if (!got) return 'The example files could not be loaded.';
  if (!got.files.length)
    return `The files of ${EXAMPLES.find((x) => x.id === id)?.label ?? id} are not in this copy of CaBaNA (example_data/${id}/ is missing or empty).`;
  await startExample(id, got);
  goToStep('data');
  return undefined;
}
