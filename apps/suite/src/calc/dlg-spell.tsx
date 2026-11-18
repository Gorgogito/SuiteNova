import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { SPELL_LANGS, type SpellLang } from '@suitenova/spell-core';
import { useEffect, useMemo, useState } from 'react';
import { addToUserDictionary, applyFixToText, defaultFieldLang, getReviewOptions, ignoreWord, loadSpeller, loadedEngine, onReviewOptions, reviewPlainText, type Issue } from '../spell';
import type { CalcUI } from './commands';
import { Modal, field } from './modal';

interface Found {
  sheetId: number;
  row: number;
  col: number;
  text: string;
  issue: Issue;
}

const cellName = (row: number, col: number) => {
  let n = '';
  for (let c = col; c >= 0; c = Math.floor(c / 26) - 1) n = String.fromCharCode(65 + (c % 26)) + n;
  return `${n}${row + 1}`;
};

/**
 * Ortografía de la hoja (F7), como en Excel: recorre las celdas con texto (la selección, si abarca varias; si no, toda la hoja) y ofrece
 * cambiar, omitir o agregar al diccionario. Solo ortografía: Excel no revisa la gramática de las celdas.
 */
export function CalcSpellDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const doc = ui.doc;
  const [lang, setLang] = useState<SpellLang>(defaultFieldLang);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState('');
  useEffect(() => {
    let alive = true;
    setReady(false);
    setFailed(false);
    loadSpeller(lang).then(
      () => alive && setReady(true),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [lang]);
  useEffect(() => onReviewOptions(() => setTick((n) => n + 1)), []);
  const cells = useMemo(() => doc.textCells(), [doc, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (f: { sheetId: number; row: number; col: number; issue: Issue }) => `${f.sheetId}:${f.row}:${f.col}:${f.issue.text}`;
  const found: Found[] = useMemo(() => {
    if (!ready) return [];
    const out: Found[] = [];
    const options = { ...getReviewOptions(), grammar: false };
    for (const c of cells)
      for (const issue of reviewPlainText(c.text, { lang, options, engineFor: loadedEngine, onMissing: (l) => void loadSpeller(l).then(() => setTick((n) => n + 1), () => {}) }))
        if (!skipped.has(key({ ...c, issue }))) out.push({ ...c, issue });
    return out;
  }, [ready, cells, lang, skipped, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = found[0];
  const suggestions = useMemo(() => (cur ? (loadedEngine(cur.issue.lang)?.suggest(cur.issue.text) ?? []) : []), [cur?.issue.text, cur?.issue.lang, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setChoice(suggestions[0] ?? '');
    if (cur) doc.selectCell(cur.row, cur.col);
  }, [cur?.sheetId, cur?.row, cur?.col, cur?.issue.text, suggestions]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (all: boolean) => {
    if (!cur || !choice) return;
    const targets = all ? found.filter((f) => f.issue.text === cur.issue.text) : [cur];
    // varias palabras iguales de una misma celda se cambian de atrás adelante para no mover las demás
    const byCell = new Map<string, { f: Found; text: string }>();
    for (const f of [...targets].sort((a, b) => b.issue.from - a.issue.from)) {
      const k = `${f.sheetId}:${f.row}:${f.col}`;
      const base = byCell.get(k)?.text ?? f.text;
      byCell.set(k, { f, text: applyFixToText(base, { from: f.issue.from, to: f.issue.to, text: choice }) });
    }
    doc.setCellsText([...byCell.values()].map(({ f, text }) => ({ sheetId: f.sheetId, row: f.row, col: f.col, text })));
    setTick((n) => n + 1);
  };
  return (
    <Modal title={t('Ortografía')} onClose={onClose} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <div style={field}>
        <label htmlFor="calc-sp-lang">{t('Idioma')}</label>
        <select
          id="calc-sp-lang"
          className="nv-select"
          value={lang}
          onChange={(e) => {
            const l = e.target.value as SpellLang;
            try {
              localStorage.setItem('nova.spell.lang', l);
            } catch {
              /* sin almacenamiento */
            }
            setLang(l);
          }}
        >
          {SPELL_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {t(l.label)}
            </option>
          ))}
        </select>
      </div>
      {failed && <p role="alert">{t('No se pudo cargar el diccionario.')}</p>}
      {!ready && !failed && <p>{t('Cargando el diccionario…')}</p>}
      {ready && !cur && (
        <p role="status" data-testid="spell-done" style={{ fontWeight: 600 }}>
          {t('La revisión ortográfica ha terminado.')}
        </p>
      )}
      {ready && cur && (
        <>
          <p style={{ margin: '0 0 6px', fontSize: 12, opacity: 0.8 }}>
            {t('Celda {c}', { c: cellName(cur.row, cur.col) })} · {t('quedan {n}', { n: found.length })}
          </p>
          <div style={field}>
            <label>{t('No está en el diccionario')}</label>
            <div style={{ fontWeight: 600, padding: '4px 8px', border: '1px solid var(--colorNeutralStroke2)', borderRadius: 4 }} data-testid="spell-word">
              {cur.issue.text}
            </div>
            <div style={{ fontStyle: 'italic', fontSize: 12, opacity: 0.8, maxHeight: 50, overflow: 'auto' }}>{cur.text}</div>
          </div>
          <div style={field}>
            <label htmlFor="calc-sp-sug">{t('Sugerencias')}</label>
            <select id="calc-sp-sug" size={5} value={choice} onChange={(e) => setChoice(e.target.value)} style={{ width: '100%' }}>
              {suggestions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {suggestions.length === 0 && <span style={{ opacity: 0.7 }}>{t('(sin sugerencias)')}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button disabled={!choice} onClick={() => change(false)}>
              {t('Cambiar')}
            </Button>
            <Button disabled={!choice} onClick={() => change(true)}>
              {t('Cambiar todas')}
            </Button>
            <Button onClick={() => setSkipped((s) => new Set(s).add(key(cur)))}>{t('Omitir una vez')}</Button>
            <Button onClick={() => (loadedEngine(cur.issue.lang) && ignoreWord(loadedEngine(cur.issue.lang)!, cur.issue.text), setTick((n) => n + 1))}>{t('Omitir todo')}</Button>
            <Button onClick={() => (addToUserDictionary(null, cur.issue.text), setTick((n) => n + 1))}>{t('Agregar al diccionario')}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
