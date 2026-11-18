import type { JSX } from 'solid-js';
import { fileList } from '../LoadPanel.tsx';

/** A hidden folder input inside a button-styled label. */
export function FolderButton(props: {
  class: string;
  children: JSX.Element;
  onFiles: (files: File[]) => void;
}): JSX.Element {
  return (
    <label class={`${props.class} cb-file`}>
      {props.children}
      <input
        type="file"
        hidden
        multiple
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory=""
        onChange={(e) => props.onFiles(fileList(e))}
      />
    </label>
  );
}
