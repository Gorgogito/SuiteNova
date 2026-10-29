import { CFEvaluator, colToName, colAtPx, colOffsetPx, normRect, rowAtPx, rowOffsetPx, tableAt, type FormulaLocale, type PageSetup, type Rect, type Sheet, type Style } from '@suitenova/calc-engine';
import type { CalcDoc } from './doc';
import { chartSvg } from './chartRender';
import { sparkSvg, sparklineJobs, tableFillAt, tableTextLook } from './render-objects';

export type PrintScope = 'sheet' | 'selection' | 'workbook';

const PAPER_MM: Record<PageSetup['paper'], [number, number]> = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
export const mmToPx = (mm: number): number => (mm * 96) / 25.4;
export const cmToPx = (cm: number): number => mmToPx(cm * 10);

export interface PrintPage {
  sheetId: number;
  /** Visible rows and columns on the page (title rows/columns first). */
  rows: number[];
  cols: number[];
  scale: number;
  area: Rect;
  /** Position of the page among all pages, from 1. */
  number: number;
}

export interface PrintLayout {
  pages: PrintPage[];
  paperW: number;
  paperH: number;
  /** Why nothing is printed, when it is empty. */
  empty?: string;
}

/** The cells a sheet prints when no print area is set: everything with content, plus pictures and charts. */
export function usedPrintArea(doc: CalcDoc, sheetId: number): Rect | null {
  const sheet = doc.wb.sheet(sheetId);
  const used = doc.wb.usedRange(sheetId);
  let r2 = used?.r2 ?? -1;
  let c2 = used?.c2 ?? -1;
  const reach = (x: number, y: number, w: number, h: number) => {
    r2 = Math.max(r2, rowAtPx(sheet, y + h).row);
    c2 = Math.max(c2, colAtPx(sheet, x + w).col);
  };
  for (const c of sheet.charts) reach(c.x, c.y, c.width, c.height);
  for (const i of sheet.images) reach(i.x, i.y, i.width, i.height);
  for (const s of sheet.slicers) reach(s.x, s.y, s.width, s.height);
  if (r2 < 0 || c2 < 0) return null;
  return { r1: used?.r1 ?? 0, c1: used?.c1 ?? 0, r2, c2 };
}

const visibleRows = (sheet: Sheet, r1: number, r2: number): number[] => {
  const out: number[] = [];
  for (let r = r1; r <= r2; r++) if (!sheet.hiddenRows.has(r) && !sheet.filterHidden.has(r)) out.push(r);
  return out;
};
const visibleCols = (sheet: Sheet, c1: number, c2: number): number[] => {
  const out: number[] = [];
  for (let c = c1; c <= c2; c++) if (!sheet.hiddenCols.has(c)) out.push(c);
  return out;
};

/** Cut a list of sizes into blocks that fit `avail`, honouring forced breaks (after the given indices) and repeated titles. */
function blocks(items: number[], size: (i: number) => number, avail: number, breaksAfter: Set<number>, titles: number[], titleSize: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  const titleSet = new Set(titles);
  for (const it of items) {
    const s = size(it);
    if (cur.length && used + s > avail + 0.5) {
      out.push(cur);
      cur = [];
      used = titleSize;
    }
    cur.push(it);
    used += s;
    if (breaksAfter.has(it)) {
      out.push(cur);
      cur = [];
      used = titleSize;
    }
  }
  if (cur.length) out.push(cur);
  // a block that starts after the titles gets them in front
  return out.map((blk, i) => (i > 0 && titles.length && !titleSet.has(blk[0]!) && blk[0]! > titles[titles.length - 1]! ? [...titles, ...blk] : blk));
}

