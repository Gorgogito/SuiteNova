import { newId, type Connector, type Layer, type Page, type Shape } from './model';

/*
 * Layers. Every shape and connector sits on one layer (the first one when it names none). A hidden layer is neither drawn nor
 * exported, a locked one cannot be selected or changed, and a layer that is not printable is left out of exports and printing.
 * Layers do not change the stacking order.
 */

export const DEFAULT_LAYER = 'layer0';

const base = (): Layer => ({ id: DEFAULT_LAYER, name: 'Capa 1', visible: true, locked: false, printable: true });

/** The layers of a page (a page that has none has one implicit layer). */
export function layersOf(page: Page): Layer[] {
  return page.layers?.length ? page.layers : [base()];
}

const layerIds = (page: Page) => new Set(layersOf(page).map((l) => l.id));

/** The layer an item sits on. */
export function layerIdOf(page: Page, item: { layer?: string }): string {
  const ids = layerIds(page);
  return item.layer && ids.has(item.layer) ? item.layer : layersOf(page)[0]!.id;
}

export function layerOf(page: Page, item: { layer?: string }): Layer {
  const id = layerIdOf(page, item);
  return layersOf(page).find((l) => l.id === id)!;
}

export const isItemVisible = (page: Page, item: { layer?: string }): boolean => !page.layers?.length || layerOf(page, item).visible;
export const isItemLocked = (page: Page, item: { layer?: string }): boolean => !!page.layers?.length && layerOf(page, item).locked;

export const visibleShapes = (page: Page): Shape[] => (page.layers?.length ? page.shapes.filter((s) => isItemVisible(page, s)) : page.shapes);
export const visibleConnectors = (page: Page): Connector[] => (page.layers?.length ? page.connectors.filter((c) => isItemVisible(page, c)) : page.connectors);

/** The page as it is exported or printed: only visible, printable layers. */
export function printablePage(page: Page): Page {
  if (!page.layers?.length) return page;
  const ok = (i: { layer?: string }) => {
    const l = layerOf(page, i);
    return l.visible && l.printable;
  };
  return { ...page, shapes: page.shapes.filter(ok), connectors: page.connectors.filter(ok) };
}

function materialize(page: Page): Page {
  return page.layers?.length ? page : { ...page, layers: [base()], activeLayer: page.activeLayer ?? DEFAULT_LAYER };
}

export function addLayer(page: Page, name?: string): { page: Page; layer: Layer } {
  const p = materialize(page);
  const layer: Layer = { id: newId('ly'), name: name?.trim() || `Capa ${p.layers!.length + 1}`, visible: true, locked: false, printable: true };
  return { page: { ...p, layers: [...p.layers!, layer], activeLayer: layer.id }, layer };
}

export function updateLayer(page: Page, id: string, patch: Partial<Omit<Layer, 'id'>>): Page {
  const p = materialize(page);
  return { ...p, layers: p.layers!.map((l) => (l.id === id ? { ...l, ...patch, name: patch.name !== undefined ? patch.name.trim() || l.name : l.name } : l)) };
}

/** Removes a layer; what was on it moves to `to` (the first other layer by default). The last layer cannot be removed. */
export function removeLayer(page: Page, id: string, to?: string): Page {
  const p = materialize(page);
  if (p.layers!.length <= 1) return page;
  const target = to && to !== id && p.layers!.some((l) => l.id === to) ? to : p.layers!.find((l) => l.id !== id)!.id;
  const move = <T extends { layer?: string }>(i: T): T => (layerIdOf(p, i) === id ? { ...i, layer: target } : i);
  const layers = p.layers!.filter((l) => l.id !== id);
  return { ...p, layers, shapes: p.shapes.map(move), connectors: p.connectors.map(move), activeLayer: p.activeLayer === id || !layers.some((l) => l.id === p.activeLayer) ? target : p.activeLayer };
}

export function moveLayer(page: Page, id: string, dir: -1 | 1): Page {
  const p = materialize(page);
  const i = p.layers!.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.layers!.length) return page;
  const layers = [...p.layers!];
  [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  return { ...p, layers };
}

export function setActiveLayer(page: Page, id: string): Page {
  const p = materialize(page);
  return p.layers!.some((l) => l.id === id) ? { ...p, activeLayer: id } : page;
}

/** Puts shapes and connectors on a layer. */
export function assignLayer(page: Page, shapeIds: string[], connectorIds: string[], layerId: string): Page {
  const p = materialize(page);
  if (!p.layers!.some((l) => l.id === layerId)) return page;
  return {
    ...p,
    shapes: p.shapes.map((s) => (shapeIds.includes(s.id) ? { ...s, layer: layerId } : s)),
    connectors: p.connectors.map((c) => (connectorIds.includes(c.id) ? { ...c, layer: layerId } : c)),
  };
}

export const itemCount = (page: Page, layerId: string): number => page.shapes.filter((s) => layerIdOf(page, s) === layerId).length + page.connectors.filter((c) => layerIdOf(page, c) === layerId).length;
