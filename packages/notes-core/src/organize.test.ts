import { describe, expect, it } from 'vitest';
import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { addContainer, countPage, copySection, displayTitle, insertSpace, mergeSections, newFileContainer, newNotebook, newPage, newSection, newStroke, newTextContainer, parseNotebook, recentPages, readableText, serializeNotebook, sortPages, transferPage, unreadPages, type Notebook, type Page } from './index';

const p = (text: string) => nodeTypes.paragraph!.create({}, text ? writerSchema.text(text) : undefined);
const docJson = (...b: ReturnType<typeof p>[]) => nodeTypes.doc!.create(null, b).toJSON();
const pg = (title: string, text = '', level: 0 | 1 | 2 = 0, modified = 1000): Page => {
  const x = newPage(title);
  x.level = level;
  x.modified = modified;
  x.created = modified;
  if (text) x.containers = [newTextContainer(48, 24, 640, docJson(p(text)))];
  return x;
};

function sample(): Notebook {
  const nb = newNotebook('T');
  nb.sections[0]!.name = 'A';
  nb.sections[0]!.pages = [pg('Zeta', 'uno dos tres', 0, 3000), pg('Hija', 'hija', 1, 5000), pg('Alfa', 'cuatro', 0, 1000)];
  const b = newSection('B', 1);
  b.pages = [pg('Beta', 'b', 0, 2000)];
  nb.sections.push(b);
  return nb;
}

describe('mover y copiar páginas', () => {
  it('mueve una página con sus subpáginas a otra sección y conserva sus identificadores', () => {
    const nb = sample();
    const [a, b] = nb.sections;
    const r = transferPage(nb, a!.id, a!.pages[0]!.id, b!.id, false)!;
    expect(r.nb.sections[0]!.pages.map((x) => x.title)).toEqual(['Alfa']);
    expect(r.nb.sections[1]!.pages.map((x) => x.title)).toEqual(['Beta', 'Zeta', 'Hija']);
    expect(r.nb.sections[1]!.pages[2]!.level).toBe(1);
    expect(r.pageIds).toEqual([a!.pages[0]!.id, a!.pages[1]!.id]);
  });
  it('copiar deja la original, crea identificadores nuevos y no arrastra versiones', () => {
    const nb = sample();
    nb.sections[0]!.pages[0]!.versions = [{ id: 'v', at: 1, label: '', manual: true, body: { title: '', containers: [], ink: [], style: nb.sections[0]!.pages[0]!.style } }];
    const r = transferPage(nb, nb.sections[0]!.id, nb.sections[0]!.pages[2]!.id, nb.sections[1]!.id, true)!;
    expect(r.nb.sections[0]!.pages).toHaveLength(3);
    const copy = r.nb.sections[1]!.pages[1]!;
    expect(copy.title).toBe('Alfa (copia)');
    expect(copy.id).not.toBe(nb.sections[0]!.pages[2]!.id);
    expect(copy.containers[0]!.id).not.toBe(nb.sections[0]!.pages[2]!.containers[0]!.id);
    expect(copy.versions).toEqual([]);
  });
  it('no mueve la última página de una sección, ni a la misma sección, ni a una bloqueada', () => {
    const nb = sample();
    expect(transferPage(nb, nb.sections[1]!.id, nb.sections[1]!.pages[0]!.id, nb.sections[0]!.id, false)).toBeNull();
    expect(transferPage(nb, nb.sections[0]!.id, nb.sections[0]!.pages[2]!.id, nb.sections[0]!.id, false)).toBeNull();
    nb.sections[1]!.vault = { iv: 'x', data: 'y' };
    expect(transferPage(nb, nb.sections[0]!.id, nb.sections[0]!.pages[2]!.id, nb.sections[1]!.id, true)).toBeNull();
  });
});

describe('secciones', () => {
  it('copia una sección con páginas nuevas', () => {
    const nb = sample();
    const r = copySection(nb, nb.sections[0]!.id)!;
    expect(r.nb.sections.map((s) => s.name)).toEqual(['A', 'A (copia)', 'B']);
    const ids = new Set(nb.sections[0]!.pages.map((x) => x.id));
    expect(r.nb.sections[1]!.pages.every((x) => !ids.has(x.id))).toBe(true);
    expect(r.nb.sections[1]!.pages.map((x) => x.level)).toEqual([0, 1, 0]);
  });
  it('combina una sección en otra', () => {
    const nb = sample();
    const m = mergeSections(nb, nb.sections[0]!.id, nb.sections[1]!.id)!;
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0]!.pages.map((x) => x.title)).toEqual(['Beta', 'Zeta', 'Hija', 'Alfa']);
    expect(mergeSections(nb, nb.sections[0]!.id, nb.sections[0]!.id)).toBeNull();
  });
});

describe('ordenar páginas', () => {
  it('por título mantiene cada página con sus subpáginas', () => {
    const nb = sample();
    const s = sortPages(nb, nb.sections[0]!.id, 'title').sections[0]!.pages.map((x) => x.title);
    expect(s).toEqual(['Alfa', 'Zeta', 'Hija']);
  });
  it('por fecha de modificación, de más nueva a más antigua', () => {
    const nb = sample();
    expect(sortPages(nb, nb.sections[0]!.id, 'modified-desc').sections[0]!.pages.map((x) => x.title)).toEqual(['Zeta', 'Hija', 'Alfa']);
    expect(sortPages(nb, nb.sections[0]!.id, 'modified').sections[0]!.pages.map((x) => x.title)).toEqual(['Alfa', 'Zeta', 'Hija']);
  });
  it('si ya están en orden devuelve la misma libreta', () => {
    const nb = sample();
    const sorted = sortPages(nb, nb.sections[0]!.id, 'title');
    expect(sortPages(sorted, nb.sections[0]!.id, 'title')).toBe(sorted);
  });
});

