import { defaultStyle, emptyContent, newId, newTextContainer, type PageBody, type PageStyle, type TextContainer } from './model';

/** Plantillas de página: un punto de partida con cuadros de texto ya colocados. */

type J = Record<string, unknown>;
const text = (t: string, bold = false): J => (bold ? { type: 'text', text: t, marks: [{ type: 'strong' }] } : { type: 'text', text: t });
const para = (t = '', attrs: J = {}): J => ({ type: 'paragraph', attrs, content: t ? [text(t)] : [] });
const head = (t: string, level = 1): J => para(t, { style: `Heading${level}` });
const todo = (t = ''): J => para(t, { tag: 'todo' });
const doc = (...blocks: J[]): unknown => ({ type: 'doc', content: blocks.length ? blocks : [para()] });
const table = (rows: string[][], width: number, boldHeader = true): J => {
  const w = Math.max(40, Math.floor(width / Math.max(...rows.map((r) => r.length))));
  return {
    type: 'table',
    attrs: { borders: true },
    content: rows.map((r, i) => ({
      type: 'table_row',
      content: r.map((c) => ({ type: 'table_cell', attrs: { colwidth: [w] }, content: [{ type: 'paragraph', attrs: { spaceAfter: 0 }, content: c ? [text(c, boldHeader && i === 0)] : [] }] })),
    })),
  };
};

const box = (x: number, y: number, w: number, content: unknown, z: number): TextContainer => ({ ...newTextContainer(x, y, w, content, z) });

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  build(now: Date): PageBody;
}

