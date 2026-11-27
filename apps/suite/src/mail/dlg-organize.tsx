import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import {
  ACTIONS,
  CATEGORY_COLORS,
  CONDITIONS,
  FOLLOW_PRESETS,
  brokenActions,
  categoriesOf,
  categoryHex,
  folderRows,
  isTextCondition,
  parseQuery,
  quickStepsOf,
  type Action,
  type ActionKind,
  type Condition,
  type ConditionKind,
  type QuickStep,
  type Rule,
} from '@suitenova/mail-core';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { categoryLabel } from './CategoryViews';
import { dateStr, parseLocal, timeStr } from './CalendarView';
import type { MailCtl } from './ctl';
import { buildQuery, type SearchForm } from './search-form';

/* The dialogs to organise the mail: categories, follow-up, rules, quick steps, junk senders and searches. */

function Frame({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>{actions}</DialogActions>
    </>
  );
}

const Close = ({ onClose, label = 'Cerrar' }: { onClose: () => void; label?: string }) => (
  <Button appearance="primary" onClick={onClose}>
    {t(label)}
  </Button>
);

const Problem = ({ text }: { text: string }) =>
  text ? (
    <div className="ml-error" role="alert">
      {text}
    </div>
  ) : null;

const useCtl = (ctl: MailCtl) => useSyncExternalStore(ctl.subscribe, ctl.getVersion);

// ---------------------------------------------------------------------------------------------- categories

