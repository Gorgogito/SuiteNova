import { t } from '@suitenova/core-ui';
import { hasPositions, searchResult, type Box, type OcrResult } from '@suitenova/ocr-core';
import { useMemo, useRef, useState } from 'react';

type Drag = { x0: number; y0: number; x1: number; y1: number };

/**
 * A picture with what was read from it drawn on top: the words found (when `query` is given) or all of them, and, when `onZone` is given, a zone
 * the person can drag to read only that part. Boxes are in pixels of the picture the text was read from; the SVG scales with the picture.
 */
export function OcrPreview({ src, result, query = '', zone, onZone, maxHeight = 260 }: { src: string; result: OcrResult | null; query?: string; zone?: Box | null; onZone?: (z: Box | null) => void; maxHeight?: number }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const size = result && hasPositions(result) ? { w: result.width, h: result.height } : natural;
  const found = useMemo(() => (result && query.trim() ? searchResult(result, query).flatMap((m) => m.boxes) : []), [result, query]);
  const words = useMemo(() => (result && !query.trim() ? result.lines.flatMap((l) => l.words.map((w) => w.box)) : []), [result, query]);
  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(size!.w, ((e.clientX - r.left) / r.width) * size!.w)), y: Math.max(0, Math.min(size!.h, ((e.clientY - r.top) / r.height) * size!.h)) };
  };
  const boxOf = (d: Drag): Box => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
  const dz = drag ? boxOf(drag) : zone;
  const sw = size ? Math.max(1, size.w / 400) : 1;
  return (
    <div className="nn-ocrprev" style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight, display: 'block' }} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size && (
        <svg
          ref={svg}
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={onZone ? t('Arrastra para elegir la zona que se lee') : t('Lo reconocido en la imagen')}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: onZone ? 'crosshair' : 'default', touchAction: 'none' }}
          onPointerDown={(e) => {
            if (!onZone) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e);
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = at(e);
            setDrag({ ...drag, x1: p.x, y1: p.y });
          }}
          onPointerUp={() => {
            if (!drag) return;
            const z = boxOf(drag);
            setDrag(null);
            onZone?.(z.w > size.w * 0.02 && z.h > size.h * 0.02 ? z : null);
          }}
        >
          {words.map((b, i) => (
            <rect key={`w${i}`} data-ocr="word" x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#2563eb" strokeOpacity={0.5} strokeWidth={sw} />
          ))}
          {found.map((b, i) => (
            <rect key={`f${i}`} data-ocr="found" x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} fill="#facc15" fillOpacity={0.45} stroke="#ca8a04" strokeWidth={sw} />
          ))}
          {dz && dz.w > 0 && <rect data-ocr="zone" x={dz.x} y={dz.y} width={dz.w} height={dz.h} fill="#7c3aed" fillOpacity={0.15} stroke="#7c3aed" strokeWidth={sw * 1.5} strokeDasharray={`${sw * 6} ${sw * 4}`} />}
        </svg>
      )}
    </div>
  );
}
