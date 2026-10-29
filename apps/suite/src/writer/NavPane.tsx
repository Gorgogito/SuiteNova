import { t } from '@suitenova/core-ui';
import { TextSelection } from 'prosemirror-state';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { WriterCtl } from './doc';
import { headingsOf } from './outline';

/** Navigation pane: the headings of the document (click to go there) and the pages. */
export function NavPane({ ctl, onClose }: { ctl: WriterCtl; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [tab, setTab] = useState<'headings' | 'pages'>('headings');
  const [filter, setFilter] = useState('');
  const doc = ctl.body;
  const items = useMemo(() => headingsOf(doc), [doc]);
  const head = ctl.mainState?.selection.head ?? 0;
  let current = -1;
  items.forEach((h, i) => {
    if (h.pos <= head) current = i;
  });
  const go = (pos: number) => {
    const v = ctl.mainView;
    if (!v) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(Math.min(pos + 1, v.state.doc.content.size)))).scrollIntoView());
    v.focus();
  };
  const goPage = (i: number) => {
    const r = ctl.pageRects()[i];
    const host = ctl.host;
    if (!r || !host) return;
    host.closest('.nw-scroll')?.scrollTo({ top: host.offsetTop + r.top, behavior: 'auto' });
    const v = ctl.mainView;
    if (v) {
      // put the caret at the start of that page: the first text block starting after the page top
      const rect = host.getBoundingClientRect();
      const scale = host.offsetWidth ? rect.width / host.offsetWidth : 1;
      const hit = v.posAtCoords({ left: rect.left + (r.left + 120) * scale, top: rect.top + (r.top + 120) * scale });
      if (hit) v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(hit.pos))));
    }
  };
  const shown = items.filter((h) => !filter || h.text.toLowerCase().includes(filter.toLowerCase()));
  return (
    <aside className="nw-nav" aria-label={t('Panel de navegación')}>
      <header>
        <strong>{t('Navegación')}</strong>
        <button type="button" className="nv-btn nv-btn--small" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
          ✕
        </button>
      </header>
      <div className="nw-nav-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'headings'} onClick={() => setTab('headings')}>
          {t('Títulos')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'pages'} onClick={() => setTab('pages')}>
          {t('Páginas')}
        </button>
      </div>
      {tab === 'headings' ? (
        <>
          <input className="nw-nav-search" placeholder={t('Buscar en los títulos')} aria-label={t('Buscar en los títulos')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {!shown.length && <p className="nw-nav-empty">{items.length ? t('Sin resultados') : t('Los títulos del documento (estilos Título 1 a 6) aparecerán aquí.')}</p>}
          <ul>
            {shown.map((h, i) => (
              <li key={`${h.pos}-${i}`} className={items.indexOf(h) === current ? 'is-current' : ''} style={{ paddingLeft: 8 + (h.level - 1) * 14 }}>
                <button type="button" onClick={() => go(h.pos)} title={h.text}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="nw-nav-pages">
          {ctl.pageSpecs.map((p, i) => (
            <li key={i} className={ctl.currentPage() === i + 1 ? 'is-current' : ''}>
              <button type="button" onClick={() => goPage(i)}>
                {t('Página {n}', { n: i + 1 })}
                {p.blank ? ` (${t('en blanco')})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
