export interface Recording {
  kind: 'audio' | 'video';
  stream: MediaStream;
  startedAt: number;
  stop(): Promise<{ blob: Blob; seconds: number }>;
  cancel(): void;
}

const MIMES = {
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'],
  video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
};

/** Empieza a grabar con el micrófono (y la cámara en el vídeo). Lanza un error legible si no se puede. */
export async function startRecording(kind: 'audio' | 'video'): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este equipo o esta ventana no permite grabar audio ni vídeo.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } } : { audio: true });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('No se concedió permiso para usar el micrófono' + (kind === 'video' ? ' y la cámara.' : '.'));
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error(kind === 'video' ? 'No se encontró una cámara o un micrófono.' : 'No se encontró ningún micrófono.');
    throw new Error('No se pudo acceder al dispositivo: ' + ((e as Error).message || name));
  }
  const mime = MIMES[kind].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start(1000);
  const startedAt = Date.now();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    kind,
    stream,
    startedAt,
    stop: () =>
      new Promise((resolve, reject) => {
        rec.onstop = () => {
          release();
          const type = rec.mimeType || mime || (kind === 'video' ? 'video/webm' : 'audio/webm');
          resolve({ blob: new Blob(chunks, { type }), seconds: Math.round((Date.now() - startedAt) / 100) / 10 });
        };
        rec.onerror = () => {
          release();
          reject(new Error('Falló la grabación.'));
        };
        if (rec.state === 'inactive') rec.onstop(new Event('stop'));
        else rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      release();
    },
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^]*?;base64,/, ''));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** Cuánto dura un archivo de audio o de vídeo (0 si el navegador no lo sabe). */
export function mediaDuration(url: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((res) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      // los webm grabados no traen la duración hasta que se avanza al final
      if (el.duration === Infinity) {
        el.currentTime = 1e9;
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          res(Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : 0);
        };
      } else res(Math.round(el.duration * 10) / 10 || 0);
    };
    el.onerror = () => res(0);
    el.src = url;
  });
}

export function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 320, h: img.naturalHeight || 240 });
    img.onerror = () => rej(new Error('No se pudo leer la imagen.'));
    img.src = src;
  });
}
