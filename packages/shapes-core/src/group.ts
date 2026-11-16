/**
 * Matemática de bloques de formas, común a Calc y Writer: límites, mover, escalar y girar un conjunto de marcos como un bloque, y
 * pasar de coordenadas absolutas a las de un grupo (y al revés). No conoce el modelo de cada aplicación: trabaja con un marco mínimo
 * y devuelve cambios que quien llama aplica en un solo paso de deshacer.
 */

/** Marco de una forma: posición y tamaño en píxeles, y giro en grados (sentido horario, alrededor de su centro). */
export interface Frame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cambios de un marco: su id y los campos que cambian (el giro 0 se aplica como «sin giro»). */
export interface FramePatch {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Grados normalizados a 0 ≤ g < 360, con un decimal. */
export const normDeg = (deg: number): number => ((Math.round(deg * 10) / 10) % 360 + 360) % 360;

/** Rectángulo que rodea un marco, teniendo en cuenta su giro. */
export function frameBounds(f: Frame): FrameBox {
  const a = rad(f.rotation ?? 0);
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = f.width * c + f.height * s;
  const h = f.width * s + f.height * c;
  const cx = f.x + f.width / 2;
  const cy = f.y + f.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Rectángulo que rodea a todos los marcos (con sus giros). Vacío si no hay ninguno. */
export function framesBounds(frames: Frame[]): FrameBox {
  if (!frames.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const f of frames) {
    const b = frameBounds(f);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Desplazar un bloque. */
export function moveFrames(frames: Frame[], dx: number, dy: number): FramePatch[] {
  return frames.map((f) => ({ id: f.id, x: Math.round(f.x + dx), y: Math.round(f.y + dy) }));
}

/**
 * Llevar el bloque del rectángulo `from` al rectángulo `to`: posiciones y tamaños se escalan con él. Un marco girado 90° o 270°
 * intercambia los factores; con otros giros el tamaño es aproximado (el giro se conserva).
 */
export function scaleFrames(frames: Frame[], from: FrameBox, to: FrameBox, min = 4): FramePatch[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return frames.map((f) => {
    const quarter = Math.round((f.rotation ?? 0) / 90) % 2 !== 0;
    const fw = quarter ? sy : sx;
    const fh = quarter ? sx : sy;
    const width = Math.max(min, f.width * fw);
    const height = Math.max(min, f.height * fh);
    const cx = to.x + (f.x + f.width / 2 - from.x) * sx;
    const cy = to.y + (f.y + f.height / 2 - from.y) * sy;
    return { id: f.id, x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width: Math.round(width), height: Math.round(height) };
  });
}

/** Girar el bloque `deg` grados alrededor de `center`: cada marco gira sobre sí y su centro describe el mismo giro. */
export function rotateFrames(frames: Frame[], center: { x: number; y: number }, deg: number): FramePatch[] {
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return frames.map((f) => {
    const cx = f.x + f.width / 2 - center.x;
    const cy = f.y + f.height / 2 - center.y;
    const nx = center.x + cx * cos - cy * sin;
    const ny = center.y + cx * sin + cy * cos;
    return { id: f.id, x: Math.round(nx - f.width / 2), y: Math.round(ny - f.height / 2), rotation: normDeg((f.rotation ?? 0) + deg) };
  });
}

/**
 * Agrupar: el marco del grupo es el rectángulo que rodea a los marcos dados (sin giro) y cada uno queda con coordenadas relativas
 * a la esquina de ese rectángulo.
 */
export function framesToGroup<T extends Frame>(frames: T[]): { box: FrameBox; children: T[] } {
  const box = framesBounds(frames);
  const dx = Math.round(box.x);
  const dy = Math.round(box.y);
  return { box: { x: dx, y: dy, width: Math.round(box.width), height: Math.round(box.height) }, children: frames.map((f) => ({ ...f, x: Math.round(f.x - dx), y: Math.round(f.y - dy) })) };
}

/**
 * Desagrupar: coordenadas absolutas de los hijos de un grupo (`group` es el marco del grupo; los hijos son relativos a su esquina
 * sin girar). El giro del grupo se reparte: el centro de cada hijo gira alrededor del centro del grupo y su giro se suma.
 */
export function framesFromGroup(group: Frame, children: Frame[]): FramePatch[] {
  const moved = children.map((c) => ({ ...c, x: c.x + group.x, y: c.y + group.y }));
  const r = group.rotation ?? 0;
  if (!r) return moved.map((c) => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y) }));
  return rotateFrames(moved, { x: group.x + group.width / 2, y: group.y + group.height / 2 }, r);
}
