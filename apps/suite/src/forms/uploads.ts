import { safeFileName, type UploadedFile } from '@suitenova/forms-core';
import { saveBytes } from '../fileio';
import { saveAllAttachments } from '../mail/attachments';

const toBytes = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** A file chosen by the person, as it travels inside the response. */
export function readUpload(file: Blob & { name: string }): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: safeFileName(file.name), size: file.size, type: file.type, data: String(reader.result).split(',')[1] ?? '' });
    reader.onerror = () => reject(new Error(`No se pudo leer «${file.name}».`));
    reader.readAsDataURL(file);
  });
}

/** Saves one file of a response. It is only written to disk: the program never opens it. */
export const saveUpload = (f: UploadedFile) => saveBytes(safeFileName(f.name), toBytes(f.data), []);

/** All the files of a question: into a folder in the desktop application, as a .zip in the browser. */
export const saveUploads = (files: { response: number; file: UploadedFile }[], name: string, title: string) =>
  saveAllAttachments(
    // each name starts with the number of its response, so that it is known whose it is
    files.map((f) => ({ filename: `${f.response} - ${f.file.name}`, contentType: f.file.type, data: toBytes(f.file.data), inline: false })),
    name,
    title,
  );

export const sizeText = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`);
