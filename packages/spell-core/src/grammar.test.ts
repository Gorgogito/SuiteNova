import { describe, expect, it } from 'vitest';
import { GRAMMAR_RULES, checkGrammar, defaultRules, type GrammarIssue, type GrammarOptions } from './index';

const check = (text: string, lang: GrammarOptions['lang'] = 'es', o: Partial<GrammarOptions> = {}) => checkGrammar(text, { lang, ...o });
/** [regla, texto subrayado] de cada problema. */
const found = (text: string, lang: GrammarOptions['lang'] = 'es', o: Partial<GrammarOptions> = {}) => check(text, lang, o).map((i) => [i.rule, text.slice(i.start, i.end)]);
const rules = (text: string, lang: GrammarOptions['lang'] = 'es', o: Partial<GrammarOptions> = {}) => check(text, lang, o).map((i) => i.rule);
const fixWith = (text: string, i: GrammarIssue, n = 0): string => {
  const f = i.fixes[n]!;
  return text.slice(0, f.start) + f.text + text.slice(f.end);
};
const fixed = (text: string, rule: string, lang: GrammarOptions['lang'] = 'es', n = 0): string => fixWith(text, check(text, lang).find((i) => i.rule === rule)!, n);

describe('palabras repetidas', () => {
  it('flags a repeated word and offers the single word', () => {
    expect(found('Voy a el el parque.')).toContainEqual(['repeated-word', 'el el']);
    expect(fixed('Voy a el el parque.', 'repeated-word')).toBe('Voy a el parque.');
    expect(fixed('Los los niños juegan.', 'repeated-word')).toBe('Los niños juegan.');
  });
  it('merges a chain of three into one issue', () => {
    expect(found('Fue muy muy muy bueno el el el día.').filter(([r]) => r === 'repeated-word')).toEqual([['repeated-word', 'el el el']]);
  });
  it('lets valid repetitions through', () => {
    expect(rules('Ja ja ja, qué risa. Es muy muy bueno. No, no vamos.')).not.toContain('repeated-word');
    expect(rules('He said that that was true.', 'en')).not.toContain('repeated-word');
    expect(rules('El perro, el gato.')).not.toContain('repeated-word');
    expect(rules('Pagó 5 5 euros.')).not.toContain('repeated-word');
  });
});

describe('mayúscula inicial', () => {
  it('flags a lower-case start of the text and of each sentence', () => {
    expect(found('hola mundo.')).toContainEqual(['capital-after-period', 'h']);
    expect(found('Llegó tarde. luego se fue.')).toContainEqual(['capital-after-period', 'l']);
    expect(found('¿Vienes? sí, claro.')).toContainEqual(['capital-after-period', 's']);
    expect(found('¡Qué bien! vamos ya.')).toContainEqual(['capital-after-period', 'v']);
    expect(fixed('Llegó tarde. luego se fue.', 'capital-after-period')).toBe('Llegó tarde. Luego se fue.');
  });
  it('knows abbreviations, initials, numbers, ellipses and marker letters', () => {
    expect(rules('Habló el Sr. pérez con el Dr. gómez.')).not.toContain('capital-after-period');
    expect(rules('Compró pan, leche, etc. y se fue.')).not.toContain('capital-after-period');
    expect(rules('Vea p. ej. el caso A.')).not.toContain('capital-after-period');
    expect(rules('Mide 3.5 metros. Pesa 2.')).toEqual([]);
    expect(rules('Espera... y luego vuelve.')).not.toContain('capital-after-period');
    expect(rules('a) primera opción')).not.toContain('capital-after-period');
  });
  it('leaves brand names, addresses and identifiers in lower case', () => {
    expect(rules('iPhone es un teléfono.')).not.toContain('capital-after-period');
    expect(rules('www.ejemplo.org es la página.')).not.toContain('capital-after-period');
    expect(rules('Mira esto. eBay vende cosas.')).not.toContain('capital-after-period');
  });
  it('can ignore the start of the text (a cell or a fragment)', () => {
    expect(found('hola mundo', 'es', { startOfText: false })).toEqual([]);
  });
  it('works in English too', () => {
    expect(found('It rained. then we left.', 'en')).toContainEqual(['capital-after-period', 't']);
    expect(rules('Ask Mr. smith and Dr. jones.', 'en')).not.toContain('capital-after-period');
  });
});

