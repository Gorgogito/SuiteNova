import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import nspell from 'nspell';
import { EditorState } from 'prosemirror-state';
import { DEFAULT_REVIEW_OPTIONS } from '@suitenova/spell-core';
import { describe, expect, it } from 'vitest';
import { docOf, nodeTypes, writerSchema } from '@suitenova/writer-core';
import { DocSpellEngine } from './engine';
import { ignoreOnce, resetIgnored } from './options';
import { fixesOf, reviewDoc, type ReviewCtx } from './review';

const dict = (name: string) => {
  const d = fileURLToPath(new URL(`../../node_modules/${name}/`, import.meta.url));
  return new DocSpellEngine(nspell(fs.readFileSync(d + 'index.aff', 'utf8'), fs.readFileSync(d + 'index.dic', 'utf8')));
};
const es = dict('dictionary-es');
const engines: Record<string, DocSpellEngine | null> = { es, 'es-MX': dict('dictionary-es-mx'), en: dict('dictionary-en') };
const ctx = (over: Partial<ReviewCtx> & { engine?: DocSpellEngine | null } = {}): ReviewCtx => {
  const { engine, ...rest } = over;
  return { lang: 'es', options: DEFAULT_REVIEW_OPTIONS, engineFor: (l) => (engine !== undefined ? (l === 'es' ? engine : null) : (engines[l] ?? null)), ...rest };
};
const p = (...c: (string | ReturnType<typeof writerSchema.text>)[]) => nodeTypes.paragraph!.create(null, c.map((x) => (typeof x === 'string' ? writerSchema.text(x) : x)));
const apply = (doc: ReturnType<typeof docOf>, f: { from: number; to: number; text: string }) => {
  const tr = EditorState.create({ doc }).tr;
  if (f.text) tr.replaceWith(f.from, f.to, writerSchema.text(f.text));
  else tr.delete(f.from, f.to);
  return tr.doc.textContent;
};

