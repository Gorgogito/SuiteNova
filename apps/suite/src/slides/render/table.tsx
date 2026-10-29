import { clrCss, knownTableStyle, textContext, tableStyleFor, type Fill, type ListStyle, type Ln, type TableEl, type TableStyleDef, type TableStylePart, type TextContext } from '@suitenova/slides-core';
import type { CSSProperties } from 'react';
import { xfOf, type CanvasCtx } from './SlideCanvas';
import { paintFor, withPh } from './paint';
import { TextView } from './TextView';

/** "Medium Style 2 – Accent 1", the style PowerPoint gives new tables, used when a table names a style the file does not define. */
export const mediumStyle = (accent: string): TableStyleDef => tableStyleFor('medium2', Number(accent.replace('accent', '')) || 1);

const MEDIUM2: Record<string, string> = { accent1: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', accent2: '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}', accent3: '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}', accent4: '{00A15C55-8517-42AA-B614-E9B94910E393}', accent5: '{7DF18680-E054-41AD-8BC1-D1AEF772440D}', accent6: '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}' };
const NO_STYLE: TableStyleDef = { id: 'none', name: 'Sin estilo' };

export function styleOf(ctx: CanvasCtx, el: TableEl): TableStyleDef {
  const id = el.styleId ?? ctx.deck.defaultTableStyle;
  const found = ctx.deck.tableStyles?.find((s) => s.id === id);
  if (found) return found;
  const own = knownTableStyle(id);
  if (own) return own;
  if (id === '{2D5ABB26-0587-4C30-8999-92F81FD0307C}' || id === '{5940675A-B579-460E-94D1-54222C63F5DA}') return NO_STYLE;
  const accent = Object.entries(MEDIUM2).find(([, g]) => g === id)?.[0] ?? 'accent1';
  return mediumStyle(accent);
}

export function parts(style: TableStyleDef, el: TableEl, r: number, c: number, rows: number, cols: number): TableStylePart[] {
  const out: TableStylePart[] = [];
  if (style.wholeTbl) out.push(style.wholeTbl);
  const body0 = el.firstRow ? 1 : 0;
  if (el.bandRow && r >= body0) {
    const band = (r - body0) % 2 === 0 ? style.band1H : style.band2H;
    if (band) out.push(band);
  }
  if (el.bandCol) {
    const c0 = el.firstCol ? 1 : 0;
    if (c >= c0) {
      const band = (c - c0) % 2 === 0 ? style.band1V : style.band2V;
      if (band) out.push(band);
    }
  }
  if (el.firstCol && c === 0 && style.firstCol) out.push(style.firstCol);
  if (el.lastCol && c === cols - 1 && style.lastCol) out.push(style.lastCol);
  if (el.firstRow && r === 0 && style.firstRow) out.push(style.firstRow);
  if (el.lastRow && r === rows - 1 && style.lastRow) out.push(style.lastRow);
  if (el.firstRow && r === 0 && el.firstCol && c === 0 && style.nwCell) out.push(style.nwCell);
  if (el.firstRow && r === 0 && el.lastCol && c === cols - 1 && style.neCell) out.push(style.neCell);
  if (el.lastRow && r === rows - 1 && el.firstCol && c === 0 && style.swCell) out.push(style.swCell);
  if (el.lastRow && r === rows - 1 && el.lastCol && c === cols - 1 && style.seCell) out.push(style.seCell);
  return out;
}

