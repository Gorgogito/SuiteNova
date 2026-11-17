/**
 * El catálogo de la cinta «Ecuación»: estructuras (fracciones, raíces, sumatorias, matrices...) y símbolos, agrupados como
 * en Word. Cada estructura sabe construirse vacía, a qué casilla lleva el cursor y en cuál cae lo que estaba seleccionado.
 */
import { ACCENTS, FUNCS, GREEK, NARY, SYMBOLS } from './tables';
import type { MNode } from './math';

const E = (): MNode => ({ t: 'row', c: [] });

export interface Made {
  node: MNode;
  /** Casilla donde queda el cursor. */
  focus: string;
  /** Casilla que recibe lo seleccionado. */
  fill?: string;
}

export interface StructureDef {
  id: string;
  /** Nombre (para la ayuda del botón). */
  label: string;
  /** Lo que se dibuja en el botón. */
  glyph: string;
  group: string;
  make?: () => Made;
  /** Escrituras y fracciones se construyen sobre lo que precede al cursor. */
  script?: 'sup' | 'sub';
  fraction?: 'bar' | 'noBar' | 'lin' | 'skw';
}

export const STRUCTURE_GROUPS = ['Fracciones', 'Escrituras', 'Radicales', 'Integrales', 'Operadores grandes', 'Corchetes', 'Funciones', 'Acentos', 'Límites', 'Matrices'] as const;

const defs: StructureDef[] = [];
const add = (d: StructureDef) => void defs.push(d);

// fracciones
add({ id: 'frac', label: 'Fracción', glyph: 'ᵃ⁄ᵇ', group: 'Fracciones', fraction: 'bar' });
add({ id: 'frac-skw', label: 'Fracción sesgada', glyph: 'a⁄b', group: 'Fracciones', fraction: 'skw' });
add({ id: 'frac-lin', label: 'Fracción lineal', glyph: 'a/b', group: 'Fracciones', fraction: 'lin' });
add({ id: 'frac-nobar', label: 'Fracción sin barra', glyph: '(ᵃ_b)', group: 'Fracciones', fraction: 'noBar' });
add({ id: 'binom', label: 'Coeficiente binomial', glyph: '(ⁿₖ)', group: 'Fracciones', make: () => ({ node: { t: 'fenced', open: '(', close: ')', sep: '', c: [{ t: 'frac', n: E(), d: E(), bar: false }] }, focus: 'c0', fill: 'c0' }) });

// escrituras
add({ id: 'sup', label: 'Superíndice', glyph: 'xⁿ', group: 'Escrituras', script: 'sup' });
add({ id: 'sub', label: 'Subíndice', glyph: 'xₙ', group: 'Escrituras', script: 'sub' });
add({ id: 'subsup', label: 'Subíndice y superíndice', glyph: 'xₙⁿ', group: 'Escrituras', make: () => ({ node: { t: 'subsup', b: E(), sub: E(), sup: E() }, focus: 'b', fill: 'b' }) });
add({ id: 'pre', label: 'Escrituras a la izquierda', glyph: 'ⁿₙx', group: 'Escrituras', make: () => ({ node: { t: 'pre', b: E(), sub: E(), sup: E() }, focus: 'sub', fill: 'b' }) });

// radicales
add({ id: 'sqrt', label: 'Raíz cuadrada', glyph: '√x', group: 'Radicales', make: () => ({ node: { t: 'sqrt', c: E(), deg: null }, focus: 'c', fill: 'c' }) });
add({ id: 'sqrt3', label: 'Raíz cúbica', glyph: '∛x', group: 'Radicales', make: () => ({ node: { t: 'sqrt', c: E(), deg: { t: 'num', v: '3' } }, focus: 'c', fill: 'c' }) });
add({ id: 'sqrtn', label: 'Raíz con grado', glyph: 'ⁿ√x', group: 'Radicales', make: () => ({ node: { t: 'sqrt', c: E(), deg: E() }, focus: 'deg', fill: 'c' }) });

