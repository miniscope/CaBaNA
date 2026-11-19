// The size of one run in the open project's storage report; undefined without a project or when
// the engine is off (sizes need a saved project).

import type { RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import { openProject } from './open-project.ts';
import { projects } from './projects-client.ts';

export function runBytes(r: RunRecord): Promise<number | undefined> {
  const project = openProject();
  if (!project || !bridgeReady()) return Promise.resolve(undefined);
  return projects
    .storage(project.id)
    .then((s) => {
      const found = s.runs.find((x) => x.run_id === r.run_id);
      return found ? found.record_bytes + found.large_bytes : undefined;
    })
    .catch(() => undefined);
}
