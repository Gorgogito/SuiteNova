import type { FileKind } from './files';

export type QType = 'text' | 'longtext' | 'choice' | 'multi' | 'dropdown' | 'ranking' | 'rating' | 'nps' | 'date' | 'number' | 'likert' | 'file' | 'section' | 'title';

export const QTYPES: { id: QType; name: string }[] = [
  { id: 'text', name: 'Texto corto' },
  { id: 'longtext', name: 'Párrafo' },
  { id: 'choice', name: 'Opción única' },
  { id: 'multi', name: 'Casillas (varias opciones)' },
  { id: 'dropdown', name: 'Lista desplegable' },
  { id: 'ranking', name: 'Clasificación (ordenar)' },
  { id: 'rating', name: 'Calificación' },
  { id: 'nps', name: 'Recomendación (0–10)' },
  { id: 'date', name: 'Fecha' },
  { id: 'number', name: 'Número' },
  { id: 'likert', name: 'Escala por filas' },
  { id: 'file', name: 'Subir archivos' },
  { id: 'section', name: 'Sección (página nueva)' },
  { id: 'title', name: 'Título o texto' },
];

export interface Condition {
  /** Id of an earlier question. */
  question: string;
  op: 'eq' | 'neq' | 'contains';
  value: string;
}

/** When a question is shown: one condition, or several of which all (or, with `anyOf`, any one) must be met. */
export interface ShowIf extends Condition {
  more?: Condition[];
  anyOf?: boolean;
}

export const MAX_CONDITIONS = 10;

export const conditionsOf = (q: { showIf: ShowIf | null }): Condition[] => (q.showIf ? [{ question: q.showIf.question, op: q.showIf.op, value: q.showIf.value }, ...(q.showIf.more ?? [])] : []);

export function showIfOf(list: Condition[], anyOf?: boolean): ShowIf | null {
  const [first, ...more] = list;
  return first ? { ...first, ...(more.length ? { more, ...(anyOf ? { anyOf: true } : {}) } : {}) } : null;
}

/** The widths a picture of a question can have (the picture keeps its proportions and never grows past the card). */
export const IMAGE_SIZES = [
  { id: 'small', name: 'Pequeña', px: 160 },
  { id: 'medium', name: 'Mediana', px: 320 },
  { id: 'large', name: 'Grande', px: 480 },
  { id: 'full', name: 'Todo el ancho', px: 0 },
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number]['id'];

/** A picture shown with a question (or a title): a `data:` URL of a raster image of up to 1.5 MB. */
export interface QuestionImage {
  src: string;
  /** Alternative text for assistive technology. */
  alt: string;
  size: ImageSize;
}

/** Only raster `data:` pictures that fit the limit are shown: anything else (an address, a script, SVG) is never put in a page. */
export const isSafeImage = (src: unknown): src is string => typeof src === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length <= 2_100_000;
/** The limit, in bytes, of a picture file. */
export const MAX_IMAGE_BYTES = 1_500_000;

/**
 * How a number is limited: `range` (at least `min`, at most `maxValue`; either may be missing), more than `min`, less
 * than `maxValue`, other than `min`, or outside the stretch from `min` to `maxValue`.
 */
export const NUMBER_RULES = [
  { id: 'range', name: 'Entre un mínimo y un máximo' },
  { id: 'gt', name: 'Mayor que' },
  { id: 'lt', name: 'Menor que' },
  { id: 'ne', name: 'Distinto de' },
  { id: 'outside', name: 'Fuera de un intervalo' },
] as const;
export type NumberRule = (typeof NUMBER_RULES)[number]['id'];

/** What a rating is drawn with: the sign when chosen and when not (numbers have none). */
export const RATING_SYMBOLS = [
  { id: 'number', name: 'Números', on: '', off: '' },
  { id: 'star', name: 'Estrellas', on: '★', off: '☆' },
  { id: 'heart', name: 'Corazones', on: '♥', off: '♡' },
  { id: 'circle', name: 'Círculos', on: '●', off: '○' },
] as const;
export type RatingSymbol = (typeof RATING_SYMBOLS)[number]['id'];