// operadores grandes e integrales
const NARY_NAMES: Record<string, [string, string]> = {
  '∑': ['Suma', 'Operadores grandes'], '∏': ['Producto', 'Operadores grandes'], '∐': ['Coproducto', 'Operadores grandes'], '⋃': ['Unión', 'Operadores grandes'], '⋂': ['Intersección', 'Operadores grandes'],
  '⋁': ['O lógico', 'Operadores grandes'], '⋀': ['Y lógico', 'Operadores grandes'], '⨁': ['Suma directa', 'Operadores grandes'], '⨂': ['Producto tensorial', 'Operadores grandes'],
  '∫': ['Integral', 'Integrales'], '∬': ['Integral doble', 'Integrales'], '∭': ['Integral triple', 'Integrales'], '∮': ['Integral de contorno', 'Integrales'],
};
for (const op of Object.values(NARY)) {
  const [name, group] = NARY_NAMES[op] ?? ['Operador', 'Operadores grandes'];
  const integral = group === 'Integrales';
  add({ id: `nary-${op}`, label: `${name} con límites`, glyph: op, group, make: () => ({ node: { t: 'nary', op, sub: E(), sup: E(), c: E(), limits: !integral }, focus: 'sub', fill: 'c' }) });
  add({ id: `nary0-${op}`, label: `${name} sin límites`, glyph: `${op}·`, group, make: () => ({ node: { t: 'nary', op, sub: null, sup: null, c: E(), limits: false }, focus: 'c', fill: 'c' }) });
}

// corchetes
const FENCES: [string, string, string, string][] = [
  ['(', ')', 'Paréntesis', '( )'], ['[', ']', 'Corchetes', '[ ]'], ['{', '}', 'Llaves', '{ }'], ['⟨', '⟩', 'Ángulos', '⟨ ⟩'], ['|', '|', 'Valor absoluto', '| |'], ['‖', '‖', 'Norma', '‖ ‖'], ['⌊', '⌋', 'Parte entera', '⌊ ⌋'], ['⌈', '⌉', 'Techo', '⌈ ⌉'],
];
for (const [open, close, name, glyph] of FENCES) add({ id: `fence-${open}`, label: name, glyph, group: 'Corchetes', make: () => ({ node: { t: 'fenced', open, close, sep: '', c: [E()] }, focus: 'c0', fill: 'c0' }) });
add({ id: 'fence-sep', label: 'Paréntesis con separador', glyph: '(a|b)', group: 'Corchetes', make: () => ({ node: { t: 'fenced', open: '(', close: ')', sep: '|', c: [E(), E()] }, focus: 'c0', fill: 'c0' }) });

// funciones
for (const name of FUNCS) {
  const withSub = name === 'lim' || name === 'liminf' || name === 'limsup' || name === 'max' || name === 'min';
  add({ id: `fn-${name}`, label: `Función ${name}`, glyph: name, group: name === 'lim' || name === 'liminf' || name === 'limsup' ? 'Límites' : 'Funciones', make: () => ({ node: withSub ? { t: 'func', name, c: E(), sub: E() } : { t: 'func', name, c: E() }, focus: withSub ? 'sub' : 'c', fill: 'c' }) });
}

// acentos y barras
const ACC_NAMES: Record<string, string> = { hat: 'Circunflejo', bar: 'Barra', vec: 'Vector', dot: 'Punto', ddot: 'Dos puntos', tilde: 'Tilde', widehat: 'Circunflejo ancho', widetilde: 'Tilde ancha', acute: 'Agudo', grave: 'Grave', breve: 'Breve', check: 'Caron' };
for (const [name, ch] of Object.entries(ACCENTS)) {
  if (name.startsWith('wide')) continue;
  add({ id: `acc-${name}`, label: ACC_NAMES[name] ?? name, glyph: `x${ch}`, group: 'Acentos', make: () => ({ node: { t: 'acc', ch, c: E() }, focus: 'c', fill: 'c' }) });
}
add({ id: 'overline', label: 'Barra superior', glyph: 'x̅', group: 'Acentos', make: () => ({ node: { t: 'bar', c: E(), top: true }, focus: 'c', fill: 'c' }) });
add({ id: 'underline', label: 'Barra inferior', glyph: 'x̲', group: 'Acentos', make: () => ({ node: { t: 'bar', c: E(), top: false }, focus: 'c', fill: 'c' }) });
add({ id: 'box', label: 'Recuadro', glyph: '▭', group: 'Acentos', make: () => ({ node: { t: 'box', c: E(), border: true }, focus: 'c', fill: 'c' }) });
add({ id: 'limit-over', label: 'Límite superior', glyph: 'x̄ᵃ', group: 'Límites', make: () => ({ node: { t: 'limit', b: E(), lim: E(), top: true }, focus: 'b', fill: 'b' }) });
add({ id: 'limit-under', label: 'Límite inferior', glyph: 'xₐ', group: 'Límites', make: () => ({ node: { t: 'limit', b: E(), lim: E(), top: false }, focus: 'b', fill: 'b' }) });

