import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { RULINGS, TEMPLATES, TRASH_DAYS, bodyOf, diffLines, displayTitle, findTag, pageText, tagDefs, tagItems, trashTitle, versionText, type Container, type Ruling } from '@suitenova/notes-core';
import { isSafeHref, markTypes, parseMath, toMathML, nodeTypes } from '@suitenova/writer-core';
import { NodeSelection } from 'prosemirror-state';
import { useEffect, useState } from 'react';
import type { NotesCtl } from './ctl';
import { createTable, insertBlockAfterCursor, markAttr, setLink } from './editing';

export function Modal({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: React.ReactNode; actions: React.ReactNode; wide?: boolean }) {
  // Fluent deja aria-hidden en la página cuando el padre desmonta el diálogo abierto (invisible para lectores de pantalla y automatización):
  // se devuelve cuando ya no queda ningún diálogo (mismo arreglo que en Nova Writer).
  useEffect(
    () => () => {
      setTimeout(() => {
        if (document.querySelector('[role=dialog]')) return;
        for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
        document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
      }, 0);
    },
    [],
  );
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: wide ? 760 : 520, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };
const closeBtn = (onClose: () => void) => (
  <Button appearance="primary" onClick={onClose}>
    {t('Cerrar')}
  </Button>
);
const refocus = (ctl: NotesCtl) => setTimeout(() => ctl.focusEditor(), 80);

