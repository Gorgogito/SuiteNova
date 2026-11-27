export type QType = 'text' | 'longtext' | 'choice' | 'multi' | 'dropdown' | 'rating' | 'nps' | 'date' | 'number' | 'likert' | 'title';

export const QTYPES: { id: QType; name: string }[] = [
  { id: 'text', name: 'Texto corto' },
  { id: 'longtext', name: 'Párrafo' },
  { id: 'choice', name: 'Opción única' },
  { id: 'multi', name: 'Casillas (varias opciones)' },
  { id: 'dropdown', name: 'Lista desplegable' },
  { id: 'rating', name: 'Calificación' },
  { id: 'nps', name: 'Recomendación (0–10)' },
  { id: 'date', name: 'Fecha' },
  { id: 'number', name: 'Número' },
  { id: 'likert', name: 'Escala por filas' },
  { id: 'title', name: 'Título o texto' },
];

export interface ShowIf {
  /** Id of an earlier question. */
  question: string;
  op: 'eq' | 'neq' | 'contains';
  value: string;
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

export interface Question {
  id: string;
  type: QType;
  title: string;
  description: string;
  required: boolean;
  /** choice, multi, dropdown: the options. likert: the columns. */
  options: string[];
  /** likert: the rows. */
  rows: string[];
  /** choice and multi: let the respondent write another answer. */
  allowOther: boolean;
  /** rating: number of stars (3–10). */
  max: number;
  /** text: "none", "email" or "url". */
  format: 'none' | 'email' | 'url';
  /** number: limits; text: limits on the length. */
  min: number | null;
  maxValue: number | null;
  integer: boolean;
  showIf: ShowIf | null;
  /** Quiz: the right answer(s) and their points. */
  correct: string[];
  points: number;
  /** A picture shown under the title of the question. */
  image?: QuestionImage;
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
}

/** A single answer: text, a number, a list (multi), or one column per row (likert). null = not answered. */
export type Answer = string | number | string[] | Record<string, string> | null;

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
  if (type === 'likert') {
    base.options = ['Muy en desacuerdo', 'En desacuerdo', 'De acuerdo', 'Muy de acuerdo'];
    base.rows = ['Afirmación 1', 'Afirmación 2'];
  }
  return base;
}

export function newForm(title = 'Formulario sin título'): Form {
  return { id: newId('f'), version: 1, title, description: '', color: '#0f6cbd', quiz: false, showScore: true, thanks: 'Gracias por responder.', questions: [] };
}

export const isInput = (q: Question): boolean => q.type !== 'title';
export const hasOptions = (q: Question): boolean => q.type === 'choice' || q.type === 'multi' || q.type === 'dropdown' || q.type === 'likert';
/** Question types a quiz can grade. */
export const gradable = (q: Question): boolean => ['choice', 'multi', 'dropdown', 'text', 'number'].includes(q.type);
/** The number each question shows, by its id: titles and texts are not questions and take none. */
export function numbers(form: Pick<Form, 'questions'>): Map<string, number> {
  let n = 0;
  return new Map(form.questions.filter(isInput).map((q) => [q.id, ++n]));
}
