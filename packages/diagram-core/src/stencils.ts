import type { Style } from './model';

/**
 * Shapes are drawn from the same data on screen and in every export. They are our own drawings of common symbols
 * (flowchart, UML, network, BPMN), not Microsoft Visio stencils.
 */
export interface PathDef {
  d: string;
  /** "main" = the shape's fill; "stroke" = painted with the line colour; "light" = semi-transparent white over the fill. */
  fill: 'main' | 'none' | 'stroke' | 'light';
  /** Draw the outline (default true). */
  stroke?: boolean;
  /** Line width multiplier. */
  width?: number;
  dashed?: boolean;
}

export interface PortDef {
  /** 0–1 inside the shape box. */
  x: number;
  y: number;
  /** Outward direction. */
  dir: 'n' | 'e' | 's' | 'w';
}

export interface TextSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wrap long lines inside the box (default true). */
  wrap?: boolean;
}

export interface Stencil {
  id: string;
  name: string;
  category: string;
  /** Default size. */
  w: number;
  h: number;
  paths(w: number, h: number): PathDef[];
  ports: PortDef[];
  text?(w: number, h: number): TextSpec;
  /** The text is split on lines containing only "---" into compartments (UML class). */
  sections?: boolean;
  /** Overrides of the default style when the shape is created. */
  style?: Partial<Style>;
}

export const CATEGORIES: { id: string; name: string }[] = [
  { id: 'basic', name: 'Formas básicas' },
  { id: 'flow', name: 'Diagrama de flujo' },
  { id: 'uml', name: 'UML' },
  { id: 'network', name: 'Redes' },
  { id: 'bpmn', name: 'BPMN' },
  { id: 'extra', name: 'Imágenes y contenedores' },
];

const n = (v: number): string => String(Math.round(v * 100) / 100);
const P = (pts: number[][]): string => `M${pts.map(([x, y]) => `${n(x!)},${n(y!)}`).join(' L')} Z`;
const R = (x: number, y: number, w: number, h: number): string => `M${n(x)},${n(y)} H${n(x + w)} V${n(y + h)} H${n(x)} Z`;
const E = (cx: number, cy: number, rx: number, ry: number): string => `M${n(cx - rx)},${n(cy)} A${n(rx)},${n(ry)} 0 1 0 ${n(cx + rx)},${n(cy)} A${n(rx)},${n(ry)} 0 1 0 ${n(cx - rx)},${n(cy)} Z`;
const RR = (x: number, y: number, w: number, h: number, r: number): string => {
  const k = Math.min(r, w / 2, h / 2);
  return `M${n(x + k)},${n(y)} H${n(x + w - k)} A${n(k)},${n(k)} 0 0 1 ${n(x + w)},${n(y + k)} V${n(y + h - k)} A${n(k)},${n(k)} 0 0 1 ${n(x + w - k)},${n(y + h)} H${n(x + k)} A${n(k)},${n(k)} 0 0 1 ${n(x)},${n(y + h - k)} V${n(y + k)} A${n(k)},${n(k)} 0 0 1 ${n(x + k)},${n(y)} Z`;
};
const L = (...pts: number[][]): string => `M${pts.map(([x, y]) => `${n(x!)},${n(y!)}`).join(' L')}`;

const four: PortDef[] = [
  { x: 0.5, y: 0, dir: 'n' },
  { x: 1, y: 0.5, dir: 'e' },
  { x: 0.5, y: 1, dir: 's' },
  { x: 0, y: 0.5, dir: 'w' },
];
const inset = (px: number, py = px) => (w: number, h: number): TextSpec => ({ x: w * px, y: h * py, w: w * (1 - 2 * px), h: h * (1 - 2 * py) });
const whole = (w: number, h: number): TextSpec => ({ x: 0, y: 0, w, h });

type Def = Omit<Stencil, 'ports'> & { ports?: PortDef[] };
const defs: Def[] = [];
const def = (d: Def) => defs.push(d);

