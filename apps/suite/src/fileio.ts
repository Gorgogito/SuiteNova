import { isTauri } from './platform';

export interface OpenedFile {
  name: string;
  /** Absolute path (desktop only). */
  path: string | null;
  data: Uint8Array;
}

export interface SavedFile {
  name: string;
  path: string | null;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Ask for a file and read it. Resolves to null when the user cancels. */
export async function pickAndRead(filters: FileFilter[]): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, directory: false, filters });
    if (!path || Array.isArray(path)) return null;
    return { name: baseName(path), path, data: await readFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function readPath(path: string): Promise<OpenedFile> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return { name: baseName(path), path, data: await readFile(path) };
}

/** Write bytes. With `path` it overwrites silently; otherwise asks where to save. */
export async function saveBytes(suggestedName: string, data: Uint8Array, filters: FileFilter[], path?: string | null): Promise<SavedFile | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const target = path ?? (await save({ defaultPath: suggestedName, filters }));
    if (!target) return null;
    await writeFile(target, data);
    return { name: baseName(target), path: target };
  }
  const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name: suggestedName, path: null };
}
