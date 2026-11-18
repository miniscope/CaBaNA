/** Open the browser's file chooser and pass back the chosen file. For menu items, which have no <input> of their own. */
export function pickFile(onFile: (file: File) => void, accept?: string): void {
  const input = document.createElement('input');
  input.type = 'file';
  if (accept) input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
}
