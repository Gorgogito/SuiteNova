import { Button, Checkbox, Input, Select, Tab, TabList } from '@fluentui/react-components';
import { defaultMathAutoCorrect } from '@suitenova/math-core';
import { t } from '@suitenova/core-ui';
import { useMemo, useState } from 'react';
import {
  AUTO_LANGS,
  DEFAULT_AUTOCORRECT,
  defaultExceptions,
  defaultReplacements,
  exportReplacements,
  importReplacements,
  loadAutoCorrectFrom,
  saveAutoCorrectTo,
  type AutoCorrectOptions,
  type AutoExceptions,
  type AutoFlags,
  type AutoLang,
} from '@suitenova/spell-core';
import { pickAndRead, saveBytes } from '../fileio';
import { getMathList, setMathList } from './autocorrect';
import { Modal } from './ui';

type Flag = keyof AutoFlags;

/** Lo que se corrige al escribir, pestaña «Autocorrección». */
const FLAGS_AC: [Flag, string][] = [
  ['capitalizeSentences', 'Poner en mayúscula la primera letra de una oración'],
  ['fixTwoInitialCaps', 'Corregir DOs mayúsculas iniciales'],
  ['symbols', 'Símbolos con teclas: (c) © (r) ® (tm) ™ ... … --> →'],
];
/** Lo que se da formato al escribir, pestaña «Autoformato». */
const FLAGS_AF: [Flag, string][] = [
  ['smartQuotes', 'Comillas rectas por comillas tipográficas'],
  ['dashes', 'Guiones: -- por raya corta y --- por raya'],
  ['fractions', 'Fracciones: 1/2 ½  1/4 ¼  3/4 ¾'],
  ['ordinals', 'Ordinales: 1.o por 1.º y 2.a por 2.ª (en inglés, 1st con superíndice)'],
  ['autoLinks', 'Convertir direcciones web y de correo en vínculos'],
  ['autoLists', 'Listas automáticas al escribir (1. a. i. y guion al empezar un párrafo)'],
];
/** Las casillas que valen sin formato (campos de texto, celdas): vínculos y listas necesitan un documento con formato; los ordinales con superíndice también, pero los del español no. */
const PLAIN = new Set<Flag>(['smartQuotes', 'symbols', 'fractions', 'dashes', 'capitalizeSentences', 'fixTwoInitialCaps', 'ordinals']);

const LANG_NAMES: Record<AutoLang, string> = { es: 'Español', en: 'English' };
const EXC_KINDS: { id: keyof AutoExceptions; label: string; help: string }[] = [
  { id: 'firstLetter', label: 'Primeras letras', help: 'No poner mayúscula tras estas abreviaturas (sin el punto):' },
  { id: 'twoInitialCaps', label: 'DOs MAyúsculas', help: 'No corregir las dos mayúsculas iniciales en estas palabras:' },
  { id: 'other', label: 'Otras correcciones', help: 'No corregir nunca estas palabras:' },
];

const box: React.CSSProperties = { border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, padding: 8, marginTop: 8 };
const validKey = (k: string) => !!k && !/\s/.test(k);

