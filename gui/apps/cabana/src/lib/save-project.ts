// Save project and Next on Data setup. With the engine on, an unnamed draft asks for a name first
// (pre-filled with the folder's name) and example data opens Save as project; without the engine
// Next goes on unsaved, as before.

import { createSignal } from 'solid-js';
import { errorText, showMessage } from './confirm.ts';
import { isExample, setSaveDialog } from './example-session.ts';
import { openProject } from './open-project.ts';
import { nameDraft, nameProblem, projectsOn, typedName, unsavedDraft } from './project-session.ts';
import { folderInfo, sessionName } from './store.ts';

/** The name window: from Next (`thenNext`) or from Save project; `after` runs once saved. */
export const [namePrompt, setNamePrompt] = createSignal<{
  thenNext: boolean;
  after?: () => void;
}>();

/** The name the window starts with: what was typed, else the folder's name. */
export const suggestedName = (): string => typedName().trim() || folderInfo()?.name || '';

/** The Project name field: the typed name while the draft has none, else the project's name. */
export const nameField = (): string => (unsavedDraft() ? typedName() : (sessionName() ?? ''));

/** Name and save the project, then run `after`. Problems are shown, not thrown. */
export async function saveAs(name: string, parent?: string, after?: () => void): Promise<void> {
  try {
    await nameDraft(name, parent);
    after?.();
  } catch (e) {
    showMessage('The project could not be saved', errorText(e));
  }
}

/**
 * Save project (`thenNext` false) or Next (`thenNext` true, `after` opens the next page). A typed
 * name is used as it is; without one the name window opens.
 */
export function saveProject(thenNext: boolean, after?: () => void): void {
  if (!projectsOn()) return after?.();
  if (isExample()) return void setSaveDialog({ after });
  if (!openProject()) return after?.();
  if (thenNext && !unsavedDraft()) return after?.();
  const typed = nameField().trim();
  if (typed && !nameProblem(typed)) return void saveAs(typed, undefined, after);
  setNamePrompt({ thenNext, after });
}

/** The line under Next on Data setup: what is missing, or whether Next saves. */
export function nextLine(blocked: string | undefined): string {
  if (blocked) return blocked;
  if (!projectsOn()) return 'Start the Python engine to save this project';
  if (isExample() || unsavedDraft() || !openProject())
    return 'Selecting Next saves this project automatically';
  return 'Project saved';
}
