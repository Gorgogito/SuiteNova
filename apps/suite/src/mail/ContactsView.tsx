import { t } from '@suitenova/core-ui';
import { displayName, formatAddress, isGroup, type Contact, type LabeledValue } from '@suitenova/mail-core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ProofTextarea } from '../spell';
import { CategoryChips, CategoryPicker } from './CategoryViews';
import type { MailUI } from './commands';
import type { MailCtl } from './ctl';
import { photoFrom } from './photo';
import { RecipientInput } from './RecipientInput';

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const LABELS = ['trabajo', 'casa', 'móvil', 'fax', 'otro'];

/** The picture of a contact, its first letter, or the sign of a group. */
export function Avatar({ c, large }: { c: Contact; large?: boolean }) {
  const cls = `ml-avatar${large ? ' ml-avatar--large' : ''}${isGroup(c) ? ' ml-avatar--group' : ''}`;
  return c.photo ? (
    <img className={cls} src={c.photo} alt="" />
  ) : (
    <span className={cls} aria-hidden="true">
      {isGroup(c) ? '👥' : displayName(c).slice(0, 1).toUpperCase()}
    </span>
  );
}

function LabeledList({ title, items, onChange, kind }: { title: string; items: LabeledValue[]; onChange: (l: LabeledValue[]) => void; kind: 'email' | 'tel' }) {
  return (
    <fieldset className="ml-lv">
      <legend>{title}</legend>
      {items.map((it, i) => (
        <div key={i} className="ml-lv__row">
          <select aria-label={t('Tipo de {t} {n}', { t: title.toLowerCase(), n: i + 1 })} value={LABELS.includes(it.label) ? it.label : 'otro'} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {t(l)}
              </option>
            ))}
          </select>
          <input type={kind === 'email' ? 'email' : 'tel'} aria-label={`${title} ${i + 1}`} value={it.value} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <button type="button" className="ml-btn" aria-label={t('Quitar {name}', { name: it.value || title })} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="ml-btn" onClick={() => onChange([...items, { label: 'trabajo', value: '' }])}>
        + {t('Agregar')}
      </button>
    </fieldset>
  );
}

/** What is typed in the form, until it is saved. A change made elsewhere (an undo, a merge) starts it again. */
function useDraft(c: Contact) {
  const [state, setState] = useState({ of: c, draft: c });
  if (state.of !== c) setState({ of: c, draft: c });
  const d = state.of === c ? state.draft : c;
  const set = (p: Partial<Contact>) => setState((x) => ({ of: x.of, draft: { ...x.draft, ...p } }));
  return { d, set, dirty: d !== c && JSON.stringify(d) !== JSON.stringify(c) };
}

const remove = (ctl: MailCtl, c: Contact) => {
  const question = isGroup(c) ? t('¿Eliminar este grupo? Se puede deshacer con Ctrl+Z.') : t('¿Eliminar este contacto? Se puede deshacer con Ctrl+Z.');
  if (window.confirm(question)) ctl.deleteContact(c.id);
};

