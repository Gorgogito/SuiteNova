import { describe, expect, it } from 'vitest';
import { Reader, pickVoice, pieces, sentences, toSpeech, writtenRange, type SpeakHandlers, type SpeakOptions, type Synth, type Voice } from './index';

const cut = (text: string) => sentences(text).map((s) => text.slice(s.start, s.end));

describe('sentences', () => {
  it('cuts at the end of a sentence and keeps the Spanish question and exclamation marks', () => {
    expect(cut('Hola. ¿Cómo estás? ¡Muy bien! Gracias')).toEqual(['Hola.', '¿Cómo estás?', '¡Muy bien!', 'Gracias']);
    expect(cut('Uno.\n\nDos.')).toEqual(['Uno.', 'Dos.']);
    expect(cut('Línea sin punto\notra línea')).toEqual(['Línea sin punto', 'otra línea']);
  });
  it('does not cut at abbreviations, initials, decimals or numbered items', () => {
    expect(cut('El Sr. Pérez llegó. Dr. Gómez no.')).toEqual(['El Sr. Pérez llegó.', 'Dr. Gómez no.']);
    expect(cut('Escribió J. Pérez en la hoja. Fin.')).toEqual(['Escribió J. Pérez en la hoja.', 'Fin.']);
    expect(cut('Costó 3.5 euros. Pagó.')).toEqual(['Costó 3.5 euros.', 'Pagó.']);
    expect(cut('Mr. Smith left at 5 p.m. Then it rained.')).toEqual(['Mr. Smith left at 5 p.m.', 'Then it rained.']);
    expect(cut('1. Primero\n2. Segundo')).toEqual(['1. Primero', '2. Segundo']);
  });
  it('an ellipsis followed by lower case goes on; followed by a capital it ends', () => {
    expect(cut('Bueno… no sé. Quizá…\nSí')).toEqual(['Bueno… no sé.', 'Quizá…', 'Sí']);
  });
  it('offsets point into the text given', () => {
    const t = '  Hola mundo.   Adiós.  ';
    const s = sentences(t);
    expect(s.map((x) => t.slice(x.start, x.end))).toEqual(['Hola mundo.', 'Adiós.']);
  });
  it('a very long sentence is cut where a pause would be, never inside a word, and covers everything', () => {
    const t = Array.from({ length: 30 }, (_v, i) => `palabra${i}`).join(', ') + '.';
    const ps = pieces(t, 100);
    expect(ps.length).toBeGreaterThan(2);
    for (const p of ps) {
      expect(p.end - p.start).toBeLessThanOrEqual(100);
      expect(/^[\p{L}\p{N}]/u.test(t.slice(p.start, p.end))).toBe(true);
    }
    expect(ps.map((p) => t.slice(p.start, p.end)).join(' ').replace(/\s+/g, ' ')).toBe(t.replace(/\s+/g, ' '));
    // with no punctuation, at a space
    const u = 'a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(30);
    expect(pieces(u, 40).map((p) => u.slice(p.start, p.end))).toEqual(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)]);
  });
});

describe('what is spoken', () => {
  it('addresses are said as one word and the map takes the word back to the whole address', () => {
    const t = 'Mira https://example.org/ayuda?x=1 ahora';
    const sp = toSpeech(t, 'es');
    expect(sp.text).toBe('Mira vínculo ahora');
    const i = sp.text.indexOf('vínculo');
    const r = writtenRange(sp, i, i + 'vínculo'.length);
    expect(t.slice(r.start, r.end)).toBe('https://example.org/ayuda?x=1');
    const j = sp.text.indexOf('ahora');
    expect(t.slice(writtenRange(sp, j, j + 5).start, writtenRange(sp, j, j + 5).end)).toBe('ahora');
    expect(toSpeech('See www.nova.org now', 'en-US').text).toBe('See link now');
  });
  it('marks that only draw are not read, and the text around them keeps its place', () => {
    const t = '• Uno​ y dos ------ fin';
    const sp = toSpeech(t);
    expect(sp.text).not.toMatch(/[•​]|-{3}/);
    const k = sp.text.indexOf('dos');
    const r = writtenRange(sp, k, k + 3);
    expect(t.slice(r.start, r.end)).toBe('dos');
  });
  it('text with nothing to change comes back as it is, with an identity map', () => {
    const sp = toSpeech('Hola mundo');
    expect(sp.text).toBe('Hola mundo');
    expect(sp.map).toEqual(Array.from({ length: 11 }, (_v, i) => i));
  });
});

