/*
 * Léxico mínimo del español para la concordancia: género de sustantivos frecuentes, terminaciones que no admiten duda y adjetivos de
 * cuatro formas. Se prefiere la precisión al alcance: una palabra que no está aquí no se comprueba.
 */

export type Gender = 'm' | 'f';
export type Num = 's' | 'p';

const list = (s: string): string[] => s.split(/\s+/).filter(Boolean);

const MASC = list(
  'problema día mapa planeta idioma sistema programa tema poema clima cuadro libro perro gato tiempo país lápiz mes año hombre niño amigo trabajo camino mundo momento lugar nombre número ejemplo resultado proceso servicio estudio grupo equipo punto cambio caso uso valor dato archivo documento correo texto teléfono ordenador coche carro auto barco tren avión cielo sol mar río monte árbol vaso plato papel cuaderno cuarto baño jardín parque pueblo edificio negocio mercado precio costo gasto banco dinero domingo verano invierno otoño dolor amor color calor olor sabor sonido ruido silencio viaje mensaje paisaje camión corazón balcón origen margen examen volumen reloj pie diente brazo ojo oído dedo pelo cabello rostro cuerpo médico profesor alumno maestro vecino padre hermano hijo abuelo tío primo',
);
const FEM = list(
  'casa mano mesa silla ventana puerta persona vida forma parte noche calle clase tarde gente luz voz vez paz flor razón mujer niña amiga foto moto palabra idea historia familia empresa semana hora cosa manera pregunta respuesta tabla hoja página carta lista fecha imagen región escuela universidad pared playa montaña tierra luna estrella nube lluvia nieve cama cocina sala oficina tienda fábrica carretera avenida plaza temporada primavera computadora pantalla tecla contraseña cuenta carpeta red leche sal llave fuente nave carne sangre serie especie superficie labor madre hermana hija abuela tía prima médica profesora alumna maestra vecina',
);
/** Sustantivos femeninos que, en singular y con «a» tónica, llevan «el» o «un» (el agua, un águila): «la agua» es un error. */
export const STRESSED_A = new Set(list('agua águila alma arma área aula hacha hambre ave asa ala ancla arpa asma hada'));
/** Sustantivos que también son formas de un verbo (los casa, las cuenta): con «la», «las» y «los» no se comprueban. */
export const VERBISH = new Set(list('casa cuenta pregunta forma cambio trabajo estudio uso gasto costo punto caso paso carro cierre lista tarde parte'));

const GENDER = new Map<string, Gender>();
for (const w of MASC) GENDER.set(w, 'm');
for (const w of FEM) GENDER.set(w, 'f');
for (const w of STRESSED_A) GENDER.set(w, 'f');

/** Terminaciones de género seguro (no son formas de verbo). */
const SUFFIX_GENDER: [RegExp, Gender][] = [
  [/(ci|si|xi)ón$/, 'f'],
  [/(dad|tad|tud)$/, 'f'],
  [/umbre$/, 'f'],
  [/itis$/, 'f'],
  [/(miento|mento|aje|ismo)$/, 'm'],
];

/** Posibles singulares de una palabra en plural. */
function singulars(w: string): string[] {
  const out: string[] = [];
  if (/(ci|si|xi)ones$/.test(w)) out.push(w.replace(/ones$/, 'ón'));
  if (/ines$/.test(w)) out.push(w.replace(/ines$/, 'ín'));
  if (/ones$/.test(w)) out.push(w.replace(/ones$/, 'ón'));
  if (/ces$/.test(w)) out.push(w.replace(/ces$/, 'z'));
  if (/es$/.test(w)) out.push(w.slice(0, -2));
  if (/s$/.test(w)) out.push(w.slice(0, -1));
  return out;
}

export interface NounInfo {
  gender: Gender;
  number: Num;
  singular: string;
}

const known = (w: string): Gender | null => {
  const g = GENDER.get(w);
  if (g) return g;
  for (const [re, gg] of SUFFIX_GENDER) if (re.test(w) && w.length > 4) return gg;
  return null;
};

export function nounInfo(word: string): NounInfo | null {
  const w = word.toLowerCase();
  const g = known(w);
  if (g) return { gender: g, number: 's', singular: w };
  for (const s of singulars(w)) {
    const gs = known(s);
    if (gs) return { gender: gs, number: 'p', singular: s };
  }
  return null;
}

/** El plural de un sustantivo de la lista (casa → casas, ciudad → ciudades, canción → canciones, lápiz → lápices). */
export function pluralOf(s: string): string {
  if (/ón$/.test(s)) return s.slice(0, -2) + 'ones';
  if (/ín$/.test(s)) return s.slice(0, -2) + 'ines';
  if (/z$/.test(s)) return s.slice(0, -1) + 'ces';
  if (/[aeiouáéíóú]$/.test(s)) return s + 's';
  if (/s$/.test(s)) return s;
  return s + 'es';
}

// ----------------------------------------------------------------------------------------------------- determinantes

export interface Det {
  gender: Gender | null;
  number: Num;
  /** También es un pronombre (la, las, los): con un verbo detrás no hay error. */
  pronoun?: boolean;
}