describe('recientes y sin leer', () => {
  it('lista por fecha y respeta el límite de días', () => {
    const nb = sample();
    const day = 86400000;
    expect(recentPages(nb, 0).map((r) => r.title)).toEqual(['Hija', 'Zeta', 'Beta', 'Alfa']);
    expect(recentPages(nb, 2, 3000 + day).map((r) => r.title)).toEqual(['Hija', 'Zeta', 'Beta', 'Alfa']);
    expect(recentPages(nb, 1, 5000 + day / 2).map((r) => r.title)).toEqual(['Hija', 'Zeta', 'Beta', 'Alfa']);
    expect(recentPages(nb, 1, 4000 + day).map((r) => r.title)).toEqual(['Hija']);
  });
  it('no lista páginas ni secciones bloqueadas', () => {
    const nb = sample();
    nb.sections[1]!.vault = { iv: 'x', data: 'y' };
    nb.sections[0]!.pages[0]!.vault = { iv: 'x', data: 'y' };
    expect(recentPages(nb, 0).map((r) => r.title)).toEqual(['Hija', 'Alfa']);
  });
  it('sin leer = modificada después de verla', () => {
    const nb = sample();
    const ids = nb.sections[0]!.pages.map((x) => x.id);
    const seen = { [ids[0]!]: 3000, [ids[1]!]: 4000 };
    expect(unreadPages(nb, seen).map((r) => r.title).sort()).toEqual(['Alfa', 'Beta', 'Hija']);
  });
});

describe('insertar espacio', () => {
  const base = () => {
    const a = newTextContainer(10, 10, 300);
    const b = newTextContainer(10, 200, 300);
    const s = newStroke('pen', '#000', 2, [10, 300, 20, 310]);
    const s2 = newStroke('pen', '#000', 2, [10, 20, 20, 30]);
    return { containers: [a, b], ink: [s, s2] };
  };
  it('empuja hacia abajo lo que está debajo de la línea', () => {
    const r = insertSpace(base(), 100, 150);
    expect(r.containers.map((c) => c.y)).toEqual([10, 350]);
    expect(r.ink[0]!.pts).toEqual([10, 450, 20, 460]);
    expect(r.ink[1]!.pts).toEqual([10, 20, 20, 30]);
  });
  it('quitar espacio no pasa por encima de lo que queda arriba', () => {
    const b = base();
    const r = insertSpace(b, 100, -500, { [b.containers[0]!.id]: 40 });
    expect(r.containers[0]!.y).toBe(10);
    expect(r.containers[1]!.y).toBe(100);
    expect(r.ink[0]!.pts[1]).toBe(200);
  });
  it('sin nada debajo no hace nada', () => {
    const b = base();
    expect(insertSpace(b, 900, 100)).toEqual(b);
    expect(insertSpace(b, 100, 0)).toBe(b);
  });
});

describe('recuento y adjuntos', () => {
  it('cuenta palabras, caracteres y objetos', () => {
    const x = pg('T', 'Hola mundo, qué tal');
    x.containers.push(newFileContainer('a1', 'informe.pdf', 100));
    x.ink = [newStroke('pen', '#000', 2, [0, 0, 1, 1])];
    const c = countPage(x);
    expect(c.words).toBe(4);
    expect(c.characters).toBe(19);
    expect(c.charactersNoSpaces).toBe(16);
    expect(c.files).toBe(1);
    expect(c.strokes).toBe(1);
  });
  it('un archivo adjunto se guarda, se reabre y se protege con su activo', async () => {
    const nb = newNotebook('A');
    nb.assets['a1'] = { id: 'a1', mime: 'application/pdf', data: 'JVBERi0=', name: 'informe.pdf', size: 5 };
    nb.sections[0]!.pages[0]!.containers = addContainer({ ...nb.sections[0]!.pages[0]!, containers: [] }, newFileContainer('a1', 'informe.pdf', 5)).containers;
    const back = parseNotebook(await serializeNotebook(nb));
    const c = back.sections[0]!.pages[0]!.containers[0]!;
    expect(c.kind).toBe('file');
    expect(back.assets['a1']!.mime).toBe('application/pdf');
  });
  it('un adjunto cuyo activo falta se descarta al abrir', async () => {
    const nb = newNotebook('A');
    nb.sections[0]!.pages[0]!.containers = [newFileContainer('nada', 'x.bin', 1)];
    expect(parseNotebook(await serializeNotebook(nb)).sections[0]!.pages[0]!.containers.some((c) => c.kind === 'file')).toBe(false);
  });
  it('el texto legible incluye el título', () => {
    expect(readableText(pg('Título', 'cuerpo'))).toBe('Título\ncuerpo');
    expect(displayTitle(pg('', 'cuerpo'))).toBe('cuerpo');
  });
});