describe('choosing a voice', () => {
  const voices: Voice[] = [
    { name: 'Helena', lang: 'es-ES', local: true },
    { name: 'Paulina', lang: 'es_MX', local: false },
    { name: 'Sabina', lang: 'es-MX', local: true },
    { name: 'Zira', lang: 'en-US', local: true },
  ];
  it('the very same language first, then the same language of another region, and local before online', () => {
    expect(pickVoice(voices, 'es-MX')!.name).toBe('Sabina');
    expect(pickVoice(voices, 'es-ES')!.name).toBe('Helena');
    expect(pickVoice(voices, 'es-PE')!.name).toBe('Helena');
    expect(pickVoice(voices, 'es')!.name).toBe('Helena');
    expect(pickVoice(voices, 'en-GB')!.name).toBe('Zira');
    expect(pickVoice(voices, 'fr-FR')).toBeNull();
  });
  it('the voice the person chose is kept while it still fits the language', () => {
    expect(pickVoice(voices, 'es-ES', 'Sabina')!.name).toBe('Sabina');
    expect(pickVoice(voices, 'en-US', 'Sabina')!.name).toBe('Zira');
    expect(pickVoice(voices, 'es-ES', 'ya no existe')!.name).toBe('Helena');
  });
});

/** An engine that says nothing and lets the test decide what happens. */
class Fake implements Synth {
  spoken: { text: string; o: SpeakOptions; h: SpeakHandlers }[] = [];
  cancels = 0;
  list: Voice[] = [{ name: 'Helena', lang: 'es-ES', local: true }, { name: 'Zira', lang: 'en-US', local: true }];
  voices(): Voice[] {
    return this.list;
  }
  speak(text: string, o: SpeakOptions, h: SpeakHandlers): void {
    this.spoken.push({ text, o, h });
  }
  cancel(): void {
    this.cancels++;
  }
  get last() {
    return this.spoken[this.spoken.length - 1]!;
  }
}

const read = (blocks: { text: string; lang?: string }[]) => {
  const synth = new Fake();
  const r = new Reader(synth);
  r.load(blocks);
  return { synth, r };
};

