import { CFEvaluator, MAX_COLS, MAX_ROWS, colToName, hasActiveFilter, normRect, rectContains, type CFResult, type Rect, type Style } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { Axis } from './axis';
import type { CalcDoc } from './doc';
import {
  activeListValidation,
  drawCommentMarker,
  drawDropdownButton,
  drawInvalidCircle,
  drawPivotPlaceholder,
  drawSparkline,
  drawTableBackgrounds,
  dropdownButtonRect,
  sparklineJobs,
  tableTextLook,
  withTableLook,
} from './render-objects';

export interface Palette {
  bg: string;
  grid: string;
  text: string;
  headerBg: string;
  headerText: string;
  headerBorder: string;
  accent: string;
  accentFill: string;
  selectedHeaderBg: string;
  selectedHeaderText: string;
}

export const LIGHT: Palette = {
  bg: '#ffffff',
  grid: '#d4d4d4',
  text: '#000000',
  headerBg: '#f3f3f3',
  headerText: '#444444',
  headerBorder: '#c8c8c8',
  accent: '#2f855a',
  accentFill: 'rgba(47,133,90,0.13)',
  selectedHeaderBg: '#d3ebdc',
  selectedHeaderText: '#1d5c3a',
};

export const DARK: Palette = {
  bg: '#1e1e1e',
  grid: '#3d3d3d',
  text: '#e8e8e8',
  headerBg: '#2b2b2b',
  headerText: '#b8b8b8',
  headerBorder: '#454545',
  accent: '#4cc38a',
  accentFill: 'rgba(76,195,138,0.16)',
  selectedHeaderBg: '#2d4a3b',
  selectedHeaderText: '#bff0d6',
};

export const HEADER_H = 22;
export const FONT_STACK = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

export interface Layout {
  colAxis: Axis;
  rowAxis: Axis;
  zoom: number;
  headerW: number;
  headerH: number;
  frozenRows: number;
  frozenCols: number;
}

export function buildLayout(doc: CalcDoc, zoom: number, sheetId = doc.activeSheetId): Layout {
  const s = doc.wb.sheet(sheetId);
  // maps, not lists: a hidden item with a custom size must count once
  const colSizes = new Map(s.colWidths);
  for (const c of s.hiddenCols) colSizes.set(c, 0);
  const rowSizes = new Map(s.rowHeights);
  for (const r of s.hiddenRows) rowSizes.set(r, 0);
  for (const r of s.filterHidden) rowSizes.set(r, 0);
  const digits = String(Math.max(99, s.maxRow + 1, 100)).length;
  return {
    colAxis: new Axis(64, colSizes, MAX_COLS),
    rowAxis: new Axis(20, rowSizes, MAX_ROWS),
    zoom,
    headerW: Math.round((digits * 8 + 16) * zoom),
    headerH: Math.round(HEADER_H * zoom),
    frozenRows: s.freeze.rows,
    frozenCols: s.freeze.cols,
  };
}

export interface Viewport {
  width: number;
  height: number;
  /** Scroll offsets in zoomed px, relative to the first unfrozen row/column. */
  scrollX: number;
  scrollY: number;
}

/** Zoomed absolute position of the start of a column/row (no scroll applied). */
export const colX = (l: Layout, c: number) => l.colAxis.offset(c) * l.zoom;
export const rowY = (l: Layout, r: number) => l.rowAxis.offset(r) * l.zoom;

export interface PaneGeometry {
  /** index ranges, inclusive */
  r1: number;
  r2: number;
  c1: number;
  c2: number;
  /** screen origin of the pane's clip rect */
  x: number;
  y: number;
  w: number;
  h: number;
  /** subtract from absolute zoomed position to get a position relative to the pane's clip origin */
  ox: number;
  oy: number;
}

export function panes(l: Layout, v: Viewport): PaneGeometry[] {
  const fw = colX(l, l.frozenCols);
  const fh = rowY(l, l.frozenRows);
  const contentX = l.headerW;
  const contentY = l.headerH;
  const viewW = v.width - contentX;
  const viewH = v.height - contentY;
  const firstCol = l.colAxis.indexAt((fw + v.scrollX) / l.zoom);
  const firstRow = l.rowAxis.indexAt((fh + v.scrollY) / l.zoom);
  const lastCol = l.colAxis.indexAt((fw + v.scrollX + viewW - fw) / l.zoom);
  const lastRow = l.rowAxis.indexAt((fh + v.scrollY + viewH - fh) / l.zoom);
  const out: PaneGeometry[] = [];
  const fr = l.frozenRows;
  const fc = l.frozenCols;
  const scrollCols = Math.max(firstCol, fc);
  const scrollRows = Math.max(firstRow, fr);
  // bottom-right (scrolling) pane
  out.push({ r1: scrollRows, r2: lastRow, c1: scrollCols, c2: lastCol, x: contentX + fw, y: contentY + fh, w: viewW - fw, h: viewH - fh, ox: fw + v.scrollX - 0, oy: fh + v.scrollY - 0 });
  if (fc > 0) out.push({ r1: scrollRows, r2: lastRow, c1: 0, c2: fc - 1, x: contentX, y: contentY + fh, w: fw, h: viewH - fh, ox: 0, oy: fh + v.scrollY });
  if (fr > 0) out.push({ r1: 0, r2: fr - 1, c1: scrollCols, c2: lastCol, x: contentX + fw, y: contentY, w: viewW - fw, h: fh, ox: fw + v.scrollX, oy: 0 });
  if (fr > 0 && fc > 0) out.push({ r1: 0, r2: fr - 1, c1: 0, c2: fc - 1, x: contentX, y: contentY, w: fw, h: fh, ox: 0, oy: 0 });
  return out;
}