/** How the cells of a table look: fill, borders (table style first, the cell's own on top) and the text context. */
export function tableLook(ctx: CanvasCtx, el: TableEl) {
  const { deck, env } = ctx;
  const style = styleOf(ctx, el);
  const rows = el.rows.length;
  const cols = el.cols.length;
  const dummy = { kind: 'shape' as const, id: el.id };
  const baseTc = textContext(deck, ctx.chain, dummy, false);
  const cellCss = (ln: Ln | undefined): string | undefined => {
    if (!ln || !ln.fill || ln.fill.t === 'none') return undefined;
    if (ln.fill.t !== 'solid') return undefined;
    return `${Math.max(0.5, ln.w ?? 0.75)}px solid ${clrCss(ln.fill.c, env.cc)}`;
  };
  const fillCss = (f: Fill | undefined): string | undefined => {
    if (!f || f.t === 'none') return undefined;
    if (f.t === 'solid') return clrCss(f.c, env.cc);
    const p = paintFor(f, 'tbl', 10, 10, env);
    void p;
    return undefined;
  };
  return (r: number, c: number): { td: CSSProperties; tc: TextContext; bg?: string } => {
    const cell = el.rows[r]!.cells[c]!;
    const ps = parts(style, el, r, c, rows, cols);
    let fill: Fill | undefined;
    let rPr: Record<string, unknown> = {};
    const borders: { l?: Ln; r?: Ln; t?: Ln; b?: Ln } = {};
    // a merged cell reaches the table's edge through its far side
    const first = c === 0;
    const last = c + (cell.gridSpan ?? 1) - 1 === cols - 1;
    const top = r === 0;
    const bottom = r + (cell.rowSpan ?? 1) - 1 === rows - 1;
    for (const p of ps) {
      if (p.fill) fill = p.fill;
      if (p.rPr) rPr = { ...rPr, ...p.rPr };
      if (p.ln) {
        if (p.ln.l && first) borders.l = p.ln.l;
        if (p.ln.r && last) borders.r = p.ln.r;
        if (p.ln.t && top) borders.t = p.ln.t;
        if (p.ln.b && bottom) borders.b = p.ln.b;
        if (p.ln.insideV) {
          if (!first) borders.l = p.ln.insideV;
          if (!last) borders.r = p.ln.insideV;
        }
        if (p.ln.insideH) {
          if (!top) borders.t = p.ln.insideH;
          if (!bottom) borders.b = p.ln.insideH;
        }
        // a part that gives its own edge (header's bottom, last row's top)
        if (p.ln.b && !bottom && !p.ln.insideH) borders.b = p.ln.b;
        if (p.ln.t && !top && !p.ln.insideH) borders.t = p.ln.t;
      }
    }
    if (cell.fill) fill = cell.fill;
    if (cell.lnL) borders.l = cell.lnL;
    if (cell.lnR) borders.r = cell.lnR;
    if (cell.lnT) borders.t = cell.lnT;
    if (cell.lnB) borders.b = cell.lnB;
    const tc: TextContext = { ...baseTc, lists: [...baseTc.lists, { def: { rPr: rPr as never } } as ListStyle, cell.text?.lst], body: cell.text?.body ?? {} };
    const bg = fillCss(fill);
    const td: CSSProperties = {
      background: bg,
      borderLeft: cellCss(borders.l),
      borderRight: cellCss(borders.r),
      borderTop: cellCss(borders.t),
      borderBottom: cellCss(borders.b),
      padding: `${cell.marT ?? 3.6}px ${cell.marR ?? 7.2}px ${cell.marB ?? 3.6}px ${cell.marL ?? 7.2}px`,
      verticalAlign: cell.anchor === 'ctr' ? 'middle' : cell.anchor === 'b' ? 'bottom' : 'top',
      overflow: 'hidden',
      wordBreak: 'break-word',
    };
    return { td, tc, bg };
  };
}

export function TableView({ el, ctx }: { el: TableEl; ctx: CanvasCtx }) {
  const { env } = ctx;
  const x = xfOf(ctx, el);
  const width = el.cols.reduce((a, b) => a + b, 0);
  const look = tableLook(ctx, el);
  // the seams between cells (fractional borders) show the table's own colour, not what is behind it
  const wf = styleOf(ctx, el).wholeTbl?.fill;
  const seam = wf && wf.t === 'solid' ? clrCss(wf.c, env.cc) : undefined;
  const ec = ctx.editingCell && ctx.editingCell.id === el.id ? ctx.editingCell : null;
  void withPh;
  return (
    <div className="sl-el sl-table" data-id={el.id} style={{ position: 'absolute', left: x.x, top: x.y, width }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width, borderSpacing: 0, background: seam }}>
        <colgroup>
          {el.cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {el.rows.map((row, r) => (
            <tr key={r} data-r={r} style={{ height: row.h }}>
              {row.cells.map((cell, c) => {
                if (cell.hMerge || cell.vMerge) return null;
                const { td, tc } = look(r, c);
                const hide = !!ec && ec.r === r && ec.c === c;
                return (
                  <td key={c} data-r={r} data-c={c} colSpan={cell.gridSpan} rowSpan={cell.rowSpan} style={td}>
                    {cell.text && (hide ? <div style={{ visibility: 'hidden' }}><TextView tb={cell.text} tc={tc} env={env} /></div> : <TextView tb={cell.text} tc={tc} env={env} />)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
