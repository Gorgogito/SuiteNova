import { listChoices, type SheetImage, type SlicerDef } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { Check, FilterX, ListChecks } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
  const begin = (id: string, orig: Rect4, e: React.PointerEvent, mode: Handle | 'move', keepRatio = false) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    doc.commitIfEditing();
    select(id);
    const start = { x: e.clientX, y: e.clientY };
    let latest = orig;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / zoom;
      const dy = (ev.clientY - start.y) / zoom;
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

/** Pictures and slicers of the active sheet, over the grid. */
export function ObjectLayer({ doc, layout, viewport, zoom }: { doc: CalcDoc; layout: Layout; viewport: Viewport; zoom: number }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const images = doc.sheet.images;
  const slicers = doc.sheet.slicers;
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
  const urlsFor = useMemo(() => new Map(images.map((i) => [i.id, mediaUrl(doc, i.media)])), [images, doc]);
  useEffect(() => undefined, []);
  if (!images.length && !slicers.length) return null;
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