// matrices
const matrix = (rows: number, cols: number, open: string, close: string): Made => ({
  node: { t: 'matrix', rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => E())), open, close },
  focus: '0:0',
  fill: '0:0',
});
add({ id: 'matrix', label: 'Matriz 2×2', glyph: '▦', group: 'Matrices', make: () => matrix(2, 2, '', '') });
add({ id: 'matrix-p', label: 'Matriz 2×2 con paréntesis', glyph: '(▦)', group: 'Matrices', make: () => matrix(2, 2, '(', ')') });
add({ id: 'matrix-b', label: 'Matriz 2×2 con corchetes', glyph: '[▦]', group: 'Matrices', make: () => matrix(2, 2, '[', ']') });
add({ id: 'matrix-v', label: 'Determinante 2×2', glyph: '|▦|', group: 'Matrices', make: () => matrix(2, 2, '|', '|') });
add({ id: 'matrix3', label: 'Matriz 3×3 con paréntesis', glyph: '(▦▦)', group: 'Matrices', make: () => matrix(3, 3, '(', ')') });
add({ id: 'matrix-col', label: 'Vector columna', glyph: '(▯▯)', group: 'Matrices', make: () => matrix(2, 1, '(', ')') });
add({ id: 'cases', label: 'Sistema de casos', glyph: '{▦', group: 'Matrices', make: () => matrix(2, 2, '{', '') });
add({ id: 'eqarr', label: 'Ecuaciones alineadas', glyph: '≡', group: 'Matrices', make: () => ({ node: { t: 'eqarr', rows: [E(), E()] }, focus: 'r0', fill: 'r0' }) });

export const STRUCTURES: StructureDef[] = defs;

// ------------------------------------------------------------------------------------------------- símbolos

export interface SymbolItem {
  ch: string;
  /** Escritura corta (`\alpha`) o vacío. */
  title: string;
}
export interface SymbolGroup {
  name: string;
  items: SymbolItem[];
}

const nameOf: Record<string, string> = {};
for (const [k, v] of Object.entries({ ...SYMBOLS, ...GREEK })) if (!nameOf[v]) nameOf[v] = k;
const sym = (chars: string): SymbolItem[] => [...chars.replace(/\s+/g, '')].map((ch) => ({ ch, title: nameOf[ch] ? `\\${nameOf[ch]}` : '' }));

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { name: 'Griegas minúsculas', items: sym('αβγδεϵζηθϑικλμνξπϖρϱσςτυϕφχψω') },
  { name: 'Griegas mayúsculas', items: sym('ΓΔΘΛΞΠΣΥΦΨΩ') },
  { name: 'Operadores', items: sym('±∓×÷⋅∗⋆∘∙∧∨⊕⊗¬∖∪∩') },
  { name: 'Relaciones', items: sym('=≠≈≡∼≃≅∝<>≤≥≪≫∈∉∋⊂⊃⊆⊇∥⊥') },
  { name: 'Flechas', items: sym('→←↔⇒⇐⇔↦↑↓⟹⟺') },
  { name: 'Letras y símbolos', items: [...'ℝℂℕℤℚℵℏℓ∅∞∂∇∀∃∄′°∠∴∵…⋯⋮⋱'].map((ch) => ({ ch, title: nameOf[ch] ? `\\${nameOf[ch]}` : '' })) },
];