describe('espacios y puntuación', () => {
  it('finds double spaces', () => {
    expect(found('Hola  mundo   feliz.')).toEqual([['double-space', '  '], ['double-space', '   ']]);
    expect(fixed('Hola  mundo.', 'double-space')).toBe('Hola mundo.');
    expect(rules('  sangría al principio.', 'es', { startOfText: false })).toEqual([]);
  });
  it('finds a space before punctuation but not in ellipses, times or smileys', () => {
    expect(fixed('Hola , mundo .', 'space-before-punctuation')).toBe('Hola, mundo .');
    expect(found('¿Qué tal ?')).toContainEqual(['space-before-punctuation', ' ']);
    expect(rules('Espera ... ya voy.')).not.toContain('space-before-punctuation');
    expect(rules('Hola :) amigo.')).not.toContain('space-before-punctuation');
    expect(rules('Mira https://x.org/a ?b=1 ya.')).not.toContain('space-before-punctuation');
  });
  it('finds spaces inside brackets', () => {
    expect(fixed('Dijo ( que sí).', 'space-inside-brackets')).toBe('Dijo (que sí).');
    expect(fixed('Dijo (que sí ).', 'space-inside-brackets')).toBe('Dijo (que sí).');
    expect(rules('Fue :) y ;) divertido.')).not.toContain('space-inside-brackets');
  });
  it('finds a missing space after punctuation but not in decimals, times, addresses or code', () => {
    expect(found('Hola,mundo;adiós:fin.')).toEqual([['missing-space-after', ','], ['missing-space-after', ';'], ['missing-space-after', ':']]);
    expect(fixed('Hola,mundo.', 'missing-space-after')).toBe('Hola, mundo.');
    expect(fixed('Llegó tarde.Luego se fue.', 'missing-space-after')).toBe('Llegó tarde. Luego se fue.');
    for (const ok of ['Pesa 2,5 kg.', 'A las 10:30 h.', 'Ver http://ejemplo.org/a,b ahora.', 'Escribe a juan.perez@correo.com ya.', 'Usa System.Text.Json aquí.', 'Es S.A.Rojas.', 'Ver www.Ejemplo.com hoy.']) expect(rules(ok), ok).not.toContain('missing-space-after');
  });
  it('pairs brackets and quotes', () => {
    expect(found('Dijo (que sí.')).toEqual([['unmatched-pair', '(']]);
    expect(found('Dijo que sí).')).toEqual([['unmatched-pair', ')']]);
    expect(found('Un «ejemplo y [otro.').map((x) => x[1]).sort()).toEqual(['[', '«']);
    expect(rules('Pasos: a) uno, b) dos y 1) tres.')).not.toContain('unmatched-pair');
    expect(rules('Fue genial :)')).not.toContain('unmatched-pair');
    expect(rules('Dijo (en voz baja) «que sí».')).toEqual([]);
  });
  it('pairs the Spanish opening and closing marks', () => {
    expect(found('Qué haces?')).toEqual([['unmatched-pair', '?']]);
    expect(fixed('Hoy llueve. Qué haces?', 'unmatched-pair')).toBe('Hoy llueve. ¿Qué haces?');
    expect(found('Qué bien!')).toEqual([['unmatched-pair', '!']]);
    expect(fixed('¿Qué haces', 'unmatched-pair')).toBe('¿Qué haces?');
    expect(rules('¿Qué haces? ¡Qué bien!')).toEqual([]);
    expect(rules('Mira page?id=3 ya.')).not.toContain('unmatched-pair');
    expect(rules('What are you doing?', 'en')).toEqual([]);
  });
});

