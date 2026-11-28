/*
 * Ready-made forms to start from. Each one is built anew, in Spanish or in English.
 */
import type { Lang } from './i18n';
import { newForm, newQuestion, showIfOf, type Form, type QType, type Question } from './model';

/** The text in the language of the template. */
type Say = (es: string, en: string) => string;

export interface Template {
  id: string;
  name: string;
  description: string;
  make: () => Form;
}

function build(say: Say, lang: Lang, title: string, description: string, questions: Question[], over: Partial<Form> = {}): Form {
  const form = newForm(title);
  return { ...form, description, thanks: say('Gracias por responder.', 'Thanks for your response.'), ...(lang === 'en' ? { language: 'en' } : {}), ...over, questions };
}

const q = (type: QType, title: string, over: Partial<Question> = {}): Question => ({ ...newQuestion(type), title, ...over });

export function templates(lang: Lang): Template[] {
  const say: Say = (es, en) => (lang === 'en' ? en : es);
  const list = (es: string[], en: string[]) => (lang === 'en' ? en : es);
  const make = (title: [string, string], description: [string, string], questions: () => Question[], over: Partial<Form> = {}) => () => build(say, lang, say(...title), say(...description), questions(), over);
  const scale = () => list(['Muy en desacuerdo', 'En desacuerdo', 'De acuerdo', 'Muy de acuerdo'], ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree']);

  const all: [string, [string, string], [string, string], () => Form][] = [
    [
      'satisfaction',
      ['Satisfacción de clientes', 'Customer satisfaction'],
      ['Recomendación, valoración y qué mejorar.', 'Recommendation, rating and what to improve.'],
      make(['Cuéntanos tu experiencia', 'Tell us about your experience'], ['Son dos minutos.', 'It takes two minutes.'], () => [
        q('nps', say('¿Qué probabilidad hay de que nos recomiendes?', 'How likely are you to recommend us?'), { required: true }),
        q('rating', say('¿Cómo valoras la atención?', 'How would you rate our service?'), { symbol: 'star', lowLabel: say('Mala', 'Poor'), highLabel: say('Excelente', 'Excellent') }),
        q('multi', say('¿Qué deberíamos mejorar?', 'What should we improve?'), { options: list(['Rapidez', 'Trato', 'Precio', 'Calidad'], ['Speed', 'Staff', 'Price', 'Quality']), allowOther: true }),
        q('longtext', say('¿Algo más que quieras contarnos?', 'Anything else you want to tell us?')),
      ]),
    ],
    [
      'event',
      ['Inscripción a un evento', 'Event registration'],
      ['Con secciones: quien no asiste termina en la primera.', 'With sections: those not attending finish on the first one.'],
      () => {
        const first = q('section', say('Asistencia', 'Attendance'));
        const going = q('choice', say('¿Vas a asistir?', 'Will you attend?'), { required: true, options: list(['Sí', 'No'], ['Yes', 'No']) });
        going.branch = { [going.options[1]!]: 'end' };
        return build(say, lang, say('Inscripción', 'Registration'), say('Confirma si vienes.', 'Let us know if you are coming.'), [
          first,
          going,
          q('section', say('Tus datos', 'Your details')),
          q('text', say('Correo electrónico', 'E-mail address'), { required: true, format: 'email' }),
          q('number', say('¿Cuántas personas te acompañan?', 'How many people are coming with you?'), { integer: true, min: 0, maxValue: 5 }),
          q('multi', say('Alimentación', 'Dietary needs'), { options: list(['Vegetariana', 'Sin gluten', 'Sin lactosa'], ['Vegetarian', 'Gluten free', 'Lactose free']), allowOther: true }),
        ], { askName: true, receipt: true, progress: true });
      },
    ],
    [
      'course',
      ['Evaluación de un curso', 'Course evaluation'],
      ['Escala por filas, valoración y comentarios.', 'Rating grid, overall score and comments.'],
      make(['Evaluación del curso', 'Course evaluation'], ['Tus respuestas nos ayudan a mejorar.', 'Your answers help us improve.'], () => [
        q('likert', say('Indica tu grado de acuerdo', 'How much do you agree?'), { required: true, options: scale(), rows: list(['Los objetivos estaban claros', 'El ritmo fue adecuado', 'Los materiales ayudaron'], ['The goals were clear', 'The pace was right', 'The materials helped']) }),
        q('rating', say('Valoración general', 'Overall rating'), { symbol: 'star' }),
        q('longtext', say('¿Qué cambiarías?', 'What would you change?')),
      ]),
    ],
    [
      'quiz',
      ['Cuestionario con puntuación', 'Scored quiz'],
      ['Con comentarios, explicaciones, respuestas al terminar y una pregunta corregida a mano.', 'With comments, explanations, answers at the end and a question marked by hand.'],
      () => {
        const first = q('choice', say('¿Cuánto es 7 × 8?', 'What is 7 × 8?'), { required: true, options: ['54', '56', '64'], points: 2, explanation: say('7 × 8 = 56.', '7 × 8 = 56.') });
        first.correct = ['56'];
        first.feedback = { '64': say('Eso es 8 × 8.', 'That is 8 × 8.') };
        return build(say, lang, say('Cuestionario de ejemplo', 'Sample quiz'), say('Cambia las preguntas por las tuyas.', 'Replace these questions with yours.'), [
          first,
          q('multi', say('¿Cuáles son números primos?', 'Which of these are prime numbers?'), { options: ['2', '9', '11', '15'], correct: ['2', '11'], points: 2 }),
          q('longtext', say('Explica con tus palabras qué es un número primo.', 'Explain in your own words what a prime number is.'), { manual: true, points: 3 }),
        ], { quiz: true, showScore: true, showAnswers: true, askName: true });
      },
    ],
    [
      'meeting',
      ['Elegir fecha de reunión', 'Pick a meeting date'],
      ['Cada persona marca las fechas que le sirven.', 'Everyone ticks the dates that work for them.'],
      make(['¿Cuándo nos reunimos?', 'When shall we meet?'], ['Marca todas las opciones que te sirvan.', 'Tick every option that works for you.'], () => [
        q('multi', say('Fechas posibles', 'Possible dates'), { required: true, options: list(['Lunes por la mañana', 'Miércoles por la tarde', 'Viernes por la mañana'], ['Monday morning', 'Wednesday afternoon', 'Friday morning']), min: 1 }),
        q('choice', say('¿Cómo prefieres reunirte?', 'How would you rather meet?'), { options: list(['En persona', 'Por videollamada'], ['In person', 'Video call']) }),
      ], { askName: true }),
    ],
    [
      'contact',
      ['Datos de contacto', 'Contact details'],
      ['Correo, teléfono y mensaje, con una condición.', 'E-mail, phone and message, with a condition.'],
      () => {
        const how = q('choice', say('¿Cómo prefieres que te contactemos?', 'How should we contact you?'), { required: true, options: list(['Correo', 'Teléfono'], ['E-mail', 'Phone']) });
        return build(say, lang, say('Contacto', 'Contact'), '', [
          how,
          q('text', say('Correo electrónico', 'E-mail address'), { required: true, format: 'email', showIf: showIfOf([{ question: how.id, op: 'eq', value: how.options[0]! }]) }),
          q('text', say('Número de teléfono', 'Phone number'), { required: true, showIf: showIfOf([{ question: how.id, op: 'eq', value: how.options[1]! }]) }),
          q('longtext', say('Mensaje', 'Message')),
        ], { askName: true });
      },
    ],
  ];
  return all.map(([id, name, description, form]) => ({ id, name: say(...name), description: say(...description), make: form }));
}
