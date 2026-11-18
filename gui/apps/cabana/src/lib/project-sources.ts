// Another project's saved settings, read from its yaml files into the shape the settings
// templates use (settings-template.ts), so Apply settings from and Load configuration can take
// engine projects as sources. QC decisions, geometry, clock offset, file names and the subject ID
// are never read into it.

import { readConfig } from './config-read.ts';
import { processingFromData } from './project-files.ts';
import { captureProcessing } from './project-state.ts';
import { listOtherProjects, readProjectYaml } from './project-session.ts';
import { projects, type ProjectSummary } from './projects-client.ts';
import type { SavedDataset } from './settings-template.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const without = (o: unknown, keys: string[]): Obj =>
  Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k]) => !keys.includes(k)));

/** The analyses group of the template from analysis.yaml: sections as saved, minus selections. */
export function analysesFromYaml(raw: unknown): Obj {
  const a = isObj(raw) ? raw : {};
  const place = isObj(a.place_cells) ? a.place_cells : {};
  const decoding = isObj(a.decoding) ? a.decoding : {};
  const out: Obj = {};
  const put = (key: string, v: unknown) => {
    if (isObj(v) && Object.keys(v).length) out[key] = v;
  };
  put('place', place.settings);
  if (typeof place.bin_cm === 'number') out.binCm = place.bin_cm;
  if (typeof place.min_time_per_bin_s === 'number') out.minOccupancy = place.min_time_per_bin_s;
  put('auroc', without(a.auroc, ['unselected', 'pairA', 'pairB']));
  put('peth', without(a.peth, ['unselected']));
  put('population', without(a.population, ['labels']));
  put('positionDecoding', decoding.position);
  put('behaviorDecoding', without(decoding.behaviors, ['labels']));
  if (typeof decoding.target === 'string') out.decodeTarget = decoding.target;
  return out;
}

/** The setup group from experiment.yaml: descriptive fields and units, no geometry or names. */
function setupFromYaml(text: string | undefined): Obj {
  if (!text) return {};
  const v = readConfig(text).values;
  return {
    ...Object.fromEntries(Object.entries(v.meta ?? {})),
    ...(v.positionUnit && { positionUnit: v.positionUnit }),
    ...(v.yDown !== undefined && { yDown: v.yDown }),
  };
}

/** One project's settings as a saved dataset: name, when it was last changed, and the groups. */
export async function savedFromProject(p: ProjectSummary): Promise<SavedDataset> {
  const [proc, ana, exp] = await Promise.all([
    readProjectYaml(p.id, 'processing.yaml'),
    readProjectYaml(p.id, 'analysis.yaml'),
    projects.readFile(p.id, 'experiment.yaml').catch(() => undefined),
  ]);
  const s = processingFromData(proc, captureProcessing());
  return {
    name: p.name,
    savedAt: p.modified,
    settings: {
      setup: setupFromYaml(exp?.valid ? exp.text : undefined),
      prep: { prep: s.prep, decon: s.decon },
      qc: { tol: s.limits.tol, maxSpeed: s.limits.maxSpeed },
      analyses: analysesFromYaml(ana),
    },
  } as SavedDataset;
}

/** Every other project's settings, for the source lists. */
export async function projectDatasets(): Promise<SavedDataset[]> {
  return Promise.all((await listOtherProjects()).map(savedFromProject));
}