describe('the reader', () => {
  it('reads the pieces one after another and ends by itself', () => {
    const { synth, r } = read([{ text: 'Uno. Dos.' }, { text: 'Tres.' }]);
    expect(r.snapshot).toMatchObject({ state: 'idle', count: 3 });
    r.play();
    expect(synth.last.text).toBe('Uno.');
    expect(r.snapshot).toMatchObject({ state: 'playing', index: 0, block: 0 });
    synth.last.h.onEnd();
    expect(synth.last.text).toBe('Dos.');
    synth.last.h.onEnd();
    expect(synth.last.text).toBe('Tres.');
    expect(r.snapshot).toMatchObject({ index: 2, block: 1 });
    synth.last.h.onEnd();
    expect(r.snapshot).toMatchObject({ state: 'idle', index: 0, word: null });
  });

  it('the word being read comes back in the written text of its block, even after a piece that begins late in the block', () => {
    const { synth, r } = read([{ text: 'Primera frase. Segunda frase aquí.' }]);
    r.play(1);
    expect(synth.last.text).toBe('Segunda frase aquí.');
    synth.last.h.onWord?.(8, 5);
    const w = r.snapshot.word!;
    expect('Primera frase. Segunda frase aquí.'.slice(w.start, w.end)).toBe('frase');
    expect(w.start).toBe(23);
    // without a length, the word is found
    synth.last.h.onWord?.(14);
    const w2 = r.snapshot.word!;
    expect('Primera frase. Segunda frase aquí.'.slice(w2.start, w2.end)).toBe('aquí.');
  });

  it('pause goes on from the word it stopped at, not from the start of the piece', () => {
    const { synth, r } = read([{ text: 'Una frase de varias palabras.' }]);
    r.play();
    synth.last.h.onWord?.(10);
    r.pause();
    expect(r.snapshot.state).toBe('paused');
    // what the engine says when it is cancelled does not count
    synth.spoken[0]!.h.onEnd();
    synth.spoken[0]!.h.onError('canceled', true);
    expect(r.snapshot.state).toBe('paused');
    r.resume();
    expect(r.snapshot.state).toBe('playing');
    expect(synth.last.text).toBe('de varias palabras.');
    synth.last.h.onWord?.(3);
    const w = r.snapshot.word!;
    expect('Una frase de varias palabras.'.slice(w.start, w.end)).toBe('varias');
  });

  it('a change of speed is heard at once, from the word being read', () => {
    const { synth, r } = read([{ text: 'Una frase de varias palabras.' }]);
    r.play();
    synth.last.h.onWord?.(10);
    r.setRate(1.5);
    expect(synth.last.o.rate).toBe(1.5);
    expect(synth.last.text).toBe('de varias palabras.');
    r.setRate(9);
    expect(r.rate).toBe(3);
  });

  it('stop ends everything and the engine\'s late events are ignored', () => {
    const { synth, r } = read([{ text: 'Uno. Dos.' }]);
    r.play();
    const first = synth.last;
    r.stop();
    expect(r.snapshot).toMatchObject({ state: 'idle', word: null });
    first.h.onEnd();
    first.h.onWord?.(0, 3);
    expect(synth.spoken).toHaveLength(1);
    expect(r.snapshot.state).toBe('idle');
  });

  it('next and previous move by piece, reading or not', () => {
    const { synth, r } = read([{ text: 'Uno. Dos. Tres cuatro.' }]);
    r.next();
    expect(r.snapshot).toMatchObject({ state: 'idle', index: 1 });
    r.previous();
    expect(r.snapshot.index).toBe(0);
    r.play(1);
    expect(synth.last.text).toBe('Dos.');
    r.next();
    expect(synth.last.text).toBe('Tres cuatro.');
    r.next();
    expect(synth.last.text).toBe('Tres cuatro.');
    synth.last.h.onWord?.(5, 6);
    r.previous();
    expect(synth.last.text).toBe('Tres cuatro.');
    r.previous();
    expect(synth.last.text).toBe('Dos.');
  });

  it('each block is read in its own language with the voice that fits, the person\'s choice first', () => {
    const { synth, r } = read([{ text: 'Hola.' }, { text: 'Hello.', lang: 'en-US' }, { text: 'Bonjour.', lang: 'fr-FR' }]);
    r.play();
    expect(synth.last.o.voice!.name).toBe('Helena');
    synth.last.h.onEnd();
    expect(synth.last.o).toMatchObject({ lang: 'en-US' });
    expect(synth.last.o.voice!.name).toBe('Zira');
    expect(r.snapshot.noVoice).toBe(false);
    synth.last.h.onEnd();
    expect(r.snapshot.noVoice).toBe(true);
    expect(synth.last.o.voice).toBeNull();
    r.setVoice('es', 'Helena');
    expect(r.voices).toEqual({ es: 'Helena' });
  });

  it('an engine that has not handed over its voices yet is not reported as having none', () => {
    const { synth, r } = read([{ text: 'Hola.' }]);
    synth.list = [];
    r.play();
    expect(r.snapshot.noVoice).toBe(false);
    expect(synth.last.o.voice).toBeNull();
  });

  it('a real error stops and says so; an interruption does not', () => {
    const { synth, r } = read([{ text: 'Uno. Dos.' }]);
    r.play();
    synth.last.h.onError('canceled', true);
    expect(r.snapshot.state).toBe('playing');
    synth.last.h.onError('synthesis-failed', false);
    expect(r.snapshot).toMatchObject({ state: 'idle', error: 'synthesis-failed' });
  });

  it('empty text, or text with nothing to say, does not hang and finds a piece by place', () => {
    const empty = read([{ text: '   ' }]);
    empty.r.play();
    expect(empty.synth.spoken).toHaveLength(0);
    const { r } = read([{ text: 'Uno. Dos.' }, { text: 'Tres.' }]);
    expect(r.indexAt(0, 0)).toBe(0);
    expect(r.indexAt(0, 6)).toBe(1);
    expect(r.indexAt(1, 0)).toBe(2);
    expect(r.indexAt(5, 0)).toBe(3);
    const marks = read([{ text: '•' }, { text: 'Sí.' }]);
    marks.r.play();
    expect(marks.synth.last.text).toBe('Sí.');
  });
});

