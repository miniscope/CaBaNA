// Where Import preprocessing settings can read from: the settings this browser kept for earlier
// sessions, and, with the engine on, the preprocess section of other projects' processing.yaml.

import { listOtherProjects, projectsOn, readPreprocessOf } from './project-session.ts';
import type { PrepValues } from './qc-draft.ts';
import { savedDatasets } from './settings-template.ts';

export interface PrepSource {
  id: string;
  label: string;
  /** ISO time the source was last changed. */
  savedAt: string;
  values: Partial<PrepValues>;
}

export async function prepSources(): Promise<PrepSource[]> {
  const browser = savedDatasets().flatMap((d): PrepSource[] => {
    const values = d.settings.prep?.prep as Partial<PrepValues> | undefined;
    return values
      ? [{ id: `browser:${d.name}`, label: `${d.name} · this browser`, savedAt: d.savedAt, values }]
      : [];
  });
  if (!projectsOn()) return browser;
  const projects = await Promise.all(
    (await listOtherProjects()).map(async (p): Promise<PrepSource[]> => {
      const values = (await readPreprocessOf(p.id))?.prep as Partial<PrepValues> | undefined;
      return values
        ? [
            {
              id: `project:${p.id}`,
              label: `${p.name} · processing.yaml`,
              savedAt: p.modified,
              values,
            },
          ]
        : [];
    }),
  );
  return [...projects.flat(), ...browser];
}
