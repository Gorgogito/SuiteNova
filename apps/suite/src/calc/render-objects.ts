import {
  MAX_COLS,
  listChoices,
  normRect,
  readRangeValues,
  resolveRangeText,
  tableParts,
  tableStyleLook,
  type Rect,
  type Scalar,
  type SparklineGroup,
  type Style,
  type TableDef,
  type Workbook,
} from '@suitenova/calc-engine';
import type { CalcDoc } from './doc';
import type { Palette } from './render';

type PX = (c: number) => number;
type PY = (r: number) => number;

interface Pane {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a table style does to the text of a cell. */
export interface TableTextLook {
  fg?: string;
  bold?: boolean;
}

function lookOf(t: TableDef) {
  return tableStyleLook(t.style);
}

/** Header, stripes and totals of the tables, painted under the cell contents. */
export function drawTableBackgrounds(ctx: CanvasRenderingContext2D, doc: CalcDoc, g: Pane, px: PX, py: PY, dark: boolean): void {
  for (const t of doc.sheet.tables) {
    const look = lookOf(t);
    if (!look) continue;
    const parts = tableParts(t);
    const all = parts.all;
    if (all.r2 < g.r1 || all.r1 > g.r2 || all.c2 < g.c1 || all.c1 > g.c2) continue;
    const r1 = Math.max(all.r1, g.r1);
    const r2 = Math.min(all.r2, g.r2);
    const c1 = Math.max(all.c1, g.c1);
    const c2 = Math.min(all.c2, g.c2);
    const shade = (c: string) => (dark ? dim(c) : c);
    for (let r = r1; r <= r2; r++) {
      const isHeader = !!parts.header && r === parts.header.r1;
      const isTotals = !!parts.totals && r === parts.totals.r1;
      const dataIndex = r - parts.data.r1;
      let fill: string | undefined;
      if (isHeader) fill = look.headerBg;
      else if (!isTotals && t.rowStripes && dataIndex % 2 === 0) fill = look.band1;
      else if (!isTotals && t.rowStripes && look.band2 && dataIndex % 2 === 1) fill = look.band2;
      else if (!isTotals && look.band2 && !t.rowStripes) fill = look.band1;
      for (let c = c1; c <= c2; c++) {
        let f = fill;
        if (!f && !isHeader && !isTotals && t.colStripes && (c - all.c1) % 2 === 0) f = look.band1;
        if (!f) continue;
        ctx.fillStyle = shade(f);
        ctx.fillRect(px(c), py(r), px(c + 1) - px(c), py(r + 1) - py(r));
      }
    }
    // lines: under the header, above the totals, between cells for grid styles
    ctx.save();
    ctx.lineWidth = 1;
    const x1 = px(c1);
    const x2 = px(c2 + 1);
    if (look.line) {
      ctx.strokeStyle = shade(look.line);
      if (parts.header && !look.headerBg && parts.header.r1 >= r1 && parts.header.r1 <= r2) line(ctx, x1, py(parts.header.r1 + 1), x2, py(parts.header.r1 + 1));
      if (parts.totals && parts.totals.r1 >= r1 && parts.totals.r1 <= r2) line(ctx, x1, py(parts.totals.r1), x2, py(parts.totals.r1), look.totalsTop);
      if (!look.headerBg) {
        if (all.r1 >= g.r1) line(ctx, px(c1), py(all.r1), px(c2 + 1), py(all.r1));
        if (all.r2 <= g.r2) line(ctx, px(c1), py(all.r2 + 1), px(c2 + 1), py(all.r2 + 1));
      }
    }
    if (look.grid) {
      ctx.strokeStyle = shade(look.grid);
      for (let r = r1; r <= r2 + 1; r++) line(ctx, x1, py(r), x2, py(r));
      for (let c = c1; c <= c2 + 1; c++) line(ctx, px(c), py(r1), px(c), py(r2 + 1));
    }
    ctx.restore();
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color?: string): void {
  if (color) ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) - 0.5, Math.round(y1) - 0.5);
  ctx.lineTo(Math.round(x2) - 0.5, Math.round(y2) - 0.5);
  ctx.stroke();
}