function CategoryName({ ctl, name, onError }: { ctl: MailCtl; name: string; onError: (text: string) => void }) {
  const [text, setText] = useState(categoryLabel(name));
  const rename = () => {
    if (text === categoryLabel(name)) return;
    try {
      ctl.organize.changeCategory(name, { name: text });
      onError('');
    } catch (e) {
      onError(t((e as Error).message));
      setText(categoryLabel(name));
    }
  };
  return <input aria-label={t('Nombre de la categoría {name}', { name: categoryLabel(name) })} value={text} onChange={(e) => setText(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && rename()} />;
}

export function CategoriesDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  useCtl(ctl);
  const [name, setName] = useState('');
  const [color, setColor] = useState('teal');
  const [err, setErr] = useState('');
  const add = () => {
    try {
      ctl.organize.addCategory(name, color);
      setName('');
      setErr('');
    } catch (e) {
      setErr(t((e as Error).message));
    }
  };
  const colors = CATEGORY_COLORS.map((c) => (
    <option key={c.id} value={c.id}>
      {t(c.label)}
    </option>
  ));
  return (
    <Frame title={t('Categorías')} actions={<Close onClose={onClose} />}>
      <ul className="ml-editlist" aria-label={t('Categorías')}>
        {categoriesOf(ctl.data).map((c) => (
          <li key={c.name}>
            <i className="ml-swatch" style={{ background: categoryHex(ctl.data, c.name) }} aria-hidden="true" />
            <CategoryName ctl={ctl} name={c.name} onError={setErr} />
            <select aria-label={t('Color de {name}', { name: categoryLabel(c.name) })} value={c.color} onChange={(e) => ctl.organize.changeCategory(c.name, { color: e.target.value })}>
              {colors}
            </select>
            <button
              type="button"
              className="ml-btn"
              aria-label={t('Eliminar la categoría {name}', { name: categoryLabel(c.name) })}
              onClick={() => {
                if (window.confirm(t('¿Eliminar la categoría «{name}»? Se quitará de todos los elementos que la tienen.', { name: categoryLabel(c.name) }))) ctl.organize.removeCategory(c.name);
              }}
            >
              {t('Eliminar')}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="ml-addrow"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input aria-label={t('Categoría nueva')} placeholder={t('Categoría nueva')} value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label={t('Color de la categoría nueva')} value={color} onChange={(e) => setColor(e.target.value)}>
          {colors}
        </select>
        <button type="submit" className="ml-btn" disabled={!name.trim()}>
          {t('Agregar')}
        </button>
      </form>
      <Problem text={err} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------- follow-up

export function FollowDialog({ ctl, ids, onClose }: { ctl: MailCtl; ids: string[]; onClose: () => void }) {
  const first = ctl.records(ids)[0];
  const [due, setDue] = useState(first?.follow?.due != null ? dateStr(first.follow.due) : dateStr(Date.now()));
  const [remind, setRemind] = useState(first?.follow?.remind !== undefined);
  const [when, setWhen] = useState(() => {
    const at = first?.follow?.remind ?? parseLocal(dateStr(Date.now()), '16:00');
    return `${dateStr(at)}T${timeStr(at)}`;
  });
  const save = () => {
    const [day, time] = when.split('T');
    ctl.followMany(ids, due ? parseLocal(due, '00:00') : null, remind && day ? parseLocal(day, time ?? '09:00') : undefined);
    onClose();
  };
  return (
    <Frame
      title={t('Seguimiento')}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Close onClose={save} label="Aceptar" />
        </>
      }
    >
      <div className="ml-form">
        <p>{ids.length === 1 ? first?.subject || t('(sin asunto)') : t('{n} mensajes', { n: ids.length })}</p>
        <label>
          <span>{t('Vence el')}</span>
          <input type="date" aria-label={t('Vence el')} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="ml-check">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> {t('Avisarme')}
        </label>
        {remind && (
          <label>
            <span>{t('Cuándo')}</span>
            <input type="datetime-local" aria-label={t('Cuándo avisar')} value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
        )}
        {remind && <p className="ml-hint">{t('El aviso aparece mientras Nova Mail está abierto.')}</p>}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------- conditions and actions

const folderOptions = (ctl: MailCtl) =>
  folderRows(ctl.data)
    .filter(({ folder: f }) => !f.id.startsWith('c:') && f.id !== 'drafts')
    .map(({ folder: f, depth }) => (
      <option key={f.id} value={f.id}>
        {`${'  '.repeat(depth)}${t(f.name)}`}
      </option>
    ));

function newCondition(kind: ConditionKind, ctl: MailCtl): Condition {
  if (isTextCondition(kind)) return { kind, words: [] };
  if (kind === 'importance') return { kind, value: 'high' };
  if (kind === 'larger') return { kind, kb: 1024 };
  if (kind === 'account') return { kind, account: ctl.accounts[0]?.id ?? '' };
  return { kind } as Condition;
}

function newAction(kind: ActionKind, ctl: MailCtl): Action {
  if (kind === 'move' || kind === 'copy') return { kind, folder: 'archive' };
  if (kind === 'category') return { kind, name: categoriesOf(ctl.data)[0]?.name ?? '' };
  if (kind === 'follow') return { kind, when: 'today' };
  if (kind === 'alert') return { kind, text: '' };
  if (kind === 'forward') return { kind, to: '' };
  return { kind } as Action;
}

/** The words of a condition, typed separated by semicolons. */
function Words({ words, label, onChange }: { words: string[]; label: string; onChange: (w: string[]) => void }) {
  const [text, setText] = useState(words.join('; '));
  return (
    <input
      aria-label={label}
      placeholder={t('Una o varias palabras, separadas por ;')}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(';').map((w) => w.trim()).filter(Boolean));
      }}
    />
  );
}

type Keyed<T> = { key: number; value: T };
let keys = 0;
const keyed = <T,>(list: T[]): Keyed<T>[] => list.map((value) => ({ key: ++keys, value }));

function Conditions({ ctl, list, onChange, title, add }: { ctl: MailCtl; list: Keyed<Condition>[]; onChange: (l: Keyed<Condition>[]) => void; title: string; add: string }) {
  const kinds = CONDITIONS.filter((c) => c.kind !== 'account' || ctl.accounts.length > 0);
  const set = (key: number, value: Condition) => onChange(list.map((x) => (x.key === key ? { key, value } : x)));
  return (
    <fieldset className="ml-parts">
      <legend>{title}</legend>
      {list.map(({ key, value: c }, i) => {
        const label = t('{title}: valor {n}', { title, n: i + 1 });
        return (
          <div key={key} className="ml-part">
            <select aria-label={t('{title}: condición {n}', { title, n: i + 1 })} value={c.kind} onChange={(e) => set(key, newCondition(e.target.value as ConditionKind, ctl))}>
              {kinds.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {t(k.label)}
                </option>
              ))}
              {!kinds.some((k) => k.kind === c.kind) && <option value={c.kind}>{t('Llegó a la cuenta')}</option>}
            </select>
            {'words' in c && <Words key={c.kind} words={c.words} label={label} onChange={(words) => set(key, { ...c, words })} />}
            {c.kind === 'importance' && (
              <select aria-label={label} value={c.value} onChange={(e) => set(key, { ...c, value: e.target.value as 'high' | 'low' })}>
                <option value="high">{t('Alta')}</option>
                <option value="low">{t('Baja')}</option>
              </select>
            )}
            {c.kind === 'larger' && <input type="number" min={0} aria-label={label} value={c.kb} onChange={(e) => set(key, { ...c, kb: Math.max(0, Number(e.target.value) || 0) })} />}
            {c.kind === 'account' && (
              <select aria-label={label} value={c.account} onChange={(e) => set(key, { ...c, account: e.target.value })}>
                {ctl.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                {!ctl.accounts.some((a) => a.id === c.account) && <option value={c.account}>{t('Una cuenta que ya no está')}</option>}
              </select>
            )}
            <button type="button" className="ml-btn" aria-label={t('{title}: quitar la condición {n}', { title, n: i + 1 })} onClick={() => onChange(list.filter((x) => x.key !== key))}>
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="ml-btn" onClick={() => onChange([...list, ...keyed([newCondition('from', ctl)])])}>
        + {add}
      </button>
    </fieldset>
  );
}

function Actions({ ctl, list, onChange, use }: { ctl: MailCtl; list: Keyed<Action>[]; onChange: (l: Keyed<Action>[]) => void; use: 'rule' | 'step' }) {
  const kinds = ACTIONS.filter((a) => !a.only || a.only === use);
  const set = (key: number, value: Action) => onChange(list.map((x) => (x.key === key ? { key, value } : x)));
  return (
    <fieldset className="ml-parts">
      <legend>{t('Hacer esto')}</legend>
      {list.map(({ key, value: a }, i) => {
        const label = t('Valor de la acción {n}', { n: i + 1 });
        return (
          <div key={key} className="ml-part">
            <select aria-label={t('Acción {n}', { n: i + 1 })} value={a.kind} onChange={(e) => set(key, newAction(e.target.value as ActionKind, ctl))}>
              {kinds.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {t(k.label)}
                </option>
              ))}
            </select>
            {(a.kind === 'move' || a.kind === 'copy') && (
              <select aria-label={label} value={a.folder} onChange={(e) => set(key, { ...a, folder: e.target.value })}>
                {folderOptions(ctl)}
                {!ctl.data.folders.some((f) => f.id === a.folder) && <option value={a.folder}>{t('Una carpeta que ya no existe')}</option>}
              </select>
            )}
            {a.kind === 'category' && (
              <select aria-label={label} value={a.name} onChange={(e) => set(key, { ...a, name: e.target.value })}>
                {categoriesOf(ctl.data).map((c) => (
                  <option key={c.name} value={c.name}>
                    {categoryLabel(c.name)}
                  </option>
                ))}
                {!categoriesOf(ctl.data).some((c) => c.name === a.name) && <option value={a.name}>{a.name}</option>}
              </select>
            )}
            {a.kind === 'follow' && (
              <select aria-label={label} value={a.when} onChange={(e) => set(key, { ...a, when: e.target.value as typeof a.when })}>
                {FOLLOW_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(p.label)}
                  </option>
                ))}
              </select>
            )}
            {a.kind === 'alert' && <input aria-label={label} placeholder={t('Texto del aviso (si se deja vacío, el asunto)')} value={a.text} onChange={(e) => set(key, { ...a, text: e.target.value })} />}
            {a.kind === 'forward' && <input aria-label={label} placeholder={t('Dirección (puede dejarse vacía)')} value={a.to} onChange={(e) => set(key, { ...a, to: e.target.value })} />}
            <button type="button" className="ml-btn" aria-label={t('Quitar la acción {n}', { n: i + 1 })} onClick={() => onChange(list.filter((x) => x.key !== key))}>
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="ml-btn" onClick={() => onChange([...list, ...keyed([newAction('read', ctl)])])}>
        + {t('Agregar acción')}
      </button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------- rules

function RuleEditor({ ctl, rule, onDone }: { ctl: MailCtl; rule: Rule; onDone: () => void }) {
  const [name, setName] = useState(rule.name);
  const [conditions, setConditions] = useState(() => keyed(rule.conditions));
  const [exceptions, setExceptions] = useState(() => keyed(rule.exceptions));
  const [actions, setActions] = useState(() => keyed(rule.actions));
  const [stop, setStop] = useState(rule.stop);
  const [err, setErr] = useState('');
  const save = () => {
    const values = <T,>(l: Keyed<T>[]) => l.map((x) => x.value);
    const empty = [...values(conditions), ...values(exceptions)].some((c) => 'words' in c && !c.words.length);
    if (empty) return setErr(t('Hay una condición sin palabras.'));
    try {
      // saving a rule turns it on, as one that was just made or repaired
      ctl.organize.saveRule({ ...rule, name, conditions: values(conditions), exceptions: values(exceptions), actions: values(actions), stop, enabled: true });
      onDone();
    } catch (e) {
      setErr(t((e as Error).message));
    }
  };
  return (
    <Frame
      title={rule.id ? t('Editar regla') : t('Regla nueva')}
      actions={
        <>
          <Button onClick={onDone}>{t('Cancelar')}</Button>
          <Close onClose={save} label="Guardar regla" />
        </>
      }
    >
      <div className="ml-form">
        <label>
          <span>{t('Nombre')}</span>
          <input aria-label={t('Nombre de la regla')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <Conditions ctl={ctl} list={conditions} onChange={setConditions} title={t('Cuando se cumple todo esto')} add={t('Agregar condición')} />
        <Actions ctl={ctl} list={actions} onChange={setActions} use="rule" />
        <Conditions ctl={ctl} list={exceptions} onChange={setExceptions} title={t('Excepto si se cumple algo de esto')} add={t('Agregar excepción')} />
        <label className="ml-check">
          <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} /> {t('No aplicar más reglas a estos mensajes')}
        </label>
        <Problem text={err} />
      </div>
    </Frame>
  );
}

const Order = ({ name, first, last, move }: { name: string; first: boolean; last: boolean; move: (by: -1 | 1) => void }) => (
  <>
    <button type="button" className="ml-btn" aria-label={t('Subir {name}', { name })} disabled={first} onClick={() => move(-1)}>
      ↑
    </button>
    <button type="button" className="ml-btn" aria-label={t('Bajar {name}', { name })} disabled={last} onClick={() => move(1)}>
      ↓
    </button>
  </>
);

export function RulesDialog({ ctl, initial, onClose }: { ctl: MailCtl; initial?: Rule; onClose: () => void }) {
  useCtl(ctl);
  const [editing, setEditing] = useState<Rule | null>(initial ?? null);
  const [folder, setFolder] = useState(() => (ctl.data.folders.some((f) => f.id === ctl.folder) ? ctl.folder : 'inbox'));
  const [result, setResult] = useState('');
  const rules = ctl.data.rules ?? [];
  if (editing) return <RuleEditor key={editing.id || 'new'} ctl={ctl} rule={editing} onDone={() => setEditing(null)} />;
  const run = () => {
    const ids = rules.filter((r) => r.enabled).map((r) => r.id);
    const r = ctl.organize.runRules(ids, folder);
    setResult(
      (r.matched === 1 ? t('Las reglas se aplicaron a 1 mensaje.') : t('Las reglas se aplicaron a {n} mensajes.', { n: r.matched })) +
        (r.failed ? ` ${t('A {n} no se les pudo aplicar todo: una carpeta no existe o no está en su cuenta.', { n: r.failed })}` : ''),
    );
  };
  return (
    <Frame title={t('Reglas')} actions={<Close onClose={onClose} />}>
      {rules.length === 0 && <p>{t('Todavía no hay reglas.')}</p>}
      <ul className="ml-editlist" aria-label={t('Reglas')}>
        {rules.map((r, i) => {
          const broken = brokenActions(ctl.data, r.actions) || (!r.conditions.length || !r.actions.length ? 'Le falta una condición o una acción.' : '');
          return (
            <li key={r.id}>
              <label>
                <input type="checkbox" aria-label={t('Activar {name}', { name: r.name })} checked={r.enabled} onChange={(e) => ctl.organize.enableRule(r.id, e.target.checked)} />
                <span>
                  {r.name}
                  {broken && <em role="note">{t(broken)}</em>}
                </span>
              </label>
              <Order name={r.name} first={i === 0} last={i === rules.length - 1} move={(by) => ctl.organize.moveRule(r.id, by)} />
              <button type="button" className="ml-btn" aria-label={t('Editar {name}', { name: r.name })} onClick={() => setEditing(r)}>
                {t('Editar')}
              </button>
              <button type="button" className="ml-btn" aria-label={t('Eliminar {name}', { name: r.name })} onClick={() => window.confirm(t('¿Eliminar la regla «{name}»?', { name: r.name })) && ctl.organize.removeRule(r.id)}>
                {t('Eliminar')}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ml-addrow">
        <button type="button" className="ml-btn" onClick={() => setEditing({ id: '', name: '', enabled: true, conditions: [{ kind: 'from', words: [] }], exceptions: [], actions: [{ kind: 'move', folder: 'archive' }], stop: true })}>
          {t('Regla nueva…')}
        </button>
      </div>
      <div className="ml-addrow">
        <label>
          {t('Aplicar ahora las reglas activas a')}{' '}
          <select aria-label={t('Carpeta donde aplicar las reglas')} value={folder} onChange={(e) => setFolder(e.target.value)}>
            {folderOptions(ctl)}
          </select>
        </label>
        <button type="button" className="ml-btn" disabled={!rules.some((r) => r.enabled)} onClick={run}>
          {t('Ejecutar')}
        </button>
      </div>
      {result && <p role="status">{result}</p>}
      <p className="ml-hint">{t('Al sincronizar, las reglas se aplican a los mensajes nuevos sin leer que llegan a la Bandeja de entrada, solo mientras Nova Mail está abierto.')}</p>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------- quick steps

function StepEditor({ ctl, step, onDone }: { ctl: MailCtl; step: QuickStep; onDone: () => void }) {
  const [name, setName] = useState(step.id ? t(step.name) : step.name);
  const [actions, setActions] = useState(() => keyed(step.actions));
  const [err, setErr] = useState('');
  const save = () => {
    try {
      ctl.organize.saveStep({ ...step, name: step.id && name === t(step.name) ? step.name : name, actions: actions.map((x) => x.value) });
      onDone();
    } catch (e) {
      setErr(t((e as Error).message));
    }
  };
  return (
    <Frame
      title={step.id ? t('Editar paso rápido') : t('Paso rápido nuevo')}
      actions={
        <>
          <Button onClick={onDone}>{t('Cancelar')}</Button>
          <Close onClose={save} label="Guardar paso" />
        </>
      }
    >
      <div className="ml-form">
        <label>
          <span>{t('Nombre')}</span>
          <input aria-label={t('Nombre del paso rápido')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <Actions ctl={ctl} list={actions} onChange={setActions} use="step" />
        <p className="ml-hint">{t('Responder y reenviar abren el mensaje para que lo escribas: nunca se envía solo.')}</p>
        <Problem text={err} />
      </div>
    </Frame>
  );
}

export function QuickStepsDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  useCtl(ctl);
  const [editing, setEditing] = useState<QuickStep | null>(null);
  const steps = quickStepsOf(ctl.data);
  if (editing) return <StepEditor key={editing.id || 'new'} ctl={ctl} step={editing} onDone={() => setEditing(null)} />;
  return (
    <Frame title={t('Pasos rápidos')} actions={<Close onClose={onClose} />}>
      {steps.length === 0 && <p>{t('No hay pasos rápidos.')}</p>}
      <ul className="ml-editlist" aria-label={t('Pasos rápidos')}>
        {steps.map((s, i) => {
          const name = t(s.name);
          const broken = brokenActions(ctl.data, s.actions);
          return (
            <li key={s.id}>
              <label>
                <span>
                  {name}
                  {i < 9 && <kbd>{t('Ctrl+Mayús+{n}', { n: i + 1 })}</kbd>}
                  {broken && <em role="note">{t(broken)}</em>}
                </span>
              </label>
              <Order name={name} first={i === 0} last={i === steps.length - 1} move={(by) => ctl.organize.moveStep(s.id, by)} />
              <button type="button" className="ml-btn" aria-label={t('Editar {name}', { name })} onClick={() => setEditing(s)}>
                {t('Editar')}
              </button>
              <button type="button" className="ml-btn" aria-label={t('Eliminar {name}', { name })} onClick={() => window.confirm(t('¿Eliminar el paso rápido «{name}»?', { name })) && ctl.organize.removeStep(s.id)}>
                {t('Eliminar')}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ml-addrow">
        <button type="button" className="ml-btn" onClick={() => setEditing({ id: '', name: '', actions: [{ kind: 'read' }] })}>
          {t('Paso rápido nuevo…')}
        </button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------- junk senders

function SenderList({ ctl, list, title, help }: { ctl: MailCtl; list: 'blocked' | 'safe'; title: string; help: string }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const entries = ctl.data.junk?.[list] ?? [];
  return (
    <section className="ml-senders">
      <h3>{title}</h3>
      <p className="ml-hint">{help}</p>
      <ul className="ml-editlist" aria-label={title}>
        {entries.length === 0 && <li className="ml-hint">{t('Ninguno.')}</li>}
        {entries.map((e) => (
          <li key={e}>
            <span>{e}</span>
            <button type="button" className="ml-btn" aria-label={t('Quitar {name}', { name: e })} onClick={() => ctl.organize.removeSender(list, e)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="ml-addrow"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            ctl.organize.addSender(list, text);
            setText('');
            setErr('');
          } catch (x) {
            setErr(t((x as Error).message));
          }
        }}
      >
        <input aria-label={t('Agregar a «{title}»', { title })} placeholder={t('ana@ejemplo.com o @ejemplo.com')} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="ml-btn" disabled={!text.trim()}>
          {t('Agregar')}
        </button>
      </form>
      <Problem text={err} />
    </section>
  );
}

export function JunkDialog({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  useCtl(ctl);
  return (
    <Frame title={t('Remitentes bloqueados y seguros')} actions={<Close onClose={onClose} />}>
      <SenderList ctl={ctl} list="blocked" title={t('Remitentes bloqueados')} help={t('Sus mensajes nuevos van a Correo no deseado al sincronizar.')} />
      <SenderList ctl={ctl} list="safe" title={t('Remitentes seguros')} help={t('Nunca se tratan como bloqueados y sus imágenes de Internet se muestran sin preguntar. El remitente de un mensaje se puede falsificar.')} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------- searches

const TEMPLATES: { label: string; name: string; query: string }[] = [
  { label: 'Correo no leído', name: 'Correo no leído', query: 'es:noleido' },
  { label: 'Para seguimiento', name: 'Para seguimiento', query: 'es:marcado' },
  { label: 'Seguimiento vencido', name: 'Seguimiento vencido', query: 'es:vencido' },
  { label: 'Con categoría', name: 'Categorizados', query: 'categoria:*' },
  { label: 'Con datos adjuntos', name: 'Con adjuntos', query: 'adjuntos:sí' },
  { label: 'Correo grande', name: 'Correo grande', query: 'tamaño:>1mb' },
  { label: 'Importancia alta', name: 'Importantes', query: 'importancia:alta' },
  { label: 'De una persona', name: '', query: 'de:' },
];

export const SearchHelp = () => (
  <details className="ml-hint">
    <summary>{t('Cómo se escribe una búsqueda')}</summary>
    <p>{t('Se buscan todas las palabras escritas, sin distinguir mayúsculas ni acentos. "entre comillas" busca la frase y -palabra la excluye.')}</p>
    <p>
      <code>de: para: cc: asunto: cuerpo: adjunto: adjuntos:sí categoria: es:noleido es:marcado es:vencido importancia:alta tamaño:&gt;1mb carpeta: fecha:hoy fecha:05/2026 desde:01/05/2026 hasta:31/05/2026</code>
    </p>
  </details>
);

export function SearchFolderDialog({ ctl, id, query: from, onClose }: { ctl: MailCtl; id?: string; query?: string; onClose: () => void }) {
  const current = id ? ctl.organize.searchFolder(id) : undefined;
  const [name, setName] = useState(current ? t(current.name) : '');
  const [query, setQuery] = useState(current?.query ?? from ?? '');
  const [err, setErr] = useState('');
  const errors = parseQuery(query).errors;
  const save = () => {
    try {
      const saved = ctl.organize.saveSearchFolder({ id: current?.id, name: current && name === t(current.name) ? current.name : name, query });
      ctl.setFolder(saved);
      ctl.go('mail');
      onClose();
    } catch (e) {
      setErr(t((e as Error).message));
    }
  };
  return (
    <Frame
      title={current ? t('Editar carpeta de búsqueda') : t('Carpeta de búsqueda nueva')}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Close onClose={save} label="Aceptar" />
        </>
      }
    >
      <div className="ml-form">
        {!current && (
          <label>
            <span>{t('Plantilla')}</span>
            <select
              aria-label={t('Plantilla')}
              value=""
              onChange={(e) => {
                const x = TEMPLATES[Number(e.target.value)];
                if (!x) return;
                setName(x.name ? t(x.name) : name);
                setQuery(x.query);
                setErr('');
              }}
            >
              <option value="">{t('Elegir…')}</option>
              {TEMPLATES.map((x, i) => (
                <option key={x.label} value={i}>
                  {t(x.label)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{t('Nombre')}</span>
          <input aria-label={t('Nombre de la carpeta de búsqueda')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>{t('Buscar')}</span>
          <input aria-label={t('Qué buscar')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {errors.length > 0 && <Problem text={t('No se entiende: {what}', { what: errors.join(', ') })} />}
        <p className="ml-hint">{t('Busca en todas las carpetas, menos en Eliminados y No deseado, salvo que la búsqueda nombre una carpeta.')}</p>
        <SearchHelp />
        <Problem text={err} />
      </div>
    </Frame>
  );
}

export function AdvancedSearchDialog({ ctl, onClose, onSave }: { ctl: MailCtl; onClose: () => void; onSave: (query: string) => void }) {
  const [f, setF] = useState<SearchForm>({ from: '', to: '', subject: '', words: '', category: '', attachments: '', state: '', since: '', until: '', everywhere: ctl.query.startsWith('*') });
  const set = (patch: Partial<SearchForm>) => setF((x) => ({ ...x, ...patch }));
  const query = buildQuery(f);
  const search = () => {
    ctl.go('mail');
    ctl.setQuery(f.everywhere ? `* ${query}` : query);
    onClose();
  };
  const text = (key: 'from' | 'to' | 'subject' | 'words', label: string) => (
    <label>
      <span>{label}</span>
      <input aria-label={label} value={f[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );
  return (
    <Frame
      title={t('Búsqueda avanzada')}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button disabled={!query} onClick={() => onSave(query)}>
            {t('Guardar búsqueda')}
          </Button>
          <Button appearance="primary" disabled={!query} onClick={search}>
            {t('Buscar')}
          </Button>
        </>
      }
    >
      <form
        className="ml-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (query) search();
        }}
      >
        {text('from', t('De'))}
        {text('to', t('Para'))}
        {text('subject', t('Asunto'))}
        {text('words', t('Contiene las palabras'))}
        <label>
          <span>{t('Categoría')}</span>
          <select aria-label={t('Categoría')} value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">{t('Cualquiera')}</option>
            <option value="*">{t('Alguna')}</option>
            {categoriesOf(ctl.data).map((c) => (
              <option key={c.name} value={c.name}>
                {categoryLabel(c.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('Datos adjuntos')}</span>
          <select aria-label={t('Datos adjuntos')} value={f.attachments} onChange={(e) => set({ attachments: e.target.value as SearchForm['attachments'] })}>
            <option value="">{t('Da igual')}</option>
            <option value="sí">{t('Con adjuntos')}</option>
            <option value="no">{t('Sin adjuntos')}</option>
          </select>
        </label>
        <label>
          <span>{t('Estado')}</span>
          <select aria-label={t('Estado')} value={f.state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">{t('Cualquiera')}</option>
            <option value="noleido">{t('No leídos')}</option>
            <option value="leido">{t('Leídos')}</option>
            <option value="marcado">{t('Con bandera')}</option>
            <option value="completado">{t('Completados')}</option>
            <option value="vencido">{t('Vencidos')}</option>
          </select>
        </label>
        <label>
          <span>{t('Desde')}</span>
          <input type="date" aria-label={t('Desde')} value={f.since} onChange={(e) => set({ since: e.target.value })} />
        </label>
        <label>
          <span>{t('Hasta')}</span>
          <input type="date" aria-label={t('Hasta')} value={f.until} onChange={(e) => set({ until: e.target.value })} />
        </label>
        <label className="ml-check">
          <input type="checkbox" checked={f.everywhere} onChange={(e) => set({ everywhere: e.target.checked })} /> {t('En todas las carpetas')}
        </label>
        <p className="ml-hint" data-testid="built-query">
          {query || t('Rellena algún campo.')}
        </p>
        <button type="submit" hidden />
      </form>
    </Frame>
  );
}