function cylinder(w: number, h: number): PathDef[] {
  const ry = Math.min(h * 0.16, w * 0.3);
  const rx = w / 2;
  return [
    { d: `M0,${n(ry)} V${n(h - ry)} A${n(rx)},${n(ry)} 0 0 0 ${n(w)},${n(h - ry)} V${n(ry)} A${n(rx)},${n(ry)} 0 0 0 0,${n(ry)} Z`, fill: 'main' },
    { d: `M0,${n(ry)} A${n(rx)},${n(ry)} 0 0 0 ${n(w)},${n(ry)}`, fill: 'none' },
  ];
}
function cloud(w: number, h: number): PathDef[] {
  const X = (v: number) => n(v * w);
  const Y = (v: number) => n(v * h);
  return [{ d: `M${X(0.22)},${Y(0.82)} C${X(0)},${Y(0.82)} ${X(0)},${Y(0.45)} ${X(0.2)},${Y(0.46)} C${X(0.14)},${Y(0.12)} ${X(0.5)},${Y(0.0)} ${X(0.56)},${Y(0.26)} C${X(0.66)},${Y(0.02)} ${X(1)},${Y(0.1)} ${X(0.88)},${Y(0.42)} C${X(1)},${Y(0.5)} ${X(1)},${Y(0.82)} ${X(0.8)},${Y(0.82)} Z`, fill: 'main' }];
}
function starPoints(w: number, h: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 0.5 : 0.2;
    pts.push([w / 2 + Math.cos(a) * r * w * 1.05, h * 0.52 + Math.sin(a) * r * h * 1.05]);
  }
  return pts;
}
function regular(sides: number, w: number, h: number, start = -Math.PI / 2): number[][] {
  return Array.from({ length: sides }, (_, i) => {
    const a = start + (i * 2 * Math.PI) / sides;
    return [w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2];
  });
}
const diamond = (w: number, h: number) => P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);

// ---------------------------------------------------------------- basic
def({ id: 'rect', name: 'Rectángulo', category: 'basic', w: 120, h: 70, paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'main' }], text: inset(0.04) });
def({ id: 'roundRect', name: 'Rectángulo redondeado', category: 'basic', w: 120, h: 70, paths: (w, h) => [{ d: RR(0, 0, w, h, Math.min(w, h) * 0.2), fill: 'main' }], text: inset(0.06) });
def({ id: 'ellipse', name: 'Elipse', category: 'basic', w: 110, h: 70, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }], text: inset(0.14, 0.14) });
def({
  id: 'triangle', name: 'Triángulo', category: 'basic', w: 100, h: 90,
  paths: (w, h) => [{ d: P([[w / 2, 0], [w, h], [0, h]]), fill: 'main' }],
  ports: [{ x: 0.5, y: 0, dir: 'n' }, { x: 0.75, y: 0.5, dir: 'e' }, { x: 0.5, y: 1, dir: 's' }, { x: 0.25, y: 0.5, dir: 'w' }],
  text: (w, h) => ({ x: w * 0.25, y: h * 0.45, w: w * 0.5, h: h * 0.5 }),
});
def({ id: 'diamond', name: 'Rombo', category: 'basic', w: 110, h: 80, paths: (w, h) => [{ d: diamond(w, h), fill: 'main' }], text: inset(0.2, 0.2) });
def({
  id: 'parallelogram', name: 'Paralelogramo', category: 'basic', w: 130, h: 70,
  paths: (w, h) => [{ d: P([[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]]), fill: 'main' }],
  ports: [{ x: 0.6, y: 0, dir: 'n' }, { x: 0.9, y: 0.5, dir: 'e' }, { x: 0.4, y: 1, dir: 's' }, { x: 0.1, y: 0.5, dir: 'w' }],
  text: inset(0.18, 0.05),
});
def({ id: 'trapezoid', name: 'Trapecio', category: 'basic', w: 130, h: 70, paths: (w, h) => [{ d: P([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]]), fill: 'main' }], text: inset(0.16, 0.05) });
def({ id: 'pentagon', name: 'Pentágono', category: 'basic', w: 100, h: 95, paths: (w, h) => [{ d: P(regular(5, w, h)), fill: 'main' }], text: inset(0.2, 0.2) });
def({ id: 'hexagon', name: 'Hexágono', category: 'basic', w: 120, h: 80, paths: (w, h) => [{ d: P([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]), fill: 'main' }], text: inset(0.16, 0.08) });
def({ id: 'octagon', name: 'Octógono', category: 'basic', w: 100, h: 100, paths: (w, h) => [{ d: P([[w * 0.3, 0], [w * 0.7, 0], [w, h * 0.3], [w, h * 0.7], [w * 0.7, h], [w * 0.3, h], [0, h * 0.7], [0, h * 0.3]]), fill: 'main' }], text: inset(0.14) });
def({ id: 'star', name: 'Estrella', category: 'basic', w: 100, h: 96, paths: (w, h) => [{ d: P(starPoints(w, h)), fill: 'main' }], text: inset(0.28, 0.3) });
def({
  id: 'cross', name: 'Cruz', category: 'basic', w: 90, h: 90,
  paths: (w, h) => [{ d: P([[w / 3, 0], [(2 * w) / 3, 0], [(2 * w) / 3, h / 3], [w, h / 3], [w, (2 * h) / 3], [(2 * w) / 3, (2 * h) / 3], [(2 * w) / 3, h], [w / 3, h], [w / 3, (2 * h) / 3], [0, (2 * h) / 3], [0, h / 3], [w / 3, h / 3]]), fill: 'main' }],
  text: inset(0.3),
});
def({ id: 'arrowRight', name: 'Flecha', category: 'basic', w: 130, h: 70, paths: (w, h) => [{ d: P([[0, h * 0.25], [w * 0.62, h * 0.25], [w * 0.62, 0], [w, h / 2], [w * 0.62, h], [w * 0.62, h * 0.75], [0, h * 0.75]]), fill: 'main' }], text: (w, h) => ({ x: w * 0.04, y: h * 0.25, w: w * 0.56, h: h * 0.5 }) });
def({ id: 'chevron', name: 'Cheurón', category: 'basic', w: 130, h: 70, paths: (w, h) => [{ d: P([[0, 0], [w * 0.7, 0], [w, h / 2], [w * 0.7, h], [0, h], [w * 0.3, h / 2]]), fill: 'main' }], text: inset(0.26, 0.05) });
def({ id: 'cylinder', name: 'Cilindro', category: 'basic', w: 80, h: 100, paths: cylinder, text: (w, h) => ({ x: w * 0.05, y: h * 0.25, w: w * 0.9, h: h * 0.7 }) });
def({ id: 'cloud', name: 'Nube', category: 'basic', w: 140, h: 90, paths: cloud, text: inset(0.18, 0.25) });
def({
  id: 'callout', name: 'Bocadillo', category: 'basic', w: 140, h: 90,
  paths: (w, h) => [{ d: `M0,0 H${n(w)} V${n(h * 0.72)} H${n(w * 0.45)} L${n(w * 0.2)},${n(h)} L${n(w * 0.25)},${n(h * 0.72)} H0 Z`, fill: 'main' }],
  text: (w, h) => ({ x: w * 0.04, y: h * 0.04, w: w * 0.92, h: h * 0.64 }),
});
def({ id: 'text', name: 'Cuadro de texto', category: 'basic', w: 140, h: 40, paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'none', stroke: false }], text: inset(0.02, 0.02), style: { fill: 'none', stroke: 'none' } });