const long = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const style = (over: Partial<PageStyle> = {}): PageStyle => ({ ...defaultStyle(), ...over });

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'blank',
    name: 'En blanco',
    description: 'Un cuadro de texto vacío.',
    build: () => ({ title: '', containers: [newTextContainer()], ink: [], style: defaultStyle() }),
  },
  {
    id: 'meeting',
    name: 'Acta de reunión',
    description: 'Fecha, asistentes, orden del día, decisiones y acciones.',
    build: (d) => ({
      title: 'Reunión',
      style: style(),
      ink: [],
      containers: [
        box(48, 24, 640, doc(para(`Fecha: ${long(d)}`), para('Lugar: '), para('Convoca: ')), 1),
        box(48, 128, 640, doc(head('Asistentes', 2), table([['Nombre', 'Cargo', 'Asiste'], ['', '', ''], ['', '', ''], ['', '', '']], 620)), 2),
        box(48, 360, 640, doc(head('Orden del día', 2), para('1. '), para('2. '), para('3. ')), 3),
        box(48, 512, 640, doc(head('Decisiones', 2), para()), 4),
        box(48, 640, 640, doc(head('Acciones', 2), todo(), todo(), todo()), 5),
      ],
    }),
  },
  {
    id: 'todo',
    name: 'Lista de tareas',
    description: 'Tareas con casilla agrupadas por cuándo hacerlas.',
    build: () => ({
      title: 'Tareas',
      style: style(),
      ink: [],
      containers: [
        box(48, 24, 300, doc(head('Hoy', 2), todo(), todo(), todo()), 1),
        box(376, 24, 300, doc(head('Esta semana', 2), todo(), todo(), todo()), 2),
        box(704, 24, 300, doc(head('Más adelante', 2), todo(), todo()), 3),
      ],
    }),
  },
  {
    id: 'journal',
    name: 'Diario',
    description: 'Un día: cómo fue, lo importante y para mañana.',
    build: (d) => ({
      title: long(d),
      style: style({ ruling: 'wide', color: '#fffdf5' }),
      ink: [],
      containers: [box(48, 24, 640, doc(head('Cómo fue el día', 2), para()), 1), box(48, 240, 640, doc(head('Lo más importante', 2), para()), 2), box(48, 456, 640, doc(head('Para mañana', 2), todo(), todo()), 3)],
    }),
  },
  {
    id: 'weekly',
    name: 'Planificador semanal',
    description: 'Un cuadro por día de la semana y otro de notas.',
    build: () => {
      const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      return {
        title: 'Semana',
        style: style({ ruling: 'grid-medium' }),
        ink: [],
        containers: [
          ...days.map((d, i) => box(40 + (i % 3) * 330, 24 + Math.floor(i / 3) * 240, 300, doc(head(d, 2), todo(), todo()), i + 1)),
          box(40 + 330, 24 + 2 * 240, 300, doc(head('Notas', 2), para()), 8),
        ],
      };
    },
  },
  {
    id: 'brainstorm',
    name: 'Lluvia de ideas',
    description: 'El tema en el centro y cuatro cuadros alrededor.',
    build: () => ({
      title: 'Lluvia de ideas',
      style: style({ ruling: 'grid-large' }),
      ink: [],
      containers: [
        box(320, 260, 280, doc(head('Tema', 1), para('Escribe aquí el tema')), 1),
        box(48, 40, 300, doc(head('Ideas', 2), para()), 2),
        box(560, 40, 300, doc(head('A favor', 2), para()), 3),
        box(48, 520, 300, doc(head('Dudas', 2), para()), 4),
        box(560, 520, 300, doc(head('Siguientes pasos', 2), todo(), todo()), 5),
      ],
    }),
  },
  {
    id: 'cornell',
    name: 'Notas Cornell',
    description: 'Pistas a la izquierda, notas a la derecha y resumen abajo.',
    build: () => ({
      title: 'Apuntes',
      style: style({ ruling: 'standard', margin: true }),
      ink: [],
      containers: [box(48, 24, 200, doc(head('Pistas', 2), para()), 1), box(280, 24, 560, doc(head('Notas', 2), para()), 2), box(48, 700, 792, doc(head('Resumen', 2), para()), 3)],
    }),
  },
  {
    id: 'project',
    name: 'Plan de proyecto',
    description: 'Objetivo y una tabla de tareas con responsable y fecha.',
    build: () => ({
      title: 'Proyecto',
      style: style(),
      ink: [],
      containers: [
        box(48, 24, 700, doc(head('Objetivo', 2), para()), 1),
        box(48, 150, 700, doc(head('Tareas', 2), table([['Tarea', 'Responsable', 'Fecha', 'Estado'], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']], 680)), 2),
      ],
    }),
  },
  {
    id: 'proscons',
    name: 'Pros y contras',
    description: 'Dos columnas para decidir.',
    build: () => ({
      title: 'Decisión',
      style: style(),
      ink: [],
      containers: [box(48, 24, 700, doc(head('Decisión a tomar', 2), para()), 1), box(48, 150, 700, doc(table([['Pros', 'Contras'], ['', ''], ['', ''], ['', ''], ['', '']], 680)), 2)],
    }),
  },
  {
    id: 'budget',
    name: 'Presupuesto con fórmulas',
    description: 'Una tabla que calcula los totales (=B2*C2, =SUMA(ARRIBA)).',
    build: () => ({
      title: 'Presupuesto',
      style: style(),
      ink: [],
      containers: [
        box(48, 24, 620, doc(head('Presupuesto', 1), table([['Concepto', 'Cantidad', 'Precio', 'Total'], ['Material', '10', '4,5', '=B2*C2'], ['Transporte', '1', '120', '=B3*C3'], ['Servicios', '3', '85', '=B4*C4'], ['Total', '', '', '=SUMA(ARRIBA)']], 600)), 1),
        box(48, 330, 620, doc(para('Escribe una fórmula empezando por «=». Las celdas se llaman A1, B2… como en una hoja de cálculo; SUMA(ARRIBA) suma los números de encima.')), 2),
      ],
    }),
  },
];

export const templateById = (id: string): TemplateInfo | undefined => TEMPLATES.find((t) => t.id === id);

/** Una copia nueva de un cuerpo de plantilla (con identificadores nuevos en cada cuadro y trazo). */
export function freshBody(b: PageBody): PageBody {
  return {
    title: b.title,
    style: { ...b.style },
    containers: b.containers.map((c) => ({ ...JSON.parse(JSON.stringify(c)), id: newId('c') }) as PageBody['containers'][number]),
    ink: b.ink.map((s) => ({ ...JSON.parse(JSON.stringify(s)), id: newId('k') })),
  };
}

void emptyContent;