/** Pixel rect (zoomed, absolute from top-left of the sheet) of a cell range. */
export function rectPx(l: Layout, r: Rect): { x: number; y: number; w: number; h: number } {
  const x = colX(l, r.c1);
  const y = rowY(l, r.r1);
  return { x, y, w: colX(l, r.c2 + 1) - x, h: rowY(l, r.r2 + 1) - y };
}

export interface HitResult {
  kind: 'cell' | 'colHeader' | 'rowHeader' | 'corner' | 'none';
  row: number;
  col: number;
  /** pointer is on the border that resizes this column/row */
  resize?: 'col' | 'row';
  /** pointer is on the fill handle of the active range */
  fill?: boolean;
}

/** Screen x of the left edge of column c (viewport coordinates, zoomed). */
export const screenX = (l: Layout, v: Viewport, c: number): number => l.headerW + colX(l, c) - (c >= l.frozenCols ? v.scrollX : 0);
export const screenY = (l: Layout, v: Viewport, r: number): number => l.headerH + rowY(l, r) - (r >= l.frozenRows ? v.scrollY : 0);

/** Map a screen point to the grid. */
export function hitTest(l: Layout, v: Viewport, x: number, y: number, fillHandle?: { x: number; y: number } | null): HitResult {
  const fw = colX(l, l.frozenCols);
  const fh = rowY(l, l.frozenRows);
  const toCol = (px: number) => {
    const rel = px - l.headerW;
    return l.colAxis.indexAt((rel < fw ? rel : rel + v.scrollX) / l.zoom);
  };
  const toRow = (py: number) => {
    const rel = py - l.headerH;
    return l.rowAxis.indexAt((rel < fh ? rel : rel + v.scrollY) / l.zoom);
  };
  if (fillHandle && Math.abs(x - fillHandle.x) <= 5 && Math.abs(y - fillHandle.y) <= 5) return { kind: 'cell', row: toRow(y), col: toCol(x), fill: true };
  if (x < l.headerW && y < l.headerH) return { kind: 'corner', row: 0, col: 0 };
  if (y < l.headerH) {
    const col = toCol(x);
    // the resize zone straddles the right border of a column
    for (const c of [col - 1, col]) {
      if (c >= 0 && Math.abs(x - screenX(l, v, c + 1)) <= 4 && x > l.headerW) return { kind: 'colHeader', row: 0, col: c, resize: 'col' };
    }
    return { kind: 'colHeader', row: 0, col };
  }
  if (x < l.headerW) {
    const row = toRow(y);
    for (const r of [row - 1, row]) {
      if (r >= 0 && Math.abs(y - screenY(l, v, r + 1)) <= 3 && y > l.headerH) return { kind: 'rowHeader', row: r, col: 0, resize: 'row' };
    }
    return { kind: 'rowHeader', row, col: 0 };
  }
  return { kind: 'cell', row: toRow(y), col: toCol(x) };
}


