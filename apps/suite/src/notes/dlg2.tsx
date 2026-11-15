import { Button, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { contentNode, countPage, displayTitle, recentPages, type Page } from '@suitenova/notes-core';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { useMemo, useState } from 'react';
import type { NotesCtl } from './ctl';
import { Modal } from './Dialogs';

const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };
const closeBtn = (onClose: () => void) => (
  <Button appearance="primary" onClick={onClose}>
    {t('Cerrar')}
  </Button>
);
const refocus = (ctl: NotesCtl) => setTimeout(() => ctl.focusEditor(), 80);

const sectionLabel = (ctl: NotesCtl, id: string) => {
  const s = ctl.nb.sections.find((x) => x.id === id)!;
  const g = s.group ? ctl.nb.groups.find((x) => x.id === s.group)?.name : '';
  return g ? `${g} › ${s.name}` : s.name;
};

// ------------------------------------------------------------------------------------------------ mover o copiar página

export function MovePageDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const options = ctl.nb.sections.filter((s) => !s.vault);
  const first = options.find((s) => s.id !== ctl.sectionId)?.id ?? options[0]?.id ?? '';
  const [to, setTo] = useState(first);
  const move = ctl.canTransfer(to, false);
  const copy = ctl.canTransfer(to, true);
  const sub = ctl.section.pages.filter((p, i, a) => {
    const at = a.findIndex((x) => x.id === ctl.pageId);
    return i > at && p.level > ctl.page.level && a.slice(at + 1, i).every((q) => q.level > ctl.page.level);
  }).length;
  return (
    <Modal
      title={t('Mover o copiar la página')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            disabled={!copy}
            onClick={() => {
              if (ctl.transferPage(to, true)) onClose();
            }}
          >
            {t('Copiar')}
          </Button>
          <Button
            appearance="primary"
            disabled={!move}
            onClick={() => {
              if (ctl.transferPage(to, false)) onClose();
            }}
          >
            {t('Mover')}
          </Button>
        </>
      }
    >
      <p>
        «{displayTitle(ctl.page)}»{sub ? ` ${t('y sus {n} subpáginas', { n: sub })}` : ''}
      </p>
      <div style={field}>
        <label htmlFor="nn-move-to">{t('A la sección')}</label>
        <select id="nn-move-to" className="nv-select" value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {sectionLabel(ctl, s.id)}
              {s.id === ctl.sectionId ? ` (${t('esta')})` : ''}
            </option>
          ))}
        </select>
      </div>
      {!move && to !== ctl.sectionId && <p className="nn-note">{t('No se puede mover aquí: la página está bloqueada o es la última de su sección.')}</p>}
      {to === ctl.sectionId && <p className="nn-note">{t('Para mover dentro de la misma sección usa «Subir» y «Bajar» en Organizar; aquí puedes copiarla.')}</p>}
    </Modal>
  );
}

