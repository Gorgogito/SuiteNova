import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** The quiet zone around a code, in its own squares: readers need it. */
const MARGIN = 4;

/** A QR code of a short text, always black on white so that any camera reads it, whatever the theme. */
export function Qr({ text, label, size }: { text: string; label: string; size: number }) {
  const { path, side } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const n = code.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.isDark(y, x)) d += `M${x + MARGIN} ${y + MARGIN}h1v1h-1z`;
    return { path: d, side: n + MARGIN * 2 };
  }, [text]);
  return (
    <svg className="fm-qr" role="img" aria-label={label} viewBox={`0 0 ${side} ${side}`} width={size} height={size} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