function ContactForm({ ctl, ui, c }: { ctl: MailCtl; ui: MailUI; c: Contact }) {
  const { d, set, dirty } = useDraft(c);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const field = (k: keyof Contact, label: string, type = 'text') => (
    <label key={k}>
      <span>{label}</span>
      <input type={type} aria-label={label} value={String(d[k] ?? '')} onChange={(e) => set({ [k]: e.target.value } as Partial<Contact>)} />
    </label>
  );
  const mine = new Set(d.emails.map((e) => e.value.trim().toLowerCase()).filter(Boolean));
  const twin = ctl.data.contacts.find((x) => x.id !== c.id && !isGroup(x) && x.emails.some((e) => mine.has(e.value.trim().toLowerCase())));
  return (
    <form
      className="ml-contactform"
      onSubmit={(e) => {
        e.preventDefault();
        ctl.updateContact({ ...d, name: d.name.trim() });
      }}
    >
      <header className="ml-contactform__head">
        <Avatar c={d} large />
        <div>
          <h2>{displayName(d)}</h2>
          <button type="button" className="ml-btn" onClick={() => file.current?.click()}>
            {d.photo ? t('Cambiar la foto…') : t('Agregar una foto…')}
          </button>
          {d.photo && (
            <button type="button" className="ml-btn" onClick={() => set({ photo: undefined })}>
              {t('Quitar la foto')}
            </button>
          )}
          <input
            ref={file}
            type="file"
            hidden
            accept="image/*"
            aria-label={t('Foto del contacto')}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = '';
              if (chosen)
                photoFrom(chosen).then(
                  (photo) => (set({ photo }), setErr('')),
                  (x: Error) => setErr(t(x.message)),
                );
            }}
          />
        </div>
      </header>
      {err && (
        <div className="ml-error" role="alert">
          {err}
        </div>
      )}
      {twin && (
        <div className="ml-follow" role="note">
          <span>{t('Otro contacto tiene el mismo correo: {name}.', { name: displayName(twin) })}</span>
          <button type="button" disabled={dirty} title={dirty ? t('Guarda antes los cambios.') : undefined} onClick={() => ui.openDialog('duplicates')}>
            {t('Revisar duplicados…')}
          </button>
        </div>
      )}
      <div className="ml-grid2">
        {field('first', t('Nombre'))}
        {field('last', t('Apellidos'))}
      </div>
      {field('name', t('Nombre para mostrar'))}
      <div className="ml-grid2">
        {field('org', t('Empresa'))}
        {field('title', t('Cargo'))}
      </div>
      <LabeledList title={t('Correo electrónico')} kind="email" items={d.emails} onChange={(emails) => set({ emails })} />
      <LabeledList title={t('Teléfono')} kind="tel" items={d.phones} onChange={(phones) => set({ phones })} />
      {field('address', t('Dirección'))}
      <div className="ml-grid2">
        {field('url', t('Sitio web'))}
        {field('birthday', t('Cumpleaños'), 'date')}
      </div>
      <label>
        <span>{t('Notas')}</span>
        <ProofTextarea aria-label={t('Notas')} rows={4} value={d.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <CategoryPicker data={ctl.data} value={d.categories} onChange={(categories) => set({ categories })} />
      <div className="ml-actions">
        <button type="submit" className="ml-btn ml-btn--primary" disabled={!dirty}>
          {t('Guardar contacto')}
        </button>
        <button type="button" className="ml-btn" disabled={!d.emails[0]?.value} onClick={() => ctl.newMessage(d.emails[0]!.value)}>
          {t('Nuevo correo')}
        </button>
        <button type="button" className="ml-btn" onClick={() => remove(ctl, c)}>
          {t('Eliminar contacto')}
        </button>
      </div>
    </form>
  );
}

