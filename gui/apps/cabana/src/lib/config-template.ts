// A copy of the session config to use as a template for the next project: the same settings
// without what belongs to one animal or recording.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Input file names are the one key pair the framework reads from every layer of the config. */
const FILE_KEYS = ['file', 'timestamps', 'alternatives'];

function dropFiles(node: unknown): void {
  if (!isObj(node)) return;
  for (const k of Object.keys(node)) {
    if (FILE_KEYS.includes(k)) delete node[k];
    else if (k !== 'metadata') dropFiles(node[k]);
  }
}

/** The config without the session name, subject ID, behavior clock offset and scale, and file names. */
export function withoutAnimalDetails(config: Obj): Obj {
  const out = JSON.parse(JSON.stringify(config)) as Obj;
  delete out.name;
  delete out.subjects;
  if (isObj(out.behavior)) delete out.behavior.clock;
  dropFiles(out);
  return out;
}
