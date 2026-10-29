export interface PickedImage {
  mime: string;
  data: Uint8Array;
  width: number;
  height: number;
  name: string;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };

/** The pixel size of an image given as bytes. */
export function imageSize(data: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth || 320, height: img.naturalHeight || 240 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen: el archivo no es una imagen válida.'));
    };
    img.src = url;
  });
}

/** An SVG drawing as a PNG (workbooks keep bitmaps), at twice its size so it stays sharp. */
async function svgToPng(data: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { width, height } = await imageSize(data, 'image/svg+xml');
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error('No se pudo leer el dibujo SVG.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(4096, width * 2);
    canvas.height = Math.min(4096, height * 2);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('No se pudo convertir el dibujo SVG.');
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Ask for an image file (the system dialog of the page) and read it. SVG drawings become PNG. */
export function pickImage(): Promise<PickedImage | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml,.png,.jpg,.jpeg,.gif,.bmp,.webp,.svg';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try {
        resolve(await readImageFile(file));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function readImageFile(file: File): Promise<PickedImage> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME[ext] ?? file.type;
  if (!Object.values(MIME).includes(mime)) throw new Error('Formato de imagen no admitido. Use PNG, JPG, GIF, BMP, WebP o SVG.');
  if (file.size > 20 * 1024 * 1024) throw new Error('La imagen pesa más de 20 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.[^.]+$/, '');
  if (mime === 'image/svg+xml') {
    const png = await svgToPng(data);
    return { mime: 'image/png', data: png.data, width: png.width, height: png.height, name };
  }
  const size = await imageSize(data, mime);
  return { mime, data, ...size, name };
}