export function layoutPrint(doc: CalcDoc, scope: PrintScope): PrintLayout {
  const sheets = scope === 'workbook' ? doc.wb.sheets : [doc.sheet];
  const pages: PrintPage[] = [];
  const first = doc.sheet.print.page;
  const [pwMm, phMm] = PAPER_MM[first.paper];
  const landscape = first.orientation === 'landscape';
  const paperW = mmToPx(landscape ? phMm : pwMm);
  const paperH = mmToPx(landscape ? pwMm : phMm);
  for (const sheet of sheets) {
    const pr = sheet.print;
    const g = pr.page;
    const [aw, ah] = PAPER_MM[g.paper];
    const W = mmToPx(g.orientation === 'landscape' ? ah : aw);
    const H = mmToPx(g.orientation === 'landscape' ? aw : ah);
    const contentW = W - cmToPx(g.margins.left + g.margins.right);
    const contentH = H - cmToPx(g.margins.top + g.margins.bottom);
    let areas: Rect[];
    if (scope === 'selection' && sheet.id === doc.activeSheetId) areas = doc.sel.ranges.map((r) => normRect(r));
    else if (pr.areas.length) areas = pr.areas.map((r) => normRect(r));
    else {
      const used = usedPrintArea(doc, sheet.id);
      areas = used ? [used] : [];
    }
    const colW = (c: number) => doc.wb.colWidth(sheet.id, c);
    const rowH = (r: number) => doc.wb.rowHeight(sheet.id, r);
    const titleRows = pr.titleRows ? visibleRows(sheet, pr.titleRows.r1, pr.titleRows.r2) : [];
    const titleCols = pr.titleCols ? visibleCols(sheet, pr.titleCols.c1, pr.titleCols.c2) : [];
    for (const area of areas) {
      const rows = visibleRows(sheet, area.r1, area.r2);
      const cols = visibleCols(sheet, area.c1, area.c2);
      if (!rows.length || !cols.length) continue;
      const totalW = cols.reduce((a, c) => a + colW(c), 0);
      const totalH = rows.reduce((a, r) => a + rowH(r), 0);
      let scale = g.scale / 100;
      if (g.fitWidth > 0 || g.fitHeight > 0) {
        scale = 1;
        if (g.fitWidth > 0) scale = Math.min(scale, (contentW * g.fitWidth) / totalW);
        if (g.fitHeight > 0) scale = Math.min(scale, (contentH * g.fitHeight) / totalH);
        scale = Math.max(0.1, scale);
      }
      const titleH = titleRows.reduce((a, r) => a + rowH(r), 0);
      const titleW = titleCols.reduce((a, c) => a + colW(c), 0);
      const rowBlocks = blocks(rows, rowH, contentH / scale, new Set(pr.rowBreaks), titleRows, titleH);
      const colBlocks = blocks(cols, colW, contentW / scale, new Set(pr.colBreaks), titleCols, titleW);
      for (const cb of colBlocks) {
        for (const rb of rowBlocks) pages.push({ sheetId: sheet.id, rows: rb, cols: cb, scale, area, number: pages.length + 1 });
      }
    }
  }
  return { pages, paperW, paperH, empty: pages.length ? undefined : 'No hay nada que imprimir: la hoja está vacía.' };
}

// ------------------------------------------------------------------------------------------------ HTML
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
const BORDER: Record<string, string> = { thin: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', dotted: '1px dotted', double: '3px double', hair: '1px dotted' };

function cssOf(style: Style, fill: string | undefined, defFont: { name: string; size: number }): string {
  const out: string[] = [];
  const size = (style.fontSize ?? defFont.size) * (96 / 72);
  out.push(`font:${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size.toFixed(1)}px '${style.fontName ?? defFont.name}',Calibri,Carlito,'Segoe UI',Arial,sans-serif`);
  if (style.color) out.push(`color:${style.color}`);
  const bg = style.bg ?? fill;
  if (bg) out.push(`background:${bg}`);
  const deco = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) out.push(`text-decoration:${deco}`);
  for (const [side, b] of [['top', style.top], ['right', style.right], ['bottom', style.bottom], ['left', style.left]] as const) {
    if (b) out.push(`border-${side}:${BORDER[b.style] ?? '1px solid'} ${b.color ?? '#000'}`);
  }
  if (style.vAlign === 'top') out.push('align-items:flex-start');
  else if (style.vAlign === 'middle') out.push('align-items:center');
  else out.push('align-items:flex-end');
  if (style.indent) out.push(`padding-left:${3 + style.indent * 9}px`);
  return out.join(';');
}

