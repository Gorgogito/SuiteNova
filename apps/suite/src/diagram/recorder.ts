import { centerOf, isGlued, stencilOf, type Connector, type Diagram, type Page, type Shape } from '@suitenova/diagram-core';
import { rgbOf, vbString, type MacroRecorder } from '../macros/recorder';

const num = (n: number) => String(Math.round(n * 100) / 100);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const colour = (c: string) => (c === 'none' ? 'RGB(255, 255, 255)' : rgbOf(c));

const LABELS: Record<string, string> = {
  stencil: 'cambiar el tipo de forma',
  locked: 'bloqueo',
  geometry: 'geometría libre',
  flipH: 'voltear',
  flipV: 'voltear',
  image: 'imágenes',
  link: 'vínculos',
  showData: 'mostrar los datos',
  layer: 'capas',
  group: 'agrupar',
  container: 'contenedores',
  parent: 'contenedores',
  lane: 'carriles',
  routing: 'tipo de conector',
  startArrow: 'puntas de flecha',
  endArrow: 'puntas de flecha',
  dash: 'tipo de línea',
  from: 'extremos de conectores',
  to: 'extremos de conectores',
};
const label = (k: string) => LABELS[k] ?? k;

const diffKeys = (a: object, b: object, skip: Set<string>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.has(k) && !same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));

const SHAPE_HANDLED = new Set(['text', 'x', 'y', 'w', 'h', 'rot', 'style', 'font', 'data']);
const CONN_HANDLED = new Set(['text', 'stroke', 'strokeWidth']);

/** The lines that set what changed in one shape (`Shapes(2).Cells("Width").ResultIU = 200`). */
function shapeLines(at: string, a: Shape, b: Shape, un: Set<string>): string[] {
  const out: string[] = [];
  const cell = (name: string, v: string) => out.push(`${at}.Cells(${vbString(name)}).ResultIU = ${v}`);
  if (a.text !== b.text) out.push(`${at}.Text = ${vbString(b.text)}`);
  // size first: it keeps the centre, so the position after it is the one the user left
  if (a.w !== b.w) cell('Width', num(b.w));
  if (a.h !== b.h) cell('Height', num(b.h));
  const ca = centerOf(a);
  const cb = centerOf(b);
  if (num(ca.x) !== num(cb.x)) cell('PinX', num(cb.x));
  if (num(ca.y) !== num(cb.y)) cell('PinY', num(cb.y));
  if (a.rot !== b.rot) cell('Angle', num(b.rot));
  if (a.style.fill !== b.style.fill) out.push(`${at}.Cells("FillForegnd").FormulaU = ${vbString(colour(b.style.fill))}`);
  if (a.style.stroke !== b.style.stroke) out.push(`${at}.Cells("LineColor").FormulaU = ${vbString(colour(b.style.stroke))}`);
  if (a.style.strokeWidth !== b.style.strokeWidth) cell('LineWeight', num(b.style.strokeWidth));
  if (a.font.size !== b.font.size) cell('Char.Size', num(b.font.size));
  for (const k of diffKeys(a.style, b.style, new Set(['fill', 'stroke', 'strokeWidth']))) un.add(k === 'dash' ? 'tipo de línea' : k === 'opacity' ? 'transparencia' : k === 'shadow' ? 'sombra' : k);
  for (const k of diffKeys(a.font, b.font, new Set(['size']))) un.add(`formato del texto (${k})`);
  if (!same(a.data, b.data)) {
    const before = new Map((a.data ?? []).map((d) => [d.name, d.value]));
    for (const d of b.data ?? []) if (before.get(d.name) !== d.value) out.push(`${at}.Cells(${vbString(`Prop.${d.name}`)}).FormulaU = ${vbString(d.value)}`);
    if ((a.data ?? []).some((d) => !(b.data ?? []).some((x) => x.name === d.name))) un.add('quitar datos de forma');
  }
  for (const k of diffKeys(a, b, SHAPE_HANDLED)) un.add(label(k));
  return out;
}

/**
 * Translates what happened between two versions of a diagram into lines of Nova Basic with the objects of Visio
 * (`ActivePage.Drop ActiveDocument.Masters.ItemU("Proceso"), 200, 150`). Shapes and connectors are numbered together as `Shapes(n)` does
 * (the shapes first). Only the page being edited is followed; what a macro cannot say comes back in `unsupported`.
 * Deletions come first (from the end), then the changes, then the additions, so the index in every line is the one the macro finds when it replays.
 */
export function describeChange(prev: Diagram, next: Diagram, pageId: string): { lines: string[]; unsupported: string[] } {
  const lines: string[] = [];
  const un = new Set<string>();
  if (prev === next) return { lines, unsupported: [] };

  if (prev.name !== next.name) lines.push(`ActiveDocument.Name = ${vbString(next.name)}`);
  // pages added or removed, and renamed
  const pPrev = new Map(prev.pages.map((p) => [p.id, p]));
  const pNext = new Map(next.pages.map((p) => [p.id, p]));
  for (const p of next.pages) if (!pPrev.has(p.id)) lines.push('ActiveDocument.Pages.Add');
  if (prev.pages.some((p) => !pNext.has(p.id))) un.add('eliminar páginas');
  for (const p of prev.pages) {
    const n = pNext.get(p.id);
    if (!n || p === n) continue;
    if (p.id !== pageId) {
      un.add('cambios en otra página');
      continue;
    }
    if (p.name !== n.name) lines.push(`ActivePage.Name = ${vbString(n.name)}`);
    for (const k of diffKeys(p, n, new Set(['shapes', 'connectors', 'name']))) un.add(k === 'width' || k === 'height' ? 'tamaño de la página' : `ajustes de la página (${k})`);
    pageLines(p, n, lines, un);
  }
  return { lines, unsupported: [...un] };
}

