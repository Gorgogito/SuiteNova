import {
  DEFAULT_DOC_DEFAULTS,
  defaultPage,
  defaultSection,
  emptyWriterDoc,
  makeSection,
  newSectionId,
  nodeTypes,
  writerSchema,
  type WriterDoc,
} from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { newControl } from './forms';

const T = nodeTypes;
const txt = (s: string, marks: PMNode['marks'] = []) => writerSchema.text(s, marks);
const bold = () => [writerSchema.marks.strong!.create()];
type Inline = PMNode | string;
const inl = (c: Inline[]): PMNode[] => c.map((x) => (typeof x === 'string' ? txt(x) : x));
const P = (c: Inline[] | string = [], attrs: Record<string, unknown> = {}) => T.paragraph!.create(attrs, inl(Array.isArray(c) ? c : c ? [c] : []));
const S = (style: string, c: Inline[] | string) => P(c, { style });
const B = (s: string) => txt(s, bold());
/** A placeholder the person replaces by typing: a text content control. */
const ph = (title: string, hint?: string) => newControl('text', { id: `cc-${newSectionId()}`, title, placeholder: hint ?? title });
const date = () => T.content_control!.create({ type: 'date', id: `cc-${newSectionId()}`, title: 'Fecha', placeholder: 'Seleccione una fecha', showing: true, dateFormat: "d 'de' MMMM 'de' yyyy" }, txt('Seleccione una fecha'));
const cell = (c: Inline[] | string, attrs: Record<string, unknown> = {}) => T.table_cell!.create(attrs, [P(c)]);
const row = (cells: PMNode[]) => T.table_row!.create(null, cells);
const table = (rows: PMNode[], borders = true) => T.table!.create({ borders }, rows);
const pageNumberFooter = (): PMNode => T.doc!.create(null, [P([txt('Página '), T.field!.create({ kind: 'page' }), txt(' de '), T.field!.create({ kind: 'pages' })], { align: 'center' })]);

export interface WriterTemplate {
  id: string;
  name: string;
  description: string;
  build(): WriterDoc;
}

function doc(blocks: PMNode[][], extra: Partial<WriterDoc> = {}, sectionExtra: Partial<ReturnType<typeof defaultSection>> = {}): WriterDoc {
  const base = emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS });
  const secs = blocks.map((b, i) => makeSection(b, { ...defaultSection(defaultPage()), id: newSectionId(), ...(i === 0 ? {} : { start: 'nextPage' }), ...sectionExtra }));
  return { ...base, body: T.doc!.create(null, secs), ...extra };
}

