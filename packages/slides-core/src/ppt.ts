import * as CFB from 'cfb';
import { newDeck } from './defaults';
import { addSlide } from './ops';
import { docFromText } from './text';
import type { Deck, ShapeEl } from './types';

/*
 * PowerPoint 97-2003 (.ppt), read only and only for the text: the slides in order with the text of their titles and bodies. Layout,
 * formatting, pictures, tables and everything else in the binary format are not read; a warning says so.
 */

const SLIDE_PERSIST = 0x03f3;
const SLIDE_LIST = 0x0ff0;
const TEXT_HEADER = 0x0f9f;
const TEXT_CHARS = 0x0fa0;
const TEXT_BYTES = 0x0fa8;

interface PptSlide {
  title?: string;
  body: string[];
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export function readPpt(data: Uint8Array): { deck: Deck; warnings: string[] } {
  let stream: Uint8Array | null = null;
  try {
    const c = CFB.read(data, { type: 'array' });
    const f = CFB.find(c, '/PowerPoint Document');
    if (f?.content) stream = Uint8Array.from(f.content as ArrayLike<number>);
  } catch {
    /* not a compound file */
  }
  if (!stream) throw new Error('El archivo no es una presentación de PowerPoint 97-2003 válida.');
  const dv = view(stream);
  const slides: PptSlide[] = [];
  let cur: PptSlide | null = null;
  let headerType = 4;

  const addText = (t: string) => {
    if (!cur) return;
    const parts = t.split(/[\r\u000b]/).map((s) => s.replace(/\u0000/g, '')).filter((s, _i, a) => s.length || a.length === 1);
    if (headerType === 0 || headerType === 6) cur.title = ((cur.title ? `${cur.title} ` : '') + parts.join(' ')).trim();
    else if (headerType === 2) return;
    else cur.body.push(...parts);
  };

  // records: 2 bytes (version 4 bits, instance 12), 2 bytes type, 4 bytes length; containers (version 0xF) hold records
  const walk = (start: number, end: number, inSlideList: boolean, listInstance: number) => {
    let p = start;
    while (p + 8 <= end) {
      const verInst = dv.getUint16(p, true);
      const type = dv.getUint16(p + 2, true);
      const len = dv.getUint32(p + 4, true);
      const ver = verInst & 0xf;
      const inst = verInst >> 4;
      const body = p + 8;
      if (body + len > end) break;
      if (ver === 0xf) {
        walk(body, body + len, type === SLIDE_LIST ? true : inSlideList, type === SLIDE_LIST ? inst : listInstance);
      } else if (inSlideList && listInstance === 0) {
        if (type === SLIDE_PERSIST) {
          cur = { body: [] };
          slides.push(cur);
          headerType = 4;
        } else if (type === TEXT_HEADER && len >= 4) headerType = dv.getUint32(body, true);
        else if (type === TEXT_CHARS) addText(new TextDecoder('utf-16le').decode(stream!.subarray(body, body + len)));
        else if (type === TEXT_BYTES) addText(new TextDecoder('windows-1252').decode(stream!.subarray(body, body + len)));
      }
      p = body + len;
    }
  };
  walk(0, stream.length, false, -1);
  if (!slides.length) throw new Error('No se encontró texto de diapositivas en el archivo .ppt.');

  const deck = newDeck();
  const obj = deck.layouts.find((l) => l.type === 'obj') ?? deck.layouts[1] ?? deck.layouts[0]!;
  const blank = deck.layouts.find((l) => l.type === 'blank') ?? deck.layouts[deck.layouts.length - 1]!;
  deck.slides = [];
  let d: Deck = deck;
  slides.forEach((s, i) => {
    const r = addSlide(d, s.title || s.body.length ? obj.id : blank.id, i - 1);
    d = r.deck;
    const shapes = r.slide.shapes.map((e): typeof e => {
      if (e.kind !== 'shape' || !e.ph) return e;
      const t = e.ph.type;
      if ((t === 'title' || t === 'ctrTitle') && s.title) return { ...(e as ShapeEl), text: { ...e.text!, doc: docFromText(s.title) as never } };
      if ((t === 'body' || t === 'obj' || t === 'subTitle') && s.body.length) return { ...(e as ShapeEl), text: { ...e.text!, doc: docFromText(s.body.join('\n')) as never } };
      return e;
    });
    d = { ...d, slides: d.slides.map((x) => (x.id === r.slide.id ? { ...x, shapes } : x)) };
  });
  return { deck: d, warnings: ['Archivo .ppt (formato binario antiguo): solo se ha importado el texto de los títulos y de los cuerpos de las diapositivas. El formato, las imágenes, las tablas, los gráficos y las notas no se leen. Para conservarlo todo, guárdalo como .pptx con PowerPoint o LibreOffice.'] };
}