function pageLines(prev: Page, next: Page, lines: string[], un: Set<string>): void {
  type It = { id: string; kind: 'shape' | 'conn' };
  const order = (p: Page): It[] => [...p.shapes.map((s): It => ({ id: s.id, kind: 'shape' })), ...p.connectors.map((c): It => ({ id: c.id, kind: 'conn' }))];
  const pi = order(prev);
  const ni = order(next);
  const nextIds = new Set(ni.map((i) => i.id));
  const prevIds = new Set(pi.map((i) => i.id));

  // deletions, from the end
  pi.map((it, i) => [it, i] as const)
    .filter(([it]) => !nextIds.has(it.id))
    .reverse()
    .forEach(([, i]) => lines.push(`ActivePage.Shapes(${i + 1}).Delete`));

  // changes: the index among what survives the deletions
  const survivors = pi.filter((it) => nextIds.has(it.id));
  const nextSurvivors = ni.filter((it) => prevIds.has(it.id));
  if (!same(survivors.map((i) => i.id), nextSurvivors.map((i) => i.id))) un.add('orden de las formas');
  else {
    survivors.forEach((it, i) => {
      const at = `ActivePage.Shapes(${i + 1})`;
      if (it.kind === 'shape') {
        const a = prev.shapes.find((s) => s.id === it.id)!;
        const b = next.shapes.find((s) => s.id === it.id)!;
        if (a !== b) lines.push(...shapeLines(at, a, b, un));
      } else {
        const a = prev.connectors.find((c) => c.id === it.id)!;
        const b = next.connectors.find((c) => c.id === it.id)!;
        if (a === b) return;
        if (a.text !== b.text) lines.push(`${at}.Text = ${vbString(b.text)}`);
        if (a.stroke !== b.stroke) lines.push(`${at}.Cells("LineColor").FormulaU = ${vbString(colour(b.stroke))}`);
        if (a.strokeWidth !== b.strokeWidth) lines.push(`${at}.Cells("LineWeight").ResultIU = ${num(b.strokeWidth)}`);
        for (const k of diffKeys(a, b, CONN_HANDLED)) if (k !== 'font') un.add(label(k));
      }
    });
  }

  // additions, in the order they end up
  const added = next.shapes.filter((s) => !prevIds.has(s.id));
  for (const s of added) {
    if (s.container) un.add('contenedores');
    const c = centerOf(s);
    lines.push(`ActivePage.Drop ActiveDocument.Masters.ItemU(${vbString(stencilOf(s.stencil).name)}), ${num(c.x)}, ${num(c.y)}`);
    const at = `ActivePage.Shapes(${next.shapes.indexOf(s) + 1})`;
    const base = stencilOf(s.stencil);
    if (s.w !== base.w) lines.push(`${at}.Cells("Width").ResultIU = ${num(s.w)}`);
    if (s.h !== base.h) lines.push(`${at}.Cells("Height").ResultIU = ${num(s.h)}`);
    if (s.text) lines.push(`${at}.Text = ${vbString(s.text)}`);
    if (s.rot) lines.push(`${at}.Cells("Angle").ResultIU = ${num(s.rot)}`);
  }
  for (const c of next.connectors.filter((x) => !prevIds.has(x.id))) addedConnector(next, c, lines, un);
}

function addedConnector(page: Page, c: Connector, lines: string[], un: Set<string>): void {
  if (isGlued(c.from) && isGlued(c.to)) {
    const f = c.from.shape;
    const t = c.to.shape;
    const i = page.shapes.findIndex((s) => s.id === f) + 1;
    const j = page.shapes.findIndex((s) => s.id === t) + 1;
    lines.push(`ActivePage.Shapes(${i}).AutoConnect ActivePage.Shapes(${j})`);
    if (c.text) lines.push(`ActivePage.Shapes(${page.shapes.length + page.connectors.indexOf(c) + 1}).Text = ${vbString(c.text)}`);
  } else if (!isGlued(c.from) && !isGlued(c.to)) {
    lines.push(`ActivePage.DrawLine ${num(c.from.x)}, ${num(c.from.y)}, ${num(c.to.x)}, ${num(c.to.y)}`);
  } else un.add('conector pegado por un solo extremo');
}

/** Writes into the recording what the diagram did between two versions (the controller calls it from `commit`). */
export function recordChange(rec: MacroRecorder, prev: Diagram, next: Diagram, pageId: string): void {
  const { lines, unsupported } = describeChange(prev, next, pageId);
  for (const l of lines) rec.add(l);
  for (const u of unsupported) rec.unsupported(u);
}