export interface Question {
  id: string;
  type: QType;
  title: string;
  description: string;
  required: boolean;
  /** choice, multi, dropdown: the options. ranking: what is put in order. likert: the columns. */
  options: string[];
  /** likert: the rows. */
  rows: string[];
  /** choice and multi: let the respondent write another answer. */
  allowOther: boolean;
  /** rating: number of stars (3–10). */
  max: number;
  /** text: "none", "email" or "url". */
  format: 'none' | 'email' | 'url';
  /** number: limits; text: limits on the length; multi: how many may be chosen. */
  min: number | null;
  maxValue: number | null;
  integer: boolean;
  showIf: ShowIf | null;
  /** Quiz: the right answer(s) and their points. */
  correct: string[];
  points: number;
  /** A picture shown under the title of the question. */
  image?: QuestionImage;
  /** An equation shown under the title, written as in LaTeX. */
  equation?: string;
  /** choice, multi, dropdown, ranking: each person sees the options in another order. */
  shuffle?: boolean;
  /** number: how `min` and `maxValue` limit it (without it, `range`). */
  rule?: NumberRule;
  /** rating: what it is drawn with (without it, numbers). */
  symbol?: RatingSymbol;
  /** rating and nps: what the two ends mean. */
  lowLabel?: string;
  highLabel?: string;
  /** choice and dropdown: where an option leads when its page is left (the id of a later section, or `end`). */
  branch?: Record<string, string>;
  /** section: where it leads when it is finished (without it, to the page that follows). */
  next?: string;
  /** Keeps its place when the questions are shuffled. */
  locked?: boolean;
  /** file: how many files, how large each (MB) and of which kinds (none: any that is not blocked). */
  maxFiles?: number;
  maxMb?: number;
  kinds?: FileKind[];
}

/** A file that comes with a response. */
export interface UploadedFile {
  name: string;
  size: number;
  type: string;
  /** The content, in base64. */
  data: string;
}

export interface Form {
  id: string;
  version: 1;
  title: string;
  description: string;
  color: string;
  quiz: boolean;
  showScore: boolean;
  thanks: string;
  questions: Question[];
  /** Each person sees the questions in another order (only without sections). */
  shuffle?: boolean;
  /** With several pages: says on which one the person is. */
  progress?: boolean;
  /** The questions show no number. */
  hideNumbers?: boolean;
}

/**
 * A single answer: text, a number, a list (multi; ranking, in order), files, or one column per row (likert).
 * null = not answered.
 */
export type Answer = string | number | string[] | UploadedFile[] | Record<string, string> | null;

export interface Response {
  id: string;
  /** ISO date and time. */
  at: string;
  answers: Record<string, Answer>;
}

let counter = 0;
export const newId = (p: string): string => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newQuestion(type: QType): Question {
  const base: Question = {
    id: newId('q'),
    type,
    title: '',
    description: '',
    required: false,
    options: [],
    rows: [],
    allowOther: false,
    max: 5,
    format: 'none',
    min: null,
    maxValue: null,
    integer: false,
    showIf: null,
    correct: [],
    points: 1,
  };
  if (type === 'choice' || type === 'multi' || type === 'dropdown') base.options = ['Opción 1', 'Opción 2'];
  if (type === 'ranking') base.options = ['Elemento 1', 'Elemento 2', 'Elemento 3'];
  if (type === 'rating') base.symbol = 'star';
  if (type === 'file') Object.assign(base, { maxFiles: 1, maxMb: 10, kinds: [] });
  if (type === 'likert') {
    base.options = ['Muy en desacuerdo', 'En desacuerdo', 'De acuerdo', 'Muy de acuerdo'];
    base.rows = ['Afirmación 1', 'Afirmación 2'];
  }
  return base;
}

export function newForm(title = 'Formulario sin título'): Form {
  return { id: newId('f'), version: 1, title, description: '', color: '#0f6cbd', quiz: false, showScore: true, thanks: 'Gracias por responder.', questions: [] };
}

/** Whether it is a question: texts and sections are not. */
export const isInput = (q: Question): boolean => q.type !== 'title' && q.type !== 'section';
export const hasOptions = (q: Question): boolean => q.type === 'choice' || q.type === 'multi' || q.type === 'dropdown' || q.type === 'ranking' || q.type === 'likert';
/** Whether another question can depend on the answer to this one. */
export const canDecide = (q: Question): boolean => isInput(q) && q.type !== 'file' && q.type !== 'ranking';
/** Question types a quiz can grade. */
export const gradable = (q: Question): boolean => ['choice', 'multi', 'dropdown', 'text', 'number'].includes(q.type);
/** The number each question shows, by its id: titles and texts are not questions and take none. */
export function numbers(form: Pick<Form, 'questions'>): Map<string, number> {
  let n = 0;
  return new Map(form.questions.filter(isInput).map((q) => [q.id, ++n]));
}
