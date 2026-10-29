import { t } from '@suitenova/core-ui';
import { CATEGORIES, STENCILS, createShape, shapeRender, type Stencil } from '@suitenova/diagram-core';
import { useMemo, useState } from 'react';
import type { DiagramCtl } from './ctl';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A small drawing of the stencil, using the same renderer as the canvas. */
function Thumb({ st }: { st: Stencil }) {
  const k = Math.min(52 / st.w, 34 / st.h);
  const w = st.w * k;
  const h = st.h * k;
  const shape = { ...createShape(st.id, 0, 0), w, h, text: '' };
  const r = shapeRender({ ...shape, style: { ...shape.style, strokeWidth: 1.2, fill: shape.style.fill === 'none' ? 'none' : '#e8f0fa' } });
  return (
    <svg width={56} height={38} viewBox={`${-(56 - w) / 2} ${-(38 - h) / 2} 56 38`} aria-hidden="true">
      <g>
        {r.paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} stroke={p.stroke === 'none' ? (st.id === 'text' ? '#8a8a8a' : 'none') : p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={st.id === 'text' ? '2 2' : p.dasharray} />
        ))}
        {st.id === 'text' && <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fontSize="12" fill="#444">Aa</text>}
      </g>
    </svg>
  );
}

export function StencilPanel({ ctl, onImage }: { ctl: DiagramCtl; onImage?: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ basic: true, flow: true });
  const needle = norm(q.trim());
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({ ...c, items: STENCILS.filter((s) => s.category === c.id && (!needle || norm(t(s.name)).includes(needle) || norm(s.name).includes(needle))) })).filter((c) => c.items.length),
    [needle],
  );
  return (
    <aside className="dg-panel" aria-label={t('Formas')}>
      <input type="search" className="dg-search" aria-label={t('Buscar formas')} placeholder={t('Buscar formas')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="dg-groups">
        {groups.length === 0 && <p className="dg-none">{t('Ninguna forma coincide.')}</p>}
        {groups.map((c) => {
          const isOpen = needle ? true : !!open[c.id];
          return (
            <section key={c.id} className="dg-group">
              <button type="button" className="dg-grouphead" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [c.id]: !isOpen })}>
                <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {t(c.name)}
              </button>
              {isOpen && (
                <ul className="dg-items">
                  {c.items.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="dg-item"
                        title={t(s.name)}
                        aria-label={t(s.name)}
                        data-stencil={s.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-nova-stencil', s.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => (s.id === 'image' && onImage ? onImage() : ctl.addStencil(s.id))}
                      >
                        <Thumb st={s} />
                        <span>{t(s.name)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