// ---------------------------------------------------------------- flowchart
def({ id: 'process', name: 'Proceso', category: 'flow', w: 120, h: 60, paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'main' }], text: inset(0.04) });
def({ id: 'decision', name: 'Decisión', category: 'flow', w: 120, h: 80, paths: (w, h) => [{ d: diamond(w, h), fill: 'main' }], text: inset(0.2, 0.2) });
def({ id: 'terminator', name: 'Inicio / fin', category: 'flow', w: 120, h: 50, paths: (w, h) => [{ d: RR(0, 0, w, h, h / 2), fill: 'main' }], text: inset(0.14, 0.05) });
def({
  id: 'data', name: 'Datos (entrada/salida)', category: 'flow', w: 130, h: 60,
  paths: (w, h) => [{ d: P([[w * 0.18, 0], [w, 0], [w * 0.82, h], [0, h]]), fill: 'main' }],
  ports: [{ x: 0.59, y: 0, dir: 'n' }, { x: 0.91, y: 0.5, dir: 'e' }, { x: 0.41, y: 1, dir: 's' }, { x: 0.09, y: 0.5, dir: 'w' }],
  text: inset(0.18, 0.05),
});
def({
  id: 'document', name: 'Documento', category: 'flow', w: 120, h: 70,
  paths: (w, h) => [{ d: `M0,0 H${n(w)} V${n(h * 0.82)} C${n(w * 0.8)},${n(h * 0.66)} ${n(w * 0.7)},${n(h * 0.66)} ${n(w * 0.5)},${n(h * 0.82)} C${n(w * 0.3)},${n(h * 0.98)} ${n(w * 0.2)},${n(h * 0.98)} 0,${n(h * 0.82)} Z`, fill: 'main' }],
  text: (w, h) => ({ x: w * 0.04, y: h * 0.04, w: w * 0.92, h: h * 0.7 }),
});
def({ id: 'predefined', name: 'Proceso predefinido', category: 'flow', w: 130, h: 60, paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'main' }, { d: L([w * 0.1, 0], [w * 0.1, h]), fill: 'none' }, { d: L([w * 0.9, 0], [w * 0.9, h]), fill: 'none' }], text: inset(0.14, 0.04) });
def({ id: 'manualInput', name: 'Entrada manual', category: 'flow', w: 120, h: 60, paths: (w, h) => [{ d: P([[0, h * 0.2], [w, 0], [w, h], [0, h]]), fill: 'main' }], text: (w, h) => ({ x: w * 0.04, y: h * 0.22, w: w * 0.92, h: h * 0.74 }) });
def({ id: 'preparation', name: 'Preparación', category: 'flow', w: 120, h: 60, paths: (w, h) => [{ d: P([[w * 0.2, 0], [w * 0.8, 0], [w, h / 2], [w * 0.8, h], [w * 0.2, h], [0, h / 2]]), fill: 'main' }], text: inset(0.2, 0.05) });
def({ id: 'delay', name: 'Retraso', category: 'flow', w: 110, h: 60, paths: (w, h) => [{ d: `M0,0 H${n(w * 0.6)} A${n(w * 0.4)},${n(h / 2)} 0 0 1 ${n(w * 0.6)},${n(h)} H0 Z`, fill: 'main' }], text: (w, h) => ({ x: w * 0.04, y: h * 0.05, w: w * 0.7, h: h * 0.9 }) });
def({ id: 'database', name: 'Almacén de datos', category: 'flow', w: 80, h: 100, paths: cylinder, text: (w, h) => ({ x: w * 0.05, y: h * 0.25, w: w * 0.9, h: h * 0.7 }) });
def({
  id: 'offPage', name: 'Conector de otra página', category: 'flow', w: 60, h: 60,
  paths: (w, h) => [{ d: P([[0, 0], [w, 0], [w, h * 0.65], [w / 2, h], [0, h * 0.65]]), fill: 'main' }],
  text: (w, h) => ({ x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.55 }),
});
def({ id: 'flowConnector', name: 'Conector', category: 'flow', w: 40, h: 40, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }], text: inset(0.1, 0.1) });
def({ id: 'merge', name: 'Combinar', category: 'flow', w: 70, h: 60, paths: (w, h) => [{ d: P([[0, 0], [w, 0], [w / 2, h]]), fill: 'main' }], text: (w, h) => ({ x: w * 0.25, y: 0, w: w * 0.5, h: h * 0.45 }) });
def({
  id: 'summing', name: 'Unión de suma', category: 'flow', w: 44, h: 44,
  paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }, { d: L([w * 0.15, h * 0.15], [w * 0.85, h * 0.85]), fill: 'none' }, { d: L([w * 0.85, h * 0.15], [w * 0.15, h * 0.85]), fill: 'none' }],
  text: () => ({ x: 0, y: 0, w: 0, h: 0 }),
});
def({
  id: 'or', name: 'O', category: 'flow', w: 44, h: 44,
  paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }, { d: L([w / 2, 0], [w / 2, h]), fill: 'none' }, { d: L([0, h / 2], [w, h / 2]), fill: 'none' }],
  text: () => ({ x: 0, y: 0, w: 0, h: 0 }),
});

