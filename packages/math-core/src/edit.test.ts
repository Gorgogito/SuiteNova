import { describe, expect, it } from 'vitest';
import { setMathAutoCorrect, defaultMathAutoCorrect, end, toTree, backspace, del, fromTree, insertStructure, moveLeft, moveRight, moveVertical, nextSlot, parsePathKey, parseUnicodeMath, pathKey, placeCursor, renderEdit, selectAll, toTex, typeChar, typeText, STRUCTURES, SYMBOL_GROUPS, type EditState } from './index';

const start = () => fromTree({ t: 'row', c: [] });
const type = (s: string, st: EditState = start()) => typeText(st, s);
const tex = (st: EditState) => toTex(toTree(st)).replace(/\s+/g, '');
const r = String.raw;

describe('edición estructurada', () => {
  it('escribir letras, números y operadores', () => {
    expect(tex(type('x+12.5=y'))).toBe('x+12.5=y');
    expect(type('12.5').root).toMatchObject({ c: [{ t: 'num', v: '12.5' }] });
  });

  it('«/» hace una fracción con lo que precede y deja el cursor en el denominador', () => {
    const st = type('a+b/c');
    expect(tex(st)).toBe(r`a+\frac{b}{c}`);
    expect(st.path.length).toBe(1);
    expect(tex(type('(a+b)/c'))).toBe(r`\frac{a+b}{c}`);
    expect(tex(type('xy/2'))).toBe(r`\frac{xy}{2}`);
    expect(tex(type('/', start()))).toBe(r`\frac{}{}`);
    expect(type('/', start()).path[0]!.k).toBe('n');
  });

  it('«^» y «_» escriben índices del elemento anterior; juntos dan ambos', () => {
    expect(tex(type('x^2'))).toBe('x^2');
    expect(tex(type('x_i^2'))).toBe('x_i^2');
    expect(tex(type('x^2_i'))).toBe('x_i^2');
    const st = type('x^');
    expect(st.path[0]!.k).toBe('s');
  });

  it('los paréntesis se cierran solos y «)» sale de ellos', () => {
    const open = type('(a+b');
    expect(open.path.length).toBe(1);
    const closed = typeChar(open, ')');
    expect(closed.path.length).toBe(0);
    expect(tex(type('(a+b)+c'))).toBe(r`\left(a+b\right)+c`);
  });

  it('escrituras con barra invertida: \\alpha + espacio, \\sqrt y \\frac', () => {
    expect(tex(type(r`\alpha `))).toBe(r`\alpha`);
    expect(tex(type(r`\alpha+\beta `))).toBe(r`\alpha+\beta`);
    const st = type(r`\frac `);
    expect(tex(st)).toBe(r`\frac{}{}`);
    expect(st.path[0]!.k).toBe('n');
    expect(tex(type(r`\sqrt x`))).toBe(r`\sqrt{x}`);
    expect(tex(type(r`\sum `))).toBe(r`\sum_{}^{}`);
    expect(tex(type(r`\noexiste `))).toContain('noexiste');
    expect(type(r`\alp`).esc).toBe('alp');
    expect(backspace(type(r`\al`)).esc).toBe('a');
  });

  it('los nombres de función se reconocen al escribir un espacio u otro carácter', () => {
    const st = type('sin x');
    expect(tex(st)).toBe(r`\sinx`);
    expect(st.root).toMatchObject({ c: [{ t: 'func', name: 'sin', c: { c: [{ t: 'id', v: 'x' }] } }] });
    expect(tex(type('lim_x'))).toContain(r`\lim_x`);
    expect(tex(type('sin(x)'))).toBe(r`\sin\left(x\right)`);
    expect(tex(type('asin'))).toBe('asin');
  });

  it('Retroceso: quita elementos, entra en estructuras llenas y quita las vacías', () => {
    expect(tex(backspace(type('ab')))).toBe('a');
    const frac = type('a/b'); // cursor en el denominador, al final
    const out = backspace(backspace(frac)); // quita b y, al estar el denominador vacío al principio, pasa al numerador
    expect(out.path[0]!.k).toBe('n');
    expect(tex(out)).toContain('frac');
    // fuera de una fracción llena, Retroceso entra en ella en vez de borrarla
    const outside = { ...frac, path: [], at: 1 };
    const inside = backspace(outside);
    expect(inside.path[0]!.k).toBe('d');
    expect(tex(inside)).toContain('frac');
    // una vacía se quita de golpe
    expect(tex(backspace(type('/')))).toBe('');
    expect(tex(backspace(type('x/')))).toContain('frac');
    // un paréntesis con una sola casilla se disuelve
    expect(tex(backspace(backspace(backspace(type('(ab')))))).toBe('');
    expect(tex(backspace(backspace(type('(ab'))))).toBe(r`\left(\right)`.replace('\\left(\\right)', '\\left(\\right)'));
  });

  it('Supr y flechas recorren las casillas en orden', () => {
    let st = type('a/b');
    st = { ...st, path: [], at: 0 };
    st = moveRight(st); // a → entra en el numerador
    expect(st.path[0]!.k).toBe('n');
    expect(tex(typeChar(st, 'x'))).toBe(r`\frac{xa}{b}`);
    st = moveRight(end(typeChar(st, 'x'))); // fin del numerador → denominador
    expect(st.path[0]!.k).toBe('d');
    st = moveRight(moveRight(st)); // fin del denominador → fuera
    expect(st.path.length).toBe(0);
    expect(st.at).toBe(1);
    st = moveLeft(st); // vuelve a entrar por el final
    expect(st.path[0]!.k).toBe('d');
    expect(tex(del(type('ab')))).toBe('ab');
    expect(tex(del({ ...type('ab'), at: 0 }))).toBe('b');
  });

  it('flechas arriba y abajo cambian de numerador a denominador y de base a índice', () => {
    const st = type('a/b'); // cursor en d
    const up = moveVertical(st, 'up');
    expect(up.path[0]!.k).toBe('n');
    expect(moveVertical(up, 'down').path[0]!.k).toBe('d');
    const sup = type('x^2'); // en s
    expect(moveVertical(sup, 'down').path[0]!.k).toBe('b');
  });

  it('Tabulador pasa a la casilla siguiente', () => {
    let st = insertStructure(start(), 'frac');
    expect(st.path[0]!.k).toBe('n');
    st = nextSlot(st);
    expect(st.path[0]!.k).toBe('d');
    st = nextSlot(st);
    expect(st.path.length).toBe(0);
  });

  it('selección: reemplaza al escribir, se borra y entra en la casilla de una estructura', () => {
    let st = type('abc');
    st = { ...st, anchor: 1, at: 3 };
    expect(tex(typeChar(st, 'x'))).toBe('ax');
    expect(tex(backspace(st))).toBe('a');
    expect(tex(insertStructure(st, 'sqrt'))).toBe(r`a\sqrt{bc}`);
    expect(tex(insertStructure(selectAll(type('a+b')), 'frac'))).toBe(r`\frac{}{}`.replace('{}{}', '{}{}'));
  });

  it('la galería inserta estructuras vacías con el cursor en su primera casilla', () => {
    for (const d of STRUCTURES) {
      const st = insertStructure(start(), d.id);
      expect(JSON.stringify(st.root), d.id).not.toBe('{"t":"row","c":[]}');
      expect(st.path.length, d.id).toBe(1);
    }
    expect(tex(insertStructure(start(), 'matrix-p'))).toContain('matrix');
    expect(tex(insertStructure(start(), 'nary-∫'))).toBe(r`\int_{}^{}`);
    expect(tex(insertStructure(start(), 'fn-sin'))).toBe(r`\sin`);
    expect(STRUCTURES.length).toBeGreaterThan(50);
    expect(SYMBOL_GROUPS.every((g) => g.items.length > 5)).toBe(true);
  });

  it('el MathML editable lleva el cursor, los huecos y las rutas de cada nodo', () => {
    const st = insertStructure(start(), 'frac');
    const ml = renderEdit(st);
    expect(ml).toContain('<mfrac');
    expect(ml).toContain('nm-ph');
    expect(ml).toContain('nm-caret');
    expect(renderEdit(st, false)).not.toContain('nm-caret');
    expect(renderEdit({ ...type(r`\alp`) })).toContain('\\alp');
    const key = pathKey([{ i: 3, k: '0:1' }, { i: 0, k: 'sub' }]);
    expect(parsePathKey(key)).toEqual([{ i: 3, k: '0:1' }, { i: 0, k: 'sub' }]);
    expect(parsePathKey('')).toEqual([]);
  });

  it('clic: coloca el cursor en una fila y posición', () => {
    const st = type('a/b');
    const moved = placeCursor(st, [], 0);
    expect(moved.path.length).toBe(0);
    expect(moved.at).toBe(0);
    expect(placeCursor(st, [{ i: 0, k: 'n' }], 99).at).toBe(1);
  });

  it('lo escrito se puede leer en el formato lineal de Word', () => {
    expect(JSON.stringify(parseUnicodeMath('a/b'))).toContain('frac');
    expect(tex(type('x^2+y^2=z^2'))).toBe('x^2+y^2=z^2');
  });
});

describe('autocorrección matemática editable', () => {
  it('la lista de fábrica trae letras y símbolos y no cambia el comportamiento', () => {
    expect(defaultMathAutoCorrect().alpha).toBe('α');
    expect(defaultMathAutoCorrect().leq).toBe('≤');
    setMathAutoCorrect(defaultMathAutoCorrect());
    expect(tex(type(r`\alpha `))).toBe(r`\alpha`);
    setMathAutoCorrect(null);
  });
  it('una entrada propia reemplaza, y quitar una de fábrica la deja sin convertir', () => {
    const list = defaultMathAutoCorrect();
    delete list.beta;
    list.mio = 'ℵ';
    setMathAutoCorrect(list);
    try {
      expect(tex(type(r`\mio `))).toBe(r`\aleph`);
      expect(tex(type(r`\beta `))).toBe(r`\text{\beta}`);
      expect(tex(type(r`\frac `))).toContain('frac');
    } finally {
      setMathAutoCorrect(null);
    }
  });
});