function GroupForm({ ctl, c }: { ctl: MailCtl; c: Contact }) {
  const { d, set, dirty } = useDraft(c);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const members = d.members ?? [];
  /** Adds what is typed. False when something was not understood: it stays in the box. */
  const add = (): Contact | null => {
    if (!typed.trim()) return d;
    const { group, unknown } = ctl.people.addToGroup(d, typed);
    set({ members: group.members });
    setTyped(unknown.join(', '));
    setErr(unknown.length ? t('No se reconoce: {list}.', { list: unknown.join(', ') }) : '');
    return unknown.length ? null : group;
  };
  return (
    <form
      className="ml-contactform"
      onSubmit={(e) => {
        e.preventDefault();
        const out = add();
        if (!out) return;
        if (!out.name.trim()) return setErr(t('Escribe un nombre para el grupo.'));
        ctl.updateContact({ ...out, name: out.name.trim() });
      }}
    >
      <header className="ml-contactform__head">
        <Avatar c={d} large />
        <div>
          <h2>{d.name.trim() || t('Grupo sin nombre')}</h2>
          <span className="ml-hint">{members.length === 1 ? t('1 persona') : t('{n} personas', { n: members.length })}</span>
        </div>
      </header>
      <label>
        <span>{t('Nombre del grupo')}</span>
        <input aria-label={t('Nombre del grupo')} value={d.name} onChange={(e) => (set({ name: e.target.value }), setErr(''))} />
      </label>
      <fieldset className="ml-lv">
        <legend>{t('Miembros')}</legend>
        <ul className="ml-members" aria-label={t('Miembros')}>
          {members.map((m) => (
            <li key={m.email}>
              <span>
                <strong>{m.name || m.email}</strong>
                {m.name && <em>{m.email}</em>}
              </span>
              <button type="button" className="ml-btn" aria-label={t('Quitar {name}', { name: m.name || m.email })} onClick={() => set({ members: members.filter((x) => x !== m) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {members.length === 0 && <p className="ml-hint">{t('El grupo no tiene a nadie todavía.')}</p>}
        <div className="ml-members__add">
          <RecipientInput label={t('Agregar personas')} name={t('Agregar personas')} value={typed} onChange={(v) => (setTyped(v), setErr(''))} entries={() => ctl.addressEntries()} />
          <button type="button" className="ml-btn" disabled={!typed.trim()} onClick={add}>
            {t('Agregar')}
          </button>
        </div>
      </fieldset>
      {err && (
        <div className="ml-error" role="alert">
          {err}
        </div>
      )}
      <label>
        <span>{t('Notas')}</span>
        <ProofTextarea aria-label={t('Notas')} rows={3} value={d.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <CategoryPicker data={ctl.data} value={d.categories} onChange={(categories) => set({ categories })} />
      <div className="ml-actions">
        <button type="submit" className="ml-btn ml-btn--primary" disabled={!dirty && !typed.trim()}>
          {t('Guardar grupo')}
        </button>
        <button type="button" className="ml-btn" disabled={!members.length} onClick={() => ctl.newMessage(members.map(formatAddress).join(', '))}>
          {t('Nuevo correo')}
        </button>
        <button type="button" className="ml-btn" onClick={() => remove(ctl, c)}>
          {t('Eliminar grupo')}
        </button>
      </div>
    </form>
  );
}

export function ContactsView({ ctl, ui }: { ctl: MailCtl; ui: MailUI }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const q = fold(ctl.contactQuery);
  const list = useMemo(
    () =>
      ctl.data.contacts
        .filter((c) => !q || fold(`${displayName(c)} ${c.org} ${c.emails.map((e) => e.value).join(' ')} ${c.phones.map((p) => p.value).join(' ')} ${(c.members ?? []).map((m) => `${m.name} ${m.email}`).join(' ')}`).includes(q))
        .sort((a, b) => displayName(a).localeCompare(displayName(b), 'es')),
    [ctl.data.contacts, q],
  );
  const sel = ctl.data.contacts.find((c) => c.id === ctl.selectedContact) ?? null;
  const current = useRef<HTMLButtonElement>(null);
  // one opened from somewhere else is brought into view
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [ctl.selectedContact]);
  return (
    <div className="ml-contacts">
      <div className="ml-contacts__list">
        <input type="search" aria-label={t('Buscar contactos')} placeholder={t('Buscar contactos')} value={ctl.contactQuery} onChange={(e) => { ctl.contactQuery = e.target.value; ctl.touch(); }} />
        <ul role="listbox" aria-label={t('Contactos')}>
          {list.length === 0 && <li className="ml-empty">{ctl.data.contacts.length ? t('Sin resultados') : t('No hay contactos. Crea uno o importa un archivo vCard o CSV.')}</li>}
          {list.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === ctl.selectedContact}>
              <button ref={c.id === ctl.selectedContact ? current : undefined} type="button" className={c.id === ctl.selectedContact ? 'is-current' : ''} onClick={() => { ctl.selectedContact = c.id; ctl.touch(); }}>
                <Avatar c={c} />
                <span>
                  <strong>{isGroup(c) && !c.name.trim() ? t('Grupo sin nombre') : displayName(c)}</strong>
                  <em>{isGroup(c) ? (c.members!.length === 1 ? t('1 persona') : t('{n} personas', { n: c.members!.length })) : c.emails[0]?.value || c.org}</em>
                  <CategoryChips data={ctl.data} names={c.categories} max={2} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ml-contacts__detail">{!sel ? <div className="ml-empty">{t('Selecciona un contacto.')}</div> : isGroup(sel) ? <GroupForm key={sel.id} ctl={ctl} c={sel} /> : <ContactForm key={sel.id} ctl={ctl} ui={ui} c={sel} />}</div>
    </div>
  );
}
