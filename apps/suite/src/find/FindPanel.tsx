import { t } from '@suitenova/core-ui';
import { DEFAULT_FIND, compileQuery, type FindMode, type FindOptions } from '@suitenova/find-core';
import { useEffect, useRef, useState } from 'react';
import type { FindFilters, FindHost, FindRequest, FindStatus } from './host';
import './messages';
import './find.css';

const MODE_LABEL: Record<FindMode, string> = { normal: 'Texto', wildcards: 'Comodines de Word', excel: 'Comodines de Excel', regex: 'Expresión regular' };
/** `any`: stands for a character, so it is not offered with Word's wildcards (where `?` is already that). */
const SPECIALS: { code: string; label: string; any?: boolean }[] = [
  { code: '^p', label: 'Marca de párrafo' },
  { code: '^t', label: 'Tabulación' },
  { code: '^l', label: 'Salto de línea' },
  { code: '^#', label: 'Cualquier dígito' },
  { code: '^$', label: 'Cualquier letra' },
  { code: '^w', label: 'Espacio en blanco' },
  { code: '^s', label: 'Espacio de no separación' },
  { code: '^+', label: 'Guion largo' },
  { code: '^?', label: 'Cualquier carácter', any: true },
];

export interface FindPanelProps {
  host: FindHost;
  /** Opens with the «Replace with» row. */
  replace?: boolean;
  /** Opens with the «Go to» row. */
  goTo?: boolean;
  onClose: () => void;
  /** Escape closes the bar (not where Escape already closes the window around it). */
  escape?: boolean;
  /** An extra css class, for the product's own styles and tests. */
  className?: string;
}

const info = (s: FindStatus) => (s.count ? t('{n} de {total}', { n: s.current + 1, total: s.count }) : t('Sin resultados'));