describe('concordancia', () => {
  it('flags gender and number between article and noun, and offers the fix', () => {
    expect(found('Escuché el canción.')).toContainEqual(['agreement', 'el canción']);
    expect(fixed('Escuché el canción.', 'agreement')).toBe('Escuché la canción.');
    expect(fixed('Vi la problema.', 'agreement')).toBe('Vi el problema.');
    expect(fixed('Compré los mesa.', 'agreement')).toBe('Compré la mesa.');
    expect(fixed('Compré los mesa.', 'agreement', 'es', 1)).toBe('Compré las mesas.');
    expect(fixed('Tengo dos casa.', 'agreement', 'es', 0)).toBe('Tengo dos casas.');
    expect(fixed('Las canción es bonita.', 'agreement', 'es', 1)).toBe('Las canciones es bonita.');
    expect(fixed('Una documentos importante.', 'agreement', 'es', 0)).toBe('Unos documentos importante.');
    expect(fixed('El Canción.', 'agreement')).toBe('La Canción.');
  });
  it('knows the nouns that take «el» with a stressed «a»', () => {
    expect(fixed('Bebe la agua fría.', 'agreement')).toBe('Bebe el agua fría.');
    expect(rules('El agua está fría. Un águila vuela.')).toEqual([]);
    expect(rules('Las aguas bajan.')).toEqual([]);
    expect(found('Los aguas bajan.')).toContainEqual(['agreement', 'Los aguas']);
  });
  it('accepts correct phrases and verbs that look like nouns', () => {
    expect(rules('La canción es bonita. Los problemas se resuelven. Una casa grande.')).toEqual([]);
    expect(rules('El mes pasado compré mis libros y unas cartas.')).toEqual([]);
    expect(rules('Los casa el juez. La cuenta bien. Las pregunta él.')).toEqual([]);
    expect(rules('Vimos los lunes de ese mes.')).toEqual([]);
  });
  it('checks the adjective after a noun with a known gender', () => {
    expect(fixed('Una casa blanco.', 'agreement')).toBe('Una casa blanca.');
    expect(fixed('El libro nueva.', 'agreement')).toBe('El libro nuevo.');
    expect(fixed('Las canciones bonito.', 'agreement')).toBe('Las canciones bonitas.');
    expect(fixed('Un problema largas.', 'agreement')).toBe('Un problema largo.');
    expect(rules('La casa blanca y el libro nuevo, las canciones bonitas.')).toEqual([]);
    expect(rules('Trabajo duro. Cuenta nueva.')).toEqual([]);
  });
});

describe('errores frecuentes', () => {
  it('dequeísmo and queísmo', () => {
    expect(fixed('Pienso de que vendrá.', 'dequeismo')).toBe('Pienso que vendrá.');
    expect(fixed('Dijeron de que no.', 'dequeismo')).toBe('Dijeron que no.');
    expect(rules('Pienso que vendrá. Se habla de que llueve.')).toEqual([]);
    expect(fixed('Me alegro que vengas.', 'queismo')).toBe('Me alegro de que vengas.');
    expect(fixed('Me di cuenta que era tarde.', 'queismo')).toBe('Me di cuenta de que era tarde.');
    expect(rules('Me alegra que vengas. Se acordó que mañana no hay clase.')).toEqual([]);
  });
  it('«haber» impersonal, «a ver» and «hecho»', () => {
    expect(fixed('Habían muchos niños.', 'haber-impersonal')).toBe('Había muchos niños.');
    expect(fixed('Hubieron varios problemas.', 'haber-impersonal')).toBe('Hubo varios problemas.');
    expect(rules('Habían llegado muchos. Hubieron terminado.')).toEqual([]);
    expect(fixed('Haber si vienes.', 'a-ver')).toBe('A ver si vienes.');
    expect(fixed('Vamos haber qué pasa.', 'a-ver')).toBe('Vamos a ver qué pasa.');
    expect(rules('Debe haber si acaso uno. Puede haber cómo hacerlo. Voy a haber si')).toEqual([]);
    expect(fixed('Ya ha echo la tarea.', 'hecho')).toBe('Ya ha hecho la tarea.');
    expect(rules('Yo echo la basura. Ha hecho todo.')).toEqual([]);
  });
});

