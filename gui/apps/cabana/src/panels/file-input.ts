// Small helpers for picking files and listing names, shared by the project and Data setup pages.

/** The files chosen in a file input; the input is cleared so the same file can be chosen again. */
export function fileList(e: Event): File[] {
  const input = e.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  return files;
}

export const savedWhen = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export const listed = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