/** The search bar shared by Writer, Calc, Slides, Notes and Base: it reads what is typed with find-core and asks the product (its `FindHost`) to look. */
export function FindPanel({ host, replace: withReplace = false, goTo: withGoTo = false, onClose, escape = true, className }: FindPanelProps) {
  const f = host.features;
  const [text, setText] = useState(() => {
    const s = host.selectionText();
    return s && s.length < 80 && !/[\n\v]/.test(s) ? s : '';
  });
  const [rep, setRep] = useState('');
  const [opts, setOpts] = useState<FindOptions>({ ...DEFAULT_FIND, mode: f.modes[0] ?? 'normal' });
  const [filters, setFilters] = useState<FindFilters>({});
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [goKind, setGoKind] = useState(f.goTo?.[0]?.id ?? '');
  const [goValue, setGoValue] = useState('');
  const [goMsg, setGoMsg] = useState('');
  const [results, setResults] = useState<{ label: string; detail: string; go(): void }[] | null>(null);
  const [lastField, setLastField] = useState<'find' | 'rep'>('find');
  const findRef = useRef<HTMLInputElement>(null);
  const repRef = useRef<HTMLInputElement>(null);
  const canReplace = f.replace && withReplace;
  const canGo = !!f.goTo && f.goTo.length > 0;

  /** The request for the text and options, or null (with the reason shown) when there is nothing to search. */
  const request = (value = text, o = opts, fl = filters): FindRequest | null => {
    if (!value) {
      setError('');
      return null;
    }
    const c = compileQuery(value, o);
    if (!c.ok) {
      setError(t('Búsqueda no válida: {m}', { m: c.message }));
      return null;
    }
    setError('');
    return { text: value, query: c.query, filters: fl };
  };
  const run = (value = text, o = opts, fl = filters) => {
    setResults(null);
    const req = request(value, o, fl);
    if (!req) {
      host.clear();
      setStatus('');
      return;
    }
    setStatus(info(host.find(req)));
  };
  useEffect(() => {
    if (text) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && escape) onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, escape]);

  const step = (d: 1 | -1) => {
    if (!request()) return;
    setStatus(info(host.step(d)));
  };
  const change = (patch: Partial<FindOptions>) => {
    const o = { ...opts, ...patch };
    setOpts(o);
    run(text, o);
  };
  const setFilter = (id: string, v: string | boolean) => {
    const fl = { ...filters, [id]: v };
    if (v === '' || v === false) delete fl[id];
    setFilters(fl);
    run(text, opts, fl);
  };
  const insertSpecial = (code: string) => {
    const inRep = lastField === 'rep' && canReplace;
    const target = inRep ? repRef.current : findRef.current;
    const value = inRep ? rep : text;
    const at = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? at;
    const next = value.slice(0, at) + code + value.slice(end);
    if (inRep) setRep(next);
    else {
      setText(next);
      run(next);
    }
    target?.focus();
  };
  const doReplace = () => {
    const req = request();
    if (req) setStatus(info(host.replaceCurrent(req, rep)));
  };
  const doReplaceAll = () => {
    const req = request();
    if (!req) return;
    const n = host.replaceAll(req, rep);
    host.clear();
    setStatus(n === 0 ? t('Sin resultados') : n === 1 ? t('Se reemplazó 1 coincidencia.') : t('Se reemplazaron {n} coincidencias.', { n }));
  };
  const kind = f.goTo?.find((k) => k.id === goKind);
  const kindOptions = kind?.options?.() ?? null;
  const doList = () => {
    const req = request();
    setResults(req && host.list ? host.list(req) : []);
  };
  const doGo = () => setGoMsg(host.goTo?.(goKind, goValue) ?? '');
  const showGo = withGoTo && canGo;

  return (
    <div className={`nv-find-bar${className ? ` ${className}` : ''}`} role="search" aria-label={t('Buscar y reemplazar')}>
      <div className="nv-find-row">
        <input
          ref={findRef}
          autoFocus
          aria-label={t('Buscar')}
          placeholder={t('Buscar')}
          value={text}
          onFocus={() => setLastField('find')}
          onChange={(e) => {
            setText(e.target.value);
            run(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="nv-find-info" role="status" aria-live="polite">
          {error || status}
        </span>
        <button type="button" className="nv-btn nv-btn--small" onClick={() => step(-1)} aria-label={t('Anterior')} title={t('Anterior')}>
          ↑
        </button>
        <button type="button" className="nv-btn nv-btn--small" onClick={() => step(1)} aria-label={t('Siguiente')} title={t('Siguiente')}>
          ↓
        </button>
        <label>
          <input type="checkbox" checked={opts.matchCase} onChange={(e) => change({ matchCase: e.target.checked })} /> {t('Coincidir mayúsculas')}
        </label>
        <label>
          <input type="checkbox" checked={opts.wholeWord} disabled={opts.mode === 'wildcards' || opts.mode === 'excel'} onChange={(e) => change({ wholeWord: e.target.checked })} /> {t('Palabras completas')}
        </label>
        {host.list && (
          <button type="button" className="nv-btn nv-btn--small" onClick={doList}>
            {t('Buscar todos')}
          </button>
        )}
        <button type="button" className="nv-btn nv-btn--small" aria-expanded={more} aria-label={t('Opciones de búsqueda')} title={t('Opciones de búsqueda')} onClick={() => setMore(!more)}>
          ⋯
        </button>
        <button type="button" className="nv-btn nv-btn--small" onClick={onClose} aria-label={t('Cerrar')} title={t('Cerrar')}>
          ✕
        </button>
      </div>
      {more && (
        <div className="nv-find-row">
          {f.modes.length > 1 && (
            <select aria-label={t('Cómo se lee lo que se busca')} value={opts.mode} onChange={(e) => change({ mode: e.target.value as FindMode })}>
              {f.modes.map((m) => (
                <option key={m} value={m}>
                  {t(MODE_LABEL[m])}
                </option>
              ))}
            </select>
          )}
          <label>
            <input type="checkbox" checked={opts.ignoreAccents} onChange={(e) => change({ ignoreAccents: e.target.checked })} /> {t('Ignorar acentos')}
          </label>
          {f.wholeUnit && (
            <label>
              <input type="checkbox" checked={opts.wholeUnit} onChange={(e) => change({ wholeUnit: e.target.checked })} /> {t('Todo el contenido de la celda')}
            </label>
          )}
          {f.special && (opts.mode === 'normal' || opts.mode === 'wildcards') && (
            <select
              aria-label={t('Carácter especial')}
              value=""
              onChange={(e) => {
                if (e.target.value) insertSpecial(e.target.value);
              }}
            >
              <option value="">{t('Carácter especial')}</option>
              {SPECIALS.filter((s) => !s.any || opts.mode === 'normal').map((s) => (
                <option key={s.code} value={s.code}>
                  {t(s.label)} ({s.code})
                </option>
              ))}
            </select>
          )}
          {(f.filters ?? []).map((d) =>
            d.kind === 'bool' ? (
              <label key={d.id}>
                <input type="checkbox" checked={filters[d.id] === true} onChange={(e) => setFilter(d.id, e.target.checked)} /> {t(d.label)}
              </label>
            ) : (
              <select key={d.id} aria-label={t(d.label)} value={String(filters[d.id] ?? '')} onChange={(e) => setFilter(d.id, e.target.value)}>
                <option value="">
                  {t(d.label)}: {t('Cualquiera')}
                </option>
                {(d.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ),
          )}
        </div>
      )}
      {canReplace && (
        <div className="nv-find-row">
          <input ref={repRef} aria-label={t('Reemplazar con')} placeholder={t('Reemplazar con')} value={rep} onFocus={() => setLastField('rep')} onChange={(e) => setRep(e.target.value)} />
          <button type="button" className="nv-btn nv-btn--small" onClick={doReplace}>
            {t('Reemplazar')}
          </button>
          <button type="button" className="nv-btn nv-btn--small" onClick={doReplaceAll}>
            {t('Reemplazar todo')}
          </button>
        </div>
      )}
      {results && (
        <ul className="nv-find-list" aria-label={t('Resultados')}>
          {results.length === 0 && <li>{t('Sin resultados')}</li>}
          {results.slice(0, 500).map((r, i) => (
            <li key={i}>
              <button type="button" onClick={r.go}>
                <strong>{r.label}</strong> {r.detail}
              </button>
            </li>
          ))}
          {results.length > 500 && <li>{t('Se muestran los primeros 500 de {n}.', { n: results.length })}</li>}
        </ul>
      )}
      {showGo && (
        <div className="nv-find-row">
          <select aria-label={t('Ir a qué')} value={goKind} onChange={(e) => (setGoKind(e.target.value), setGoValue(''), setGoMsg(''))}>
            {f.goTo!.map((k) => (
              <option key={k.id} value={k.id}>
                {t(k.label)}
              </option>
            ))}
          </select>
          {kindOptions ? (
            <select aria-label={t(kind?.label ?? 'Ir a')} value={goValue} onChange={(e) => setGoValue(e.target.value)}>
              <option value="" />
              {kindOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={t(kind?.label ?? 'Ir a')}
              placeholder={kind?.hint ?? ''}
              value={goValue}
              onChange={(e) => setGoValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  doGo();
                }
              }}
            />
          )}
          <button type="button" className="nv-btn nv-btn--small" onClick={doGo}>
            {t('Ir')}
          </button>
          <span className="nv-find-info" role="status" aria-live="polite">
            {goMsg}
          </span>
        </div>
      )}
    </div>
  );
}