/** Replace the codes of a header or footer: &P page, &N pages, &D date, &T time, &F file, &A sheet. */
export function headerFooterParts(text: string | undefined, ctx: { page: number; pages: number; file: string; sheet: string; now: Date; locale: FormulaLocale }): { left: string; center: string; right: string } {
  const out = { left: '', center: '', right: '' };
  if (!text) return out;
  let sec: 'left' | 'center' | 'right' = 'center';
  const date = ctx.now.toLocaleDateString(ctx.locale === 'es' ? 'es-ES' : 'en-US');
  const time = ctx.now.toLocaleTimeString(ctx.locale === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '&') {
      out[sec] += ch;
      continue;
    }
    const nx = text[++i];
    if (nx === undefined) break;
    switch (nx.toUpperCase()) {
      case 'L':
        sec = 'left';
        break;
      case 'C':
        sec = 'center';
        break;
      case 'R':
        sec = 'right';
        break;
      case 'P':
        out[sec] += String(ctx.page);
        break;
      case 'N':
        out[sec] += String(ctx.pages);
        break;
      case 'D':
        out[sec] += date;
        break;
      case 'T':
        out[sec] += time;
        break;
      case 'F':
        out[sec] += ctx.file;
        break;
      case 'A':
        out[sec] += ctx.sheet;
        break;
      case '&':
        out[sec] += '&';
        break;
      case '"': {
        const end = text.indexOf('"', i + 1);
        i = end < 0 ? text.length : end;
        break;
      }
      default:
        // font size (&12) and the &B &I &U toggles are not reproduced
        if (/\d/.test(nx)) while (/\d/.test(text[i + 1] ?? '')) i++;
    }
  }
  return out;
}

const ICON_GLYPH: Record<string, string[]> = {
  arrows: ['▼', '►', '▲'],
};

interface HtmlOptions {
  doc: CalcDoc;
  layout: PrintLayout;
}

