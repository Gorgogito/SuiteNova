import { cellsOf, insertRows, originCells, setCellDoc, setColWidth, setRowHeight, updateElement, emptyDocJson, type SlideElement, type TableEl } from '@suitenova/slides-core';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SlidesCtl } from './ctl';
import { cursorAtEnd, editCtxKey, editPlugins, makeState, type EditContext } from './edit/pm';
import type { CanvasCtx } from './render/SlideCanvas';
import { tableLook } from './render/table';

/*
 * What is drawn over a selected table: the selected cells, the grips on the column and row borders, and the editor of the cell
 * being typed in. Positions are measured from the table as drawn (rows grow with their text), in slide points.
 */

interface CellBox {
  r: number;
  c: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geo {
  cells: CellBox[];
  rows: { y: number; h: number }[];
  box: { x: number; y: number; w: number; h: number };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Moves the editing to the next (or previous) cell; Tab in the last one adds a row. */
export function stepCell(ctl: SlidesCtl, el: TableEl, r: number, c: number, dir: 1 | -1, editing = true): void {
  const flat = originCells(el);
  const i = flat.findIndex(([a, b]) => a === r && b === c);
  const n = i + dir;
  if (n < 0) return;
  const go = (id: string, rr: number, cc: number) => (editing ? ctl.beginCellEdit(id, rr, cc) : ctl.selectCells(id, rr, cc));
  if (n >= flat.length) {
    ctl.endEdit();
    ctl.tableApply('Insertar fila', (t) => insertRows(t, t.rows.length));
    const last = (ctl.element(el.id) as TableEl).rows.length - 1;
    go(el.id, last, 0);
    return;
  }
  go(el.id, flat[n]![0], flat[n]![1]);
}

export function TableLayer({ ctl, el, ctx, surface, zoom }: { ctl: SlidesCtl; el: TableEl; ctx: CanvasCtx; surface: React.RefObject<HTMLDivElement | null>; zoom: number }) {
  const [geo, setGeo] = useState<Geo | null>(null);

  useLayoutEffect(() => {
    const sf = surface.current;
    const root = sf?.querySelector<HTMLElement>(`.sl-table[data-id="${el.id}"]`);
    if (!sf || !root) return;
    const sr = sf.getBoundingClientRect();
    const k = zoom || 1;
    const cells: CellBox[] = [...root.querySelectorAll<HTMLElement>('td[data-r]')].map((td) => {
      const b = td.getBoundingClientRect();
      return { r: Number(td.dataset.r), c: Number(td.dataset.c), x: round((b.left - sr.left) / k), y: round((b.top - sr.top) / k), w: round(b.width / k), h: round(b.height / k) };
    });
    const rows = [...root.querySelectorAll<HTMLElement>('tr')].map((tr) => {
      const b = tr.getBoundingClientRect();
      return { y: round((b.top - sr.top) / k), h: round(b.height / k) };
    });
    const tb = root.getBoundingClientRect();
    const next: Geo = { cells, rows, box: { x: round((tb.left - sr.left) / k), y: round((tb.top - sr.top) / k), w: round(tb.width / k), h: round(tb.height / k) } };
    setGeo((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    // rows grow with their text: the model keeps the height the table really has
    if (ctl.editing === el.id || ctl.syncTable === el.id) {
      ctl.syncTable = null;
      let t = el;
      let changed = false;
      rows.forEach((row, i) => {
        if (row.h > (t.rows[i]?.h ?? 0) + 0.6) {
          t = setRowHeight(t, i, round(row.h));
          changed = true;
        }
      });
      if (changed) ctl.liveDeck((d) => updateElement(d, ctl.slide.id, el.id, () => t as SlideElement));
    }
  });

  const cs = ctl.cellSelection;
  const ec = ctl.editingCell;
  if (!geo) return null;
  const sel = cs ? cellsOf(el, cs.range).map(({ r, c }) => geo.cells.find((b) => b.r === r && b.c === c)).filter((b): b is CellBox => !!b) : [];
  const ub = sel.length ? { x: Math.min(...sel.map((b) => b.x)), y: Math.min(...sel.map((b) => b.y)), x2: Math.max(...sel.map((b) => b.x + b.w)), y2: Math.max(...sel.map((b) => b.y + b.h)) } : null;
  const grip = 7 / (zoom || 1);

  const startGrip = (kind: 'col' | 'row', i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const orig = el;
    const sf = surface.current!;
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = sf.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / (zoom || 1), y: (ev.clientY - r.top) / (zoom || 1) };
    };
    const left = geo.box.x + orig.cols.slice(0, i).reduce((a, b) => a + b, 0);
    const top = geo.rows[i]?.y ?? 0;
    ctl.beginGesture(kind === 'col' ? 'Cambiar el ancho de columna' : 'Cambiar el alto de fila');
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      ctl.liveDeck((d) => updateElement(d, ctl.slide.id, el.id, () => (kind === 'col' ? setColWidth(orig, i, p.x - left, !ev.shiftKey) : setRowHeight(orig, i, p.y - top)) as SlideElement));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ctl.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const colX: number[] = [];
  let acc = geo.box.x;
  for (const w of el.cols) {
    acc += w;
    colX.push(acc);
  }

  return (
    <div className="sl-tablelayer" style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }}>
      {ub && !ec && (
        <div className="sl-cellsel" style={{ left: ub.x, top: ub.y, width: ub.x2 - ub.x, height: ub.y2 - ub.y, borderWidth: 2 / (zoom || 1) }} data-testid="cell-selection" data-cells={sel.length} />
      )}
      {!ec &&
        colX.map((x, i) => (
          <div key={`c${i}`} className="sl-grip sl-colgrip" title="Cambiar el ancho de la columna" data-testid={`col-grip-${i}`} style={{ left: x - grip / 2, top: geo.box.y, width: grip, height: geo.box.h }} onPointerDown={startGrip('col', i)} />
        ))}
      {!ec &&
        geo.rows.map((row, i) => (
          <div key={`r${i}`} className="sl-grip sl-rowgrip" title="Cambiar el alto de la fila" data-testid={`row-grip-${i}`} style={{ left: geo.box.x, top: row.y + row.h - grip / 2, width: geo.box.w, height: grip }} onPointerDown={startGrip('row', i)} />
        ))}
      {ec && (() => {
        const o = geo.cells.find((b) => b.r === ec.r && b.c === ec.c);
        return o ? <CellEditor key={`${el.id}:${ec.r}:${ec.c}`} ctl={ctl} el={el} ctx={ctx} r={ec.r} c={ec.c} box={o} /> : null;
      })()}
    </div>
  );
}

/** The ProseMirror editor drawn over a table cell while its text is edited. */
function CellEditor({ ctl, el, ctx, r, c, box }: { ctl: SlidesCtl; el: TableEl; ctx: CanvasCtx; r: number; c: number; box: CellBox }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const look = tableLook(ctx, el)(r, c);
  const cell = el.rows[r]!.cells[c]!;
  const ecx: EditContext = { tc: look.tc, env: ctx.env };
  const ecRef = useRef(ecx);
  ecRef.current = ecx;

  useEffect(() => {
    const view = new EditorView(host.current!, {
      state: makeState(cell.text?.doc ?? emptyDocJson(), editPlugins(() => ecRef.current, ecRef.current)),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const json = next.doc.toJSON();
          ctl.liveDeck((d) => updateElement(d, ctl.slide.id, el.id, (e) => setCellDoc(e as TableEl, r, c, json) as SlideElement));
        } else if (!tr.getMeta(editCtxKey)) ctl.touch();
      },
      handleKeyDown(_v, ev) {
        if (ev.key === 'Tab') {
          ev.preventDefault();
          stepCell(ctl, ctl.element(el.id) as TableEl, r, c, ev.shiftKey ? -1 : 1);
          return true;
        }
        return false;
      },
      attributes: { class: 'sl-pm', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto de la celda' },
    });
    viewRef.current = view;
    ctl.editor = view;
    const at = ctl.caretAt;
    const pos = at ? view.posAtCoords({ left: at.x, top: at.y })?.pos : undefined;
    view.dispatch(pos !== undefined ? view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))) : cursorAtEnd(view.state.tr));
    view.focus();
    return () => {
      if (ctl.editor === view) ctl.editor = null;
      view.destroy();
      viewRef.current = null;
    };
  }, [el.id, r, c]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const v = viewRef.current;
    if (v) v.dispatch(v.state.tr.setMeta(editCtxKey, { ctx: ecx }));
  });

  const anchor = cell.anchor === 'ctr' ? 'center' : cell.anchor === 'b' ? 'flex-end' : 'flex-start';
  return (
    <div className="sl-edit-wrap sl-celledit" data-editing={el.id} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, background: look.bg ?? '#fff', display: 'flex', flexDirection: 'column', justifyContent: anchor, boxSizing: 'border-box', padding: look.td.padding, pointerEvents: 'auto' }}>
      <div ref={host} className="sl-text sl-edit" style={{ width: '100%' }} />
    </div>
  );
}
