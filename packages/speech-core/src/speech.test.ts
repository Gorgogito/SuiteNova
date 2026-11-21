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