/** Darken a light table colour for the dark theme. */
function dim(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const f = (v: number) => Math.round(v * 0.45);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Bold header, white text on dark fills, bold totals, as the style of the table dictates. */
export function tableTextLook(doc: CalcDoc, row: number, col: number): TableTextLook | undefined {
  const tables = doc.sheet.tables;
  if (!tables.length) return undefined;
  for (const t of tables) {
    const r = normRect(t.ref);
    if (row < r.r1 || row > r.r2 || col < r.c1 || col > r.c2) continue;
    const look = lookOf(t);
    if (!look) return undefined;
    if (t.header && row === r.r1) return { fg: look.headerFg === '#000000' ? undefined : look.headerFg, bold: look.headerBold };
    if (t.totals && row === r.r2) return { bold: look.totalsBold, fg: look.fg };
    if (t.firstCol && col === r.c1) return { bold: look.firstColBold, fg: look.fg };
    return look.fg ? { fg: look.fg } : undefined;
  }
  return undefined;
}

export function withTableLook(style: Style, look: TableTextLook | undefined): Style {
  if (!look) return style;
  return { ...style, ...(look.bold && !style.bold ? { bold: true } : {}), ...(look.fg && !style.color ? { color: look.fg } : {}) };
}

// ------------------------------------------------------------------------------------------------ sparklines
interface SparkData {
  values: (number | null)[];
}

function sparkValues(wb: Workbook, sheetId: number, group: SparklineGroup, source: string): SparkData {
  const r = resolveRangeText(wb, source, sheetId);
  if (!r) return { values: [] };
  const sheet = wb.sheet(r.sheetId);
  const out: (number | null)[] = [];
  const horizontal = r.rect.r1 === r.rect.r2;
  const r2 = Math.min(r.rect.r2, Math.max(sheet.maxRow, r.rect.r1));
  const c2 = Math.min(r.rect.c2, Math.max(sheet.maxCol, r.rect.c1));
  for (let row = r.rect.r1; row <= r2; row++) {
    for (let col = r.rect.c1; col <= c2; col++) {
      if (!group.showHidden && (sheet.hiddenRows.has(row) || sheet.hiddenCols.has(col) || sheet.filterHidden.has(row))) continue;
      const v = wb.getValue(r.sheetId, row, col);
      out.push(typeof v === 'number' && Number.isFinite(v) ? v : null);
    }
  }
  void horizontal;
  return { values: out };
}

export interface SparkLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a sparkline is made of, independent of the surface it is painted on (canvas for the grid, SVG for printing). */
export type SparkOp =
  | { k: 'line'; pts: [number, number][][]; color: string; width: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { k: 'dot'; x: number; y: number; r: number; color: string }
  | { k: 'axis'; x1: number; x2: number; y: number };

/** Geometry of one sparkline in a w x h box (all in the same units as `zoom` scales). */
export function sparkOps(group: SparklineGroup, data: (number | null)[], w0: number, h0: number, zoom: number, groupRange: { min: number; max: number }): SparkOp[] {
  const pad = 3 * zoom;
  const x0 = pad;
  const y0 = pad;
  const w = w0 - pad * 2;
  const h = h0 - pad * 2;
  if (w <= 2 || h <= 2) return [];
  let values = data.slice();
  if (group.rightToLeft) values = values.reverse();
  const nums = values.filter((v): v is number => v !== null);
  if (!nums.length) return [];
  const own = { min: Math.min(...nums), max: Math.max(...nums) };
  let lo = group.minType === 'group' ? groupRange.min : group.minType === 'custom' && group.min !== undefined ? group.min : own.min;
  let hi = group.maxType === 'group' ? groupRange.max : group.maxType === 'custom' && group.max !== undefined ? group.max : own.max;
  if (group.type !== 'line') {
    if (group.minType === 'auto' && lo > 0) lo = 0;
    if (group.maxType === 'auto' && hi < 0) hi = 0;
  }
  if (hi === lo) {
    hi += 1;
    lo -= group.type === 'line' ? 1 : 0;
  }
  const n = values.length;
  const yOf = (v: number) => y0 + h - ((v - lo) / (hi - lo)) * h;
  const xOf = (i: number) => (n === 1 ? x0 + w / 2 : x0 + (i / (n - 1)) * w);
  const maxV = Math.max(...nums);
  const minV = Math.min(...nums);
  const ops: SparkOp[] = [];
  if (group.showAxis && lo <= 0 && hi >= 0) ops.push({ k: 'axis', x1: x0, x2: x0 + w, y: yOf(0) });
  const special = (i: number, v: number): string | undefined => {
    if (group.showHigh && v === maxV) return group.highColor;
    if (group.showLow && v === minV) return group.lowColor;
    if (group.showFirst && i === 0) return group.firstColor;
    if (group.showLast && i === n - 1) return group.lastColor;
    if (group.showNegative && v < 0) return group.negativeColor;
    return undefined;
  };
  if (group.type === 'line') {
    const runs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      let v = values[i]!;
      if (v === null) {
        if (group.emptyAs === 'zero') v = 0;
        else if (group.emptyAs === 'gap') {
          if (cur.length) runs.push(cur);
          cur = [];
          continue;
        } else continue;
      }
      cur.push([xOf(i), yOf(v)]);
    }
    if (cur.length) runs.push(cur);
    ops.push({ k: 'line', pts: runs, color: group.color, width: Math.max(1, group.lineWeight * zoom) });
    values.forEach((v, i) => {
      if (v === null) return;
      const sp = special(i, v);
      if (sp) ops.push({ k: 'dot', x: xOf(i), y: yOf(v), r: 2.6 * zoom, color: sp });
      else if (group.showMarkers) ops.push({ k: 'dot', x: xOf(i), y: yOf(v), r: 1.8 * zoom, color: group.markerColor });
    });
  } else {
    const slot = w / Math.max(1, n);
    const bw = Math.max(1, slot * 0.7);
    const base = group.type === 'column' ? Math.min(Math.max(0, lo), hi) : 0;
    values.forEach((raw, i) => {
      let v = raw;
      if (v === null) {
        if (group.emptyAs !== 'zero') return;
        v = 0;
      }
      const cx = x0 + slot * i + slot / 2;
      if (group.type === 'winloss') {
        const half = h / 2 - 1;
        const mid = y0 + h / 2;
        const color = special(i, v) ?? (v < 0 ? group.negativeColor : group.color);
        if (v === 0) ops.push({ k: 'rect', x: cx - bw / 2, y: mid - 0.5, w: bw, h: 1, color });
        else if (v > 0) ops.push({ k: 'rect', x: cx - bw / 2, y: mid - half, w: bw, h: half - 0.5, color });
        else ops.push({ k: 'rect', x: cx - bw / 2, y: mid + 0.5, w: bw, h: half - 0.5, color });
        return;
      }
      const color = special(i, v) ?? (v < 0 && group.showNegative ? group.negativeColor : group.color);
      const yv = yOf(v);
      const yb = yOf(base);
      ops.push({ k: 'rect', x: cx - bw / 2, y: Math.min(yv, yb), w: bw, h: Math.max(1, Math.abs(yb - yv)), color });
    });
  }
  return ops;
}

/** Paint one sparkline inside a cell. `groupRange` is the shared vertical scale of the group. */
export function drawSparkline(ctx: CanvasRenderingContext2D, group: SparklineGroup, data: (number | null)[], rc: SparkLayout, zoom: number, groupRange: { min: number; max: number }): void {
  const ops = sparkOps(group, data, rc.w, rc.h, zoom, groupRange);
  if (!ops.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rc.x, rc.y, rc.w, rc.h);
  ctx.clip();
  ctx.translate(rc.x, rc.y);
  for (const op of ops) {
    if (op.k === 'axis') {
      ctx.strokeStyle = '#7f7f7f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(op.x1, Math.round(op.y) + 0.5);
      ctx.lineTo(op.x2, Math.round(op.y) + 0.5);
      ctx.stroke();
    } else if (op.k === 'line') {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const run of op.pts) run.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    } else if (op.k === 'rect') {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else {
      ctx.fillStyle = op.color;
      ctx.beginPath();
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The same sparkline as SVG text (for printing). */
export function sparkSvg(group: SparklineGroup, data: (number | null)[], w: number, h: number, groupRange: { min: number; max: number }): string {
  const ops = sparkOps(group, data, w, h, 1, groupRange);
  const body = ops
    .map((op) => {
      if (op.k === 'axis') return `<line x1="${op.x1}" x2="${op.x2}" y1="${op.y}" y2="${op.y}" stroke="#7f7f7f"/>`;
      if (op.k === 'line') return op.pts.map((run) => `<polyline fill="none" stroke="${op.color}" stroke-width="${op.width}" stroke-linejoin="round" stroke-linecap="round" points="${run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`).join('');
      if (op.k === 'rect') return `<rect x="${op.x.toFixed(1)}" y="${op.y.toFixed(1)}" width="${op.w.toFixed(1)}" height="${op.h.toFixed(1)}" fill="${op.color}"/>`;
      return `<circle cx="${op.x.toFixed(1)}" cy="${op.y.toFixed(1)}" r="${op.r}" fill="${op.color}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

/** Fill colour a table style gives a cell (header, band, column band), or undefined. */
export function tableFillAt(t: TableDef, row: number, col: number): string | undefined {
  const look = lookOf(t);
  if (!look) return undefined;
  const parts = tableParts(t);
  const all = parts.all;
  if (row < all.r1 || row > all.r2 || col < all.c1 || col > all.c2) return undefined;
  if (parts.header && row === parts.header.r1) return look.headerBg;
  if (parts.totals && row === parts.totals.r1) return undefined;
  const i = row - parts.data.r1;
  if (t.rowStripes && i % 2 === 0) return look.band1;
  if (t.rowStripes && look.band2 && i % 2 === 1) return look.band2;
  if (!t.rowStripes && look.band2) return look.band1;
  if (t.colStripes && (col - all.c1) % 2 === 0) return look.band1;
  return undefined;
}

export { sparkValues };

/** Values of the sparklines of the visible cells, with the shared scale of each group. */
export function sparklineJobs(doc: CalcDoc, g: Pane): { group: SparklineGroup; row: number; col: number; values: (number | null)[]; range: { min: number; max: number } }[] {
  const jobs: { group: SparklineGroup; row: number; col: number; values: (number | null)[]; range: { min: number; max: number } }[] = [];
  for (const group of doc.sheet.sparklines) {
    let range: { min: number; max: number } | null = null;
    const visible = group.items.filter((i) => i.row >= g.r1 && i.row <= g.r2 && i.col >= g.c1 && i.col <= g.c2);
    if (!visible.length) continue;
    const needsGroup = group.minType === 'group' || group.maxType === 'group';
    if (needsGroup) {
      let min = Infinity;
      let max = -Infinity;
      for (const i of group.items) {
        for (const v of sparkValues(doc.wb, doc.activeSheetId, group, i.source).values) {
          if (v === null) continue;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      range = { min, max };
    }
    for (const i of visible) jobs.push({ group, row: i.row, col: i.col, values: sparkValues(doc.wb, doc.activeSheetId, group, i.source).values, range: range ?? { min: 0, max: 1 } });
  }
  return jobs;
}

// ------------------------------------------------------------------------------------------------ small indicators
/** The drop-down arrow of a list validation at the right edge of a cell. */
export function dropdownButtonRect(left: number, top: number, right: number, bottom: number, zoom: number): { x: number; y: number; w: number; h: number } | null {
  const w = Math.round(16 * zoom);
  const h = Math.round(Math.min(bottom - top - 2, 18 * zoom));
  if (right - left < w + 8 || h < 8) return null;
  return { x: right - w, y: top + (bottom - top - h) / 2, w, h };
}

export function drawDropdownButton(ctx: CanvasRenderingContext2D, rc: { x: number; y: number; w: number; h: number }, p: Palette): void {
  ctx.save();
  ctx.fillStyle = p.bg;
  ctx.strokeStyle = p.headerBorder;
  ctx.lineWidth = 1;
  ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
  ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
  ctx.fillStyle = p.headerText;
  const cx = rc.x + rc.w / 2;
  const cy = rc.y + rc.h / 2;
  const s = rc.w * 0.25;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s * 0.4);
  ctx.lineTo(cx + s, cy - s * 0.4);
  ctx.lineTo(cx, cy + s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Does the active cell have a list drop-down to show? */
export function activeListValidation(doc: CalcDoc): boolean {
  if (doc.edit) return false;
  const { row, col } = doc.sel.active;
  const v = doc.sheet.validations.find((x) => x.type === 'list' && x.showDropdown && x.ranges.some((r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2));
  if (!v) return false;
  return listChoices(doc.wb, doc.sheet, v, row, col) !== null;
}

export function drawCommentMarker(ctx: CanvasRenderingContext2D, right: number, top: number, zoom: number): void {
  const s = 7 * zoom;
  ctx.fillStyle = '#d13438';
  ctx.beginPath();
  ctx.moveTo(right - s, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, top + s);
  ctx.closePath();
  ctx.fill();
}

export function drawInvalidCircle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = '#d13438';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2 + 1, h / 2 + 3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The placeholder Excel shows for a pivot table with no fields yet. */
export function drawPivotPlaceholder(ctx: CanvasRenderingContext2D, rc: { x: number; y: number; w: number; h: number }, title: string, lines: string[], p: Palette, zoom: number): void {
  ctx.save();
  ctx.fillStyle = p.bg;
  ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
  ctx.setLineDash([]);
  ctx.fillStyle = p.accent;
  ctx.font = `bold ${12 * zoom}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, rc.x + 8, rc.y + 8);
  ctx.fillStyle = p.headerText;
  ctx.font = `${12 * zoom}px sans-serif`;
  let y = rc.y + 8 + 22 * zoom;
  for (const ln of lines) {
    wrap(ctx, ln, rc.w - 16).forEach((l) => {
      ctx.fillText(l, rc.x + 8, y);
      y += 16 * zoom;
    });
  }
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > width && cur) {
      out.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

void MAX_COLS;
void readRangeValues;
export type { Rect, Scalar };
