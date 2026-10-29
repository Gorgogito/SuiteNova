import { cleanResponse, norm } from './logic';
import { newForm, newId, newQuestion, type Answer, type Form, type QType, type Question, type Response } from './model';

/*
 * Import of forms made elsewhere.
 *
 * - Google Forms: the page of a form (viewform or edit, saved from the browser as .html) carries the whole form in a
 *   JavaScript variable, FB_PUBLIC_LOAD_DATA_. That is an internal, undocumented structure of Google: the positions
 *   below were taken from the open source library "gforms" and may stop working if Google changes the page.
 * - Microsoft Forms and Google Forms both export the *responses* as a spreadsheet (Excel / CSV). The form is rebuilt
 *   from the header row and the values, so the question types are a best guess.
 */

export interface ImportedForm {
  form: Form;
  responses: Response[];
  warnings: string[];
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ------------------------------------------------------------------ Google Forms page

/** The JSON text of FB_PUBLIC_LOAD_DATA_ inside an HTML page (or the array itself), or null. */
function extractLoadData(text: string): string | null {
  const at = text.indexOf('FB_PUBLIC_LOAD_DATA_');
  let start: number;
  if (at >= 0) start = text.indexOf('[', text.indexOf('=', at));
  else start = text.trimStart().startsWith('[') ? text.indexOf('[') : -1;
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export function parseGoogleForm(text: string): ImportedForm {
  const json = extractLoadData(text);
  if (!json) throw new Error('No se encontró el formulario de Google en este archivo. Abre el formulario en el navegador (la vista para responder) y guarda la página como .html.');
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    try {
      data = JSON.parse(json.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'));
    } catch {
      throw new Error('Los datos del formulario de Google no se pudieron leer (¿Google cambió el formato de la página?).');
    }
  }
  const raw = arr(data)[1];
  if (!Array.isArray(raw)) throw new Error('El archivo no tiene la estructura de un formulario de Google.');
  const warnings: string[] = [];
  const form = newForm(clip(raw[8], 300) || clip(data[3], 300) || 'Formulario de Google');
  form.description = clip(raw[0], 3000);
  form.thanks = 'Gracias por responder.';
  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);
  let jumps = false;
  let validations = 0;
  let sections = 0;

  for (const e of arr(raw[1]).slice(0, 500)) {
    if (!Array.isArray(e)) continue;
    const title = clip(e[1], 500);
    const description = clip(e[2], 2000);
    const type = e[3];
    const entries = arr(e[4]);
    const e0 = arr(entries[0]);
    const required = e0[2] === 1 || e0[2] === true;
    const make = (t: QType, over: Partial<Question> = {}): void => {
      form.questions.push({ ...newQuestion(t), id: newId('q'), title, description, required: t === 'title' ? false : required, options: [], rows: [], ...over });
    };
    const options = (entry: any[]): { list: string[]; other: boolean; jump: boolean } => {
      const list: string[] = [];
      let other = false;
      let jump = false;
      for (const o of arr(entry[1])) {
        const oa = arr(o);
        if (oa[4]) other = true;
        else if (typeof oa[0] === 'string' && oa[0] !== '') list.push(oa[0].slice(0, 500));
        if (Array.isArray(oa[2]) ? oa[2].length > 0 : oa[2] !== undefined && oa[2] !== null && oa[2] !== 0) jump = true;
      }
      return { list: [...new Set(list)].slice(0, 200), other, jump };
    };
    switch (type) {
      case 0:
      case 1:
        if (arr(e0[4]).length) validations++;
        make(type === 0 ? 'text' : 'longtext');
        break;
      case 2:
      case 3:
      case 4: {
        const o = options(e0);
        if (o.jump) jumps = true;
        make(type === 2 ? 'choice' : type === 3 ? 'dropdown' : 'multi', { options: o.list, allowOther: o.other && type !== 3 });
        if (o.other && type === 3) warnings.push(`La pregunta «${title}» tiene la opción «Otro», que una lista desplegable no admite; se omitió.`);
        break;
      }
      case 5: {
        const vals = arr(e0[1]).map((o) => String(arr(o)[0] ?? ''));
        const nums = vals.map(Number);
        const labels = arr(e0[3]);
        const low = clip(labels[0], 100);
        const high = clip(labels[1], 100);
        const hint = low || high ? `${description ? description + ' ' : ''}(${low || '—'} → ${high || '—'})` : description;
        const first = nums[0];
        const last = nums[nums.length - 1]!;
        const consecutive = nums.length > 1 && nums.every((n, i) => Number.isInteger(n) && n === first! + i);
        if (consecutive && first === 1 && last >= 3 && last <= 10) make('rating', { max: last, description: hint });
        else if (consecutive && first === 0 && last === 10) make('nps', { description: hint });
        else {
          make('choice', { options: vals.filter(Boolean), description: hint });
          warnings.push(`La escala «${title}» (de ${vals[0] ?? '?'} a ${vals[vals.length - 1] ?? '?'}) no tiene equivalente exacto y se importó como opción única.`);
        }
        break;
      }
      case 6:
        make('title');
        break;
      case 7: {
        const rows = entries.map((en) => clip(arr(arr(en)[3])[0], 500)).filter(Boolean);
        const cols = options(e0).list;
        const multi = !!arr(e0[11])[0];
        make('likert', { options: cols, rows: [...new Set(rows)] });
        if (multi) warnings.push(`La cuadrícula de casillas «${title}» admite varias columnas por fila; se importó con una sola columna por fila.`);
        break;
      }
      case 8:
        sections++;
        if (title || description) make('title');
        break;
      case 9:
        make('date');
        if (arr(e0[7]).length && arr(e0[7])[0]) warnings.push(`La pregunta de fecha «${title}» también pedía hora; solo se conserva la fecha.`);
        break;
      case 10:
        make('text');
        warnings.push(`La pregunta de hora «${title}» no tiene tipo propio y se importó como texto corto.`);
        break;
      case 11:
        skip('imágenes');
        break;
      case 12:
        skip('vídeos');
        break;
      case 13:
        skip('preguntas de subir archivos');
        break;
      default:
        skip('elementos desconocidos');
    }
  }
  for (const [what, n] of skipped) warnings.push(`Se omitieron ${n} elemento(s) sin equivalente (${what}).`);
  if (validations) warnings.push(`${validations} pregunta(s) de texto tenían reglas de validación de Google; no se importaron (revisa los formatos y límites).`);
  if (jumps || sections > 1) warnings.push('Las secciones de Google se importaron como títulos y no se conserva el salto de sección según la respuesta: todas las preguntas se muestran en una página.');
  if (!form.questions.some((q) => q.type !== 'title')) throw new Error('El formulario de Google no tiene preguntas que se puedan importar (si exige iniciar sesión, la página guardada solo contiene el aviso de acceso).');
  return { form, responses: [], warnings };
}

// ------------------------------------------------------------------ response spreadsheets

/** Column headers that carry data about the response, not an answer. */
const MS_TIME = new Set(['completion time', 'hora de finalizacion', 'heure de fin', 'completion date']);
const MS_START = new Set(['start time', 'hora de inicio', 'heure de debut']);
const MS_META = new Set([
  'id', 'email', 'correo electronico', 'correo', 'name', 'nombre', 'last modified time', 'hora de la ultima modificacion',
  'total points', 'puntos totales', 'quiz feedback', 'comentarios del cuestionario', 'grade posted time', 'hora de publicacion de la calificacion',
  ...MS_START,
]);
const G_TIME = new Set(['timestamp', 'marca temporal', 'horodateur']);
const G_META = new Set(['email address', 'direccion de correo electronico', 'score', 'puntuacion', 'puntaje']);
const MS_PER_QUESTION = /^(points|puntos|feedback|comentarios|comentario)\s*[-:–]\s+/;

type Source = 'microsoft' | 'google' | 'unknown';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

type DateOrder = 'dmy' | 'mdy';

function parseDate(s: string, order: DateOrder): { date: string; time: string } | null {
  const m = /^\s*(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[1]!.length === 4) [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
  else if (m[3]!.length === 4) [y, mo, d] = order === 'dmy' ? [+m[3]!, +m[2]!, +m[1]!] : [+m[3]!, +m[1]!, +m[2]!];
  else return null;
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const back = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(back.getTime()) || back.toISOString().slice(0, 10) !== iso) return null;
  const time = m[4] ? `${m[4]!.padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}` : '';
  return { date: iso, time };
}

/** Day first unless a value proves the month comes first. */
function dateOrder(values: string[]): DateOrder {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{4}/.exec(v);
    if (!m) continue;
    if (+m[1]! > 12) dmy = true;
    else if (+m[2]! > 12) mdy = true;
  }
  return mdy && !dmy ? 'mdy' : 'dmy';
}