describe('how things that are written are said', () => {
  const es = (t: string) => toSpeech(t, 'es-ES').text;
  const en = (t: string) => toSpeech(t, 'en-US').text;

  it('Spanish: abbreviations, symbols, ordinals, dates and initials', () => {
    expect(es('El Sr. Pérez y la Dra. Gómez, etc.')).toBe('El señor Pérez y la doctora Gómez, etcétera');
    expect(es('Vive en EE.UU. y en EE. UU.')).toBe('Vive en Estados Unidos y en Estados Unidos');
    expect(es('Sube un 15% y cuesta 5 € o $20 o £3,50')).toBe('Sube un 15 por ciento y cuesta 5 euros o 20 dólares o 3,50 libras');
    expect(es('A las 10 a. m. y a las 4 p.m.')).toBe('A las 10 de la mañana y a las 4 de la tarde');
    expect(es('Es el 1.º, la 2.ª y el 3º')).toBe('Es el primero, la segunda y el tercero');
    expect(es('Nació el 5/3/1990 y vence el 31/12/2026; 45/13/2026 no es fecha')).toBe('Nació el 5 de marzo de 1990 y vence el 31 de diciembre de 2026; 45/13/2026 no es fecha');
    expect(es('Hace 25°C y 3 ° de pendiente, 70°F')).toBe('Hace 25 grados centígrados y 3 grados de pendiente, 70 grados Fahrenheit');
    expect(es('Casa #12 & jardín, 3 × 4 ÷ 2 ≥ 6 ≠ 5')).toBe('Casa número 12  y  jardín, 3  por  4  entre  2  mayor o igual que  6  distinto de  5');
  });

  it('English: titles, symbols and currencies', () => {
    expect(en('Mr. Smith and Dr. Jones, e.g. today vs. tomorrow')).toBe('Mister Smith and Doctor Jones, for example today versus tomorrow');
    expect(en('It rose 15% to $20 or €5 or £3.50, at 25°C')).toBe('It rose 15 percent to 20 dollars or 5 euros or 3.50 pounds, at 25 degrees Celsius');
    expect(en('Item #7 & more')).toBe('Item number 7  and  more');
  });

  it('letters that make no word are spelled; initials that can be said, and Roman numerals, are not; other languages are left as they are', () => {
    expect(es('Abre el PDF en la CPU o el HTML, la ONU y el IVA, siglo XX')).toBe('Abre el P D F en la CPU o el H T M L, la ONU y el IVA, siglo XX');
    expect(toSpeech('Bonjour M. Dupont, 5 € et 10%', 'fr-FR').text).toBe('Bonjour M. Dupont, 5 € et 10%');
  });

  it('the map still takes what is said back to what is written', () => {
    const t = 'Pagó el 15% al Sr. Pérez';
    const sp = toSpeech(t, 'es-ES');
    const at = sp.text.indexOf('señor');
    const r = writtenRange(sp, at, at + 'señor'.length);
    expect(t.slice(r.start, r.end)).toBe('Sr.');
    const k = sp.text.indexOf('ciento');
    const r2 = writtenRange(sp, k, k + 6);
    expect(t.slice(r2.start, r2.end)).toContain('%');
  });
});

describe('what the installed voices cover', () => {
  it('lists languages with no voice at all, and those read with a voice of another region', () => {
    const synth = new Fake();
    const r = new Reader(synth, { lang: 'es-ES' });
    r.load([{ text: 'Hola.' }, { text: 'Hola.', lang: 'es-PE' }, { text: 'Hello.', lang: 'en-US' }, { text: 'Bonjour.', lang: 'fr-FR' }]);
    expect(r.snapshot.missing).toEqual(['fr-FR']);
    expect(r.snapshot.regional).toEqual(['es-PE']);
    synth.list = [];
    expect(r.snapshot.missing).toEqual([]);
  });
});

describe('sentences found by comparing with Word', () => {
  it('a number before a stop ends the sentence unless it is a list item at the start of a line', () => {
    expect(cut('Vive en EE.UU. desde 2010. Antes vivía en Lima.')).toEqual(['Vive en EE.UU. desde 2010.', 'Antes vivía en Lima.']);
    expect(cut('Son las 3:45 del 20/11/2026. Hoy es viernes.')).toEqual(['Son las 3:45 del 20/11/2026.', 'Hoy es viernes.']);
    expect(cut('1. Primero\n2. Segundo')).toEqual(['1. Primero', '2. Segundo']);
  });
  it('the unit of a temperature ends the sentence', () => {
    expect(cut('Hace 25 °C. Mañana bajará a 18 °C. Fin.')).toEqual(['Hace 25 °C.', 'Mañana bajará a 18 °C.', 'Fin.']);
    expect(cut('Escribió J. Pérez en la hoja.')).toEqual(['Escribió J. Pérez en la hoja.']);
  });
  it('the closing quote or bracket goes with the sentence it closes', () => {
    expect(cut('«Vamos», dijo ella. «Ya es tarde.» Y se marcharon.')).toEqual(['«Vamos», dijo ella.', '«Ya es tarde.»', 'Y se marcharon.']);
    expect(cut('Él preguntó: "¿Vienes?" Ella respondió que sí.')).toEqual(['Él preguntó: "¿Vienes?"', 'Ella respondió que sí.']);
    expect(cut('Ocurrió (véase pág. 3). Luego pasó.')).toEqual(['Ocurrió (véase pág. 3).', 'Luego pasó.']);
  });
});
