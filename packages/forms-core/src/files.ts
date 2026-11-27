/*
 * Files that come with a response. They travel inside the response (in base64) and are only ever saved to disk, never
 * opened or shown by the program. What could run by being opened is not accepted at all.
 */
import type { Question, UploadedFile } from './model';

export type FileKind = 'document' | 'sheet' | 'slides' | 'pdf' | 'image' | 'audio' | 'video';

export const FILE_KINDS: { id: FileKind; name: string; extensions: string[] }[] = [
  { id: 'document', name: 'Documentos', extensions: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md'] },
  { id: 'sheet', name: 'Hojas de cálculo', extensions: ['xls', 'xlsx', 'ods', 'csv'] },
  { id: 'slides', name: 'Presentaciones', extensions: ['ppt', 'pptx', 'odp'] },
  { id: 'pdf', name: 'PDF', extensions: ['pdf'] },
  { id: 'image', name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'] },
  { id: 'audio', name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac'] },
  { id: 'video', name: 'Vídeo', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
];

/** Programs, scripts, shortcuts, disk images and pages: never accepted, whatever the question allows. */
export const BLOCKED_EXTENSIONS = [
  'ade', 'adp', 'app', 'appx', 'application', 'bat', 'chm', 'cmd', 'com', 'cpl', 'dll', 'exe', 'gadget', 'hta', 'htm', 'html', 'img', 'inf', 'ins', 'iso', 'jar', 'js', 'jse',
  'lnk', 'mht', 'mhtml', 'msc', 'msi', 'msix', 'msp', 'mst', 'pif', 'ps1', 'psm1', 'reg', 'scr', 'sct', 'sh', 'svg', 'sys', 'url', 'vb', 'vbe', 'vbs', 'vhd', 'vhdx', 'ws', 'wsf', 'wsh', 'xhtml', 'xll',
];

export const MB = 1024 * 1024;
export const SIZE_CHOICES = [1, 2, 5, 10];
export const MAX_FILES = 10;
/** The most all the files of one response can weigh. */
export const MAX_RESPONSE_MB = 25;

export const extensionOf = (name: string): string => /\.([^./\\]*)$/.exec(name.replace(/[. ]+$/, ''))?.[1]?.toLowerCase() ?? '';

/** A name that is only a name: no path, nothing that hides the extension or that Windows refuses. */
export function safeFileName(name: string): string {
  let n = name
    .replace(/^.*[\\/]/, '')
    // control characters and the ones that turn text around (they can hide the real extension)
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!n || /^\.+$/.test(n)) n = 'archivo';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = `_${n}`;
  const dot = n.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
  return stem.slice(0, 150) + ext.slice(0, 20);
}

/** The extensions a question takes; empty: any that is not blocked. */
export const allowedExtensions = (q: Pick<Question, 'kinds'>): string[] => FILE_KINDS.filter((k) => q.kinds?.includes(k.id)).flatMap((k) => k.extensions);

/** Why a file cannot be attached to a question, or null. */
export function fileProblem(q: Pick<Question, 'kinds' | 'maxMb'>, name: string, size: number): string | null {
  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.includes(ext)) return `No se admiten archivos .${ext}.`;
  const allowed = allowedExtensions(q);
  if (allowed.length && !allowed.includes(ext)) return `El archivo «${name}» no es de un tipo admitido.`;
  if (size <= 0) return `El archivo «${name}» está vacío.`;
  const max = q.maxMb ?? 10;
  if (size > max * MB) return `El archivo «${name}» pasa de ${max} MB.`;
  return null;
}

export const isBase64 = (s: string): boolean => s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
export const base64Size = (s: string): number => (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);

/** A file read from someone's data; the size is what the content weighs, not what it says. */
export function readFileItem(v: unknown): UploadedFile | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Partial<UploadedFile>;
  if (typeof f.name !== 'string' || typeof f.data !== 'string' || f.data.length > MAX_RESPONSE_MB * MB * 1.4 || !isBase64(f.data)) return null;
  const type = typeof f.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(f.type) ? f.type.slice(0, 100) : '';
  return { name: safeFileName(f.name), size: base64Size(f.data), type, data: f.data };
}

export const isFiles = (a: unknown): a is UploadedFile[] => Array.isArray(a) && a.length > 0 && typeof a[0] === 'object' && a[0] !== null;