const toIsoAt = (v: string, order: DateOrder): string | undefined => {
  const p = parseDate(v, order);
  return p ? `${p.date}T${p.time || '00:00:00'}.000Z` : undefined;
};

function splitMulti(cell: string, seps: string[]): string[] {
  for (const sep of seps) if (cell.includes(sep)) return cell.split(sep).map((x) => x.trim()).filter(Boolean);
  return cell.trim() ? [cell.trim()] : [];
}

interface Spec {
  title: string;
  /** Column indexes: one, or several for a grid. */
  cols: number[];
  rows: string[];
  q: Question;
  sep?: string[];
  order?: DateOrder;
}

const ordered = (values: string[]): string[] => [...new Set(values)];

/** Guess the question for one column from the values people gave. */
function inferColumn(title: string, values: string[], seps: string[], order: DateOrder): Pick<Spec, 'q' | 'sep'> {
  const q = { ...newQuestion('text'), id: newId('q'), title: title.slice(0, 500), options: [] as string[], rows: [] as string[] };
  const n = values.length;
  if (!n) return { q };
  const as = (t: QType, over: Partial<Question> = {}): Pick<Spec, 'q' | 'sep'> => ({ q: { ...newQuestion(t), id: q.id, title: q.title, options: [], rows: [], ...over } });
  // numbers: integers 1..N look like a rating, 0..10 like a recommendation score
  if (values.every((v) => /^-?\d+([.,]\d+)?$/.test(v))) {
    const nums = values.map((v) => Number(v.replace(',', '.')));
    const ints = nums.every(Number.isInteger);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (n >= 3 && ints && lo >= 1 && hi <= 10 && ordered(values).length <= 10) return as('rating', { max: hi <= 5 ? 5 : Math.max(hi, 6) });
    if (n >= 3 && ints && lo === 0 && hi <= 10 && hi > 5) return as('nps');
    return as('number', { integer: ints });
  }
  if (values.every((v) => parseDate(v, order) && !parseDate(v, order)!.time)) return as('date');
  if (values.every((v) => EMAIL.test(v))) return as('text', { format: 'email' });
  if (values.every((v) => URL_RE.test(v))) return as('text', { format: 'url' });
  if (n >= 3) {
    // several answers in one cell
    for (const sep of seps) {
      const pieces = values.map((v) => splitMulti(v, [sep]));
      const all = pieces.flat();
      const distinct = ordered(all);
      if (pieces.some((p) => p.length >= 2) && distinct.length <= 12 && distinct.length <= Math.ceil(all.length / 2)) return { ...as('multi', { options: distinct }), sep: [sep] };
    }
    const distinct = ordered(values);
    if (distinct.length <= 12 && distinct.length <= Math.max(2, Math.floor(n / 2))) return as('choice', { options: distinct });
  }
  if (values.some((v) => v.length > 150 || /\n/.test(v))) return as('longtext');
  return as('text');
}

