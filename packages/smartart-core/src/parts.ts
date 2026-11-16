import { drawingRelId, parseDataModel, writeDataModel, type DataModel } from './datamodel';
import { parseDrawing, writeDrawing, type DrawnShape } from './drawing';
import { parseLayoutDef, type LayoutDef } from './layoutdef';
import { parseColorsDef, parseStyleDef, type ColorsDef, type StyleDef } from './styles';

/** Las cinco partes de un SmartArt como las guarda un paquete de Office (cada una, el texto XML de su archivo). */
export interface SmartArtParts {
  data: string;
  layout: string;
  style: string;
  colors: string;
  /** El dibujo en caché; algunos archivos no lo traen. */
  drawing?: string;
}

/** Tipos de relación y de contenido de cada parte (comunes a PowerPoint, Word y Excel). */
export const PART_TYPES = {
  data: { rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData', content: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml', dir: 'diagrams/data' },
  layout: { rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout', content: 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml', dir: 'diagrams/layout' },
  style: { rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle', content: 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml', dir: 'diagrams/quickStyle' },
  colors: { rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors', content: 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml', dir: 'diagrams/colors' },
  drawing: { rel: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing', content: 'application/vnd.ms-office.drawingml.diagramDrawing+xml', dir: 'diagrams/drawing' },
} as const;

/** `uri` del `a:graphicData` que aloja un SmartArt en los tres productos. */
export const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';

export interface SmartArt {
  data: DataModel;
  layout: LayoutDef;
  /** El XML original del diseño, que se guarda tal cual (el diseño de un archivo viaja con él). */
  layoutXml: string;
  style: StyleDef;
  styleXml: string;
  colors: ColorsDef;
  colorsXml: string;
  /** El dibujo en caché, o `null` si no lo hay o ya no vale (tras editar los datos). */
  drawing: DrawnShape[] | null;
}

export function parseSmartArt(p: SmartArtParts): SmartArt {
  return {
    data: parseDataModel(p.data),
    layout: parseLayoutDef(p.layout),
    layoutXml: p.layout,
    style: parseStyleDef(p.style),
    styleXml: p.style,
    colors: parseColorsDef(p.colors),
    colorsXml: p.colors,
    drawing: p.drawing ? parseDrawing(p.drawing) : null,
  };
}

/** Las partes para guardar. El dibujo solo se escribe si hay (y el anfitrión debe declarar su relación con `setDrawingRelId`). */
export function writeSmartArt(sa: SmartArt): SmartArtParts {
  const out: SmartArtParts = { data: writeDataModel(sa.data), layout: sa.layoutXml, style: sa.styleXml, colors: sa.colorsXml };
  if (sa.drawing) out.drawing = writeDrawing(sa.drawing);
  return out;
}

/** ¿Declara el modelo de datos un dibujo en caché? */
export const hasCachedDrawing = (sa: SmartArt): boolean => drawingRelId(sa.data) !== undefined;