function pageHtml(o: HtmlOptions, p: PrintPage, total: number): string {
  const { doc } = o;
  const wb = doc.wb;
  const sheet = wb.sheet(p.sheetId);
  const g = sheet.print.page;
  const colW = (c: number) => wb.colWidth(p.sheetId, c);
  const rowH = (r: number) => wb.rowHeight(p.sheetId, r);
  const xs = new Map<number, number>();
  const ys = new Map<number, number>();
  let x = 0;
  for (const c of p.cols) {
    xs.set(c, x);
    x += colW(c);
  }
  let y = 0;
  for (const r of p.rows) {
    ys.set(r, y);
    y += rowH(r);
  }
  const usedW = x;
  const usedH = y;
  const [aw, ah] = PAPER_MM[g.paper];
  const W = mmToPx(g.orientation === 'landscape' ? ah : aw);
  const H = mmToPx(g.orientation === 'landscape' ? aw : ah);
  const mL = cmToPx(g.margins.left);
  const mT = cmToPx(g.margins.top);
  const contentW = W - mL - cmToPx(g.margins.right);
  const contentH = H - mT - cmToPx(g.margins.bottom);
  const offX = g.centerH ? Math.max(0, (contentW / p.scale - usedW) / 2) : 0;
  const offY = g.centerV ? Math.max(0, (contentH / p.scale - usedH) / 2) : 0;
  const cf = sheet.condFormats.length ? new CFEvaluator(wb, p.sheetId) : null;
  const merges = new Map<number, Rect>();
  const covered = new Set<number>();
  for (const m of sheet.merges) {
    merges.set(m.r1 * 16384 + m.c1, m);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(r * 16384 + c);
  }
  const parts: string[] = [];
  const colSet = new Set(p.cols);
  const heads = g.headings;
  const headW = heads ? 28 : 0;
  const headH = heads ? 18 : 0;
  const defFont = wb.defaultFont;

  for (const r of p.rows) {
    for (const c of p.cols) {
      const key = r * 16384 + c;
      if (covered.has(key)) continue;
      const cell = sheet.cells.get(key);
      const m = merges.get(key);
      const table = sheet.tables.length ? tableAt(sheet, r, c) : undefined;
      const fill = table ? tableFillAt(table, r, c) : undefined;
      if (!cell && !fill && !m && !g.gridlines) continue;
      const res = cf ? cf.forCell(r, c) : null;
      let style: Style = wb.styles.get(cell?.style ?? 0);
      if (res?.format) {
        const f = res.format;
        style = { ...style, ...(f.color ? { color: f.color } : {}), ...(f.bold ? { bold: true } : {}), ...(f.italic ? { italic: true } : {}), ...(f.underline ? { underline: true } : {}), ...(f.strike ? { strike: true } : {}), ...(f.bg ? { bg: f.bg } : {}) };
      }
      if (res?.scaleBg) style = { ...style, bg: res.scaleBg };
      const tl = table ? tableTextLook(doc, r, c) : undefined;
      if (tl) style = { ...style, ...(tl.bold ? { bold: true } : {}), ...(tl.fg && !style.color ? { color: tl.fg } : {}) };
      const d = cell ? doc.display(p.sheetId, r, c) : null;
      let w = colW(c);
      let h = rowH(r);
      if (m) {
        w = 0;
        h = 0;
        for (const cc of p.cols) if (cc >= m.c1 && cc <= m.c2) w += colW(cc);
        for (const rr of p.rows) if (rr >= m.r1 && rr <= m.r2) h += rowH(rr);
      }
      const isNum = typeof d?.value === 'number';
      const align = style.hAlign && style.hAlign !== 'general' ? style.hAlign : isNum ? 'right' : typeof d?.value === 'boolean' ? 'center' : 'left';
      // text spills over empty cells to its right
      if (!m && d && d.text !== '' && !isNum && !style.wrap && align === 'left') {
        let cc = c + 1;
        while (colSet.has(cc) && !sheet.cells.get(r * 16384 + cc)?.value && !sheet.cells.get(r * 16384 + cc)?.formula && w < d.text.length * 8) {
          w += colW(cc);
          cc++;
        }
      }
      const css = cssOf(style, fill, defFont);
      let inner = d?.text ?? '';
      if (res?.hideValue) inner = '';
      if (res?.icon) {
        const set = res.icon.set;
        const glyph = set.endsWith('Arrows') ? ['▼', '◥', '►', '◢', '▲'][Math.round((res.icon.index / Math.max(1, res.icon.count - 1)) * 4)] : set === '3Flags' ? '⚑' : '●';
        const t = res.icon.count <= 1 ? 1 : res.icon.index / (res.icon.count - 1);
        const color = t < 0.34 ? '#d64541' : t < 0.67 ? '#ebb428' : '#40a05a';
        inner = `<span style="color:${color};margin-right:3px">${glyph}</span>${esc(inner)}`;
      } else inner = esc(inner);
      const bar = res?.bar ? `<i style="position:absolute;left:2px;top:2px;bottom:2px;width:${Math.max(2, (w - 4) * res.bar.fraction).toFixed(1)}px;background:${res.bar.color};opacity:.55"></i>` : '';
      const grid = g.gridlines ? 'outline:1px solid #d4d4d4;outline-offset:-1px;' : '';
      const jc = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
      const wrap = style.wrap && !isNum ? 'white-space:pre-wrap;word-break:break-word' : 'white-space:nowrap';
      parts.push(
        `<div class="c" style="left:${headW + offX + xs.get(c)!}px;top:${headH + offY + ys.get(r)!}px;width:${w}px;height:${h}px;${grid}${css};justify-content:${jc};text-align:${align}">${bar}<span style="${wrap};overflow:hidden;max-width:100%;position:relative">${inner}</span></div>`,
      );
    }
  }
  // sparklines
  if (sheet.sparklines.length) {
    const rowSet = new Set(p.rows);
    for (const job of sparklineJobs(doc, { r1: Math.min(...p.rows), r2: Math.max(...p.rows), c1: Math.min(...p.cols), c2: Math.max(...p.cols), x: 0, y: 0, w: 0, h: 0 })) {
      if (!rowSet.has(job.row) || !colSet.has(job.col)) continue;
      const w = colW(job.col);
      const h = rowH(job.row);
      parts.push(`<div class="c" style="left:${headW + offX + xs.get(job.col)!}px;top:${headH + offY + ys.get(job.row)!}px;width:${w}px;height:${h}px">${sparkSvg(job.group, job.values, w, h, job.range)}</div>`);
    }
  }
  // headings
  if (heads) {
    for (const c of p.cols) parts.push(`<div class="hd" style="left:${headW + offX + xs.get(c)!}px;top:0;width:${colW(c)}px;height:${headH}px">${colToName(c)}</div>`);
    for (const r of p.rows) parts.push(`<div class="hd" style="left:0;top:${headH + offY + ys.get(r)!}px;width:${headW}px;height:${rowH(r)}px">${r + 1}</div>`);
  }
  // pictures, charts and slicers that start on this page
  const firstCol = p.cols.find((c) => !(sheet.print.titleCols && c >= sheet.print.titleCols.c1 && c <= sheet.print.titleCols.c2)) ?? p.cols[0]!;
  const firstRow = p.rows.find((r) => !(sheet.print.titleRows && r >= sheet.print.titleRows.r1 && r <= sheet.print.titleRows.r2)) ?? p.rows[0]!;
  const originX = colOffsetPx(sheet, firstCol) - (xs.get(firstCol) ?? 0);
  const originY = rowOffsetPx(sheet, firstRow) - (ys.get(firstRow) ?? 0);
  const lastCol = p.cols[p.cols.length - 1]!;
  const lastRow = p.rows[p.rows.length - 1]!;
  const onPage = (ox: number, oy: number) => {
    const c = colAtPx(sheet, ox).col;
    const r = rowAtPx(sheet, oy).row;
    return c >= firstCol && c <= lastCol && r >= firstRow && r <= lastRow && p.area.r1 <= r && r <= p.area.r2 && p.area.c1 <= c && c <= p.area.c2;
  };
  const palette = { text: '#333333', grid: '#dddddd', bg: '#ffffff' };
  for (const ch of sheet.charts) {
    if (!onPage(ch.x, ch.y)) continue;
    parts.push(`<div class="o" style="left:${headW + offX + ch.x - originX}px;top:${headH + offY + ch.y - originY}px;width:${ch.width}px;height:${ch.height}px">${chartSvg(ch, wb, p.sheetId, doc.locale, palette, ch.width, ch.height)}</div>`);
  }
  for (const im of sheet.images) {
    if (!onPage(im.x, im.y)) continue;
    const m = wb.media.get(im.media);
    if (!m) continue;
    parts.push(`<img class="o" alt="${esc(im.alt ?? '')}" src="data:${m.mime};base64,${toBase64(m.data)}" style="left:${headW + offX + im.x - originX}px;top:${headH + offY + im.y - originY}px;width:${im.width}px;height:${im.height}px">`);
  }
  for (const sl of sheet.slicers) {
    if (!onPage(sl.x, sl.y)) continue;
    const items = wb.slicerItems(sl);
    parts.push(
      `<div class="o sl" style="left:${headW + offX + sl.x - originX}px;top:${headH + offY + sl.y - originY}px;width:${sl.width}px;height:${sl.height}px"><b>${esc(sl.caption)}</b>${items
        .map((i) => `<span class="${sl.selected === null || i.selected ? 'on' : ''}">${esc(i.label)}</span>`)
        .join('')}</div>`,
    );
  }

  const hfCtx = { page: p.number, pages: total, file: doc.fileName ?? 'Libro1', sheet: sheet.name, now: new Date(), locale: doc.locale };
  const hdr = headerFooterParts(g.header, hfCtx);
  const ftr = headerFooterParts(g.footer, hfCtx);
  const band = (pos: 'top' | 'bottom', h: { left: string; center: string; right: string }) =>
    h.left || h.center || h.right ? `<div class="hf ${pos}" style="${pos}:${cmToPx(0.7)}px;left:${mL}px;right:${W - mL - contentW}px"><span>${esc(h.left)}</span><span>${esc(h.center)}</span><span>${esc(h.right)}</span></div>` : '';
  return (
    `<section class="page" style="width:${W}px;height:${H}px">${band('top', hdr)}` +
    `<div class="body" style="left:${mL}px;top:${mT}px;width:${contentW}px;height:${contentH}px"><div class="sheet" style="width:${contentW / p.scale}px;height:${contentH / p.scale}px;transform:scale(${p.scale})">${parts.join('')}</div></div>` +
    `${band('bottom', ftr)}</section>`
  );
}