export function MergeSectionDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const options = ctl.nb.sections.filter((s) => !s.vault && s.id !== ctl.sectionId);
  const [to, setTo] = useState(options[0]?.id ?? '');
  return (
    <Modal
      title={t('Combinar la sección con otra')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!to}
            onClick={() => {
              if (ctl.mergeSectionInto(to)) onClose();
            }}
          >
            {t('Combinar')}
          </Button>
        </>
      }
    >
      <p>{t('Las páginas de «{name}» pasan al final de la sección elegida y esta sección desaparece.', { name: ctl.section.name })}</p>
      <div style={field}>
        <label htmlFor="nn-merge-to">{t('Combinar en')}</label>
        <select id="nn-merge-to" className="nv-select" value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {sectionLabel(ctl, s.id)}
            </option>
          ))}
        </select>
      </div>
      {!options.length && <p className="nn-note">{t('No hay otra sección a la que combinar.')}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ recientes y sin leer

export function RecentDialog({ ctl, mode, onClose }: { ctl: NotesCtl; mode: 'recent' | 'unread'; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const rows = useMemo(() => {
    if (mode === 'unread') return recentPages(ctl.nb, 0).filter((r) => (ctl.nb.seen?.[r.pageId] ?? 0) < r.modified && r.pageId !== ctl.pageId);
    return recentPages(ctl.nb, days);
  }, [ctl, mode, days, ctl.getVersion()]);
  return (
    <Modal
      wide
      title={mode === 'unread' ? t('Páginas sin leer') : t('Ediciones recientes')}
      onClose={onClose}
      actions={
        <>
          {mode === 'unread' && (
            <Button
              disabled={!rows.length}
              onClick={() => {
                ctl.markAllSeen();
              }}
            >
              {t('Marcar todo como leído')}
            </Button>
          )}
          {closeBtn(onClose)}
        </>
      }
    >
      {mode === 'recent' && (
        <div style={field}>
          <label htmlFor="nn-recent-days">{t('Editadas en')}</label>
          <select id="nn-recent-days" className="nv-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>{t('el último día')}</option>
            <option value={7}>{t('los últimos 7 días')}</option>
            <option value={30}>{t('los últimos 30 días')}</option>
            <option value={0}>{t('cualquier fecha')}</option>
          </select>
        </div>
      )}
      {mode === 'unread' && <p className="nn-note">{t('Una página está «sin leer» si cambió (por ejemplo, al combinar la libreta compartida) desde la última vez que la abriste en este equipo.')}</p>}
      {rows.length === 0 && <p>{mode === 'unread' ? t('No hay páginas sin leer.') : t('No hay páginas editadas en ese periodo.')}</p>}
      <ul className="nn-listbox" aria-label={t('Páginas')}>
        {rows.map((r) => (
          <li key={r.pageId}>
            <button
              type="button"
              onClick={() => {
                ctl.goTo(r.sectionId, r.pageId);
                onClose();
              }}
            >
              <strong>{t(r.title)}</strong>
              <span>
                {r.sectionName} · {new Date(r.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ buscar y reemplazar en la página

interface Match {
  box: string;
  from: number;
  to: number;
}

const fold = (s: string, matchCase: boolean) => (matchCase ? s : s.toLocaleLowerCase());

/** Las coincidencias en un documento: se busca bloque por bloque, así que una palabra con partes en negrita también se encuentra. */
function matchesIn(doc: PMNode, box: string, q: string, matchCase: boolean): Match[] {
  const out: Match[] = [];
  const needle = fold(q, matchCase);
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const offsets: number[] = [];
    node.descendants((n, p) => {
      if (n.isText) {
        for (let i = 0; i < n.text!.length; i++) offsets.push(pos + 1 + p + i);
        text += n.text!;
      } else if (n.isLeaf) {
        offsets.push(pos + 1 + p);
        text += '￼';
      }
      return true;
    });
    const hay = fold(text, matchCase);
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const a = offsets[i]!;
      const b = offsets[i + needle.length - 1]! + 1;
      // una coincidencia que cruza un objeto no es texto corrido
      if (b - a === needle.length) out.push({ box, from: a, to: b });
    }
    return false;
  });
  return out;
}

export function FindDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [msg, setMsg] = useState('');
  const boxes = () =>
    ctl.page.containers
      .filter((c) => c.kind === 'text')
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((c) => ({ id: c.id, doc: ctl.views.get(c.id)?.state.doc ?? contentNode((c as { content: unknown }).content) }));
  const all = (): Match[] => (q ? boxes().flatMap((b) => matchesIn(b.doc, b.id, q, matchCase)) : []);
  const show = (m: Match) => {
    const v = ctl.views.get(m.box);
    if (!v) return;
    ctl.select(null);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).scrollIntoView());
    v.dom.scrollIntoView({ block: 'nearest' });
  };
  const next = (dir: 1 | -1) => {
    const ms = all();
    if (!ms.length) {
      setMsg(q ? t('No se encontró «{q}».', { q }) : '');
      setIdx(-1);
      return;
    }
    const i = (idx + dir + ms.length) % ms.length;
    setIdx(i);
    setMsg(t('{a} de {b}', { a: i + 1, b: ms.length }));
    show(ms[i]!);
  };
  const replaceOne = () => {
    const ms = all();
    const m = ms[Math.max(0, idx)];
    if (!m) return;
    const v = ctl.views.get(m.box);
    if (!v) return;
    v.dispatch(v.state.tr.replaceWith(m.from, m.to, rep ? v.state.schema.text(rep, v.state.doc.resolve(m.from).marks()) : []));
    setIdx(Math.max(-1, idx - 1));
    setTimeout(() => next(1), 30);
  };
  const replaceAll = () => {
    let n = 0;
    for (const b of boxes()) {
      const v = ctl.views.get(b.id);
      if (!v) continue;
      const ms = matchesIn(v.state.doc, b.id, q, matchCase);
      if (!ms.length) continue;
      const tr = v.state.tr;
      for (const m of [...ms].reverse()) tr.replaceWith(m.from, m.to, rep ? v.state.schema.text(rep, v.state.doc.resolve(m.from).marks()) : []);
      v.dispatch(tr);
      n += ms.length;
    }
    setMsg(n ? t('Se reemplazaron {n} coincidencias.', { n }) : t('No se encontró «{q}».', { q }));
    setIdx(-1);
  };
  return (
    <Modal
      title={t('Buscar en esta página')}
      onClose={() => {
        onClose();
        refocus(ctl);
      }}
      actions={closeBtn(() => {
        onClose();
        refocus(ctl);
      })}
    >
      <div style={field}>
        <label htmlFor="nn-find-q">{t('Buscar')}</label>
        <Input
          id="nn-find-q"
          value={q}
          autoFocus
          onChange={(_e, d) => {
            setQ(d.value);
            setIdx(-1);
            setMsg('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              next(e.shiftKey ? -1 : 1);
            }
          }}
        />
      </div>
      <div style={field}>
        <label htmlFor="nn-find-r">{t('Reemplazar con')}</label>
        <Input id="nn-find-r" value={rep} onChange={(_e, d) => setRep(d.value)} />
      </div>
      <label className="nn-check">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t('Distinguir mayúsculas y minúsculas')}
      </label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <Button onClick={() => next(-1)} disabled={!q}>
          {t('Anterior')}
        </Button>
        <Button appearance="primary" onClick={() => next(1)} disabled={!q}>
          {t('Siguiente')}
        </Button>
        <Button onClick={replaceOne} disabled={!q || idx < 0}>
          {t('Reemplazar')}
        </Button>
        <Button onClick={replaceAll} disabled={!q}>
          {t('Reemplazar todo')}
        </Button>
      </div>
      <p aria-live="polite" role="status" className="nn-note">
        {msg}
      </p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ recuento

export function CountDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const sel = (() => {
    const v = ctl.view;
    if (!v || v.state.selection.empty) return null;
    const text = v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, '\n', ' ');
    return { words: (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length, chars: text.length };
  })();
  const sum = (pages: Page[]) => pages.filter((p) => !p.vault).reduce((n, p) => n + countPage(p).words, 0);
  const pc = countPage(ctl.page);
  const rows: [string, number][] = [
    [t('Palabras en la página'), pc.words],
    [t('Caracteres (con espacios)'), pc.characters],
    [t('Caracteres (sin espacios)'), pc.charactersNoSpaces],
    [t('Cuadros de texto'), pc.boxes],
    [t('Imágenes'), pc.images],
    [t('Grabaciones'), pc.recordings],
    [t('Archivos adjuntos'), pc.files],
    [t('Trazos de tinta'), pc.strokes],
    [t('Palabras en la sección'), sum(ctl.section.pages)],
    [t('Palabras en la libreta'), sum(ctl.nb.sections.filter((s) => !s.vault).flatMap((s) => s.pages))],
  ];
  return (
    <Modal title={t('Contar palabras')} onClose={onClose} actions={closeBtn(onClose)}>
      {sel && (
        <p>
          <strong>{t('Selección')}:</strong> {t('{w} palabras, {c} caracteres', { w: sel.words, c: sel.chars })}
        </p>
      )}
      <table className="nw-shortcuts">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nn-note">{t('Las páginas bloqueadas no se cuentan. La tinta y el texto dentro de las imágenes no cuentan como palabras.')}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ accesibilidad

export interface A11yIssue {
  id: string;
  text: string;
  image?: string;
}

export function checkAccessibility(page: Page, assets: Record<string, { name: string }> = {}): A11yIssue[] {
  // al insertar una imagen su texto alternativo es el nombre del archivo: eso no describe la imagen
  const generic = (alt: string, asset: string) => !alt.trim() || alt.trim() === (assets[asset]?.name ?? '').replace(/\.[^.]+$/, '');
  const out: A11yIssue[] = [];
  if (!page.title.trim()) out.push({ id: 'title', text: 'La página no tiene título (se usa la primera línea en la lista de páginas).' });
  for (const c of page.containers) {
    if (c.kind === 'image' && generic(c.alt, c.asset)) out.push({ id: `img:${c.id}`, text: 'Una imagen no tiene texto alternativo.', image: c.id });
    if (c.kind === 'text') {
      let inline = 0;
      let tables = 0;
      contentNode(c.content).descendants((n) => {
        if (n.type.name === 'image' && !String(n.attrs.alt ?? '').trim()) inline++;
        if (n.type.name === 'table' && !n.attrs.headerRow) tables++;
        return true;
      });
      if (inline) out.push({ id: `inl:${c.id}`, text: inline === 1 ? 'Una imagen dentro del texto no tiene texto alternativo.' : `${inline} imágenes dentro del texto no tienen texto alternativo.` });
      if (tables) out.push({ id: `tab:${c.id}`, text: tables === 1 ? 'Una tabla no tiene fila de encabezado.' : `${tables} tablas no tienen fila de encabezado.` });
    }
  }
  if (page.ink.length) out.push({ id: 'ink', text: 'La página tiene tinta o dibujos: los lectores de pantalla no pueden leerlos. Si dicen algo importante, escríbelo también como texto.' });
  return out;
}

export function AccessibilityDialog({ ctl, onClose, openImage }: { ctl: NotesCtl; onClose: () => void; openImage: (id: string) => void }) {
  const issues = checkAccessibility(ctl.page, ctl.nb.assets);
  return (
    <Modal title={t('Comprobar accesibilidad')} onClose={onClose} actions={closeBtn(onClose)}>
      {issues.length === 0 ? <p>{t('No se encontraron problemas en esta página.')}</p> : <p>{issues.length === 1 ? t('Se encontró 1 problema:') : t('Se encontraron {n} problemas:', { n: issues.length })}</p>}
      <ul className="nn-listbox" aria-label={t('Problemas')}>
        {issues.map((i) => (
          <li key={i.id}>
            <div style={{ padding: '6px 8px' }}>
              {t(i.text)}{' '}
              {i.image && (
                <Button
                  size="small"
                  onClick={() => {
                    onClose();
                    openImage(i.image!);
                  }}
                >
                  {t('Añadir texto alternativo…')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="nn-note">{t('Esta revisión solo mira lo que se puede comprobar sin ayuda: textos alternativos, títulos y encabezados de tabla. No juzga el contraste ni el orden de lectura.')}</p>
    </Modal>
  );
}