export const TEMPLATES: WriterTemplate[] = [
  {
    id: 'letter',
    name: 'Carta',
    description: 'Carta formal con remitente, fecha, destinatario y despedida.',
    build: () =>
      doc([
        [
          P([ph('Su nombre')], { align: 'right', spaceAfter: 0 }),
          P([ph('Su dirección')], { align: 'right', spaceAfter: 0 }),
          P([ph('Ciudad y código postal')], { align: 'right', spaceAfter: 18 }),
          P([date()], { align: 'right', spaceAfter: 18 }),
          P([ph('Nombre del destinatario')], { spaceAfter: 0 }),
          P([ph('Cargo y empresa')], { spaceAfter: 0 }),
          P([ph('Dirección del destinatario')], { spaceAfter: 18 }),
          P([B('Asunto: '), ph('Asunto de la carta')], { spaceAfter: 12 }),
          P(['Estimado/a ', ph('Nombre'), ':'], { spaceAfter: 12 }),
          P([ph('Escriba aquí el cuerpo de la carta. Explique el motivo en el primer párrafo y detalle lo necesario en los siguientes.')], { align: 'justify' }),
          P('Quedo a su disposición para cualquier aclaración.', { align: 'justify', spaceAfter: 18 }),
          P('Atentamente,', { spaceAfter: 36 }),
          P([ph('Su nombre y firma')]),
        ],
      ]),
  },
  {
    id: 'memo',
    name: 'Memorando',
    description: 'Comunicación interna con los campos Para, De, Fecha y Asunto.',
    build: () =>
      doc([
        [
          S('Title', 'MEMORANDO'),
          table(
            [
              row([cell([B('Para:')], { colwidth: [90] }), cell([ph('Destinatario')])]),
              row([cell([B('De:')], { colwidth: [90] }), cell([ph('Remitente')])]),
              row([cell([B('Fecha:')], { colwidth: [90] }), cell([date()])]),
              row([cell([B('Asunto:')], { colwidth: [90] }), cell([ph('Asunto')])]),
            ],
            false,
          ),
          P('', { spaceAfter: 6 }),
          P([ph('Escriba aquí el mensaje.')]),
        ],
      ]),
  },
  {
    id: 'report',
    name: 'Informe',
    description: 'Portada, índice de secciones y capítulos con numeración de páginas en el pie.',
    build: () => {
      const fid = `footer-${newSectionId()}`;
      const cover = [
        P('', { spaceBefore: 120 }),
        S('Title', [ph('Título del informe')]),
        S('Subtitle', [ph('Subtítulo o descripción')]),
        P('', { spaceBefore: 120 }),
        P([B('Autor: '), ph('Su nombre')]),
        P([B('Fecha: '), date()]),
      ];
      const body = [
        S('Heading1', '1. Introducción'),
        P([ph('Presente el tema y el objetivo del informe.')]),
        S('Heading1', '2. Desarrollo'),
        S('Heading2', '2.1 Antecedentes'),
        P([ph('Describa el contexto.')]),
        S('Heading2', '2.2 Análisis'),
        P([ph('Presente los datos y su interpretación.')]),
        S('Heading1', '3. Conclusiones'),
        P([ph('Resuma los resultados y las recomendaciones.')]),
      ];
      const d = doc([cover, body]);
      const secs: PMNode[] = [];
      d.body.forEach((s, _o, i) => secs.push(i === 1 ? T.section!.create({ ...s.attrs, footer: { default: fid, first: null, even: null } }, s.content) : s));
      return { ...d, body: T.doc!.create(null, secs), parts: { [fid]: pageNumberFooter() } };
    },
  },
  {
    id: 'minutes',
    name: 'Acta de reunión',
    description: 'Datos de la reunión, asistentes, orden del día y acuerdos con responsables.',
    build: () =>
      doc([
        [
          S('Title', 'Acta de reunión'),
          P([B('Fecha: '), date()], { spaceAfter: 2 }),
          P([B('Lugar: '), ph('Lugar')], { spaceAfter: 2 }),
          P([B('Asistentes: '), ph('Nombres de los asistentes')]),
          S('Heading1', 'Orden del día'),
          P([ph('1. Primer punto')], { spaceAfter: 2 }),
          P([ph('2. Segundo punto')]),
          S('Heading1', 'Acuerdos'),
          table([
            row([cell([B('Acuerdo')]), cell([B('Responsable')]), cell([B('Plazo')])]),
            row([cell([ph('Acuerdo')]), cell([ph('Responsable')]), cell([ph('Plazo')])]),
            row([cell([ph('Acuerdo')]), cell([ph('Responsable')]), cell([ph('Plazo')])]),
          ]),
          P('', { spaceAfter: 6 }),
          P([B('Próxima reunión: '), date()]),
        ],
      ]),
  },
  {
    id: 'invoice',
    name: 'Factura',
    description: 'Factura con datos de emisor y cliente, líneas de detalle y total.',
    build: () =>
      doc([
        [
          S('Title', 'FACTURA'),
          P([B('N.º: '), ph('Número')], { spaceAfter: 2 }),
          P([B('Fecha: '), date()], { spaceAfter: 12 }),
          table(
            [
              row([cell([B('Emisor')]), cell([B('Cliente')])]),
              row([cell([ph('Nombre o razón social')]), cell([ph('Nombre o razón social')])]),
              row([cell([ph('NIF / RUC')]), cell([ph('NIF / RUC')])]),
              row([cell([ph('Dirección')]), cell([ph('Dirección')])]),
            ],
            false,
          ),
          P('', { spaceAfter: 12 }),
          table([
            row([cell([B('Descripción')]), cell([B('Cantidad')]), cell([B('Precio')]), cell([B('Importe')])]),
            row([cell([ph('Concepto')]), cell([ph('0')]), cell([ph('0,00')]), cell([ph('0,00')])]),
            row([cell([ph('Concepto')]), cell([ph('0')]), cell([ph('0,00')]), cell([ph('0,00')])]),
            row([cell(''), cell(''), cell([B('Total')]), cell([ph('0,00')])]),
          ]),
          P('', { spaceAfter: 6 }),
          P([ph('Forma de pago y observaciones')]),
        ],
      ]),
  },
  {
    id: 'resume',
    name: 'Currículum',
    description: 'Currículum de una página con perfil, experiencia, formación y habilidades.',
    build: () =>
      doc([
        [
          S('Title', [ph('Nombre y apellidos')]),
          P([ph('Teléfono'), ' · ', ph('Correo electrónico'), ' · ', ph('Ciudad')], { spaceAfter: 12 }),
          S('Heading1', 'Perfil'),
          P([ph('Resuma en dos o tres líneas quién es y qué busca.')]),
          S('Heading1', 'Experiencia'),
          P([B('Puesto'), ' — ', ph('Empresa'), ' (', ph('años'), ')'], { spaceAfter: 2 }),
          P([ph('Logros y responsabilidades.')]),
          S('Heading1', 'Formación'),
          P([B('Título'), ' — ', ph('Centro'), ' (', ph('año'), ')']),
          S('Heading1', 'Habilidades'),
          P([ph('Idiomas, herramientas, certificaciones.')]),
        ],
      ]),
  },
  {
    id: 'newsletter',
    name: 'Boletín',
    description: 'Título a una columna y artículos a dos columnas.',
    build: () => {
      const head = [S('Title', [ph('Nombre del boletín')]), S('Subtitle', [ph('Número y fecha')])];
      const cols = [S('Heading1', [ph('Titular del primer artículo')]), P([ph('Texto del artículo.')], { align: 'justify' }), S('Heading1', [ph('Titular del segundo artículo')]), P([ph('Texto del artículo.')], { align: 'justify' })];
      const d = doc([head, cols]);
      const secs: PMNode[] = [];
      d.body.forEach((s, _o, i) => secs.push(i === 1 ? T.section!.create({ ...s.attrs, start: 'continuous', cols: { count: 2, space: 36, sep: true, widths: null } }, s.content) : s));
      return { ...d, body: T.doc!.create(null, secs) };
    },
  },
  {
    id: 'form',
    name: 'Formulario de solicitud',
    description: 'Formulario para rellenar con controles de texto, lista, fecha y casillas.',
    build: () => {
      const d = doc([
        [
          S('Title', 'Solicitud'),
          P([B('Nombre completo: '), ph('Nombre')]),
          P([B('Fecha de nacimiento: '), date()]),
          P([
            B('Tipo de solicitud: '),
            newControl('dropdown', { id: `cc-${newSectionId()}`, title: 'Tipo', items: [{ label: 'Alta', value: 'alta' }, { label: 'Modificación', value: 'mod' }, { label: 'Baja', value: 'baja' }] }),
          ]),
          P([newControl('checkbox', { id: `cc-${newSectionId()}`, title: 'Acepto' }), ' Acepto las condiciones.']),
          P([B('Observaciones: '), ph('Escriba sus observaciones')]),
        ],
      ]);
      return { ...d, protection: null };
    },
  },
];