function toBase64(data: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(s);
}

/** A complete HTML document with one `section.page` per printed page (also used by the preview). */
export function printHtml(doc: CalcDoc, scope: PrintScope): { html: string; layout: PrintLayout } {
  const layout = layoutPrint(doc, scope);
  const g = doc.sheet.print.page;
  const total = layout.pages.length;
  const pages = layout.pages.map((p) => pageHtml({ doc, layout }, p, total)).join('');
  const html =
    `<!doctype html><html lang="${doc.locale}"><head><meta charset="utf-8"><title>${esc(doc.fileName ?? 'Libro1')}</title><style>` +
    `@page{size:${g.paper === 'Letter' ? 'letter' : g.paper === 'Legal' ? 'legal' : g.paper} ${g.orientation};margin:0}` +
    `*{box-sizing:border-box}body{margin:0;font-family:Calibri,Carlito,'Segoe UI',sans-serif}` +
    `.page{position:relative;overflow:hidden;background:#fff;page-break-after:always;break-after:page}` +
    `.body{position:absolute;overflow:hidden}.sheet{position:relative;transform-origin:0 0}` +
    `.c{position:absolute;display:flex;overflow:hidden;padding:0 3px;line-height:1.2;color:#000}` +
    `.hd{position:absolute;display:flex;align-items:center;justify-content:center;background:#f3f3f3;border:1px solid #c8c8c8;font:11px sans-serif;color:#444}` +
    `.o{position:absolute}.sl{border:1px solid #888;background:#fff;font:12px sans-serif;display:flex;flex-direction:column;gap:2px;padding:4px;overflow:hidden}.sl span{padding:2px 6px;border:1px solid #bbb}.sl span.on{background:#cfe3f4}` +
    `.hf{position:absolute;display:flex;justify-content:space-between;font:11px sans-serif;color:#333}` +
    `@media screen{body{background:#8a8a8a;padding:12px}.page{margin:0 auto 14px;box-shadow:0 2px 8px rgba(0,0,0,.5)}}` +
    `@media print{body{background:#fff}.page{margin:0;box-shadow:none}}` +
    `</style></head><body>${pages}</body></html>`;
  return { html, layout };
}

export function sheetPrintsNothing(doc: CalcDoc): boolean {
  return layoutPrint(doc, 'sheet').pages.length === 0;
}

void ICON_GLYPH;