/** Todas las páginas de la libreta que se pueden enlazar (las bloqueadas no). */
function allPages(ctl: NotesCtl): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const s of ctl.nb.sections) {
    if (s.vault) continue;
    for (const p of s.pages) if (!p.vault) out.push({ id: p.id, label: `${s.name} › ${'  '.repeat(p.level)}${displayTitle(p)}` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ links

export function LinkDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const st = ctl.view?.state;
  const existing = (st && (markAttr(st, markTypes.link!, 'href') as string | undefined)) || '';
  const pageId = /^#nn:page:(.+)$/.exec(existing)?.[1];
  const pages = allPages(ctl);
  const [kind, setKind] = useState<'web' | 'page'>(pageId ? 'page' : 'web');
  const [href, setHref] = useState(existing && !pageId ? existing : 'https://');
  const [target, setTarget] = useState(pageId ?? pages.find((p) => p.id !== ctl.page.id)?.id ?? pages[0]?.id ?? '');
  const [text, setText] = useState('');
  const bad = kind === 'web' && !!href && !isSafeHref(href);
  const close = () => {
    onClose();
    refocus(ctl);
  };
  const finalHref = kind === 'page' ? `#nn:page:${target}` : href.trim();
  const label = kind === 'page' ? (pages.find((p) => p.id === target)?.label.split('›').pop()?.trim() ?? '') : '';
  return (
    <Modal
      title={t('Hipervínculo')}
      onClose={close}
      actions={
        <>
          {existing && (
            <Button
              onClick={() => {
                ctl.run(setLink(null));
                close();
              }}
            >
              {t('Quitar vínculo')}
            </Button>
          )}
          <Button onClick={close}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!finalHref || bad || (kind === 'page' && !target)}
            onClick={() => {
              ctl.run(setLink(finalHref, text || label));
              close();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div role="tablist" className="nn-tagtabs">
        <button type="button" role="tab" aria-selected={kind === 'web'} className={kind === 'web' ? 'is-on' : ''} onClick={() => setKind('web')}>
          {t('Dirección web o de correo')}
        </button>
        <button type="button" role="tab" aria-selected={kind === 'page'} className={kind === 'page' ? 'is-on' : ''} onClick={() => setKind('page')}>
          {t('Página de esta libreta')}
        </button>
      </div>
      {kind === 'web' ? (
        <div style={field}>
          <label htmlFor="nn-link-href">{t('Dirección')}</label>
          <Input id="nn-link-href" value={href} onChange={(_e, d) => setHref(d.value)} autoFocus />
          {bad && <span role="alert">{t('Solo se admiten direcciones http, https, mailto, tel o anclas (#).')}</span>}
        </div>
      ) : (
        <div style={field}>
          <label htmlFor="nn-link-page">{t('Página')}</label>
          <select id="nn-link-page" className="nv-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {(!st || st.selection.empty) && (
        <div style={field}>
          <label htmlFor="nn-link-text">{t('Texto que mostrar')}</label>
          <Input id="nn-link-text" value={text} onChange={(_e, d) => setText(d.value)} placeholder={label} />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ table

export function TableDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const ok = rows >= 1 && rows <= 100 && cols >= 1 && cols <= 20;
  const close = () => {
    onClose();
    refocus(ctl);
  };
  return (
    <Modal
      title={t('Insertar tabla')}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!ok}
            onClick={() => {
              ctl.run(insertBlockAfterCursor(createTable(rows, cols, Math.max(160, (ctl.page.containers.find((c) => c.id === ctl.activeId)?.w ?? 560) - 16))));
              close();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nn-tbl-cols">{t('Número de columnas')}</label>
        <Input id="nn-tbl-cols" type="number" value={String(cols)} onChange={(_e, d) => setCols(Number(d.value))} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nn-tbl-rows">{t('Número de filas')}</label>
        <Input id="nn-tbl-rows" type="number" value={String(rows)} onChange={(_e, d) => setRows(Number(d.value))} />
      </div>
      <p className="nn-note">{t('En una celda puedes escribir una fórmula empezando por «=»: =B2*C2, =SUMA(ARRIBA), =PROMEDIO(A1:A5)… Las celdas se llaman A1, B2… como en una hoja de cálculo.')}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ tags

export function TagsDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const defs = tagDefs(ctl.nb.tagDefs);
  const [tab, setTab] = useState<'summary' | 'mine'>('summary');
  const [tag, setTag] = useState<string>('todo');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [symbol, setSymbol] = useState('●');
  const [color, setColor] = useState('#0f6cbd');
  const [checkbox, setCheckbox] = useState(false);
  const all = tagItems(ctl.nb);
  const count = (id: string) => all.filter((i) => i.tag === id).length;
  const items = tagItems(ctl.nb, tag).filter((i) => !onlyOpen || !i.done);
  const def = findTag(tag, ctl.nb.tagDefs);
  return (
    <Modal title={t('Etiquetas')} onClose={onClose} wide actions={closeBtn(onClose)}>
      <div role="tablist" className="nn-tagtabs">
        <button type="button" role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'is-on' : ''} onClick={() => setTab('summary')}>
          {t('Resumen de etiquetas')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'is-on' : ''} onClick={() => setTab('mine')}>
          {t('Mis etiquetas')}
        </button>
      </div>
      {tab === 'summary' ? (
        <>
          <div className="nn-row">
            <label htmlFor="nn-tag-pick">{t('Etiqueta')}</label>
            <select id="nn-tag-pick" className="nv-select" value={tag} onChange={(e) => setTag(e.target.value)}>
              {defs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.symbol} {t(d.label)} ({count(d.id)})
                </option>
              ))}
            </select>
            {def?.checkbox && (
              <label>
                <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {t('Solo las pendientes')}
              </label>
            )}
          </div>
          {items.length === 0 ? (
            <p>{t('No hay elementos con esta etiqueta.')}</p>
          ) : (
            <ul className="nn-taglist" aria-label={t('Elementos con la etiqueta')}>
              {items.map((it, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      ctl.goTo(it.sectionId, it.pageId);
                      onClose();
                    }}
                  >
                    <strong>
                      {it.done ? '☑ ' : ''}
                      {it.text || t('(vacío)')}
                    </strong>
                    <span>{it.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <ul className="nn-taglist" aria-label={t('Mis etiquetas')}>
            {ctl.nb.tagDefs.length === 0 && <li className="nn-note">{t('Todavía no has creado ninguna etiqueta propia.')}</li>}
            {ctl.nb.tagDefs.map((d) => (
              <li key={d.id} className="nn-row">
                <span style={{ color: d.color, fontSize: 18 }}>{d.checkbox ? '☐' : d.symbol}</span>
                <strong>{d.label}</strong>
                <Button size="small" onClick={() => ctl.removeCustomTag(d.id)} aria-label={`${t('Quitar')} ${d.label}`}>
                  {t('Quitar')}
                </Button>
              </li>
            ))}
          </ul>
          <fieldset className="nn-fieldset">
            <legend>{t('Etiqueta nueva')}</legend>
            <div style={field}>
              <label htmlFor="nn-tag-label">{t('Nombre')}</label>
              <Input id="nn-tag-label" value={label} onChange={(_e, d) => setLabel(d.value)} />
            </div>
            <div className="nn-row">
              <label htmlFor="nn-tag-symbol">{t('Símbolo')}</label>
              <Input id="nn-tag-symbol" value={symbol} onChange={(_e, d) => setSymbol(d.value)} style={{ width: 70 }} />
              <label htmlFor="nn-tag-color">{t('Color')}</label>
              <input id="nn-tag-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <label>
                <input type="checkbox" checked={checkbox} onChange={(e) => setCheckbox(e.target.checked)} /> {t('Con casilla')}
              </label>
              <Button
                appearance="primary"
                disabled={!label.trim()}
                onClick={() => {
                  ctl.addCustomTag(label, symbol, color, checkbox);
                  setLabel('');
                }}
              >
                {t('Crear etiqueta')}
              </Button>
            </div>
          </fieldset>
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ templates and page style

export function TemplatesDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal title={t('Plantillas de página')} onClose={onClose} wide actions={closeBtn(onClose)}>
      <ul className="nn-templates" aria-label={t('Plantillas')}>
        {TEMPLATES.map((tp) => (
          <li key={tp.id}>
            <div>
              <strong>{t(tp.name)}</strong>
              <span>{t(tp.description)}</span>
            </div>
            <Button
              onClick={() => {
                ctl.addPage(tp.id);
                onClose();
              }}
              aria-label={`${t('Página nueva con')} ${t(tp.name)}`}
            >
              {t('Página nueva')}
            </Button>
            <Button
              onClick={() => {
                if (!ctl.page.containers.some((c) => c.kind !== 'text' || c.content) || window.confirm(t('Esto sustituye el contenido de la página actual (se puede deshacer). ¿Continuar?'))) {
                  ctl.applyTemplate(tp.id);
                  onClose();
                }
              }}
              aria-label={`${t('Aplicar')} ${t(tp.name)}`}
            >
              {t('Aplicar a esta página')}
            </Button>
          </li>
        ))}
        {ctl.nb.templates.map((tp) => (
          <li key={tp.id}>
            <div>
              <strong>{tp.name}</strong>
              <span>{t('Plantilla propia')}</span>
            </div>
            <Button
              onClick={() => {
                ctl.addPageFromUserTemplate(tp.id);
                onClose();
              }}
              aria-label={`${t('Página nueva con')} ${tp.name}`}
            >
              {t('Página nueva')}
            </Button>
            <Button onClick={() => ctl.deleteTemplate(tp.id)} aria-label={`${t('Quitar')} ${tp.name}`}>
              {t('Quitar')}
            </Button>
          </li>
        ))}
      </ul>
      <fieldset className="nn-fieldset">
        <legend>{t('Guardar esta página como plantilla')}</legend>
        <div className="nn-row">
          <Input aria-label={t('Nombre de la plantilla')} placeholder={displayTitle(ctl.page)} value={name} onChange={(_e, d) => setName(d.value)} />
          <Button
            onClick={() => {
              ctl.saveAsTemplate(name);
              setName('');
            }}
          >
            {t('Guardar plantilla')}
          </Button>
        </div>
      </fieldset>
    </Modal>
  );
}

const RULING_LABEL: Record<Ruling, string> = {
  none: 'Sin reglas',
  narrow: 'Líneas estrechas',
  standard: 'Líneas normales',
  wide: 'Líneas anchas',
  'grid-small': 'Cuadrícula pequeña',
  'grid-medium': 'Cuadrícula mediana',
  'grid-large': 'Cuadrícula grande',
};
const PAPERS = ['#ffffff', '#fffdf5', '#fff8e1', '#f1f8e9', '#e8f4fd', '#f3e5f5', '#fbe9e7', '#eceff1', '#1f1f1f'];

export function PageStyleDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const s = ctl.page.style;
  return (
    <Modal title={t('Reglas y color de la página')} onClose={onClose} actions={closeBtn(onClose)}>
      <div style={field}>
        <label htmlFor="nn-ruling">{t('Reglas')}</label>
        <select id="nn-ruling" className="nv-select" value={s.ruling} onChange={(e) => ctl.setStyle({ ruling: e.target.value as Ruling })}>
          {RULINGS.map((r) => (
            <option key={r} value={r}>
              {t(RULING_LABEL[r])}
            </option>
          ))}
        </select>
      </div>
      <div style={field}>
        <span id="nn-paper-l">{t('Color del papel')}</span>
        <div className="nn-swatches" role="group" aria-labelledby="nn-paper-l">
          {PAPERS.map((c) => (
            <button key={c} type="button" className={s.color === c ? 'is-on' : ''} style={{ background: c }} aria-label={c} title={c} onClick={() => ctl.setStyle({ color: c })} />
          ))}
          <input type="color" aria-label={t('Otro color')} value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#ffffff'} onChange={(e) => ctl.setStyle({ color: e.target.value })} />
        </div>
      </div>
      <label>
        <input type="checkbox" checked={s.margin} onChange={(e) => ctl.setStyle({ margin: e.target.checked })} /> {t('Línea de margen')}
      </label>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ versions and trash

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function VersionsDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const page = ctl.page;
  const versions = [...page.versions].reverse();
  const [sel, setSel] = useState<string | null>(versions[0]?.id ?? null);
  const [label, setLabel] = useState('');
  const v = page.versions.find((x) => x.id === sel);
  const diff = v ? diffLines(versionText(v), pageText(page)) : [];
  return (
    <Modal
      title={t('Historial de versiones')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button
            disabled={!v}
            onClick={() => {
              if (v && window.confirm(t('La página volverá a como estaba el {fecha}. Lo de ahora se guarda como una versión más. ¿Continuar?', { fecha: when(v.at) }))) {
                ctl.restore(v.id);
                onClose();
              }
            }}
          >
            {t('Restaurar esta versión')}
          </Button>
          <Button disabled={!v} onClick={() => v && (ctl.deleteVersion(v.id), setSel(null))}>
            {t('Eliminar esta versión')}
          </Button>
          {closeBtn(onClose)}
        </>
      }
    >
      <div className="nn-row">
        <Input aria-label={t('Nombre de la versión')} placeholder={t('Nombre de la versión (opcional)')} value={label} onChange={(_e, d) => setLabel(d.value)} />
        <Button
          onClick={() => {
            ctl.saveVersion(label);
            setLabel('');
            setSel(ctl.page.versions[ctl.page.versions.length - 1]?.id ?? null);
          }}
        >
          {t('Guardar una versión ahora')}
        </Button>
      </div>
      <p className="nn-note">{t('Se guardan versiones solas al guardar el archivo (como mucho una cada 10 minutos) y se conservan las últimas 30.')}</p>
      <div className="nn-versions">
        <ul aria-label={t('Versiones')}>
          {versions.length === 0 && <li className="nn-note">{t('Esta página todavía no tiene versiones guardadas.')}</li>}
          {versions.map((x) => (
            <li key={x.id}>
              <button type="button" className={x.id === sel ? 'is-on' : ''} onClick={() => setSel(x.id)}>
                <strong>{x.label || (x.manual ? t('Versión guardada') : t('Versión automática'))}</strong>
                <span>{when(x.at)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="nn-diff" aria-label={t('Diferencias con la versión actual')}>
          {!v ? (
            <p className="nn-note">{t('Elige una versión para ver qué cambió.')}</p>
          ) : diff.every((d) => d.kind === 'same') ? (
            <p>{t('El texto es igual al actual (puede que cambie la posición de los cuadros, las imágenes o la tinta).')}</p>
          ) : (
            diff.map((d, i) => (
              <div key={i} className={`nn-diff__${d.kind}`}>
                {d.kind === 'add' ? '+ ' : d.kind === 'del' ? '− ' : '  '}
                {d.text || ' '}
              </div>
            ))
          )}
          {v && <p className="nn-note">{t('Verde: lo que tiene la página ahora y no tenía entonces. Rojo: lo que tenía entonces y ya no.')}</p>}
        </div>
      </div>
    </Modal>
  );
}

export function TrashDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const items = [...ctl.nb.trash].reverse();
  return (
    <Modal
      title={t('Papelera')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button
            disabled={!items.length}
            onClick={() => {
              if (window.confirm(t('¿Vaciar la papelera? Lo que hay en ella se perderá para siempre.'))) ctl.purgeTrash();
            }}
          >
            {t('Vaciar la papelera')}
          </Button>
          {closeBtn(onClose)}
        </>
      }
    >
      <p className="nn-note">{t('Las páginas y secciones eliminadas se guardan aquí {n} días y después se borran solas.', { n: TRASH_DAYS })}</p>
      {items.length === 0 ? (
        <p>{t('La papelera está vacía.')}</p>
      ) : (
        <ul className="nn-templates" aria-label={t('Elementos eliminados')}>
          {items.map((it) => (
            <li key={it.id}>
              <div>
                <strong>{it.kind === 'section' ? `${t('Sección')}: ${trashTitle(it)}` : trashTitle(it)}</strong>
                <span>
                  {it.kind === 'page' ? t('Página') : t('Sección')} · {when(it.at)}
                </span>
              </div>
              <Button
                onClick={() => {
                  ctl.restoreFromTrash(it.id);
                  onClose();
                }}
                aria-label={`${t('Restaurar')} ${trashTitle(it)}`}
              >
                {t('Restaurar')}
              </Button>
              <Button onClick={() => ctl.purgeTrash(it.id)} aria-label={`${t('Eliminar para siempre')} ${trashTitle(it)}`}>
                {t('Eliminar para siempre')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ password

export function ProtectDialog({ ctl, what, onClose }: { ctl: NotesCtl; what: 'page' | 'section'; onClose: () => void }) {
  const target = what === 'page' ? ctl.page : ctl.section;
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = pw.length >= 4 && pw === pw2;
  const protectedNow = !!target.protect;
  return (
    <Modal
      title={what === 'page' ? t('Proteger la página con contraseña') : t('Proteger la sección con contraseña')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          {protectedNow && (
            <Button
              onClick={() => {
                ctl.removeProtection(what);
                onClose();
              }}
            >
              {t('Quitar la contraseña')}
            </Button>
          )}
          <Button
            appearance="primary"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (what === 'page') await ctl.protectPage(pw, hint);
                else await ctl.protectSection(pw, hint);
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('Cifrando…') : protectedNow ? t('Cambiar la contraseña') : t('Poner contraseña')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nn-pw1">{t('Contraseña (al menos 4 caracteres)')}</label>
        <Input id="nn-pw1" type="password" value={pw} onChange={(_e, d) => setPw(d.value)} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nn-pw2">{t('Repite la contraseña')}</label>
        <Input id="nn-pw2" type="password" value={pw2} onChange={(_e, d) => setPw2(d.value)} />
        {pw2 && pw !== pw2 && <span role="alert">{t('Las contraseñas no coinciden.')}</span>}
      </div>
      <div style={field}>
        <label htmlFor="nn-pwh">{t('Pista (opcional; se ve sin la contraseña)')}</label>
        <Input id="nn-pwh" value={hint} onChange={(_e, d) => setHint(d.value)} />
      </div>
      <p className="nn-note">{t('El contenido se cifra con AES-256 en el archivo. Después de poner la contraseña, usa «Bloquear» para ocultarlo. Si la olvidas, no hay forma de recuperar el contenido.')}</p>
      {err && <p role="alert">{err}</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ share

export function ShareDialog({ ctl, onClose, onMerge }: { ctl: NotesCtl; onClose: () => void; onMerge: () => void }) {
  return (
    <Modal title={t('Libreta compartida')} onClose={onClose} wide actions={closeBtn(onClose)}>
      <p>{t('Nova Notes no tiene servidor. Para compartir una libreta guarda el archivo (.novanotes) en una carpeta que sincronice otro programa (OneDrive, Dropbox, Syncthing, una carpeta de red…) y ábrelo desde ahí en cada equipo.')}</p>
      <label className="nn-row">
        <input type="checkbox" checked={!!ctl.nb.shared} onChange={(e) => ctl.setShared(e.target.checked)} />
        <span>{t('Esta libreta es compartida: al guardar y cada medio minuto se combina con los cambios de los demás')}</span>
      </label>
      <ul className="nn-note">
        <li>{t('La combinación es por páginas: lo que cambió en un solo lado se queda; si una página cambió en los dos lados se conservan las dos versiones (la otra queda debajo como «conflicto»).')}</li>
        <li>{t('No hay edición simultánea del mismo texto ni avisos de quién está conectado: es una combinación de copias.')}</li>
        <li>{t('Si dos personas guardan casi a la vez, el programa de sincronización puede crear una «copia en conflicto» del archivo: ábrela con «Combinar con otro archivo».')}</li>
      </ul>
      <p>
        <Button onClick={onMerge}>{t('Combinar con otro archivo…')}</Button>
      </p>
      {ctl.nb.syncedAt ? <p className="nn-note">{t('Última combinación: {fecha}', { fecha: when(ctl.nb.syncedAt) })}</p> : null}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ equation

const SAMPLES = ['x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', '\\int_0^1 x^2 \\, dx = \\frac{1}{3}', 'E = mc^2', '\\frac{a}{b} + \\frac{c}{d}', '\\sqrt{x^2 + y^2}', '\\alpha + \\beta = \\gamma'];

export function EquationDialog({ ctl, pos, onClose }: { ctl: NotesCtl; pos?: number; onClose: () => void }) {
  const v = ctl.view;
  const node = pos !== undefined && v ? v.state.doc.nodeAt(pos) : null;
  const [tex, setTex] = useState<string>((node?.attrs.tex as string) ?? '');
  const [display, setDisplay] = useState(!!node?.attrs.display);
  let ml = '';
  try {
    ml = tex.trim() ? toMathML(parseMath(tex), display) : '';
  } catch {
    ml = '';
  }
  const close = () => {
    onClose();
    refocus(ctl);
  };
  return (
    <Modal
      title={t('Ecuación')}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!tex.trim()}
            onClick={() => {
              if (!v) return close();
              const n = nodeTypes.math!.create({ tex: tex.trim(), display });
              if (pos !== undefined && node) v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)).replaceSelectionWith(n, false));
              else v.dispatch(v.state.tr.replaceSelectionWith(n, false).scrollIntoView());
              close();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nn-eq">{t('Escribe la ecuación en LaTeX (por ejemplo \\frac{a}{b}, x^2, \\sqrt{x}, \\sum_{i=1}^{n})')}</label>
        <textarea id="nn-eq" className="nn-eqsrc" rows={3} value={tex} onChange={(e) => setTex(e.target.value)} autoFocus />
      </div>
      <label>
        <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> {t('En su propia línea (más grande)')}
      </label>
      <div className="nn-eqprev" aria-label={t('Vista previa')} dangerouslySetInnerHTML={{ __html: ml || `<span style="color:#888">${t('Vista previa')}</span>` }} />
      <div className="nn-row">
        {SAMPLES.map((s) => (
          <button key={s} type="button" className="nn-chip" onClick={() => setTex(s)}>
            {s}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ image properties and OCR text

export function ImageDialog({ ctl, id, onClose, onOcr }: { ctl: NotesCtl; id: string; onClose: () => void; onOcr: () => void }) {
  const c = ctl.page.containers.find((x) => x.id === id) as Extract<Container, { kind: 'image' }> | undefined;
  const [alt, setAlt] = useState(c?.alt ?? '');
  if (!c) return null;
  const text = ctl.ocrTextOf(c);
  const done = !!ctl.nb.ocr[c.asset];
  return (
    <Modal
      title={t('Imagen')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button
            onClick={() => {
              ctl.setAlt(c.id, alt);
              onClose();
            }}
          >
            {t('Guardar el texto alternativo')}
          </Button>
          {closeBtn(onClose)}
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nn-alt">{t('Texto alternativo (lo leen los lectores de pantalla y se incluye en la búsqueda)')}</label>
        <Input id="nn-alt" value={alt} onChange={(_e, d) => setAlt(d.value)} />
      </div>
      <div style={field}>
        <span>{t('Texto reconocido en la imagen (OCR)')}</span>
        <textarea className="nn-eqsrc" readOnly rows={6} aria-label={t('Texto reconocido en la imagen')} value={done ? text || t('(no se encontró texto)') : t('(todavía no se ha reconocido)')} />
      </div>
      <div className="nn-row">
        <Button
          onClick={() => {
            ctl.forgetOcr(c.asset);
            onOcr();
          }}
        >
          {t('Reconocer el texto de nuevo')}
        </Button>
        <Button disabled={!text} onClick={() => void navigator.clipboard?.writeText(text)}>
          {t('Copiar el texto')}
        </Button>
        <Button
          disabled={!text}
          onClick={() => {
            const v = ctl.view;
            if (v) v.dispatch(v.state.tr.insertText(text));
            else ctl.addTextAt(c.x, c.y + c.h + 16);
            onClose();
          }}
        >
          {t('Insertar el texto en la página')}
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ email

export function EmailDialog({ onClose, onSend, defaultSubject }: { onClose: () => void; onSend: (to: string, subject: string) => Promise<void>; defaultSubject: string }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('Enviar la página por correo')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSend(to, subject);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('Preparando…') : t('Preparar el correo')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nn-mail-to">{t('Para (opcional)')}</label>
        <Input id="nn-mail-to" value={to} onChange={(_e, d) => setTo(d.value)} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nn-mail-subject">{t('Asunto')}</label>
        <Input id="nn-mail-subject" value={subject} onChange={(_e, d) => setSubject(d.value)} />
      </div>
      <p className="nn-note">{t('Se crea un mensaje de correo (.eml) con la página, sus imágenes y su tinta, que puedes abrir en Nova Mail, Outlook u otro programa para revisarlo y enviarlo. Nova Notes no envía nada por sí misma.')}</p>
    </Modal>
  );
}

void bodyOf;