// ------------------------------------------------------------------------------------------------ conditional formats & filters
/** Merge the visible effects of a conditional format into a cell style. */
function withCF(base: Style, res: CFResult | null): Style {
  if (!res) return base;
  const f = res.format;
  if (!f && !res.scaleBg) return base;
  return {
    ...base,
    ...(f?.color ? { color: f.color } : {}),
    ...(f?.bold ? { bold: true } : {}),
    ...(f?.italic ? { italic: true } : {}),
    ...(f?.underline ? { underline: true } : {}),
    ...(f?.strike ? { strike: true } : {}),
    ...(f?.bg || res.scaleBg ? { bg: f?.bg ?? res.scaleBg } : {}),
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(c1: [number, number, number], c2: [number, number, number], t: number): string {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
}
const RED: [number, number, number] = [214, 69, 65];
const YELLOW: [number, number, number] = [235, 180, 40];
const GREEN: [number, number, number] = [64, 160, 90];
/** Colour of icon `index` of `count`: red (worst) through yellow to green (best). */
function iconColor(index: number, count: number): string {
  const t = count <= 1 ? 1 : index / (count - 1);
  return t < 0.5 ? mix(RED, YELLOW, t * 2) : mix(YELLOW, GREEN, (t - 0.5) * 2);
}

/** Draw an icon-set glyph centred at (cx, cy). */
export function drawCFIcon(ctx: CanvasRenderingContext2D, icon: NonNullable<CFResult['icon']>, cx: number, cy: number, size: number): void {
  const r = size / 2;
  const color = iconColor(icon.index, icon.count);
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size / 8);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (icon.set.endsWith('Arrows')) {
    // clockwise degrees from "up": the best value points up, the worst down
    const table: Record<number, number[]> = { 3: [180, 90, 0], 4: [180, 135, 45, 0], 5: [180, 135, 90, 45, 0] };
    const deg = table[icon.count]?.[icon.index] ?? 0;
    ctx.translate(cx, cy);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.85, -r * 0.05);
    ctx.lineTo(r * 0.32, -r * 0.05);
    ctx.lineTo(r * 0.32, r);
    ctx.lineTo(-r * 0.32, r);
    ctx.lineTo(-r * 0.32, -r * 0.05);
    ctx.lineTo(-r * 0.85, -r * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (icon.set === '3TrafficLights') {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (icon.set === '3Symbols') {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    if (icon.index === 2) {
      ctx.moveTo(cx - r * 0.45, cy);
      ctx.lineTo(cx - r * 0.1, cy + r * 0.4);
      ctx.lineTo(cx + r * 0.5, cy - r * 0.4);
    } else if (icon.index === 1) {
      ctx.moveTo(cx, cy - r * 0.5);
      ctx.lineTo(cx, cy + r * 0.1);
      ctx.moveTo(cx, cy + r * 0.45);
      ctx.lineTo(cx, cy + r * 0.46);
    } else {
      ctx.moveTo(cx - r * 0.4, cy - r * 0.4);
      ctx.lineTo(cx + r * 0.4, cy + r * 0.4);
      ctx.moveTo(cx + r * 0.4, cy - r * 0.4);
      ctx.lineTo(cx - r * 0.4, cy + r * 0.4);
    }
    ctx.stroke();
  } else {
    // flags: a pole with a triangular pennant
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy + r);
    ctx.lineTo(cx - r * 0.6, cy - r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy - r);
    ctx.lineTo(cx + r, cy - r * 0.3);
    ctx.lineTo(cx - r * 0.6, cy + r * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Square of the autofilter drop-down button inside a header cell (all values in screen px), or null if the cell is too small. */
export function filterButtonRect(left: number, top: number, right: number, bottom: number, zoom: number): { x: number; y: number; w: number } | null {
  const w = Math.round(16 * zoom);
  if (right - left < w + 6 || bottom - top < w - 2) return null;
  return { x: right - w - 2, y: bottom - w - 1, w };
}

function drawFilterButton(ctx: CanvasRenderingContext2D, rc: { x: number; y: number; w: number }, active: boolean, p: Palette): void {
  ctx.save();
  ctx.fillStyle = active ? p.accentFill.replace(/[\d.]+\)$/, '0.35)') : p.bg;
  ctx.strokeStyle = active ? p.accent : p.headerBorder;
  ctx.lineWidth = 1;
  ctx.fillRect(rc.x, rc.y, rc.w, rc.w);
  ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.w - 1);
  ctx.fillStyle = active ? p.accent : p.headerText;
  const cx = rc.x + rc.w / 2;
  const cy = rc.y + rc.w / 2;
  const s = rc.w * 0.26;
  ctx.beginPath();
  if (active) {
    // funnel
    ctx.moveTo(cx - s * 1.3, cy - s * 0.9);
    ctx.lineTo(cx + s * 1.3, cy - s * 0.9);
    ctx.lineTo(cx + s * 0.25, cy + s * 0.15);
    ctx.lineTo(cx + s * 0.25, cy + s * 1.2);
    ctx.lineTo(cx - s * 0.25, cy + s * 0.8);
    ctx.lineTo(cx - s * 0.25, cy + s * 0.15);
  } else {
    ctx.moveTo(cx - s, cy - s * 0.5);
    ctx.lineTo(cx + s, cy - s * 0.5);
    ctx.lineTo(cx, cy + s * 0.7);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export const colLabel = colToName;

function fontOf(style: Style, zoom: number): string {
  const size = (style.fontSize ?? 11) * (96 / 72) * zoom;
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${style.fontName ? `'${style.fontName}', ` : ''}${FONT_STACK}`;
}

const BORDER_WIDTH: Record<string, number> = { hair: 1, thin: 1, dotted: 1, dashed: 1, medium: 2, double: 3, thick: 3 };

export interface DrawOptions {
  doc: CalcDoc;
  ctx: CanvasRenderingContext2D;
  layout: Layout;
  viewport: Viewport;
  palette: Palette;
  dpr: number;
  /** Animated dash offset for the clipboard marquee. */
  marquee: number;
  /** Rect currently being dragged by the fill handle. */
  fillPreview?: Rect | null;
  /** Reference ranges highlighted while editing a formula. */
  refHighlights?: { rect: Rect; color: string }[];
  /** Rows currently hidden by a filter etc. are already in the layout. */
}

/** Paint the whole grid. */
export function drawGrid(o: DrawOptions): void {
  const { ctx, layout: l, viewport: v, palette: p, doc, dpr } = o;
  const sheet = doc.sheet;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.width, v.height);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, v.width, v.height);
  ctx.textBaseline = 'middle';

  const merges = sheet.merges;
  const mergeOf = new Map<number, (typeof merges)[number]>();
  const mergeSkip = new Set<number>();
  for (const m of merges) {
    mergeOf.set(m.r1 * MAX_COLS + m.c1, m);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) mergeSkip.add(r * MAX_COLS + c);
  }

  const cf = sheet.condFormats.length ? new CFEvaluator(doc.wb, doc.activeSheetId) : null;
  const geoms = panes(l, v);
  for (const g of geoms) {
    if (g.w <= 0 || g.h <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.clip();
    drawPane(o, g, mergeOf, mergeSkip, cf);
    ctx.restore();
  }

  drawHeaders(o, geoms);
  // separators for frozen panes
  const fw = colX(l, l.frozenCols);
  const fh = rowY(l, l.frozenRows);
  ctx.strokeStyle = p.headerBorder;
  ctx.lineWidth = 2;
  if (l.frozenCols) {
    ctx.beginPath();
    ctx.moveTo(l.headerW + fw, l.headerH);
    ctx.lineTo(l.headerW + fw, v.height);
    ctx.stroke();
  }
  if (l.frozenRows) {
    ctx.beginPath();
    ctx.moveTo(l.headerW, l.headerH + fh);
    ctx.lineTo(v.width, l.headerH + fh);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPane(o: DrawOptions, g: PaneGeometry, mergeOf: Map<number, Rect>, mergeSkip: Set<number>, cf: CFEvaluator | null): void {
  const { ctx, layout: l, palette: p, doc } = o;
  const sheet = doc.sheet;
  const z = l.zoom;
  const px = (c: number) => g.x + colX(l, c) - g.ox;
  const py = (r: number) => g.y + rowY(l, r) - g.oy;
  const showGrid = sheet.showGrid;

  // gridlines
  if (showGrid) {
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = g.c1; c <= g.c2 + 1; c++) {
      const x = Math.round(px(c)) - 0.5;
      ctx.moveTo(x, g.y);
      ctx.lineTo(x, g.y + g.h);
    }
    for (let r = g.r1; r <= g.r2 + 1; r++) {
      const y = Math.round(py(r)) - 0.5;
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.w, y);
    }
    ctx.stroke();
  }

  if (sheet.tables.length) drawTableBackgrounds(ctx, doc, g, px, py, p.bg !== '#ffffff');

  const colRight = (c: number) => px(c + 1);
  const rowBottom = (r: number) => py(r + 1);

  // collect cells to draw: only non-empty ones, plus empty styled ones
  const cells = sheet.cells;
  const rows = g.r2 - g.r1 + 1;
  const cols = g.c2 - g.c1 + 1;
  const visit = (row: number, col: number, c: NonNullable<ReturnType<typeof cells.get>>) => drawCell(row, col, c);
  const area = rows * cols;
  if (area <= cells.size) {
    for (let row = g.r1; row <= g.r2; row++) {
      for (let col = g.c1; col <= g.c2; col++) {
        const c = cells.get(row * MAX_COLS + col);
        if (c) visit(row, col, c);
      }
    }
  } else {
    for (const [k, c] of cells) {
      const row = Math.floor(k / MAX_COLS);
      const col = k % MAX_COLS;
      if (row >= g.r1 && row <= g.r2 && col >= g.c1 && col <= g.c2) visit(row, col, c);
    }
  }
  // merged blocks anchored outside the pane but overlapping it
  for (const m of mergeOf.values()) {
    if (m.r1 < g.r1 || m.c1 < g.c1) {
      if (m.r2 >= g.r1 && m.c2 >= g.c1 && m.r1 <= g.r2 && m.c1 <= g.c2) {
        const c = cells.get(m.r1 * MAX_COLS + m.c1);
        if (c) drawCell(m.r1, m.c1, c);
      }
    }
  }

  function drawCell(row: number, col: number, c: { value: unknown; style: number }): void {
    if (mergeSkip.has(row * MAX_COLS + col)) return;
    const m = mergeOf.get(row * MAX_COLS + col);
    const r1 = row;
    const c1 = col;
    const r2 = m ? m.r2 : row;
    const c2 = m ? m.c2 : col;
    const x = px(c1);
    const y = py(r1);
    const w = colRight(c2) - x;
    const h = rowBottom(r2) - y;
    if (w <= 0 || h <= 0) return;
    const res = cf ? cf.forCell(row, col) : null;
    const style = withTableLook(withCF(doc.wb.styles.get(c.style), res), sheet.tables.length ? tableTextLook(doc, row, col) : undefined);
    if (style.bg) {
      ctx.fillStyle = style.bg;
      ctx.fillRect(x, y, w, h);
      if (showGrid) {
        // keep the grid visible on top of fills like Excel does not; Excel hides it, so do nothing
      }
    }
    if (res?.bar) {
      const bw = Math.max(2, (w - 4) * res.bar.fraction);
      const grad = ctx.createLinearGradient(x + 2, 0, x + 2 + bw, 0);
      grad.addColorStop(0, res.bar.color);
      grad.addColorStop(1, res.bar.color + '99');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 2, y + 2, bw, h - 4);
    }
    drawBorders(style, x, y, w, h);
    const iconW = res?.icon ? 17 * z : 0;
    if (res?.icon) drawCFIcon(ctx, res.icon, x + 3 * z + 7 * z, y + h / 2, 12 * z);
    const d = doc.display(doc.activeSheetId, row, col);
    if (d.text === '' || res?.hideValue || (doc.edit && doc.edit.row === row && doc.edit.col === col && doc.edit.sheetId === doc.activeSheetId)) return;
    drawText(d.text, d.value, style, x + iconW, y, w - iconW, h, d.color, r1, c1, c2);
  }

  function drawBorders(style: Style, x: number, y: number, w: number, h: number): void {
    const line = (b: Style['top'], x1: number, y1: number, x2: number, y2: number) => {
      if (!b) return;
      ctx.strokeStyle = b.color ?? p.text;
      ctx.lineWidth = Math.max(1, (BORDER_WIDTH[b.style] ?? 1) * Math.min(z, 1.5));
      ctx.setLineDash(b.style === 'dashed' ? [4, 2] : b.style === 'dotted' ? [1, 2] : []);
      ctx.beginPath();
      ctx.moveTo(Math.round(x1) - 0.5, Math.round(y1) - 0.5);
      ctx.lineTo(Math.round(x2) - 0.5, Math.round(y2) - 0.5);
      ctx.stroke();
      if (b.style === 'double') {
        ctx.lineWidth = 1;
        ctx.beginPath();
        const dx = y1 === y2 ? 0 : 2;
        const dy = y1 === y2 ? 2 : 0;
        ctx.moveTo(Math.round(x1) - 0.5 + dx, Math.round(y1) - 0.5 + dy);
        ctx.lineTo(Math.round(x2) - 0.5 + dx, Math.round(y2) - 0.5 + dy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    line(style.top, x, y, x + w, y);
    line(style.bottom, x, y + h, x + w, y + h);
    line(style.left, x, y, x, y + h);
    line(style.right, x + w, y, x + w, y + h);
  }

  function drawText(text: string, value: unknown, style: Style, x: number, y: number, w: number, h: number, color: string | undefined, row: number, c1: number, c2: number): void {
    ctx.font = fontOf(style, z);
    ctx.fillStyle = color ?? style.color ?? p.text;
    const isNum = typeof value === 'number';
    const align = style.hAlign && style.hAlign !== 'general' ? style.hAlign : isNum ? 'right' : typeof value === 'boolean' || (typeof value === 'object' && value !== null) ? 'center' : 'left';
    const pad = 3 * z + (style.indent ?? 0) * 9 * z;
    const lineH = (style.fontSize ?? 11) * (96 / 72) * z * 1.2;

    if (style.wrap && !isNum) {
      const lines = wrapLines(ctx, text, Math.max(10, w - pad * 2));
      const total = lines.length * lineH;
      const vAlign = style.vAlign ?? 'bottom';
      let ty = vAlign === 'top' ? y + 2 : vAlign === 'middle' ? y + (h - total) / 2 : y + h - total - 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      for (const ln of lines) {
        const tw = ctx.measureText(ln).width;
        const tx = align === 'center' ? x + (w - tw) / 2 : align === 'right' ? x + w - pad - tw : x + pad;
        ctx.fillText(ln, tx, ty + lineH / 2);
        decorate(style, tx, ty + lineH / 2, tw);
        ty += lineH;
      }
      ctx.restore();
      return;
    }

    let shown = text.split('\n')[0] ?? '';
    let tw = ctx.measureText(shown).width;
    // numbers that do not fit show ####
    if (isNum && tw > w - pad * 2) {
      const hash = '#'.repeat(Math.max(1, Math.floor((w - pad * 2) / Math.max(1, ctx.measureText('#').width))));
      shown = hash;
      tw = ctx.measureText(shown).width;
    }
    const vAlign = style.vAlign ?? 'bottom';
    const ty = vAlign === 'top' ? y + lineH / 2 + 1 : vAlign === 'middle' ? y + h / 2 : y + h - lineH / 2 - 1;

    // text may spill into empty neighbours (not for numbers, wrap or merged cells)
    let left = x;
    let right = x + w;
    if (!isNum && !style.wrap && tw > w - pad * 2 && c1 === c2) {
      const free = (cc: number) => {
        const nb = sheet.cells.get(row * MAX_COLS + cc);
        return !nb || (nb.value === null && !nb.formula);
      };
      if (align !== 'right') {
        let cc = c2 + 1;
        while (right < g.x + g.w && cc < MAX_COLS && free(cc) && right - x < tw + pad * 2) {
          right = colRight(cc);
          cc++;
        }
      }
      if (align !== 'left') {
        let cc = c1 - 1;
        while (left > g.x && cc >= 0 && free(cc) && x + w - left < tw + pad * 2) {
          left = px(cc);
          cc--;
        }
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, y, right - left, h);
    ctx.clip();
    const tx = align === 'center' ? left + (right - left - tw) / 2 : align === 'right' ? right - pad - tw : left + pad;
    ctx.fillText(shown, tx, ty);
    decorate(style, tx, ty, tw);
    ctx.restore();
  }

  function decorate(style: Style, tx: number, ty: number, tw: number): void {
    if (!style.underline && !style.strike) return;
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = Math.max(1, z);
    const size = (style.fontSize ?? 11) * (96 / 72) * z;
    ctx.beginPath();
    if (style.underline) {
      ctx.moveTo(tx, ty + size * 0.45);
      ctx.lineTo(tx + tw, ty + size * 0.45);
    }
    if (style.strike) {
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + tw, ty);
    }
    ctx.stroke();
  }

  const af = sheet.autoFilter;
  if (af) {
    const hr = normRect(af.range);
    if (hr.r1 >= g.r1 && hr.r1 <= g.r2) {
      for (let col = Math.max(g.c1, hr.c1); col <= Math.min(g.c2, hr.c2); col++) {
        const rc = filterButtonRect(px(col), py(hr.r1), px(col + 1), py(hr.r1 + 1), z);
        if (rc) drawFilterButton(ctx, rc, !!af.columns[col], p);
      }
    }
  }

  // filter buttons of the tables
  for (const t of sheet.tables) {
    if (!t.header || !t.filterButtons) continue;
    const hr = normRect(t.ref);
    if (hr.r1 < g.r1 || hr.r1 > g.r2) continue;
    for (let col = Math.max(g.c1, hr.c1); col <= Math.min(g.c2, hr.c2); col++) {
      const rc = filterButtonRect(px(col), py(hr.r1), px(col + 1), py(hr.r1 + 1), z);
      if (rc) drawFilterButton(ctx, rc, !!t.filter?.columns[col], p);
    }
  }

  // sparklines live in cells that may be empty
  if (sheet.sparklines.length) {
    for (const job of sparklineJobs(doc, g)) {
      const x = px(job.col);
      const y = py(job.row);
      drawSparkline(ctx, job.group, job.values, { x, y, w: px(job.col + 1) - x, h: py(job.row + 1) - y }, z, job.range);
    }
  }

  // pivot tables without fields: the instructions Excel shows
  for (const pv of sheet.pivots) {
    if (!pv.size || pv.rows.length || pv.cols.length || pv.values.length || pv.filters.length) continue;
    if (pv.row + pv.size.rows <= g.r1 || pv.row > g.r2 || pv.col + pv.size.cols <= g.c1 || pv.col > g.c2) continue;
    const x = px(pv.col);
    const y = py(pv.row);
    drawPivotPlaceholder(ctx, { x, y, w: px(pv.col + pv.size.cols) - x, h: py(pv.row + pv.size.rows) - y }, pv.name, [t('Para generar un informe, elija campos de la lista de campos de la tabla dinámica.')], p, z);
  }

  // manual page breaks
  if (sheet.print.rowBreaks.length || sheet.print.colBreaks.length) {
    ctx.save();
    ctx.strokeStyle = p.headerText;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    for (const b of sheet.print.rowBreaks) {
      if (b + 1 < g.r1 || b > g.r2) continue;
      const y = Math.round(py(b + 1)) - 0.5;
      ctx.beginPath();
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.w, y);
      ctx.stroke();
    }
    for (const b of sheet.print.colBreaks) {
      if (b + 1 < g.c1 || b > g.c2) continue;
      const x = Math.round(px(b + 1)) - 0.5;
      ctx.beginPath();
      ctx.moveTo(x, g.y);
      ctx.lineTo(x, g.y + g.h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // notes
  for (const c of sheet.comments) {
    if (c.row < g.r1 || c.row > g.r2 || c.col < g.c1 || c.col > g.c2) continue;
    drawCommentMarker(ctx, px(c.col + 1), py(c.row), z);
  }

  // values that break their validation rule
  if (doc.x.circleInvalid) {
    for (const cell of invalidCached(doc)) {
      if (cell.row < g.r1 || cell.row > g.r2 || cell.col < g.c1 || cell.col > g.c2) continue;
      drawInvalidCircle(ctx, px(cell.col), py(cell.row), px(cell.col + 1) - px(cell.col), py(cell.row + 1) - py(cell.row));
    }
  }

  // drop-down arrow of a list validation on the active cell
  if (activeListValidation(doc)) {
    const a = doc.sel.active;
    if (a.row >= g.r1 && a.row <= g.r2 && a.col >= g.c1 && a.col <= g.c2) {
      const rc = dropdownButtonRect(px(a.col), py(a.row), px(a.col + 1), py(a.row + 1), z);
      if (rc) drawDropdownButton(ctx, rc, p);
    }
  }

  drawOverlays(o, g, px, py);
}

const invalidMemo = new WeakMap<CalcDoc, { version: number; list: { row: number; col: number }[] }>();
function invalidCached(doc: CalcDoc): { row: number; col: number }[] {
  const m = invalidMemo.get(doc);
  if (m && m.version === doc.getVersion()) return m.list;
  const list = doc.x.invalid();
  invalidMemo.set(doc, { version: doc.getVersion(), list });
  return list;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawOverlays(o: DrawOptions, g: PaneGeometry, px: (c: number) => number, py: (r: number) => number): void {
  const { ctx, doc, palette: p } = o;
  const rectOf = (r: Rect) => {
    const x = px(r.c1);
    const y = py(r.r1);
    return { x, y, w: px(r.c2 + 1) - x, h: py(r.r2 + 1) - y };
  };
  const visible = (r: Rect) => r.r2 >= g.r1 && r.r1 <= g.r2 && r.c2 >= g.c1 && r.c1 <= g.c2;
  const clampRect = (r: Rect): Rect => ({ r1: Math.max(r.r1, g.r1 - 1), r2: Math.min(r.r2, g.r2 + 1), c1: Math.max(r.c1, g.c1 - 1), c2: Math.min(r.c2, g.c2 + 1) });

  // clipboard marquee
  const clip = doc.clip;
  if (clip && clip.sheetId === doc.activeSheetId && visible(clip.rect)) {
    const rc = rectOf(clampRect(clip.rect));
    ctx.save();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -o.marquee;
    ctx.strokeRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
    ctx.restore();
  }

  // formula reference highlights
  for (const h of o.refHighlights ?? []) {
    if (!visible(h.rect)) continue;
    const rc = rectOf(clampRect(h.rect));
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
    ctx.fillStyle = h.color + '22';
    ctx.fillRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
  }

  // selection
  const sel = doc.sel;
  const active = sel.active;
  const activeMerge = doc.sheet.merges.find((m) => rectContains(m, active.row, active.col));
  sel.ranges.forEach((r, idx) => {
    if (!visible(r)) return;
    const rc = rectOf(clampRect(r));
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    const isActiveCellOnly = single || (activeMerge && r.r1 === activeMerge.r1 && r.c1 === activeMerge.c1 && r.r2 === activeMerge.r2 && r.c2 === activeMerge.c2);
    if (!isActiveCellOnly) {
      // tint everything except the active cell, leaving its content (and conditional formats) untouched
      ctx.fillStyle = p.accentFill;
      ctx.beginPath();
      ctx.rect(rc.x, rc.y, rc.w, rc.h);
      if (visible({ r1: active.row, c1: active.col, r2: active.row, c2: active.col })) {
        const arc = rectOf(activeMerge ?? { r1: active.row, c1: active.col, r2: active.row, c2: active.col });
        ctx.rect(arc.x, arc.y, arc.w, arc.h);
      }
      ctx.fill('evenodd');
    }
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = idx === sel.ranges.length - 1 ? 2 : 1.5;
    ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
  });

  // active cell border (thicker)
  if (visible({ r1: active.row, c1: active.col, r2: active.row, c2: active.col }) || (activeMerge && visible(activeMerge))) {
    const ar = activeMerge ?? { r1: active.row, c1: active.col, r2: active.row, c2: active.col };
    const rc = rectOf(ar);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
  }

  // fill handle at the bottom-right of the current range
  const cur = sel.ranges[sel.ranges.length - 1]!;
  if (!doc.edit && cur.r2 >= g.r1 && cur.r2 <= g.r2 && cur.c2 >= g.c1 && cur.c2 <= g.c2 && cur.r2 < MAX_ROWS - 1 && !(cur.r1 === 0 && cur.r2 === MAX_ROWS - 1) && !(cur.c1 === 0 && cur.c2 === MAX_COLS - 1)) {
    const hx = px(cur.c2 + 1);
    const hy = py(cur.r2 + 1);
    ctx.fillStyle = p.accent;
    ctx.fillRect(hx - 4, hy - 4, 7, 7);
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 1;
    ctx.strokeRect(hx - 4 + 0.5, hy - 4 + 0.5, 6, 6);
  }

  if (o.fillPreview && visible(o.fillPreview)) {
    const rc = rectOf(clampRect(o.fillPreview));
    ctx.save();
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
    ctx.restore();
  }
}

function drawHeaders(o: DrawOptions, geoms: PaneGeometry[]): void {
  const { ctx, layout: l, viewport: v, palette: p, doc } = o;
  const sel = doc.sel;
  ctx.save();
  ctx.font = `${12 * l.zoom}px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const selCols = (c: number) => sel.ranges.some((r) => c >= r.c1 && c <= r.c2);
  const selRows = (r: number) => sel.ranges.some((rg) => r >= rg.r1 && r <= rg.r2);
  const af = doc.sheet.autoFilter;
  const afRange = af && hasActiveFilter(af) ? normRect(af.range) : null;
  // Excel colours the row numbers of a filtered list so the filter is noticeable
  const filteredRow = (r: number) => !!afRange && r > afRange.r1 && r <= afRange.r2;
  const wholeCol = (c: number) => sel.ranges.some((r) => r.r1 === 0 && r.r2 === MAX_ROWS - 1 && c >= r.c1 && c <= r.c2);
  const wholeRow = (r: number) => sel.ranges.some((rg) => rg.c1 === 0 && rg.c2 === MAX_COLS - 1 && r >= rg.r1 && r <= rg.r2);

  // column header band
  ctx.fillStyle = p.headerBg;
  ctx.fillRect(0, 0, v.width, l.headerH);
  ctx.fillRect(0, 0, l.headerW, v.height);
  const colPanes = geoms.filter((g, i, arr) => arr.findIndex((x) => x.c1 === g.c1 && x.c2 === g.c2) === i);
  for (const g of colPanes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, 0, g.w, l.headerH);
    ctx.clip();
    for (let c = g.c1; c <= g.c2; c++) {
      const x = g.x + colX(l, c) - g.ox;
      const w = colX(l, c + 1) - colX(l, c);
      if (w <= 0) continue;
      const selected = selCols(c);
      if (selected) {
        ctx.fillStyle = wholeCol(c) ? p.accent : p.selectedHeaderBg;
        ctx.fillRect(x, 0, w, l.headerH);
        ctx.fillStyle = wholeCol(c) ? '#ffffff' : p.selectedHeaderText;
        ctx.fillRect(x, l.headerH - 2, w, 2);
        if (wholeCol(c)) ctx.fillStyle = '#ffffff';
      } else ctx.fillStyle = p.headerText;
      ctx.fillText(colToName(c), x + w / 2, l.headerH / 2 + 1);
      ctx.strokeStyle = p.headerBorder;
      ctx.beginPath();
      ctx.moveTo(Math.round(x + w) - 0.5, 0);
      ctx.lineTo(Math.round(x + w) - 0.5, l.headerH);
      ctx.stroke();
    }
    ctx.restore();
  }
  const rowPanes = geoms.filter((g, i, arr) => arr.findIndex((x) => x.r1 === g.r1 && x.r2 === g.r2) === i);
  for (const g of rowPanes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, g.y, l.headerW, g.h);
    ctx.clip();
    for (let r = g.r1; r <= g.r2; r++) {
      const y = g.y + rowY(l, r) - g.oy;
      const h = rowY(l, r + 1) - rowY(l, r);
      if (h <= 0) continue;
      const selected = selRows(r);
      if (selected) {
        ctx.fillStyle = wholeRow(r) ? p.accent : p.selectedHeaderBg;
        ctx.fillRect(0, y, l.headerW, h);
        ctx.fillStyle = wholeRow(r) ? '#ffffff' : p.selectedHeaderText;
        ctx.fillRect(l.headerW - 2, y, 2, h);
        if (wholeRow(r)) ctx.fillStyle = '#ffffff';
      } else ctx.fillStyle = filteredRow(r) ? p.accent : p.headerText;
      ctx.fillText(String(r + 1), l.headerW / 2, y + h / 2 + 1);
      ctx.strokeStyle = p.headerBorder;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y + h) - 0.5);
      ctx.lineTo(l.headerW, Math.round(y + h) - 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  // corner + outer borders
  ctx.fillStyle = p.headerBg;
  ctx.fillRect(0, 0, l.headerW, l.headerH);
  ctx.strokeStyle = p.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, l.headerH - 0.5);
  ctx.lineTo(v.width, l.headerH - 0.5);
  ctx.moveTo(l.headerW - 0.5, 0);
  ctx.lineTo(l.headerW - 0.5, v.height);
  ctx.stroke();
  // select-all triangle
  ctx.fillStyle = p.headerBorder;
  ctx.beginPath();
  ctx.moveTo(l.headerW - 4, l.headerH - 4);
  ctx.lineTo(l.headerW - 4, l.headerH - 12 * l.zoom);
  ctx.lineTo(l.headerW - 12 * l.zoom, l.headerH - 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