/**
 * Build a form (and its responses) from the table of responses exported by Microsoft Forms (Excel) or Google Forms
 * (its spreadsheet, as .xlsx or .csv). `rows[0]` is the header row.
 */
export function formFromSheet(rows: string[][], title: string): ImportedForm {
  const warnings: string[] = [];
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const data = rows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!header.some(Boolean)) throw new Error('El archivo no tiene una fila de encabezados con los textos de las preguntas.');
  const nh = header.map(norm);
  const source: Source = nh[0] === 'id' && nh.some((h) => MS_TIME.has(h) || MS_START.has(h)) ? 'microsoft' : G_TIME.has(nh[0] ?? '') ? 'google' : 'unknown';
  const timeCol = source === 'microsoft' ? nh.findIndex((h) => MS_TIME.has(h)) : source === 'google' ? 0 : -1;
  const idCol = source === 'microsoft' ? 0 : -1;
  const metaCol = (i: number): boolean => {
    if (i === timeCol || i === idCol) return true;
    const h = nh[i]!;
    if (source === 'microsoft') return MS_META.has(h) || MS_PER_QUESTION.test(h);
    if (source === 'google') return G_META.has(h);
    return false;
  };
  const cell = (r: string[], c: number): string => String(r[c] ?? '').trim();
  const questionCols = header.map((_h, i) => i).filter((i) => header[i] !== '' && !metaCol(i));
  if (!questionCols.length) throw new Error('El archivo no tiene columnas de preguntas.');

  const timeValues = timeCol >= 0 ? data.map((r) => cell(r, timeCol)) : [];
  const order = dateOrder([...timeValues, ...questionCols.flatMap((c) => data.map((r) => cell(r, c)))]);
  const seps = source === 'microsoft' ? [';'] : source === 'google' ? [', ', ';'] : [';', ', '];

  // Google writes a grid as one column per row, named "Question [Row]"
  const specs: Spec[] = [];
  for (let k = 0; k < questionCols.length; k++) {
    const c = questionCols[k]!;
    const m = /^(.*\S)\s*\[([^\]]*)\]$/.exec(header[c]!);
    if (m && source !== 'microsoft') {
      const group = [c];
      const rowNames = [m[2]!];
      while (k + 1 < questionCols.length) {
        const m2 = /^(.*\S)\s*\[([^\]]*)\]$/.exec(header[questionCols[k + 1]!]!);
        if (!m2 || m2[1] !== m[1]) break;
        group.push(questionCols[k + 1]!);
        rowNames.push(m2[2]!);
        k++;
      }
      const values = ordered(group.flatMap((g) => data.map((r) => cell(r, g)).filter(Boolean)));
      if (group.length >= 2 && values.length <= 12) {
        const q = { ...newQuestion('likert'), id: newId('q'), title: m[1]!.slice(0, 500), options: values, rows: ordered(rowNames) };
        specs.push({ title: q.title, cols: group, rows: rowNames, q });
        continue;
      }
      // not a grid: handle these columns one by one
      k -= group.length - 1;
    }
    const values = data.map((r) => cell(r, c)).filter(Boolean);
    const inf = inferColumn(header[c]!, values, seps, order);
    specs.push({ title: header[c]!, cols: [c], rows: [], ...inf, order });
  }

  const form = newForm(title.slice(0, 300) || 'Formulario importado');
  form.questions = specs.map((s) => s.q);
  const responses: Response[] = [];
  let dropped = 0;
  data.forEach((r, i) => {
    const answers: Record<string, Answer> = {};
    for (const s of specs) {
      if (s.q.type === 'likert') {
        const rec: Record<string, string> = {};
        s.cols.forEach((c, j) => {
          const v = cell(r, c);
          if (v) rec[s.rows[j]!] = v;
        });
        if (Object.keys(rec).length) answers[s.q.id] = rec;
        continue;
      }
      const v = cell(r, s.cols[0]!);
      if (!v) continue;
      if (s.q.type === 'multi') answers[s.q.id] = splitMulti(v, s.sep ?? seps);
      else if (s.q.type === 'date') answers[s.q.id] = parseDate(v, order)?.date ?? v;
      else answers[s.q.id] = v;
    }
    const id = source === 'microsoft' && cell(r, idCol) ? `ms-${cell(r, idCol)}` : `imp-${i + 1}`;
    const at = timeCol >= 0 ? toIsoAt(cell(r, timeCol), order) : undefined;
    const c = cleanResponse(form, { id, at, answers });
    if (c) {
      responses.push(c.response);
      dropped += c.dropped;
    }
  });
  if (data.length - responses.length > 0) warnings.push(`${data.length - responses.length} fila(s) sin ninguna respuesta se omitieron.`);
  if (dropped) warnings.push(`${dropped} respuesta(s) no encajaban con el tipo de pregunta deducido y se omitieron.`);
  const meta = header.length - questionCols.length - header.filter((h) => h === '').length;
  warnings.push(
    (source === 'microsoft' ? 'Hoja de Microsoft Forms' : source === 'google' ? 'Hoja de Google Forms' : 'Tabla de respuestas') +
      `: el formulario se reconstruyó a partir de ${specs.length} columna(s) y ${responses.length} respuesta(s). Los tipos de pregunta, las opciones y qué es obligatorio se deducen de lo respondido; no hay descripciones, condiciones ni «Otro».` +
      (meta > 0 ? ` Se ignoraron ${meta} columna(s) con datos de la respuesta (identificador, correo, nombre, puntos).` : ''),
  );
  if (!responses.length) warnings.push('El archivo no tenía respuestas; las preguntas son solo texto corto.');
  return { form, responses, warnings };
}
