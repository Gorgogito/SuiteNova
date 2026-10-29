import { REF_ACTIONS, type Relation, type RefAction } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useRef, useState, useSyncExternalStore } from 'react';
import { describeReport, withLossConfirm } from './alter';
import type { BaseCtl } from './ctl';

const ACTION_LABEL: Record<RefAction, string> = {
  'NO ACTION': 'No hacer nada',
  RESTRICT: 'Impedir',
  CASCADE: 'En cascada',
  'SET NULL': 'Poner nulo',
  'SET DEFAULT': 'Valor predeterminado',
};
const BOX_W = 176;
const HEAD = 26;
const ROW = 20;

interface Box {
  name: string;
  cols: string[];
  pk: Set<string>;
  x: number;
  y: number;
  h: number;
}

const label = (r: Relation) => `${r.child}.${r.childCols.join(', ')} → ${r.parent}.${r.parentCols.join(', ')}`;
const sameRel = (a: Relation, b: Relation) => a.child === b.child && a.childCols.join() === b.childCols.join();

/** The relationships window: tables with their relationships drawn between fields, and the referential actions of each. */
export function RelationsView({ ctl }: { ctl: BaseCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const tables = db.tables();
  const rels = db.relations();
  const [selKey, setSelKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ name: string; dx: number; dy: number } | null>(null);
  const sel = rels.find((r) => label(r) === selKey) ?? null;
  const [draft, setDraft] = useState<{ onDelete: RefAction; onUpdate: RefAction } | null>(null);
  const [nw, setNw] = useState({ child: '', childCol: '', parent: '', parentCol: '', onDelete: 'NO ACTION' as RefAction, onUpdate: 'NO ACTION' as RefAction });

  // automatic layout: columns of boxes
  const perRow = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const colY: number[] = Array(perRow).fill(16);
  const boxes = new Map<string, Box>();
  tables.forEach((tb, i) => {
    const c = i % perRow;
    const cols = tb.columns.map((x) => x.name);
    const h = HEAD + cols.length * ROW + 6;
    const auto = { x: 16 + c * (BOX_W + 90), y: colY[c]! };
    colY[c] = colY[c]! + h + 24;
    const p = moved[tb.name] ?? auto;
    boxes.set(tb.name, { name: tb.name, cols, pk: new Set(tb.columns.filter((x) => x.primaryKey).map((x) => x.name)), x: p.x, y: p.y, h });
  });
  const width = Math.max(320, ...[...boxes.values()].map((b) => b.x + BOX_W + 24));
  const height = Math.max(200, ...[...boxes.values()].map((b) => b.y + b.h + 24));

  const rowY = (b: Box, col: string) => b.y + HEAD + Math.max(0, b.cols.indexOf(col)) * ROW + ROW / 2;
  const path = (r: Relation): { d: string; x1: number; y1: number; x2: number; y2: number } | null => {
    const c = boxes.get(r.child);
    const p = boxes.get(r.parent);
    if (!c || !p) return null;
    const y1 = rowY(c, r.childCols[0]!);
    const y2 = rowY(p, r.parentCols[0]!);
    const childLeft = c.x < p.x;
    const x1 = childLeft ? c.x + BOX_W : c.x;
    const x2 = childLeft ? p.x : p.x + BOX_W;
    const bend = c === p ? 60 : Math.max(30, Math.abs(x2 - x1) / 2);
    const s = c === p ? -1 : childLeft ? 1 : -1;
    return { d: `M ${x1} ${y1} C ${x1 + s * bend} ${y1}, ${x2 - s * bend} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2 };
  };

  const finish = (text: string, report?: Parameters<typeof describeReport>[0]) => {
    ctl.touch();
    setMsg({ ok: true, text: [text, report ? describeReport(report) : ''].filter(Boolean).join(' ') });
  };
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const apply = () =>
    attempt(() => {
      if (!sel) return;
      const next: Relation = { ...sel, ...(draft ?? {}) };
      const r = withLossConfirm((opts) => db.setRelation(next, opts));
      if (r) finish(t('Se cambió la relación.'), r);
    });
  const remove = () =>
    attempt(() => {
      if (!sel) return;
      if (!window.confirm(t('¿Eliminar la relación {r}? Los datos no se modifican.', { r: label(sel) }))) return;
      const r = withLossConfirm((opts) => db.removeRelation(sel.child, sel.childCols, opts));
      if (r) {
        setSelKey(null);
        finish(t('Se eliminó la relación.'), r);
      }
    });
  const create = () =>
    attempt(() => {
      const rel: Relation = { child: nw.child, childCols: [nw.childCol], parent: nw.parent, parentCols: [nw.parentCol], onDelete: nw.onDelete, onUpdate: nw.onUpdate };
      if (!rel.child || !nw.childCol || !rel.parent || !nw.parentCol) throw new Error(t('Elija las dos tablas y los dos campos.'));
      const r = withLossConfirm((opts) => db.setRelation(rel, opts));
      if (r) {
        setSelKey(label(rel));
        setDraft(null);
        finish(t('Se creó la relación.'), r);
      }
    });

  const select = (r: Relation | null) => {
    setSelKey(r ? label(r) : null);
    setDraft(null);
    setMsg(null);
  };
  const colsOf = (tb: string) => tables.find((x) => x.name === tb)?.columns.map((c) => c.name) ?? [];
  const cur = sel ? { onDelete: draft?.onDelete ?? sel.onDelete, onUpdate: draft?.onUpdate ?? sel.onUpdate } : null;
  const composite = !!sel && (sel.childCols.length > 1 || sel.parentCols.length > 1);

  return (
    <div className="bs-relations">
      <div className="bs-reldiagram">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('Diagrama de relaciones: {n} tablas, {r} relaciones', { n: tables.length, r: rels.length })}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            setMoved((m) => ({ ...m, [d.name]: { x: Math.max(0, e.clientX - r.left - d.dx), y: Math.max(0, e.clientY - r.top - d.dy) } }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
        >
          {rels.map((r) => {
            const p = path(r);
            if (!p) return null;
            const on = label(r) === selKey;
            return (
              <g key={label(r)} className={`bs-rel${on ? ' is-sel' : ''}`}>
                <path d={p.d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} onClick={() => select(r)} data-testid="rel-hit" />
                <path d={p.d} fill="none" strokeWidth={on ? 3 : 1.5} pointerEvents="none" />
                <text x={p.x2 + (p.x2 > p.x1 ? -12 : 4)} y={p.y2 - 4} fontSize={11}>
                  1
                </text>
                <text x={p.x1 + (p.x2 > p.x1 ? 4 : -14)} y={p.y1 - 4} fontSize={11}>
                  ∞
                </text>
              </g>
            );
          })}
          {[...boxes.values()].map((b) => (
            <g key={b.name} transform={`translate(${b.x} ${b.y})`} className="bs-relbox">
              <rect width={BOX_W} height={b.h} rx={3} />
              <rect
                width={BOX_W}
                height={HEAD}
                rx={3}
                className="bs-relhead"
                style={{ cursor: 'move' }}
                onPointerDown={(e) => {
                  const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  drag.current = { name: b.name, dx: e.clientX - r.left - b.x, dy: e.clientY - r.top - b.y };
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                }}
              />
              <text x={8} y={17} fontSize={12} fontWeight={600} pointerEvents="none">
                {b.name}
              </text>
              {b.cols.map((c, i) => (
                <text key={c} x={10} y={HEAD + i * ROW + 14} fontSize={11} fontWeight={b.pk.has(c) ? 700 : 400}>
                  {b.pk.has(c) ? '🔑 ' : ''}
                  {c}
                </text>
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div className="bs-relside">
        <h3>{t('Relaciones')}</h3>
        {rels.length === 0 && <p className="bs-hint">{t('Todavía no hay relaciones entre las tablas.')}</p>}
        <ul className="bs-rellist" aria-label={t('Lista de relaciones')}>
          {rels.map((r) => (
            <li key={label(r)}>
              <button type="button" className={sameRel(r, sel ?? ({} as Relation)) ? 'is-selected' : ''} aria-pressed={sameRel(r, sel ?? ({} as Relation))} onClick={() => select(r)}>
                {label(r)}
              </button>
            </li>
          ))}
        </ul>
        {sel && cur && (
          <fieldset className="bs-relcfg">
            <legend>{label(sel)}</legend>
            <label>
              {t('Al eliminar el registro principal')}
              <select aria-label={t('Al eliminar el registro principal')} value={cur.onDelete} disabled={composite} onChange={(e) => setDraft({ ...cur, onDelete: e.target.value as RefAction })}>
                {REF_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t(ACTION_LABEL[a])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Al cambiar la clave principal')}
              <select aria-label={t('Al cambiar la clave principal')} value={cur.onUpdate} disabled={composite} onChange={(e) => setDraft({ ...cur, onUpdate: e.target.value as RefAction })}>
                {REF_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t(ACTION_LABEL[a])}
                  </option>
                ))}
              </select>
            </label>
            {composite && <p className="bs-hint">{t('Las relaciones de varios campos se conservan, pero solo se pueden eliminar desde aquí.')}</p>}
            <div className="bs-toolbar">
              <button type="button" className="bs-btn bs-btn--primary" disabled={composite || !draft} onClick={apply}>
                {t('Aplicar cambios')}
              </button>
              <button type="button" className="bs-btn" onClick={remove}>
                {t('Eliminar relación')}
              </button>
            </div>
          </fieldset>
        )}
        <fieldset className="bs-relcfg">
          <legend>{t('Nueva relación')}</legend>
          <label>
            {t('Tabla secundaria (con la clave externa)')}
            <select aria-label={t('Tabla secundaria')} value={nw.child} onChange={(e) => setNw({ ...nw, child: e.target.value, childCol: '' })}>
              <option value="" />
              {tables.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Campo')}
            <select aria-label={t('Campo secundario')} value={nw.childCol} onChange={(e) => setNw({ ...nw, childCol: e.target.value })}>
              <option value="" />
              {colsOf(nw.child).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Tabla principal (con la clave)')}
            <select aria-label={t('Tabla principal')} value={nw.parent} onChange={(e) => setNw({ ...nw, parent: e.target.value, parentCol: '' })}>
              <option value="" />
              {tables.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Campo')}
            <select aria-label={t('Campo principal')} value={nw.parentCol} onChange={(e) => setNw({ ...nw, parentCol: e.target.value })}>
              <option value="" />
              {colsOf(nw.parent).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Al eliminar')}
            <select aria-label={t('Nueva: al eliminar')} value={nw.onDelete} onChange={(e) => setNw({ ...nw, onDelete: e.target.value as RefAction })}>
              {REF_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(ACTION_LABEL[a])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Al cambiar la clave')}
            <select aria-label={t('Nueva: al cambiar la clave')} value={nw.onUpdate} onChange={(e) => setNw({ ...nw, onUpdate: e.target.value as RefAction })}>
              {REF_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(ACTION_LABEL[a])}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="bs-btn bs-btn--primary" onClick={create}>
            {t('Crear relación')}
          </button>
        </fieldset>
        {msg && (
          <div className={msg.ok ? 'bs-ok' : 'bs-error'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </div>
        )}
        <p className="bs-hint">{t('Crear o cambiar una relación reconstruye la tabla secundaria conservando sus datos; se puede deshacer.')}</p>
      </div>
    </div>
  );
}
