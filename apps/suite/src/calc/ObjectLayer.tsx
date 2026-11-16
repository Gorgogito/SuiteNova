import { adjustHandles, dragAdjust, isLineKind, shapeSvg } from '@suitenova/shapes-core';
import { listChoices, moveShapes, rotateShapes, scaleShapes, shapeLook, shapesBounds, type ShapePatch, type SheetImage, type SheetShape, type SlicerDef } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { Check, FilterX, ListChecks } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CalcDoc } from './doc';
import { colX, screenX, screenY, type Layout, type Viewport } from './render';

interface Rect4 {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const urls = new Map<string, string>();
/** A blob address for a picture of the workbook (kept for the life of the page). */
function mediaUrl(doc: CalcDoc, key: string): string | undefined {
  let u = urls.get(key);
  if (u) return u;
  const m = doc.wb.media.get(key);
  if (!m) return undefined;
  u = URL.createObjectURL(new Blob([m.data as BlobPart], { type: m.mime }));
  urls.set(key, u);
  return u;
}

/** Drag/resize behaviour shared by pictures and slicers. */
function useBox(doc: CalcDoc, zoom: number, min: { w: number; h: number }, commit: (id: string, r: Rect4, label: string) => void, select: (id: string) => void) {
  const [preview, setPreview] = useState<{ id: string; r: Rect4 } | null>(null);
  const begin = (id: string, orig: Rect4, e: React.PointerEvent, mode: Handle | 'move', keepRatio = false, rotation = 0) => {
    const rad = (rotation * Math.PI) / 180;
    if (e.button !== 0) return;
    e.stopPropagation();
    doc.commitIfEditing();
    select(id);
    const start = { x: e.clientX, y: e.clientY };
    let latest = orig;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const sx = (ev.clientX - start.x) / zoom;
      const sy = (ev.clientY - start.y) / zoom;
      // al cambiar el tamaño de una forma girada, el gesto se lee en los ejes de la forma
      const turn = mode !== 'move' && rotation !== 0;
      const dx = turn ? sx * Math.cos(rad) + sy * Math.sin(rad) : sx;
      const dy = turn ? -sx * Math.sin(rad) + sy * Math.cos(rad) : sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      let { x, y, width, height } = orig;
      if (mode === 'move') {
        x = Math.max(0, orig.x + dx);
        y = Math.max(0, orig.y + dy);
      } else {
        if (mode.includes('e')) width = Math.max(min.w, orig.width + dx);
        if (mode.includes('s')) height = Math.max(min.h, orig.height + dy);
        if (mode.includes('w')) {
          width = Math.max(min.w, orig.width - dx);
          x = Math.max(0, orig.x + orig.width - width);
        }
        if (mode.includes('n')) {
          height = Math.max(min.h, orig.height - dy);
          y = Math.max(0, orig.y + orig.height - height);
        }
        if (keepRatio && (mode === 'nw' || mode === 'ne' || mode === 'sw' || mode === 'se')) {
          const ratio = orig.width / orig.height;
          height = width / ratio;
          if (mode.includes('n')) y = orig.y + orig.height - height;
        }
      }
      if (turn) {
        // el lado opuesto al asa se queda donde está en la pantalla: el centro se mueve girado
        const cdx = x + width / 2 - (orig.x + orig.width / 2);
        const cdy = y + height / 2 - (orig.y + orig.height / 2);
        const cx = orig.x + orig.width / 2 + cdx * Math.cos(rad) - cdy * Math.sin(rad);
        const cy = orig.y + orig.height / 2 + cdx * Math.sin(rad) + cdy * Math.cos(rad);
        x = cx - width / 2;
        y = cy - height / 2;
      }
      latest = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
      setPreview({ id, r: latest });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      if (moved) commit(id, latest, mode === 'move' ? 'Mover' : 'Cambiar tamaño');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { preview, begin };
}

function Handles({ onDown }: { onDown: (e: React.PointerEvent, h: Handle) => void }) {
  return (
    <>
      {HANDLES.map((h) => (
        <span
          key={h}
          className={`calc-chart__handle calc-chart__handle--${h}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onDown(e, h);
          }}
        />
      ))}
    </>
  );
}

function SlicerView({ doc, sl, rect, selected, onDown }: { doc: CalcDoc; sl: SlicerDef; rect: { x: number; y: number; w: number; h: number }; selected: boolean; onDown: (e: React.PointerEvent, m: Handle | 'move') => void }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const [multi, setMulti] = useState(false);
  const items = doc.wb.slicerItems(sl);
  const allOn = sl.selected === null;
  const toggle = (key: string, ctrl: boolean) => {
    if (multi || ctrl) {
      const current = allOn ? items.map((i) => i.key) : [...(sl.selected ?? [])];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      doc.x.setSlicer(sl.id, next.length === items.length ? null : next);
    } else if (sl.selected && sl.selected.length === 1 && sl.selected[0] === key) doc.x.setSlicer(sl.id, null);
    else doc.x.setSlicer(sl.id, [key]);
  };
  return (
    <div className={`calc-slicer ${selected ? 'is-selected' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} onPointerDown={(e) => onDown(e, 'move')} role="group" aria-label={t('Segmentación {name}', { name: sl.caption })} data-slicer-id={sl.id}>
      <div className="calc-slicer__head">
        <strong>{sl.caption}</strong>
        <span>
          <button type="button" className={multi ? 'is-on' : ''} aria-pressed={multi} title={t('Selección múltiple')} aria-label={t('Selección múltiple')} onPointerDown={(e) => e.stopPropagation()} onClick={() => setMulti(!multi)}>
            <ListChecks size={14} />
          </button>
          <button type="button" disabled={allOn} title={t('Borrar filtro')} aria-label={t('Borrar filtro')} onPointerDown={(e) => e.stopPropagation()} onClick={() => doc.x.setSlicer(sl.id, null)}>
            <FilterX size={14} />
          </button>
        </span>
      </div>
      <div className="calc-slicer__items" style={{ gridTemplateColumns: `repeat(${Math.max(1, sl.columns)}, 1fr)` }}>
        {items.map((it) => (
          <button key={it.key} type="button" className={it.selected && !allOn ? 'is-picked' : allOn ? 'is-all' : 'is-off'} aria-pressed={it.selected && !allOn} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => toggle(it.key, e.ctrlKey || e.metaKey)}>
            {it.selected && !allOn && <Check size={12} />}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
      {selected && <Handles onDown={onDown} />}
    </div>
  );
}

function ShapeView({ s, rect, selected, zoom, editing, onDown, onEdit, onCommit, onAdjust, onRotate, member }: { s: SheetShape; rect: { x: number; y: number; w: number; h: number }; selected: boolean; zoom: number; editing: boolean; onDown: (e: React.PointerEvent, m: Handle | 'move') => void; onEdit: () => void; onCommit: (text: string | null) => void; onAdjust: (adj: Record<string, number> | undefined) => void; onRotate: (deg: number) => void; member?: boolean }) {
  const look = shapeLook(s);
  const box = useRef<HTMLDivElement>(null);
  const [adjDraft, setAdjDraft] = useState<Record<string, number> | null>(null);
  const adj = adjDraft ?? s.adj ?? {};
  const adjHandles = selected && !editing && !isLineKind(s.kind) ? adjustHandles(s.kind, Math.max(rect.w, 1), Math.max(rect.h, 1), adj) : [];
  const [rotDraft, setRotDraft] = useState<number | null>(null);
  const rotation = rotDraft ?? s.rotation ?? 0;
  const startRotate = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    let latest = s.rotation ?? 0;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = ev.clientX - (r.left + r.width / 2);
      const dy = ev.clientY - (r.top + r.height / 2);
      let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      latest = Math.round((((a % 360) + 360) % 360) * 10) / 10;
      setRotDraft(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRotDraft(null);
      if (latest !== (s.rotation ?? 0)) onRotate(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const startAdjust = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    let latest: Record<string, number> | undefined = s.adj;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = ((ev.clientX - r.left) * w) / (r.width || 1);
      const y = ((ev.clientY - r.top) * h) / (r.height || 1);
      latest = dragAdjust(s.kind, w, h, s.adj ?? {}, index, x, y);
      setAdjDraft(latest ?? {});
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setAdjDraft(null);
      if (JSON.stringify(latest ?? null) !== JSON.stringify(s.adj ?? null)) onAdjust(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const w = Math.max(rect.w, 1);
  const h = Math.max(rect.h, 1);
  const [draft, setDraft] = useState(s.text ?? '');
  useEffect(() => {
    if (editing) setDraft(s.text ?? '');
  }, [editing, s.text]);
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.vAlign ?? (s.kind === 'textBox' ? 'top' : 'middle')];
  const align = s.hAlign ?? (s.kind === 'textBox' ? 'left' : 'center');
  const font: React.CSSProperties = { color: s.textColor ?? '#000000', fontSize: (s.fontSize ?? 11) * zoom, fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : 'normal', textAlign: align, fontFamily: 'Calibri, Carlito, "Segoe UI", sans-serif' };
  return (
    <div
      ref={box}
      className={`calc-shape ${selected ? 'is-selected' : ''}${member ? ' is-member' : ''}`}
      style={{ left: rect.x, top: rect.y, width: w, height: isLineKind(s.kind) ? Math.max(h, 6) : h, ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}) }}
      data-shape-id={s.id}
      role="img"
      aria-label={s.alt ?? s.name ?? s.text ?? t('Forma')}
      onPointerDown={(e) => (editing ? e.stopPropagation() : onDown(e, 'move'))}
      onDoubleClick={() => !isLineKind(s.kind) && onEdit()}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
        <g dangerouslySetInnerHTML={{ __html: shapeSvg(s.kind, w, h, { fill: look.fill, stroke: look.line?.color ?? null, strokeWidth: (look.line?.width ?? 1) * zoom, flip: s.flip, adj }) }} />
      </svg>
      {editing ? (
        <textarea
          className="calc-shape__edit"
          autoFocus
          value={draft}
          style={{ ...font, justifyContent: justify }}
          onChange={(e) => setDraft(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={() => onCommit(draft)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onCommit(null);
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onCommit(draft);
          }}
        />
      ) : (
        s.text && (
          <div className="calc-shape__text" style={{ ...font, justifyContent: justify }}>
            {s.text}
          </div>
        )
      )}
      {selected && !editing && <Handles onDown={onDown} />}
      {selected && !editing && <span className="calc-shape__rot" data-rotate-handle title={t('Girar')} onPointerDown={startRotate} />}
      {adjHandles.map((p, i) => (
        <span key={i} className="calc-shape__adj" data-adj-handle={i} title={t('Ajustar la forma')} style={{ left: p.x, top: p.y }} onPointerDown={(e) => startAdjust(e, i)} />
      ))}
    </div>
  );
}

/** Pictures, shapes and slicers of the active sheet, over the grid. */
export function ObjectLayer({ doc, layout, viewport, zoom }: { doc: CalcDoc; layout: Layout; viewport: Viewport; zoom: number }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const images = doc.sheet.images;
  const slicers = doc.sheet.slicers;
  const shapes = doc.sheet.shapes;
  const [editingShape, setEditingShape] = useState<string | null>(null);
  const fw = colX(layout, layout.frozenCols);
  const fh = layout.rowAxis.offset(layout.frozenRows) * zoom;
  const place = (r: Rect4) => {
    const ax = r.x * zoom;
    const ay = r.y * zoom;
    return { x: ax - (ax >= fw ? viewport.scrollX : 0), y: ay - (ay >= fh ? viewport.scrollY : 0), w: r.width * zoom, h: r.height * zoom };
  };
  const imgBox = useBox(
    doc,
    zoom,
    { w: 16, h: 16 },
    (id, r, label) => doc.x.updateImage(id, r, label === 'Mover' ? 'Mover imagen' : 'Cambiar tamaño de la imagen'),
    (id) => doc.x.selectObject('image', id),
  );
  const slBox = useBox(
    doc,
    zoom,
    { w: 110, h: 90 },
    (id, r, label) => doc.x.updateSlicer(id, r, label === 'Mover' ? 'Mover segmentación' : 'Cambiar tamaño de la segmentación'),
    (id) => doc.x.selectObject('slicer', id),
  );
  const shBox = useBox(
    doc,
    zoom,
    { w: 8, h: 8 },
    (id, r, label) => doc.x.updateShape(id, r, label === 'Mover' ? 'Mover forma' : 'Cambiar tamaño de la forma'),
    (id) => doc.x.selectObject('shape', id),
  );
  const [gPrev, setGPrev] = useState<ShapePatch[] | null>(null);
  const sel = doc.x.selectedShapes;
  const multi = sel.length > 1;
  const patched = (s: SheetShape): SheetShape => {
    const p = gPrev?.find((q) => q.id === s.id);
    if (!p) return s;
    const { id, rotation, ...rest } = p;
    void id;
    const n: SheetShape = { ...s, ...rest };
    if ('rotation' in p) n.rotation = rotation || undefined;
    return n;
  };
  /** Mover, cambiar de tamaño o girar como un bloque las formas seleccionadas (un grupo o una selección múltiple). */
  const startGroup = (e: React.PointerEvent, mode: Handle | 'move' | 'rotate') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    doc.commitIfEditing();
    const orig = doc.sheet.shapes.filter((s) => doc.x.selectedShapes.includes(s.id));
    if (!orig.length) return;
    const b0 = shapesBounds(orig);
    const start = { x: e.clientX, y: e.clientY };
    const fr = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    const centre = fr ? { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 } : start;
    const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
    let latest: ShapePatch[] = [];
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / zoom;
      const dy = (ev.clientY - start.y) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      if (mode === 'move') latest = moveShapes(orig, Math.max(-b0.x, dx), Math.max(-b0.y, dy));
      else if (mode === 'rotate') {
        let deg = ((Math.atan2(ev.clientY - centre.y, ev.clientX - centre.x) - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        latest = rotateShapes(orig, { x: b0.x + b0.width / 2, y: b0.y + b0.height / 2 }, deg);
      } else {
        let { x, y, width, height } = b0;
        const min = 10;
        if (mode.includes('e')) width = Math.max(min, b0.width + dx);
        if (mode.includes('s')) height = Math.max(min, b0.height + dy);
        if (mode.includes('w')) {
          width = Math.max(min, b0.width - dx);
          x = b0.x + b0.width - width;
        }
        if (mode.includes('n')) {
          height = Math.max(min, b0.height - dy);
          y = b0.y + b0.height - height;
        }
        latest = scaleShapes(orig, b0, { x, y, width, height });
      }
      setGPrev(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGPrev(null);
      if (moved) doc.x.updateShapes(latest, mode === 'move' ? 'Mover formas' : mode === 'rotate' ? 'Girar formas' : 'Cambiar tamaño de las formas');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const urlsFor = useMemo(() => new Map(images.map((i) => [i.id, mediaUrl(doc, i.media)])), [images, doc]);
  useEffect(() => undefined, []);
  if (!images.length && !slicers.length && !shapes.length) return null;
  return (
    <div className="calc-charts" style={{ left: layout.headerW, top: layout.headerH }}>
      {images.map((img: SheetImage) => {
        const r = imgBox.preview?.id === img.id ? imgBox.preview.r : { x: img.x, y: img.y, width: img.width, height: img.height };
        const p = place(r);
        const selected = doc.x.selectedImage === img.id;
        return (
          <div key={img.id} className={`calc-picture ${selected ? 'is-selected' : ''}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h }} data-image-id={img.id} onPointerDown={(e) => imgBox.begin(img.id, { x: img.x, y: img.y, width: img.width, height: img.height }, e, 'move')}>
            <img src={urlsFor.get(img.id)} alt={img.alt ?? img.name ?? ''} draggable={false} />
            {selected && <Handles onDown={(e, h) => imgBox.begin(img.id, { x: img.x, y: img.y, width: img.width, height: img.height }, e, h, true)} />}
          </div>
        );
      })}
      {shapes.map((s0: SheetShape) => {
        const s = patched(s0);
        const r = shBox.preview?.id === s.id ? shBox.preview.r : { x: s.x, y: s.y, width: s.width, height: s.height };
        const orig = { x: s0.x, y: s0.y, width: s0.width, height: s0.height };
        return (
          <ShapeView
            key={s.id}
            s={s}
            rect={place(r)}
            zoom={zoom}
            member={multi && sel.includes(s.id)}
            selected={!multi && doc.x.selectedShape === s.id}
            editing={editingShape === s.id}
            onDown={(e, m) => {
              if (e.ctrlKey || e.shiftKey || e.metaKey) {
                e.stopPropagation();
                doc.x.toggleShapeSelection(s.id);
                return;
              }
              if (m === 'move' && (s.group || (multi && sel.includes(s.id)))) {
                if (!sel.includes(s.id)) doc.x.selectObject('shape', s.id);
                startGroup(e, 'move');
                return;
              }
              shBox.begin(s.id, orig, e, m, false, s.rotation ?? 0);
            }}
            onEdit={() => {
              doc.x.selectObject('shape', s.id);
              setEditingShape(s.id);
            }}
            onAdjust={(adj) => doc.x.updateShape(s.id, { adj }, 'Ajustar forma')}
            onRotate={(deg) => doc.x.updateShape(s.id, { rotation: deg || undefined }, 'Girar forma')}
            onCommit={(text) => {
              setEditingShape(null);
              if (text !== null && text !== (s.text ?? '')) doc.x.updateShape(s.id, { text: text || undefined }, 'Texto de la forma');
              window.dispatchEvent(new Event('nova:focus-grid'));
            }}
          />
        );
      })}
      {multi && (() => {
        const b = place(shapesBounds(shapes.filter((x) => sel.includes(x.id)).map(patched)));
        return (
          <div className="calc-groupframe" data-group-frame style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
            <Handles onDown={(e, h) => startGroup(e, h)} />
            <span className="calc-shape__rot" data-rotate-handle title={t('Girar')} onPointerDown={(e) => startGroup(e, 'rotate')} />
          </div>
        );
      })()}
      {slicers.map((sl) => {
        const r = slBox.preview?.id === sl.id ? slBox.preview.r : { x: sl.x, y: sl.y, width: sl.width, height: sl.height };
        return <SlicerView key={sl.id} doc={doc} sl={sl} rect={place(r)} selected={doc.x.selectedSlicer === sl.id} onDown={(e, m) => slBox.begin(sl.id, { x: sl.x, y: sl.y, width: sl.width, height: sl.height }, e, m)} />;
      })}
    </div>
  );
}

/** Notes: the ones always shown, and the one under the mouse. */
export function NoteLayer({ doc, layout, viewport, hover }: { doc: CalcDoc; layout: Layout; viewport: Viewport; hover: { row: number; col: number } | null }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const notes = doc.sheet.comments;
  if (!notes.length) return null;
  const show = notes.filter((c) => c.visible || (hover && hover.row === c.row && hover.col === c.col && !doc.edit));
  if (!show.length) return null;
  return (
    <>
      {show.map((c) => {
        const x = screenX(layout, viewport, c.col + 1) + 4;
        const y = Math.max(layout.headerH, screenY(layout, viewport, c.row) - 8);
        return (
          <div key={`${c.row}:${c.col}`} className="calc-note" role="note" style={{ left: x, top: y, width: c.width ?? 190, minHeight: c.height ?? 60 }} data-note={`${c.row}:${c.col}`}>
            {c.author && <strong>{c.author}:</strong>} {c.text}
          </div>
        );
      })}
    </>
  );
}

/** The input message of a validation rule, next to the active cell (like Excel's yellow tooltip). */
export function ValidationHint({ doc, layout, viewport }: { doc: CalcDoc; layout: Layout; viewport: Viewport }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  if (doc.edit) return null;
  const v = doc.x.validationAtActive();
  if (!v || !v.showInput || (!v.inputMessage && !v.inputTitle)) return null;
  const { row, col } = doc.sel.active;
  const x = screenX(layout, viewport, col);
  const y = screenY(layout, viewport, row + 1) + 4;
  return (
    <div className="calc-hint" role="status" style={{ left: x, top: y }}>
      {v.inputTitle && <strong>{v.inputTitle}</strong>}
      {v.inputMessage && <div>{v.inputMessage}</div>}
    </div>
  );
}

/** The drop-down list of a validation rule. */
export function ListMenu({ doc, row, col, x, y, width, onClose }: { doc: CalcDoc; row: number; col: number; x: number; y: number; width: number; onClose: () => void }) {
  const rule = doc.sheet.validations.find((v) => v.type === 'list' && v.ranges.some((r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2));
  const list = rule ? listChoicesOf(doc, rule, row, col) : [];
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.calc-listmenu')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const current = doc.wb.getValue(doc.activeSheetId, row, col);
  return (
    <ul className="calc-listmenu" role="listbox" aria-label={t('Valores permitidos')} style={{ left: x, top: y, minWidth: Math.max(80, width) }}>
      {list.length === 0 && <li className="is-empty">{t('(la lista está vacía)')}</li>}
      {list.map((item, i) => (
        <li
          key={i}
          role="option"
          aria-selected={String(current) === item}
          className={String(current) === item ? 'is-current' : ''}
          onClick={() => {
            const err = doc.x.chooseListValue(item);
            onClose();
            if (err && err !== '\u0001entry') window.alert(err);
            window.dispatchEvent(new Event('nova:focus-grid'));
          }}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function listChoicesOf(doc: CalcDoc, rule: Parameters<typeof listChoices>[2], row: number, col: number): string[] {
  const c = listChoices(doc.wb, doc.sheet, rule, row, col);
  if (!c) return [];
  return c.items.filter((x) => x !== null && x !== '').map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : ''));
}
