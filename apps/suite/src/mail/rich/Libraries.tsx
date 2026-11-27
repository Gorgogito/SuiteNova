/** The dialogs of the signatures and of the message templates. */
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { writerSchema } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { useRef, useState } from 'react';
import type { RemoteAccount } from '../remote';
import { insertPictureFile } from './picture';
import { FormatBar } from './FormatBar';
import { docOf } from './content';
import { loadSignatures, loadTemplates, newLibraryId, saveSignatures, saveTemplates, type Signature, type Signatures, type SignatureUse, type Template } from './library';
import { RichEditor } from './RichEditor';

export function SignaturesDialog({ accounts, onClose }: { accounts: RemoteAccount[]; onClose: () => void }) {
  const [data, setData] = useState<Signatures>(loadSignatures);
  const [selected, setSelected] = useState<string | null>(() => data.list[0]?.id ?? null);
  const [view, setView] = useState<EditorView | null>(null);
  const [, setTick] = useState(0);
  const [error, setError] = useState('');
  const picture = useRef<HTMLInputElement>(null);
  const current = data.list.find((s) => s.id === selected);
  const change = (patch: Partial<Signature>, id = selected) => setData((d) => ({ ...d, list: d.list.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const add = () => {
    const names = new Set(data.list.map((s) => s.name));
    let n = data.list.length + 1;
    while (names.has(t('Firma {n}', { n }))) n++;
    const sig: Signature = { id: newLibraryId(), name: t('Firma {n}', { n }), doc: docOf({ body: '' }).toJSON() };
    // the first signature is put in by itself, as the person expects when they make one
    setData((d) => ({ list: [...d.list, sig], defaults: d.list.length ? d.defaults : { ...d.defaults, '': { new: sig.id, reply: sig.id } } }));
    setSelected(sig.id);
  };
  const remove = () => {
    if (!current) return;
    const list = data.list.filter((s) => s.id !== current.id);
    setData((d) => ({ list, defaults: d.defaults }));
    setSelected(list[0]?.id ?? null);
  };
  const choose = (account: string, use: SignatureUse, value: string) =>
    setData((d) => {
      const own = { ...(d.defaults[account] ?? {}) };
      if (value === 'inherit') delete own[use];
      else own[use] = value;
      return { ...d, defaults: { ...d.defaults, [account]: own } };
    });
  const save = () => {
    try {
      saveSignatures(data);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rows: { id: string; name: string }[] = [{ id: '', name: t('Todas las cuentas') }, ...accounts.map((a) => ({ id: a.id, name: a.name }))];
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 820, width: '94vw' }}>
        <DialogBody>
          <DialogTitle>{t('Firmas')}</DialogTitle>
          <DialogContent>
            <div className="ml-sigs">
              <div className="ml-sigs__list">
                <ul role="listbox" aria-label={t('Firmas')}>
                  {data.list.map((s) => (
                    <li key={s.id} role="option" aria-selected={s.id === selected}>
                      <button type="button" className={s.id === selected ? 'is-current' : ''} onClick={() => setSelected(s.id)}>
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="ml-btn" onClick={add}>
                  {t('Nueva firma')}
                </button>
                <button type="button" className="ml-btn" disabled={!current} onClick={remove}>
                  {t('Quitar firma')}
                </button>
              </div>
              {current ? (
                <div className="ml-sigs__edit">
                  <label>
                    <span>{t('Nombre de la firma')}</span>
                    <input aria-label={t('Nombre de la firma')} value={current.name} onChange={(e) => change({ name: e.target.value })} />
                  </label>
                  <FormatBar view={view}>
                    <button type="button" className="ml-btn" onClick={() => picture.current?.click()}>
                      {t('Insertar imagen')}
                    </button>
                  </FormatBar>
                  <input
                    ref={picture}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f && view) void insertPictureFile(view, f, 240).catch((x) => setError((x as Error).message));
                    }}
                  />
                  <RichEditor key={current.id} initial={docOf({ body: '', doc: current.doc })} label={t('Texto de la firma')} onChange={(doc: PMNode) => change({ doc: doc.toJSON() }, current.id)} onSelect={() => setTick((n) => n + 1)} onView={setView} />
                </div>
              ) : (
                <p className="ml-empty">{t('Todavía no hay ninguna firma.')}</p>
              )}
            </div>
            {data.list.length > 0 && (
              <table className="ml-sigs__defaults">
                <caption>{t('Firma que se pone sola')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Cuenta')}</th>
                    <th scope="col">{t('Mensajes nuevos')}</th>
                    <th scope="col">{t('Respuestas y reenvíos')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      {(['new', 'reply'] as const).map((use) => (
                        <td key={use}>
                          <select className="nv-select" aria-label={`${r.name}: ${use === 'new' ? t('Mensajes nuevos') : t('Respuestas y reenvíos')}`} value={data.defaults[r.id]?.[use] ?? (r.id ? 'inherit' : '')} onChange={(e) => choose(r.id, use, e.target.value)}>
                            {r.id && <option value="inherit">{t('La de todas las cuentas')}</option>}
                            <option value="">{t('(Sin firma)')}</option>
                            {data.list.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && (
              <div className="ml-acc__err" role="alert">
                {t(error)}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" onClick={save}>
              {t('Guardar firmas')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function TemplatesDialog({ subject, doc, onInsert, onClose }: { subject: string; doc: () => PMNode; onInsert: (template: Template, doc: PMNode) => void; onClose: () => void }) {
  const [list, setList] = useState<Template[]>(loadTemplates);
  const [name, setName] = useState(subject);
  const [error, setError] = useState('');
  const store = (next: Template[]) => {
    try {
      saveTemplates(next);
      setList(next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = () => {
    const title = name.trim();
    if (!title) return;
    // a template is what is written, without the signature of the day
    const blocks: PMNode[] = [];
    doc().forEach((n) => {
      if (!(n.type.name === 'generated' && n.attrs.kind === 'signature')) blocks.push(n);
    });
    while (blocks.length > 1 && blocks[blocks.length - 1]!.type.name === 'paragraph' && !blocks[blocks.length - 1]!.content.size) blocks.pop();
    const made: Template = { id: newLibraryId(), name: title, subject, doc: writerSchema.node('doc', null, blocks.length ? blocks : [writerSchema.node('paragraph')]).toJSON() };
    // saving with the name of a template replaces it
    store([...list.filter((x) => x.name !== title), made]);
  };
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{t('Plantillas')}</DialogTitle>
          <DialogContent>
            <ul className="ml-templates" aria-label={t('Plantillas')}>
              {list.map((x) => (
                <li key={x.id}>
                  <span>{x.name}</span>
                  <button type="button" className="ml-btn" aria-label={t('Insertar la plantilla {name}', { name: x.name })} onClick={() => onInsert(x, docOf({ body: '', doc: x.doc }))}>
                    {t('Insertar')}
                  </button>
                  <button type="button" className="ml-btn" aria-label={t('Quitar la plantilla {name}', { name: x.name })} onClick={() => store(list.filter((y) => y.id !== x.id))}>
                    {t('Quitar')}
                  </button>
                </li>
              ))}
            </ul>
            {list.length === 0 && <p>{t('Todavía no hay plantillas.')}</p>}
            <form
              className="ml-templates__save"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input aria-label={t('Nombre de la plantilla')} placeholder={t('Nombre de la plantilla')} value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="ml-btn" disabled={!name.trim()}>
                {t('Guardar este mensaje como plantilla')}
              </button>
            </form>
            <p className="ml-pics__note">{t('Se guardan el asunto y el texto con su formato, tablas e imágenes; los adjuntos y los destinatarios, no.')}</p>
            {error && (
              <div className="ml-acc__err" role="alert">
                {t(error)}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {t('Cerrar')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