// ---------------------------------------------------------------- UML
const HEAD = 30;
def({
  id: 'umlClass', name: 'Clase', category: 'uml', w: 170, h: 120, sections: true,
  paths: (w, h) => {
    const rest = (h - HEAD) / 2;
    return [{ d: R(0, 0, w, h), fill: 'main' }, { d: L([0, HEAD], [w, HEAD]), fill: 'none' }, { d: L([0, HEAD + rest], [w, HEAD + rest]), fill: 'none' }];
  },
  text: whole,
});
def({
  id: 'umlActor', name: 'Actor', category: 'uml', w: 50, h: 90,
  paths: (w, h) => {
    const hr = Math.min(w * 0.22, h * 0.1);
    const cx = w / 2;
    const top = hr * 2;
    const bodyEnd = h * 0.55;
    return [
      { d: E(cx, hr, hr, hr), fill: 'main' },
      { d: L([cx, top], [cx, bodyEnd]), fill: 'none' },
      { d: L([w * 0.1, h * 0.3], [w * 0.9, h * 0.3]), fill: 'none' },
      { d: L([w * 0.15, h * 0.72], [cx, bodyEnd], [w * 0.85, h * 0.72]), fill: 'none' },
    ];
  },
  text: (w, h) => ({ x: -20, y: h * 0.76, w: w + 40, h: h * 0.24, wrap: false }),
  ports: [{ x: 0.5, y: 0, dir: 'n' }, { x: 0.9, y: 0.3, dir: 'e' }, { x: 0.85, y: 0.72, dir: 's' }, { x: 0.1, y: 0.3, dir: 'w' }],
  style: { fill: '#ffffff' },
});
def({ id: 'umlUseCase', name: 'Caso de uso', category: 'uml', w: 150, h: 70, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }], text: inset(0.14, 0.14) });
def({
  id: 'umlPackage', name: 'Paquete', category: 'uml', w: 150, h: 100,
  paths: (w, h) => [{ d: R(0, h * 0.14, w, h * 0.86), fill: 'main' }, { d: R(0, 0, w * 0.4, h * 0.14), fill: 'main' }],
  text: (w, h) => ({ x: w * 0.04, y: h * 0.16, w: w * 0.92, h: h * 0.8 }),
});
def({
  id: 'umlNote', name: 'Nota', category: 'uml', w: 130, h: 80,
  paths: (w, h) => {
    const f = Math.min(18, w * 0.2);
    return [{ d: P([[0, 0], [w - f, 0], [w, f], [w, h], [0, h]]), fill: 'main' }, { d: `M${n(w - f)},0 V${n(f)} H${n(w)}`, fill: 'none' }];
  },
  text: inset(0.05, 0.05),
  style: { fill: '#fff8c5' },
});
def({
  id: 'umlComponent', name: 'Componente', category: 'uml', w: 150, h: 80,
  paths: (w, h) => [{ d: R(w * 0.08, 0, w * 0.92, h), fill: 'main' }, { d: R(0, h * 0.24, w * 0.16, h * 0.16), fill: 'main' }, { d: R(0, h * 0.6, w * 0.16, h * 0.16), fill: 'main' }],
  text: (w, h) => ({ x: w * 0.2, y: h * 0.05, w: w * 0.76, h: h * 0.9 }),
});
def({
  id: 'umlNode', name: 'Nodo', category: 'uml', w: 140, h: 100,
  paths: (w, h) => {
    const d = Math.min(w, h) * 0.18;
    return [{ d: R(0, d, w - d, h - d), fill: 'main' }, { d: P([[0, d], [d, 0], [w, 0], [w - d, d]]), fill: 'main' }, { d: P([[w - d, d], [w, 0], [w, h - d], [w - d, h]]), fill: 'main' }];
  },
  text: (w, h) => ({ x: w * 0.04, y: h * 0.22, w: w * 0.72, h: h * 0.72 }),
});
def({
  id: 'umlLifeline', name: 'Línea de vida', category: 'uml', w: 110, h: 300,
  paths: (w, h) => [{ d: R(0, 0, w, 44), fill: 'main' }, { d: L([w / 2, 44], [w / 2, h]), fill: 'none', dashed: true }],
  ports: [{ x: 0.5, y: 0, dir: 'n' }, { x: 1, y: 0.5, dir: 'e' }, { x: 0.5, y: 1, dir: 's' }, { x: 0, y: 0.5, dir: 'w' }],
  text: (w) => ({ x: 4, y: 2, w: w - 8, h: 40 }),
});
def({ id: 'umlInitial', name: 'Estado inicial', category: 'uml', w: 28, h: 28, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'stroke' }], text: () => ({ x: 0, y: 0, w: 0, h: 0 }) });
def({ id: 'umlFinal', name: 'Estado final', category: 'uml', w: 32, h: 32, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }, { d: E(w / 2, h / 2, w * 0.28, h * 0.28), fill: 'stroke' }], text: () => ({ x: 0, y: 0, w: 0, h: 0 }) });
def({
  id: 'umlFork', name: 'Barra de bifurcación', category: 'uml', w: 110, h: 10,
  paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'stroke' }],
  text: () => ({ x: 0, y: 0, w: 0, h: 0 }),
});