const DETS: Record<string, Det> = {};
const det = (forms: [string, Gender | null, Num, boolean?][]) => {
  for (const [w, gender, number, pronoun] of forms) DETS[w] = { gender, number, ...(pronoun ? { pronoun } : {}) };
};
det([
  ['el', 'm', 's'], ['la', 'f', 's', true], ['los', 'm', 'p', true], ['las', 'f', 'p', true],
  ['un', 'm', 's'], ['una', 'f', 's'], ['unos', 'm', 'p'], ['unas', 'f', 'p'],
  ['este', 'm', 's'], ['esta', 'f', 's'], ['estos', 'm', 'p'], ['estas', 'f', 'p'],
  ['ese', 'm', 's'], ['esa', 'f', 's'], ['esos', 'm', 'p'], ['esas', 'f', 'p'],
  ['aquel', 'm', 's'], ['aquella', 'f', 's'], ['aquellos', 'm', 'p'], ['aquellas', 'f', 'p'],
  ['algún', 'm', 's'], ['alguna', 'f', 's'], ['algunos', 'm', 'p'], ['algunas', 'f', 'p'],
  ['ningún', 'm', 's'], ['ninguna', 'f', 's'], ['muchos', 'm', 'p'], ['muchas', 'f', 'p'],
  ['pocos', 'm', 'p'], ['pocas', 'f', 'p'], ['varios', 'm', 'p'], ['varias', 'f', 'p'],
  ['todos', 'm', 'p'], ['todas', 'f', 'p'], ['otros', 'm', 'p'], ['otras', 'f', 'p'],
  ['tantos', 'm', 'p'], ['tantas', 'f', 'p'], ['ambos', 'm', 'p'], ['ambas', 'f', 'p'],
  ['nuestro', 'm', 's'], ['nuestra', 'f', 's'], ['nuestros', 'm', 'p'], ['nuestras', 'f', 'p'],
  ['mi', null, 's'], ['tu', null, 's'], ['su', null, 's'], ['mis', null, 'p'], ['tus', null, 'p'], ['sus', null, 'p'],
]);
for (const n of list('dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince veinte treinta cuarenta cincuenta cien ciento')) DETS[n] = { gender: null, number: 'p' };

export const detInfo = (w: string): Det | null => DETS[w.toLowerCase()] ?? null;

/** La forma del determinante para un género y número (el/la/los/las, un/una/unos/unas…), o null si no se conoce. */
export function detForm(w: string, gender: Gender | null, number: Num): string | null {
  const lower = w.toLowerCase();
  const base = DETS[lower];
  if (!base) return null;
  for (const [form, d] of Object.entries(DETS)) {
    if (form === lower) continue;
    if (d.number !== number) continue;
    if ((base.gender === null) !== (d.gender === null)) continue;
    if (base.gender !== null && d.gender !== gender) continue;
    // las dos formas deben ser de la misma familia (el/la/los/las; un/una/unos/unas; este/esta…): comparten la raíz
    if (sameFamily(lower, form)) return form;
  }
  return lower;
}

const FAMILIES = [
  ['el', 'la', 'los', 'las'],
  ['un', 'una', 'unos', 'unas'],
  ['este', 'esta', 'estos', 'estas'],
  ['ese', 'esa', 'esos', 'esas'],
  ['aquel', 'aquella', 'aquellos', 'aquellas'],
  ['algún', 'alguna', 'algunos', 'algunas'],
  ['ningún', 'ninguna'],
  ['muchos', 'muchas'],
  ['pocos', 'pocas'],
  ['varios', 'varias'],
  ['todos', 'todas'],
  ['otros', 'otras'],
  ['tantos', 'tantas'],
  ['ambos', 'ambas'],
  ['nuestro', 'nuestra', 'nuestros', 'nuestras'],
  ['mi', 'mis'],
  ['tu', 'tus'],
  ['su', 'sus'],
];
const sameFamily = (a: string, b: string): boolean => FAMILIES.some((f) => f.includes(a) && f.includes(b));

// ------------------------------------------------------------------------------------------------------- adjetivos

const ADJ_STEMS = list('bonit nuev viej larg cort alt baj blanc negr roj clar oscur rápid lent pequeñ antigu modern delgad gord limpi suci frí cansad content ocupad abiert cerrad');

export interface AdjInfo {
  stem: string;
  gender: Gender;
  number: Num;
}

export function adjInfo(word: string): AdjInfo | null {
  const w = word.toLowerCase();
  for (const stem of ADJ_STEMS) {
    if (!w.startsWith(stem)) continue;
    const end = w.slice(stem.length);
    if (end === 'o') return { stem, gender: 'm', number: 's' };
    if (end === 'a') return { stem, gender: 'f', number: 's' };
    if (end === 'os') return { stem, gender: 'm', number: 'p' };
    if (end === 'as') return { stem, gender: 'f', number: 'p' };
  }
  return null;
}

export const adjForm = (stem: string, gender: Gender, number: Num): string => stem + (gender === 'm' ? 'o' : 'a') + (number === 'p' ? 's' : '');
