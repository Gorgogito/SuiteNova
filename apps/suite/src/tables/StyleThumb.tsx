import type { ReactElement } from 'react';
import { DEFAULT_OPTIONS, lookOf, type StyleOptions, type TableStyle } from '@suitenova/table-core';

const R = 4;
const C = 3;

/** A small drawing of a table style (4 rows × 3 columns): what the gallery shows for each style. */
export function StyleThumb({ style, options = DEFAULT_OPTIONS, width = 54, height = 38 }: { style: TableStyle | undefined; options?: StyleOptions; width?: number; height?: number }) {
  const cw = (width - 2) / C;
  const rh = (height - 2) / R;
  const cells: ReactElement[] = [];
  const lines: ReactElement[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const l = lookOf(style, options, { r, c }, { rows: R, cols: C });
      const x = 1 + c * cw;
      const y = 1 + r * rh;
      cells.push(<rect key={`f${r}${c}`} x={x} y={y} width={cw} height={rh} fill={l.fill ?? '#ffffff'} />);
      // a tick of text in each cell, in the colour the style gives it
      cells.push(<rect key={`t${r}${c}`} x={x + 3} y={y + rh / 2 - 1} width={cw - 6} height={2} rx={1} fill={l.color ?? '#9a9a9a'} opacity={l.bold ? 0.95 : 0.55} />);
      const sides = [
        ['t', x, y, x + cw, y],
        ['b', x, y + rh, x + cw, y + rh],
        ['l', x, y, x, y + rh],
        ['r', x + cw, y, x + cw, y + rh],
      ] as const;
      for (const [k, x1, y1, x2, y2] of sides) {
        const b = l.borders[k];
        if (b) lines.push(<line key={`${k}${r}${c}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={b.color} strokeWidth={Math.min(2.5, Math.max(0.6, b.width * 0.8))} strokeDasharray={b.style === 'dashed' ? '3 2' : b.style === 'dotted' ? '1 1.5' : undefined} />);
      }
    }
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true" style={{ background: '#fff', border: '1px solid #d0d0d0', display: 'block' }}>
      {cells}
      {lines}
    </svg>
  );
}