// ---------------------------------------------------------------- network
def({
  id: 'netServer', name: 'Servidor', category: 'network', w: 60, h: 90,
  paths: (w, h) => [
    { d: RR(0, 0, w, h, 4), fill: 'main' },
    { d: L([w * 0.12, h * 0.22], [w * 0.88, h * 0.22]), fill: 'none' },
    { d: L([w * 0.12, h * 0.44], [w * 0.88, h * 0.44]), fill: 'none' },
    { d: E(w * 0.24, h * 0.84, 3, 3), fill: 'stroke' },
    { d: L([w * 0.4, h * 0.84], [w * 0.88, h * 0.84]), fill: 'none' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});
def({
  id: 'netRouter', name: 'Enrutador', category: 'network', w: 80, h: 60,
  paths: (w, h) => [
    { d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' },
    { d: L([w * 0.2, h / 2], [w * 0.8, h / 2]), fill: 'none' },
    { d: L([w / 2, h * 0.2], [w / 2, h * 0.8]), fill: 'none' },
    { d: P([[w * 0.8, h / 2 - 5], [w * 0.8 + 9, h / 2], [w * 0.8, h / 2 + 5]]), fill: 'stroke' },
    { d: P([[w * 0.2, h / 2 - 5], [w * 0.2 - 9, h / 2], [w * 0.2, h / 2 + 5]]), fill: 'stroke' },
    { d: P([[w / 2 - 5, h * 0.2], [w / 2, h * 0.2 - 7], [w / 2 + 5, h * 0.2]]), fill: 'stroke' },
    { d: P([[w / 2 - 5, h * 0.8], [w / 2, h * 0.8 + 7], [w / 2 + 5, h * 0.8]]), fill: 'stroke' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});
def({
  id: 'netSwitch', name: 'Conmutador', category: 'network', w: 100, h: 44,
  paths: (w, h) => [
    { d: RR(0, 0, w, h, 4), fill: 'main' },
    { d: L([w * 0.15, h * 0.35], [w * 0.85, h * 0.35]), fill: 'none' },
    { d: L([w * 0.15, h * 0.65], [w * 0.85, h * 0.65]), fill: 'none' },
    { d: P([[w * 0.85, h * 0.35 - 4], [w * 0.85 + 7, h * 0.35], [w * 0.85, h * 0.35 + 4]]), fill: 'stroke' },
    { d: P([[w * 0.15, h * 0.65 - 4], [w * 0.15 - 7, h * 0.65], [w * 0.15, h * 0.65 + 4]]), fill: 'stroke' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});
def({
  id: 'netFirewall', name: 'Cortafuegos', category: 'network', w: 80, h: 70,
  paths: (w, h) => [
    { d: R(0, 0, w, h), fill: 'main' },
    { d: L([0, h / 4], [w, h / 4]), fill: 'none' },
    { d: L([0, h / 2], [w, h / 2]), fill: 'none' },
    { d: L([0, (3 * h) / 4], [w, (3 * h) / 4]), fill: 'none' },
    { d: L([w / 2, 0], [w / 2, h / 4]), fill: 'none' },
    { d: L([w / 4, h / 4], [w / 4, h / 2]), fill: 'none' },
    { d: L([(3 * w) / 4, h / 4], [(3 * w) / 4, h / 2]), fill: 'none' },
    { d: L([w / 2, h / 2], [w / 2, (3 * h) / 4]), fill: 'none' },
    { d: L([w / 4, (3 * h) / 4], [w / 4, h]), fill: 'none' },
    { d: L([(3 * w) / 4, (3 * h) / 4], [(3 * w) / 4, h]), fill: 'none' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
  style: { fill: '#f9d6c9' },
});
def({ id: 'netCloud', name: 'Internet / nube', category: 'network', w: 140, h: 90, paths: cloud, text: inset(0.18, 0.25) });
def({
  id: 'netPc', name: 'Ordenador', category: 'network', w: 80, h: 76,
  paths: (w, h) => [
    { d: RR(w * 0.05, 0, w * 0.9, h * 0.68, 4), fill: 'main' },
    { d: R(w * 0.12, h * 0.07, w * 0.76, h * 0.54), fill: 'light' },
    { d: R(w * 0.4, h * 0.68, w * 0.2, h * 0.14), fill: 'main' },
    { d: R(w * 0.22, h * 0.82, w * 0.56, h * 0.1), fill: 'main' },
  ],
  text: (w, h) => ({ x: -20, y: h * 0.95, w: w + 40, h: 22, wrap: false }),
  ports: [{ x: 0.5, y: 0, dir: 'n' }, { x: 1, y: 0.34, dir: 'e' }, { x: 0.5, y: 0.92, dir: 's' }, { x: 0, y: 0.34, dir: 'w' }],
});
def({
  id: 'netLaptop', name: 'Portátil', category: 'network', w: 90, h: 64,
  paths: (w, h) => [
    { d: RR(w * 0.14, 0, w * 0.72, h * 0.68, 3), fill: 'main' },
    { d: R(w * 0.2, h * 0.07, w * 0.6, h * 0.54), fill: 'light' },
    { d: P([[0, h * 0.78], [w, h * 0.78], [w * 0.92, h], [w * 0.08, h]]), fill: 'main' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});
def({
  id: 'netPrinter', name: 'Impresora', category: 'network', w: 80, h: 64,
  paths: (w, h) => [
    { d: R(w * 0.22, 0, w * 0.56, h * 0.32), fill: 'main' },
    { d: RR(0, h * 0.3, w, h * 0.45, 5), fill: 'main' },
    { d: R(w * 0.2, h * 0.58, w * 0.6, h * 0.4), fill: 'main' },
    { d: L([w * 0.3, h * 0.72], [w * 0.7, h * 0.72]), fill: 'none' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});
def({
  id: 'netUser', name: 'Usuario', category: 'network', w: 56, h: 70,
  paths: (w, h) => [
    { d: E(w / 2, h * 0.24, w * 0.22, w * 0.22), fill: 'main' },
    { d: `M${n(w * 0.1)},${n(h)} C${n(w * 0.1)},${n(h * 0.55)} ${n(w * 0.9)},${n(h * 0.55)} ${n(w * 0.9)},${n(h)} Z`, fill: 'main' },
  ],
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});

// ---------------------------------------------------------------- BPMN
def({ id: 'bpmnTask', name: 'Tarea', category: 'bpmn', w: 130, h: 70, paths: (w, h) => [{ d: RR(0, 0, w, h, 10), fill: 'main' }], text: inset(0.06, 0.06) });
def({
  id: 'bpmnSubprocess', name: 'Subproceso', category: 'bpmn', w: 140, h: 80,
  paths: (w, h) => [{ d: RR(0, 0, w, h, 10), fill: 'main' }, { d: R(w / 2 - 7, h - 20, 14, 14), fill: 'none' }, { d: L([w / 2 - 4, h - 13], [w / 2 + 4, h - 13]), fill: 'none' }, { d: L([w / 2, h - 17], [w / 2, h - 9]), fill: 'none' }],
  text: (w, h) => ({ x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.68 }),
});
def({ id: 'bpmnStart', name: 'Evento de inicio', category: 'bpmn', w: 40, h: 40, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main', width: 0.7 }], text: (w, h) => ({ x: -30, y: h + 2, w: w + 60, h: 22, wrap: false }), style: { fill: '#e3f5e1' } });
def({ id: 'bpmnEnd', name: 'Evento de fin', category: 'bpmn', w: 40, h: 40, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main', width: 2.6 }], text: (w, h) => ({ x: -30, y: h + 2, w: w + 60, h: 22, wrap: false }), style: { fill: '#fbe3e1' } });
def({ id: 'bpmnIntermediate', name: 'Evento intermedio', category: 'bpmn', w: 40, h: 40, paths: (w, h) => [{ d: E(w / 2, h / 2, w / 2, h / 2), fill: 'main' }, { d: E(w / 2, h / 2, w / 2 - 4, h / 2 - 4), fill: 'none' }], text: (w, h) => ({ x: -30, y: h + 2, w: w + 60, h: 22, wrap: false }) });
def({
  id: 'bpmnXor', name: 'Compuerta exclusiva', category: 'bpmn', w: 50, h: 50,
  paths: (w, h) => [{ d: diamond(w, h), fill: 'main' }, { d: L([w * 0.35, h * 0.35], [w * 0.65, h * 0.65]), fill: 'none', width: 1.6 }, { d: L([w * 0.65, h * 0.35], [w * 0.35, h * 0.65]), fill: 'none', width: 1.6 }],
  text: (w, h) => ({ x: -30, y: h + 2, w: w + 60, h: 22, wrap: false }),
});
def({
  id: 'bpmnAnd', name: 'Compuerta paralela', category: 'bpmn', w: 50, h: 50,
  paths: (w, h) => [{ d: diamond(w, h), fill: 'main' }, { d: L([w / 2, h * 0.25], [w / 2, h * 0.75]), fill: 'none', width: 1.6 }, { d: L([w * 0.25, h / 2], [w * 0.75, h / 2]), fill: 'none', width: 1.6 }],
  text: (w, h) => ({ x: -30, y: h + 2, w: w + 60, h: 22, wrap: false }),
});
def({
  id: 'bpmnOr', name: 'Compuerta inclusiva', category: 'bpmn', w: 50, h: 50,
  paths: (w, h) => [{ d: diamond(w, h), fill: 'main' }, { d: E(w / 2, h / 2, w * 0.2, h * 0.2), fill: 'none', width: 1.6 }],
  text: (w, h) => ({ x: -30, y: h + 2, w: w + 60, h: 22, wrap: false }),
});
def({
  id: 'bpmnData', name: 'Objeto de datos', category: 'bpmn', w: 50, h: 64,
  paths: (w, h) => {
    const f = w * 0.3;
    return [{ d: P([[0, 0], [w - f, 0], [w, f], [w, h], [0, h]]), fill: 'main' }, { d: `M${n(w - f)},0 V${n(f)} H${n(w)}`, fill: 'none' }];
  },
  text: (w, h) => ({ x: -20, y: h + 2, w: w + 40, h: 22, wrap: false }),
});
def({
  id: 'bpmnLane', name: 'Carril', category: 'bpmn', w: 500, h: 160,
  paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'main' }, { d: R(0, 0, w, 28), fill: 'light' }],
  text: (w) => ({ x: 8, y: 2, w: w - 16, h: 24 }),
  style: { fill: '#f7f9fc' },
});
def({
  id: 'bpmnAnnotation', name: 'Anotación', category: 'bpmn', w: 120, h: 60,
  paths: (w, h) => [{ d: L([16, 0], [0, 0], [0, h], [16, h]), fill: 'none' }, { d: R(0, 0, w, h), fill: 'none', stroke: false }],
  text: (w, h) => ({ x: 22, y: 4, w: w - 26, h: h - 8 }),
  style: { fill: 'none' },
});

def({
  id: 'image', name: 'Imagen', category: 'extra', w: 160, h: 120,
  paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'none' }],
  style: { fill: 'none', stroke: 'none' },
});
def({
  id: 'container', name: 'Contenedor', category: 'extra', w: 320, h: 220,
  paths: (w, h) => [{ d: RR(0, 0, w, h, 6), fill: 'main' }, { d: R(0, 0, w, 28), fill: 'light' }],
  text: (w) => ({ x: 8, y: 2, w: w - 16, h: 24 }),
  style: { fill: '#f4f7fb', stroke: '#7a8fa6', dash: 'dash' },
});
def({
  id: 'pool', name: 'Piscina con carriles horizontales', category: 'extra', w: 640, h: 300,
  paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'main' }],
  text: () => ({ x: 0, y: 0, w: 0, h: 0 }),
  style: { fill: '#ffffff' },
});
def({
  id: 'poolV', name: 'Piscina con carriles verticales', category: 'extra', w: 480, h: 420,
  paths: (w, h) => [{ d: R(0, 0, w, h), fill: 'main' }],
  text: () => ({ x: 0, y: 0, w: 0, h: 0 }),
  style: { fill: '#ffffff' },
});

export const STENCILS: Stencil[] = defs.map((d) => ({ ...d, ports: d.ports ?? four, text: d.text ?? whole }));
const byId = new Map(STENCILS.map((s) => [s.id, s]));

/** Unknown ids (from a damaged or newer file) draw as rectangles. */
export function stencilOf(id: string): Stencil {
  return byId.get(id) ?? byId.get('rect')!;
}
export const hasStencil = (id: string): boolean => byId.has(id);
export const stencilsIn = (category: string): Stencil[] => STENCILS.filter((s) => s.category === category);
