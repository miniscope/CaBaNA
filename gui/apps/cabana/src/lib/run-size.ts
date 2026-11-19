// The size of saved runs in the open project's storage report; undefined without a project or
// when the engine is off (sizes need a saved project).

import type { RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import { openProject } from './open-project.ts';
import { projects } from './projects-client.ts';

/** Bytes of every run in the report, by run id; one request for the whole list. */
export function runSizes(): Promise<Map<string, number> | undefined> {
  const project = openProject();
  if (!project || !bridgeReady()) return Promise.resolve(undefined);
  return projects
    .storage(project.id)
    .then((s) => new Map(s.runs.map((x) => [x.run_id, x.record_bytes + x.large_bytes])))
    .catch(() => undefined);
}

export const runBytes = (r: RunRecord): Promise<number | undefined> =>
  runSizes().then((sizes) => sizes?.get(r.run_id));