describe('revisión unificada de un documento', () => {
  it('junta ortografía y gramática, en orden, con posiciones exactas', () => {
    const doc = docOf([p('La cassa es bonita.  Los mesa están.'), p('Segundo párrafo correcto.')]);
    const issues = reviewDoc(doc, ctx());
    expect(issues.map((i) => [i.kind, i.rule])).toEqual([
      ['spelling', 'spelling'],
      ['punctuation', 'double-space'],
      ['grammar', 'agreement'],
    ]);
    for (const i of issues) expect(doc.textBetween(i.from, i.to)).toBe(i.text);
    expect(issues[0]!.text).toBe('cassa');
    expect(issues[2]!.text).toBe('Los mesa');
  });

  it('las correcciones de gramática se aplican en el sitio justo, también tras otro párrafo', () => {
    const doc = docOf([p('Primero va esto.'), p('Pienso de que sí.  Otra.')]);
    const issues = reviewDoc(doc, ctx());
    const dq = issues.find((i) => i.rule === 'dequeismo')!;
    expect(apply(doc, dq.fixes[0]!)).toBe('Primero va esto.Pienso que sí.  Otra.');
    const ds = issues.find((i) => i.rule === 'double-space')!;
    expect(apply(doc, ds.fixes[0]!)).toBe('Primero va esto.Pienso de que sí. Otra.');
  });

  it('la ortografía ofrece las sugerencias del diccionario sobre la palabra', () => {
    const doc = docOf([p('Una cassa.')]);
    const i = reviewDoc(doc, ctx())[0]!;
    const fx = fixesOf(i, (l) => engines[l] ?? null);
    expect(fx.map((f) => f.text)).toContain('casa');
    expect(apply(doc, fx.find((f) => f.text === 'casa')!)).toBe('Una casa.');
  });

  it('el texto partido por un formato se revisa entero, y los enlaces y el código no se tocan', () => {
    const bold = writerSchema.marks.strong!.create();
    const link = writerSchema.marks.link!.create({ href: 'https://x.test' });
    const doc = docOf([p('los  ', writerSchema.text('ca', [bold]), writerSchema.text('sas', [bold]), ' y ', writerSchema.text('Los mesa', [link]))]);
    const issues = reviewDoc(doc, ctx());
    expect(issues.some((i) => i.rule === 'double-space')).toBe(true);
    expect(issues.some((i) => i.text.includes('mesa'))).toBe(false);
  });

  it('un objeto dentro del párrafo (salto de línea, imagen) no se convierte en texto a corregir', () => {
    const br = nodeTypes.hard_break ? [nodeTypes.hard_break.create()] : [];
    const doc = docOf([nodeTypes.paragraph!.create(null, [writerSchema.text('Hola'), ...br, writerSchema.text(' mundo mundo')])]);
    const issues = reviewDoc(doc, ctx());
    expect(issues.map((i) => i.rule)).toEqual(['repeated-word']);
    expect(doc.textBetween(issues[0]!.from, issues[0]!.to)).toBe('mundo mundo');
  });

  it('con la gramática apagada solo queda la ortografía; las reglas se apagan una a una', () => {
    const doc = docOf([p('Una cassa  bonita.')]);
    expect(reviewDoc(doc, ctx({ options: { ...DEFAULT_REVIEW_OPTIONS, grammar: false } })).map((i) => i.kind)).toEqual(['spelling']);
    expect(reviewDoc(doc, ctx({ options: { ...DEFAULT_REVIEW_OPTIONS, rules: { 'double-space': false } } })).map((i) => i.kind)).toEqual(['spelling']);
  });

  it('sin el diccionario todavía no se marca nada (ni gramática a medias)', () => {
    const doc = docOf([p('Hola  mundo.')]);
    expect(reviewDoc(doc, ctx({ engine: null }))).toEqual([]);
  });

  it('«omitir una vez» quita solo ese problema y «volver a revisar» lo devuelve', () => {
    const doc = docOf([p('Hola  mundo.'), p('Y aquí  también.')]);
    const [a, b] = reviewDoc(doc, ctx());
    expect(b).toBeTruthy();
    ignoreOnce(a!.key);
    const left = reviewDoc(doc, ctx());
    expect(left).toHaveLength(1);
    expect(left[0]!.text).toBe(b!.text);
    resetIgnored();
    expect(reviewDoc(doc, ctx())).toHaveLength(2);
  });

  it('una palabra agregada al motor deja de marcarse (la caché lo nota)', () => {
    const e = dict('dictionary-es');
    const doc = docOf([p('Visita Zorbalandia hoy.')]);
    expect(reviewDoc(doc, ctx({ engine: e })).map((i) => i.text)).toEqual(['Zorbalandia']);
    e.add('Zorbalandia');
    expect(reviewDoc(doc, ctx({ engine: e }))).toEqual([]);
    e.remove('Zorbalandia');
    expect(reviewDoc(doc, ctx({ engine: e })).map((i) => i.text)).toEqual(['Zorbalandia']);
  });

  it('un documento grande se revisa deprisa y los bloques sin cambios salen de la caché', () => {
    const paras = Array.from({ length: 800 }, (_, i) => p(`Este es el párrafo número ${i} con texto normal y una cassa.`));
    const doc = docOf(paras);
    const t0 = performance.now();
    const first = reviewDoc(doc, ctx());
    const t1 = performance.now();
    const again = reviewDoc(doc, ctx());
    const t2 = performance.now();
    expect(first).toHaveLength(800);
    expect(again).toHaveLength(800);
    expect(t2 - t1).toBeLessThan(Math.max(50, (t1 - t0) / 2));
  });

  describe('idioma por texto', () => {
    const lang = (v: string) => writerSchema.marks.lang!.create({ value: v });
    const t = (x: string, ...m: ReturnType<typeof lang>[]) => writerSchema.text(x, m);

    it('cada tramo se revisa con su idioma: lo correcto en inglés no se marca en un documento en español', () => {
      const doc = docOf([p('La casa y ', t('the house is big', lang('en-US')), ' son cassa.')]);
      expect(reviewDoc(doc, ctx()).map((i) => i.text)).toEqual(['cassa']);
      const doc2 = docOf([p('Esto es ', t('a recieve problem', lang('en-US')), '.')]);
      const issues = reviewDoc(doc2, ctx());
      expect(issues.map((i) => [i.text, i.lang])).toEqual([['recieve', 'en']]);
    });

    it('las variantes se leen de la etiqueta: es-MX acepta lo suyo y es-ES lo marca', () => {
      expect(reviewDoc(docOf([p('Qué chévere')]), ctx()).map((i) => i.text)).toEqual(['chévere']);
      expect(reviewDoc(docOf([p(t('Qué chévere', lang('es-MX')))]), ctx()).map((i) => i.text)).toEqual([]);
    });

    it('un idioma sin diccionario (francés) no se revisa, y «no revisar» tampoco', () => {
      expect(reviewDoc(docOf([p(t('Bonjour le monde cassa', lang('fr-FR')))]), ctx())).toEqual([]);
      const np = writerSchema.marks.noproof!.create();
      expect(reviewDoc(docOf([p('Hola ', writerSchema.text('cassa', [np]), ' cassa')]), ctx()).map((i) => i.from)).toHaveLength(1);
    });

    it('la gramática usa las reglas del idioma del tramo (a/an en inglés dentro de un texto en español)', () => {
      const doc = docOf([p('Dijo ', t('I saw a apple', lang('en-US')), ' ayer.')]);
      const issues = reviewDoc(doc, ctx());
      expect(issues.map((i) => i.rule)).toEqual(['a-an']);
      expect(doc.textBetween(issues[0]!.from, issues[0]!.to)).toBe('a');
    });

    it('si falta el diccionario de un tramo se avisa y se revisa el resto', () => {
      const missing: string[] = [];
      const doc = docOf([p('cassa ', t('recieve', lang('en-US')))]);
      const issues = reviewDoc(doc, ctx({ engineFor: (l) => (l === 'es' ? es : null), onMissing: (l) => missing.push(l) }));
      expect(issues.filter((i) => i.kind === 'spelling').map((i) => i.text)).toEqual(['cassa']);
      expect(missing).toEqual(['en']);
    });
  });
});

import { applyFixToText, reviewPlainText } from './plain';

describe('texto sin formato', () => {
  const text = 'Una cassa  rara.\nOtra linea con los mesa y\n\nfin';
  it('las posiciones son desplazamientos del texto, también en varias líneas', () => {
    const issues = reviewPlainText(text, ctx());
    expect(issues.length).toBeGreaterThanOrEqual(3);
    for (const i of issues) expect(text.slice(i.from, i.to)).toBe(i.text);
    expect(issues.map((i) => i.text)).toContain('cassa');
    expect(issues.map((i) => i.text)).toContain('los mesa');
  });
  it('aplicar una corrección da el texto esperado', () => {
    const ds = reviewPlainText(text, ctx()).find((i) => i.rule === 'double-space')!;
    expect(applyFixToText(text, ds.fixes[0]!)).toBe('Una cassa rara.\nOtra linea con los mesa y\n\nfin');
    const ag = reviewPlainText(text, ctx()).find((i) => i.rule === 'agreement')!;
    expect(applyFixToText(text, ag.fixes[0]!)).toMatch(/con (la mesa|los mesas) y/);
  });
  it('un texto vacío no da problemas', () => {
    expect(reviewPlainText('  \n ', ctx())).toEqual([]);
  });
});
