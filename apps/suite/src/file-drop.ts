/**
 * The windows take drags themselves (see `dragDropEnabled` in tauri.conf.json), so a file dropped where nothing expects it
 * would replace the application with the file, as in a browser. Here it is refused instead.
 */
export function guardFileDrops(target: Window = window): void {
  const refuse = (e: DragEvent) => {
    // whatever took the drag has already said so
    if (e.defaultPrevented || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    if ((e.target as Element | null)?.matches?.('input[type="file"]')) return;
    e.preventDefault();
    if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragover', refuse);
  target.addEventListener('drop', refuse);
}
