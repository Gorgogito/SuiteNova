import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import {
  CITE_STYLES,
  SOURCE_TYPES,
  bibliographyEntry,
  captionLabels,
  citationText,
  defaultTocOptions,
  emptySource,
  tocInstr,
  type CiteStyle,
  type NotesOptions,
  type Source,
  type TocOptions,
} from '@suitenova/writer-core';
import { useMemo, useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { addBookmark, deleteBookmark, goToBookmark, insertCaption, insertCitation, insertCrossReference, insertGenerated, listBookmarks, markIndexEntry, xrefTargets, type XRefKind, type XRefWhat } from './refs-actions';

const done = (ui: WriterUI, onClose: () => void) => {
  onClose();
  focusDocSoon(ui);
};

// ------------------------------------------------------------------------------------------------ table of contents / figures

export function TocDialog({ ui, kind, onClose }: { ui: WriterUI; kind: 'toc' | 'tof'; onClose: () => void }) {
  const labels = useMemo(() => {
    const l = captionLabels(ui.ctl.body);
    return l.length ? l : ['Figura', 'Tabla', 'Ecuación'];
  }, [ui]);
  const [o, setO] = useState<TocOptions>({ ...defaultTocOptions(), title: kind === 'toc' ? 'Contenido' : 'Tabla de ilustraciones' });
  const [label, setLabel] = useState(labels[0]!);
  const set = <K extends keyof TocOptions>(k: K, v: TocOptions[K]) => setO((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      title={kind === 'toc' ? t('Tabla de contenido') : t('Tabla de ilustraciones')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const opts = kind === 'toc' ? { ...o, instr: tocInstr(o) } : { ...o, label, instr: ` TOC \\h \\z \\c "${label}" ` };
              void insertGenerated(ui.ctl, kind, opts as never);
              done(ui, onClose);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-toc-title">{t('Título')}</label>
        <Input id="nw-toc-title" value={o.title ?? ''} onChange={(_e, d) => set('title', d.value || null)} />
      </div>
      {kind === 'tof' && (
        <div style={field}>
          <label htmlFor="nw-tof-label">{t('Rótulo del título')}</label>
          <Select id="nw-tof-label" value={label} onChange={(_e, d) => setLabel(d.value)}>
            {labels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </div>
      )}
      {kind === 'toc' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
          <div style={field}>
            <label htmlFor="nw-toc-min">{t('Desde el nivel')}</label>
            <Input id="nw-toc-min" type="number" min={1} max={6} value={String(o.minLevel)} onChange={(_e, d) => set('minLevel', Math.max(1, Math.min(o.maxLevel, Number(d.value) || 1)))} />
          </div>
          <div style={field}>
            <label htmlFor="nw-toc-max">{t('Hasta el nivel')}</label>
            <Input id="nw-toc-max" type="number" min={1} max={6} value={String(o.maxLevel)} onChange={(_e, d) => set('maxLevel', Math.max(o.minLevel, Math.min(6, Number(d.value) || 3)))} />
          </div>
        </div>
      )}
      <Checkbox checked={o.pageNumbers} onChange={(_e, d) => set('pageNumbers', !!d.checked)} label={t('Mostrar números de página')} />
      <Checkbox checked={o.rightAlign} disabled={!o.pageNumbers} onChange={(_e, d) => set('rightAlign', !!d.checked)} label={t('Alinear los números de página a la derecha')} />
      <Checkbox checked={o.hyperlinks} onChange={(_e, d) => set('hyperlinks', !!d.checked)} label={t('Usar hipervínculos en lugar de números de página')} />
      <div style={{ ...field, marginTop: 8 }}>
        <label htmlFor="nw-toc-leader">{t('Carácter de relleno')}</label>
        <Select id="nw-toc-leader" value={o.leader} disabled={!o.pageNumbers || !o.rightAlign} onChange={(_e, d) => set('leader', d.value as TocOptions['leader'])}>
          <option value="dot">{t('Puntos')}</option>
          <option value="hyphen">{t('Guiones')}</option>
          <option value="underscore">{t('Línea')}</option>
          <option value="none">{t('Ninguno')}</option>
        </Select>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ caption

export function CaptionDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const labels = useMemo(() => [...new Set(['Figura', 'Tabla', 'Ecuación', ...captionLabels(ui.ctl.body)])], [ui]);
  const [label, setLabel] = useState('Figura');
  const [custom, setCustom] = useState('');
  const [text, setText] = useState('');
  const [where, setWhere] = useState<'above' | 'below'>('below');
  const [withLabel, setWithLabel] = useState(true);
  const used = custom.trim() || label;
  return (
    <Modal
      title={t('Insertar título')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              insertCaption(ui.ctl, used, text, where, withLabel);
              done(ui, onClose);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-cap-label">{t('Rótulo')}</label>
        <Select id="nw-cap-label" value={label} onChange={(_e, d) => setLabel(d.value)}>
          {labels.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-cap-new">{t('o un rótulo nuevo')}</label>
        <Input id="nw-cap-new" value={custom} onChange={(_e, d) => setCustom(d.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-cap-text">{t('Texto del título (opcional)')}</label>
        <Input id="nw-cap-text" value={text} autoFocus onChange={(_e, d) => setText(d.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-cap-pos">{t('Posición')}</label>
        <Select id="nw-cap-pos" value={where} onChange={(_e, d) => setWhere(d.value as 'above' | 'below')}>
          <option value="below">{t('Debajo del elemento seleccionado')}</option>
          <option value="above">{t('Encima del elemento seleccionado')}</option>
        </Select>
      </div>
      <Checkbox checked={!withLabel} onChange={(_e, d) => setWithLabel(!d.checked)} label={t('Excluir el rótulo del título')} />
      <p style={{ fontSize: 12, margin: '8px 0 0' }}>{t('Vista previa')}: {withLabel ? `${used} 1` : '1'}{text ? `: ${text}` : ''}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ cross reference

export function XRefDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [kind, setKind] = useState<XRefKind>('heading');
  const labels = useMemo(() => captionLabels(ui.ctl.body), [ui]);
  const [label, setLabel] = useState(labels[0] ?? 'Figura');
  const targets = useMemo(() => xrefTargets(ui.ctl, kind, kind === 'caption' ? label : undefined), [ui, kind, label]);
  const [idx, setIdx] = useState(0);
  const [what, setWhat] = useState<XRefWhat>('text');
  const [link, setLink] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const opts: { id: XRefWhat; label: string }[] =
    kind === 'heading' || kind === 'bookmark'
      ? [{ id: 'text', label: kind === 'heading' ? 'Texto del título' : 'Texto del párrafo' }, { id: 'page', label: 'Número de página' }, { id: 'position', label: 'Arriba o abajo' }]
      : kind === 'caption'
        ? [{ id: 'label', label: 'Solo rótulo y número' }, { id: 'text', label: 'Título completo' }, { id: 'page', label: 'Número de página' }, { id: 'position', label: 'Arriba o abajo' }]
        : [{ id: 'number', label: 'Número de la nota' }, { id: 'page', label: 'Número de página' }];
  const valid = !!targets[idx];
  return (
    <Modal
      title={t('Referencia cruzada')}
      width={560}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
          <Button
            appearance="primary"
            disabled={!valid}
            onClick={() => {
              const e = insertCrossReference(ui.ctl, kind, targets[idx]!, opts.some((o) => o.id === what) ? what : opts[0]!.id, link);
              if (e) setError(e);
              else done(ui, onClose);
            }}
          >
            {t('Insertar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <div style={field}>
          <label htmlFor="nw-xr-kind">{t('Tipo de referencia')}</label>
          <Select id="nw-xr-kind" value={kind} onChange={(_e, d) => { setKind(d.value as XRefKind); setIdx(0); setWhat('text'); }}>
            <option value="heading">{t('Título')}</option>
            <option value="caption">{t('Título de figura o tabla')}</option>
            <option value="bookmark">{t('Marcador')}</option>
            <option value="footnote">{t('Nota al pie')}</option>
            <option value="endnote">{t('Nota final')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="nw-xr-what">{t('Insertar referencia a')}</label>
          <Select id="nw-xr-what" value={opts.some((o) => o.id === what) ? what : opts[0]!.id} onChange={(_e, d) => setWhat(d.value as XRefWhat)}>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {t(o.label)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {kind === 'caption' && (
        <div style={field}>
          <label htmlFor="nw-xr-label">{t('Rótulo')}</label>
          <Select id="nw-xr-label" value={label} onChange={(_e, d) => { setLabel(d.value); setIdx(0); }}>
            {(labels.length ? labels : ['Figura']).map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </div>
      )}
      <label htmlFor="nw-xr-list">{t('Para')}</label>
      <select id="nw-xr-list" className="nv-select" size={8} style={{ width: '100%', whiteSpace: 'pre' }} value={String(idx)} onChange={(e) => setIdx(Number(e.target.value))}>
        {targets.map((x, i) => (
          <option key={`${x.pos}-${i}`} value={String(i)}>
            {x.label || '(vacío)'}
          </option>
        ))}
      </select>
      {!targets.length && <p style={{ fontSize: 12 }}>{t('No hay elementos de este tipo en el documento.')}</p>}
      <Checkbox checked={link} onChange={(_e, d) => setLink(!!d.checked)} label={t('Insertar como hipervínculo')} />
      {error && <span role="alert">{error}</span>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ bookmarks

export function BookmarkDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const list = useMemo(() => listBookmarks(ui.ctl), [ui, version]);
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Modal
      title={t('Marcador')}
      onClose={onClose}
      actions={<Button appearance="primary" onClick={() => done(ui, onClose)}>{t('Cerrar')}</Button>}
    >
      <div style={field}>
        <label htmlFor="nw-bm-name">{t('Nombre del marcador')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <Input
            id="nw-bm-name"
            style={{ flex: 1 }}
            value={name}
            autoFocus
            onChange={(_e, d) => {
              setName(d.value);
              setError(null);
            }}
          />
          <Button
            disabled={!name}
            onClick={() => {
              const e = addBookmark(ui.ctl, name);
              if (e) setError(e);
              else {
                setName('');
                setVersion((v) => v + 1);
              }
            }}
          >
            {t('Agregar')}
          </Button>
        </div>
        {error && <span role="alert">{error}</span>}
      </div>
      <select className="nv-select" size={8} style={{ width: '100%' }} aria-label={t('Marcadores')} value={sel ?? ''} onChange={(e) => setSel(e.target.value)}>
        {list.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name} — {b.text.slice(0, 40)}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Button
          disabled={!sel}
          onClick={() => {
            goToBookmark(ui.ctl, sel!);
            done(ui, onClose);
          }}
        >
          {t('Ir a')}
        </Button>
        <Button
          disabled={!sel}
          onClick={() => {
            deleteBookmark(ui.ctl, sel!);
            setSel(null);
            setVersion((v) => v + 1);
          }}
        >
          {t('Eliminar')}
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ index

export function IndexMarkDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const st = ui.ctl.mainState;
  const selected = st && !st.selection.empty ? st.doc.textBetween(st.selection.from, st.selection.to, ' ').slice(0, 80) : '';
  const [main, setMain] = useState(selected);
  const [sub, setSub] = useState('');
  const [see, setSee] = useState('');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  return (
    <Modal
      title={t('Marcar entrada de índice')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!main.trim()}
            onClick={() => {
              markIndexEntry(ui.ctl, sub.trim() ? `${main.trim()}:${sub.trim()}` : main, { see: see.trim() ? (see.startsWith('Véase') ? see : `Véase ${see}`) : undefined, bold, italic });
              done(ui, onClose);
            }}
          >
            {t('Marcar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-ix-main">{t('Entrada principal')}</label>
        <Input id="nw-ix-main" value={main} autoFocus onChange={(_e, d) => setMain(d.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-ix-sub">{t('Subentrada')}</label>
        <Input id="nw-ix-sub" value={sub} onChange={(_e, d) => setSub(d.value)} />
      </div>
      <div style={field}>
        <label htmlFor="nw-ix-see">{t('Referencia cruzada (Véase…)')}</label>
        <Input id="nw-ix-see" value={see} onChange={(_e, d) => setSee(d.value)} />
      </div>
      <Checkbox checked={bold} onChange={(_e, d) => setBold(!!d.checked)} label={t('Número de página en negrita')} />
      <Checkbox checked={italic} onChange={(_e, d) => setItalic(!!d.checked)} label={t('Número de página en cursiva')} />
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ citations and sources

export function CiteDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const [picked, setPicked] = useState<string[]>([]);
  const [pages, setPages] = useState('');
  const [noAuthor, setNoAuthor] = useState(false);
  const [noYear, setNoYear] = useState(false);
  return (
    <Modal
      title={t('Insertar cita')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={() => ui.openDialog('sources')}>{t('Administrar fuentes…')}</Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!picked.length}
            onClick={() => {
              insertCitation(ctl, picked, { pages, suppressAuthor: noAuthor, suppressYear: noYear });
              done(ui, onClose);
            }}
          >
            {t('Insertar')}
          </Button>
        </>
      }
    >
      {!ctl.sources.length && <p>{t('No hay fuentes. Use "Administrar fuentes" para agregar las obras que va a citar.')}</p>}
      <div role="group" aria-label={t('Fuentes')} style={{ maxHeight: 220, overflow: 'auto', marginBottom: 8 }}>
        {ctl.sources.map((s) => (
          <div key={s.tag}>
            <Checkbox
              checked={picked.includes(s.tag)}
              onChange={(_e, d) => setPicked((p) => (d.checked ? [...p, s.tag] : p.filter((x) => x !== s.tag)))}
              label={`${citationText(s, ctl.citeStyle)} ${s.title}`}
            />
          </div>
        ))}
      </div>
      <div style={field}>
        <label htmlFor="nw-cite-pages">{t('Páginas (opcional)')}</label>
        <Input id="nw-cite-pages" value={pages} onChange={(_e, d) => setPages(d.value)} />
      </div>
      <Checkbox checked={noAuthor} onChange={(_e, d) => setNoAuthor(!!d.checked)} label={t('Omitir el autor')} />
      <Checkbox checked={noYear} onChange={(_e, d) => setNoYear(!!d.checked)} label={t('Omitir el año')} />
    </Modal>
  );
}

const AUTHORS_HELP = 'Un autor por línea, como "Apellido, Nombre".';

export function SourcesDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const [list, setList] = useState<Source[]>(ctl.sources.map((s) => ({ ...s })));
  const [style, setStyle] = useState<CiteStyle>(ctl.citeStyle);
  const [sel, setSel] = useState(list.length ? 0 : -1);
  const cur = list[sel];
  const patch = (p: Partial<Source>) => setList((l) => l.map((s, i) => (i === sel ? { ...s, ...p } : s)));
  const tagTaken = !!cur && list.some((s, i) => i !== sel && s.tag === cur.tag);
  const valid = list.every((s) => s.tag.trim() && s.title.trim()) && !list.some((s, i) => list.findIndex((x) => x.tag === s.tag) !== i);
  const add = () => {
    let n = list.length + 1;
    while (list.some((s) => s.tag === `Fuente${n}`)) n++;
    setList((l) => [...l, emptySource(`Fuente${n}`)]);
    setSel(list.length);
  };
  const f = (key: keyof Source, label: string) => (
    <div style={field} key={key}>
      <label htmlFor={`nw-src-${key}`}>{label}</label>
      <Input id={`nw-src-${key}`} value={String((cur as never)?.[key] ?? '')} onChange={(_e, d) => patch({ [key]: d.value } as Partial<Source>)} />
    </div>
  );
  return (
    <Modal
      title={t('Administrar fuentes')}
      width={760}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!valid}
            onClick={() => {
              ctl.sources = list;
              ctl.citeStyle = style;
              ctl.dirty = true;
              ctl.touch();
              void import('./refs-actions').then((m) => {
                m.updateFields(ctl);
                void m.updateGenerated(ctl, 1);
              });
              done(ui, onClose);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ ...field, maxWidth: 320 }}>
        <label htmlFor="nw-src-style">{t('Estilo')}</label>
        <Select id="nw-src-style" value={style} onChange={(_e, d) => setStyle(d.value as CiteStyle)}>
          {CITE_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.label)}
            </option>
          ))}
        </Select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12 }}>
        <div>
          <select className="nv-select" size={12} style={{ width: '100%' }} aria-label={t('Fuentes')} value={String(sel)} onChange={(e) => setSel(Number(e.target.value))}>
            {list.map((s, i) => (
              <option key={i} value={String(i)}>
                {s.tag} — {s.title || '…'}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <Button onClick={add}>{t('Nueva')}</Button>
            <Button
              disabled={!cur}
              onClick={() => {
                setList((l) => l.filter((_, i) => i !== sel));
                setSel(Math.max(0, sel - 1));
              }}
            >
              {t('Eliminar')}
            </Button>
          </div>
        </div>
        {cur ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px', alignContent: 'start' }}>
            <div style={field}>
              <label htmlFor="nw-src-type">{t('Tipo de fuente')}</label>
              <Select id="nw-src-type" value={cur.type} onChange={(_e, d) => patch({ type: d.value as Source['type'] })}>
                {SOURCE_TYPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.label)}
                  </option>
                ))}
              </Select>
            </div>
            {f('tag', t('Nombre de la cita'))}
            <div style={{ ...field, gridColumn: '1 / -1' }}>
              <label htmlFor="nw-src-authors">{t('Autores')}</label>
              <textarea id="nw-src-authors" className="nw-card-edit" value={cur.authors.join('\n')} onChange={(e) => patch({ authors: e.target.value.split('\n').filter((l) => l.trim()) })} />
              <small>{t(AUTHORS_HELP)}</small>
            </div>
            {f('title', t('Título'))}
            {f('year', t('Año'))}
            {f('publisher', t('Editorial'))}
            {f('city', t('Ciudad'))}
            {(cur.type === 'article' || cur.type === 'conference') && f('journal', t('Revista o publicación'))}
            {cur.type === 'article' && f('volume', t('Volumen'))}
            {cur.type === 'article' && f('issue', t('Número'))}
            {f('pages', t('Páginas'))}
            {f('edition', t('Edición'))}
            {f('url', 'URL')}
            {f('doi', 'DOI')}
            {tagTaken && <span role="alert" style={{ gridColumn: '1 / -1' }}>{t('Ya hay una fuente con ese nombre de cita.')}</span>}
            <p style={{ gridColumn: '1 / -1', fontSize: 12, margin: 0 }}>
              {t('Vista previa')}: {citationText(cur, style)} — {bibliographyEntry(cur, style, 1)}
            </p>
          </div>
        ) : (
          <p>{t('Agregue una fuente con "Nueva".')}</p>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ notes options

export function NoteOptionsDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const ctl = ui.ctl;
  const [o, setO] = useState<NotesOptions>({ ...ctl.notesOptions });
  const fmts: { id: NotesOptions['footnoteFormat']; label: string }[] = [
    { id: 'decimal', label: '1, 2, 3…' },
    { id: 'lowerLetter', label: 'a, b, c…' },
    { id: 'upperLetter', label: 'A, B, C…' },
    { id: 'lowerRoman', label: 'i, ii, iii…' },
    { id: 'upperRoman', label: 'I, II, III…' },
    { id: 'symbols', label: '*, †, ‡, §…' },
  ];
  return (
    <Modal
      title={t('Notas al pie y notas finales')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              ctl.notesOptions = o;
              ctl.dirty = true;
              ctl.invalidateNotes();
              ctl.refreshNotes();
              done(ui, onClose);
            }}
          >
            {t('Aplicar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-no-ff">{t('Formato de las notas al pie')}</label>
        <Select id="nw-no-ff" value={o.footnoteFormat} onChange={(_e, d) => setO({ ...o, footnoteFormat: d.value as NotesOptions['footnoteFormat'] })}>
          {fmts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-no-fr">{t('Numeración')}</label>
        <Select id="nw-no-fr" value={o.footnoteRestart} onChange={(_e, d) => setO({ ...o, footnoteRestart: d.value as NotesOptions['footnoteRestart'] })}>
          <option value="continuous">{t('Continua')}</option>
          <option value="section">{t('Reiniciar en cada sección')}</option>
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-no-ef">{t('Formato de las notas finales')}</label>
        <Select id="nw-no-ef" value={o.endnoteFormat} onChange={(_e, d) => setO({ ...o, endnoteFormat: d.value as NotesOptions['endnoteFormat'] })}>
          {fmts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}