describe('estilo', () => {
  it('flags stock phrases and offers the better one', () => {
    expect(fixed('Se decidió en base a los datos.', 'en-base-a')).toBe('Se decidió con base en los datos.');
    expect(fixed('Actúa de acuerdo a la ley.', 'de-acuerdo-a')).toBe('Actúa de acuerdo con la ley.');
    const a = check('Se discutió a nivel de dirección.').find((i) => i.rule === 'a-nivel-de')!;
    expect(a.category).toBe('style');
    expect(a.fixes).toEqual([]);
  });
  it('long sentences and capitals in a row are optional', () => {
    const long = Array.from({ length: 60 }, () => 'palabra').join(' ') + '.';
    expect(rules('Hola ' + long.toLowerCase())).not.toContain('long-sentence');
    expect(rules('Hola ' + long, 'es', { enabled: ['long-sentence'] })).toContain('long-sentence');
    expect(rules('Hola ' + long, 'es', { enabled: ['long-sentence'], longSentenceWords: 80 })).not.toContain('long-sentence');
    expect(rules('ESTO ES MUY IMPORTANTE de verdad.')).not.toContain('all-caps');
    expect(rules('ESTO ES MUY IMPORTANTE de verdad.', 'es', { enabled: ['all-caps'] })).toContain('all-caps');
  });
});

describe('inglés', () => {
  it('a and an', () => {
    expect(fixed('She ate a apple.', 'a-an', 'en')).toBe('She ate an apple.');
    expect(fixed('It is an dog.', 'a-an', 'en')).toBe('It is a dog.');
    expect(fixed('It takes a hour.', 'a-an', 'en')).toBe('It takes an hour.');
    expect(rules('A university, an hour, a one-off, an FBI agent, a user, an umbrella.', 'en')).toEqual([]);
  });
  it('the pronoun I', () => {
    expect(fixed('Today i went home.', 'lone-i', 'en')).toBe('Today I went home.');
    expect(rules('Item i) is first. The i-th term.', 'en')).toEqual([]);
  });
  it('does not apply Spanish rules', () => {
    expect(rules('The problem. Do you know?', 'en')).toEqual([]);
  });
});

describe('opciones y catálogo', () => {
  it('a rule can be turned off', () => {
    expect(rules('Hola  mundo.')).toEqual(['double-space']);
    expect(rules('Hola  mundo.', 'es', { disabled: ['double-space'] })).toEqual([]);
  });
  it('returns the issues in order and in the three Spanish dictionaries', () => {
    const text = 'hola ,mundo  el el fin';
    const list = check(text);
    expect(list.map((i) => i.start)).toEqual([...list.map((i) => i.start)].sort((a, b) => a - b));
    for (const lang of ['es', 'es-MX', 'es-PE'] as const) expect(check(text, lang).length).toBe(list.length);
  });
  it('lists the rules with their category and language', () => {
    expect(GRAMMAR_RULES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(GRAMMAR_RULES.map((r) => r.category))).toEqual(new Set(['grammar', 'punctuation', 'style']));
    expect(defaultRules('es')).toContain('agreement');
    expect(defaultRules('es')).not.toContain('a-an');
    expect(defaultRules('en')).toContain('a-an');
    expect(defaultRules('en')).not.toContain('long-sentence');
    for (const r of GRAMMAR_RULES) expect(r.label && r.description, r.id).toBeTruthy();
  });
  it('is fast on a long text', () => {
    const para = 'Esta es una frase de prueba, con coma y (paréntesis). ¿Qué tal? La casa blanca es bonita. ';
    const big = para.repeat(2000);
    const t0 = Date.now();
    check(big);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