/** Una lista de pares «reemplazar → con» editable, con búsqueda, importar y exportar. */
function PairsEditor({ pairs, onChange, label, keyLabel, normalize, valid, fileName, onReset }: { pairs: Record<string, string>; onChange: (p: Record<string, string>) => void; label: string; keyLabel: string; normalize?: (k: string) => string; valid?: (k: string) => boolean; fileName: string; onReset?: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const key = (normalize ?? ((k) => k))(from.trim());
  const ok = (valid ?? validKey)(key) && !!to;
  const add = () => {
    if (!ok) return;
    onChange({ ...pairs, [key]: to });
    setFrom('');
    setTo('');
  };
  const entries = useMemo(() => {
    const all = Object.entries(pairs).sort((a, b) => a[0].localeCompare(b[0]));
    const f = q.trim().toLowerCase();
    return f ? all.filter(([k, v]) => k.toLowerCase().includes(f) || v.toLowerCase().includes(f)) : all;
  }, [pairs, q]);
  const doExport = async () => {
    try {
      const saved = await saveBytes(fileName, new TextEncoder().encode('﻿' + exportReplacements(pairs)), [{ name: 'CSV', extensions: ['csv'] }]);
      if (saved) setNote(t('Exportadas {n} entradas.', { n: Object.keys(pairs).length }));
    } catch {
      setNote(t('No se pudo guardar el archivo.'));
    }
  };
  const doImport = async () => {
    try {
      const f = await pickAndRead([{ name: 'CSV / texto', extensions: ['csv', 'txt', 'tsv'] }]);
      if (!f) return;
      const got = importReplacements(new TextDecoder().decode(f.data));
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(got)) {
        const nk = (normalize ?? ((x) => x))(k);
        if ((valid ?? validKey)(nk)) clean[nk] = v;
      }
      const n = Object.keys(clean).length;
      if (n) onChange({ ...pairs, ...clean });
      setNote(n ? t('Importadas {n} entradas.', { n }) : t('El archivo no tiene entradas válidas.'));
    } catch {
      setNote(t('No se pudo leer el archivo.'));
    }
  };
  return (
    <fieldset style={box}>
      <legend>{label}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          {keyLabel}
          <Input value={from} onChange={(_e, v) => setFrom(v.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('Con')}
          <Input value={to} onChange={(_e, v) => setTo(v.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <Button onClick={add} disabled={!ok}>
          {t('Agregar')}
        </Button>
      </div>
      <Input aria-label={t('Buscar en la lista')} placeholder={t('Buscar…')} value={q} onChange={(_e, v) => setQ(v.value)} style={{ width: '100%', marginBottom: 6 }} />
      <div role="list" aria-label={label} style={{ maxHeight: 150, overflow: 'auto' }}>
        {entries.length === 0 && <small>{q ? t('Nada coincide con la búsqueda.') : t('La lista está vacía.')}</small>}
        {entries.map(([k, v]) => (
          <div key={k} role="listitem" style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>
              <b>{k}</b> → {v}
            </span>
            <Button
              size="small"
              appearance="subtle"
              aria-label={`${t('Quitar')} ${k}`}
              onClick={() => {
                const { [k]: _gone, ...rest } = pairs;
                void _gone;
                onChange(rest);
              }}
            >
              {t('Quitar')}
            </Button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="small" onClick={doImport}>
          {t('Importar…')}
        </Button>
        <Button size="small" onClick={doExport}>
          {t('Exportar…')}
        </Button>
        {onReset && (
          <Button size="small" onClick={onReset}>
            {t('Lista de fábrica')}
          </Button>
        )}
        <small role="status">{note}</small>
      </div>
    </fieldset>
  );
}

/** Una lista de palabras (las excepciones). */
function WordList({ words, onChange, help, label }: { words: string[]; onChange: (w: string[]) => void; help: string; label: string }) {
  const [w, setW] = useState('');
  const add = () => {
    const v = w.trim();
    if (!v || /\s/.test(v) || words.includes(v)) return;
    onChange([...words, v].sort((a, b) => a.localeCompare(b)));
    setW('');
  };
  return (
    <div>
      <p style={{ margin: '4px 0' }}>{help}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input aria-label={t('Nueva palabra')} value={w} onChange={(_e, v) => setW(v.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ flex: 1 }} />
        <Button onClick={add} disabled={!w.trim() || /\s/.test(w.trim())}>
          {t('Agregar')}
        </Button>
      </div>
      <div role="list" aria-label={label} style={{ maxHeight: 150, overflow: 'auto', marginTop: 6 }}>
        {words.length === 0 && <small>{t('La lista está vacía.')}</small>}
        {words.map((x) => (
          <div key={x} role="listitem" style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <b>{x}</b>
            <Button size="small" appearance="subtle" aria-label={`${t('Quitar')} ${x}`} onClick={() => onChange(words.filter((y) => y !== x))}>
              {t('Quitar')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Cuadro «Opciones de autocorrección», el mismo en todos los productos y con tres pestañas: Autocorrección (reemplazos y excepciones, por idioma),
 * Autoformato (lo que se da formato al escribir) y Matemática (la lista de las ecuaciones). `plain` oculta lo que solo tiene sentido con formato
 * (vínculos, listas) y la pestaña Matemática. Guarda los dos idiomas y la lista matemática; `onSave` recibe las opciones del idioma con que se abrió.
 */
export function AutoCorrectDialog({ initial, onSave, onClose, product, plain }: { initial: AutoCorrectOptions; onSave: (o: AutoCorrectOptions) => void; onClose: () => void; product: string; plain?: boolean }) {
  const [by, setBy] = useState<Record<AutoLang, AutoCorrectOptions>>(() => {
    const load = (l: AutoLang): AutoCorrectOptions => {
      try {
        return loadAutoCorrectFrom(localStorage, l);
      } catch {
        return loadAutoCorrectFrom(null, l);
      }
    };
    const out = { es: load('es'), en: load('en') };
    out[initial.lang] = { ...initial, exceptions: { ...initial.exceptions }, custom: { ...initial.custom } };
    return out;
  });
  const [lang, setLang] = useState<AutoLang>(initial.lang);
  const [tab, setTab] = useState<'ac' | 'af' | 'math'>('ac');
  const [excView, setExcView] = useState(false);
  const [excKind, setExcKind] = useState<keyof AutoExceptions>('firstLetter');
  const [math, setMath] = useState<Record<string, string>>(() => getMathList());
  const o = by[lang];

  const setFlag = (k: Flag, v: boolean) => setBy((b) => ({ es: { ...b.es, [k]: v }, en: { ...b.en, [k]: v } }));
  const patch = (p: Partial<AutoCorrectOptions>) => setBy((b) => ({ ...b, [lang]: { ...b[lang], ...p } }));
  const flags = (list: [Flag, string][]) =>
    list
      .filter(([k]) => !plain || PLAIN.has(k))
      .map(([k, label]) => <Checkbox key={k} label={t(label)} checked={!!o[k]} onChange={(_e, v) => setFlag(k, !!v.checked)} />);

  const reset = () => {
    if (tab === 'math') setMath(defaultMathAutoCorrect());
    else if (tab === 'af') for (const [k] of FLAGS_AF) setFlag(k, DEFAULT_AUTOCORRECT[k]);
    else {
      for (const [k] of FLAGS_AC) setFlag(k, DEFAULT_AUTOCORRECT[k]);
      patch({ custom: defaultReplacements(lang), exceptions: defaultExceptions(lang) });
    }
  };
  const save = () => {
    try {
      for (const l of AUTO_LANGS) saveAutoCorrectTo(localStorage, by[l.id]);
    } catch {
      /* sin almacenamiento */
    }
    if (!plain) {
      const def = defaultMathAutoCorrect();
      const same = Object.keys(def).length === Object.keys(math).length && Object.entries(def).every(([k, v]) => math[k] === v);
      setMathList(same ? null : math);
    }
    onSave(by[initial.lang]);
    onClose();
  };

  return (
    <Modal
      title={excView ? t('Excepciones de Autocorrección') : t('Opciones de autocorrección')}
      onClose={onClose}
      width={600}
      actions={
        excView ? (
          <Button appearance="primary" onClick={() => setExcView(false)}>
            {t('Volver')}
          </Button>
        ) : (
          <>
            <Button onClick={reset}>{t('Restablecer')}</Button>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" onClick={save}>
              {t('Aceptar')}
            </Button>
          </>
        )
      }
    >
      {excView ? (
        <>
          <p>{t('Excepciones del idioma {l}.', { l: LANG_NAMES[lang] })}</p>
          <TabList selectedValue={excKind} onTabSelect={(_e, v) => setExcKind(v.value as keyof AutoExceptions)} size="small">
            {EXC_KINDS.map((x) => (
              <Tab key={x.id} value={x.id}>
                {t(x.label)}
              </Tab>
            ))}
          </TabList>
          {EXC_KINDS.filter((x) => x.id === excKind).map((x) => (
            <WordList key={x.id} words={o.exceptions[x.id]} help={t(x.help)} label={t(x.label)} onChange={(w) => patch({ exceptions: { ...o.exceptions, [x.id]: w } })} />
          ))}
        </>
      ) : (
        <>
          <p>{t('Lo que {p} corrige mientras escribe. Los reemplazos propios valen en todos los productos.', { p: product })}</p>
          <TabList selectedValue={tab} onTabSelect={(_e, v) => setTab(v.value as 'ac' | 'af' | 'math')} size="small">
            <Tab value="ac">{t('Autocorrección')}</Tab>
            <Tab value="af">{t('Autoformato')}</Tab>
            {!plain && <Tab value="math">{t('Autocorrección matemática')}</Tab>}
          </TabList>
          <div style={{ marginTop: 8 }}>
            {tab === 'ac' && (
              <>
                {flags(FLAGS_AC)}
                <div style={{ display: 'flex', gap: 12, alignItems: 'end', margin: '8px 0' }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    {t('Idioma de la lista')}
                    <Select value={lang} onChange={(_e, v) => setLang(v.value as AutoLang)}>
                      {AUTO_LANGS.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Button onClick={() => setExcView(true)}>{t('Excepciones…')}</Button>
                </div>
                <PairsEditor
                  pairs={o.custom}
                  onChange={(custom) => patch({ custom })}
                  label={t('Reemplazar texto mientras escribe')}
                  keyLabel={t('Reemplazar')}
                  fileName={`autocorreccion-${lang}.csv`}
                  onReset={() => patch({ custom: defaultReplacements(lang) })}
                />
              </>
            )}
            {tab === 'af' && flags(FLAGS_AF)}
            {tab === 'math' && !plain && (
              <>
                <p style={{ margin: '0 0 4px' }}>{t('En una ecuación, escribe \\nombre y un espacio para obtener el símbolo (por ejemplo \\alpha y un espacio dan α).')}</p>
                <PairsEditor
                  pairs={math}
                  onChange={setMath}
                  label={t('Reemplazar texto mientras escribe')}
                  keyLabel={t('Reemplazar (sin la barra)')}
                  normalize={(k) => k.replace(/^\\/, '')}
                  valid={(k) => /^[A-Za-z]+$/.test(k)}
                  fileName="autocorreccion-matematica.csv"
                  onReset={() => setMath(defaultMathAutoCorrect())}
                />
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
