import { registerMessages } from '@suitenova/core-ui';
import { styleCatalog } from '@suitenova/table-core';

// English text of the shared table controls.
registerMessages('en', {
  'Estilos de tabla': 'Table Styles',
  'Estilo de tabla': 'Table style',
  'Opciones de estilo de tabla': 'Table Style Options',
  'Fila de encabezado': 'Header Row',
  'Fila de totales': 'Total Row',
  'Primera columna': 'First Column',
  'Última columna': 'Last Column',
  'Filas con bandas': 'Banded Rows',
  'Columnas con bandas': 'Banded Columns',
  'Borrar estilo': 'Clear Style',
  'Sin estilo': 'No Style',
  'Cuadrícula de tabla': 'Table Grid',
  'Claro': 'Light',
  'Cuadrícula': 'Grid',
  'Medio': 'Medium',
  'Oscuro': 'Dark',
  'Lista': 'List',
  'Énfasis': 'Accent',
  'Sombreado': 'Shading',
  'Sin color': 'No Color',
  'Restablecer el color del estilo': 'Reset to the style colour',
  'Colores del tema': 'Theme Colors',
  'Colores estándar': 'Standard Colors',
  'Más colores…': 'More Colors…',
  'Bordes': 'Borders',
  'Estilo de línea': 'Line style',
  'Grosor de línea': 'Line weight',
  'Color de la línea': 'Pen color',
  'Continua': 'Solid',
  'Rayas': 'Dashed',
  'Puntos': 'Dotted',
  'Doble': 'Double',
  'Todos los bordes': 'All Borders',
  'Borde exterior': 'Outside Borders',
  'Bordes interiores': 'Inside Borders',
  'Borde superior': 'Top Border',
  'Borde inferior': 'Bottom Border',
  'Borde izquierdo': 'Left Border',
  'Borde derecho': 'Right Border',
  'Borde horizontal interior': 'Inside Horizontal Border',
  'Borde vertical interior': 'Inside Vertical Border',
  'Sin borde': 'No Border',
  'Insertar tabla': 'Insert Table',
  'Insertar tabla…': 'Insert Table…',
  'Tabla de {cols} × {rows}': '{cols} × {rows} Table',
  'Elige cuántas columnas y filas. Flechas para cambiar el tamaño, Intro para insertar.': 'Choose how many columns and rows. Arrows change the size, Enter inserts.',
});

// the names of the styles, for the commands of the command palette: «Estilo de tabla: Medio – Énfasis 1»
const EN_FAMILY: Record<string, string> = { plain: 'No Style', basic: 'Table Grid', light: 'Light', grid: 'Grid', medium: 'Medium', dark: 'Dark', list: 'List' };
const styleNames: Record<string, string> = {};
for (const fam of styleCatalog()) {
  for (const s of fam.styles) {
    const en = s.accent ? `${EN_FAMILY[fam.family]} – Accent ${s.accent}` : EN_FAMILY[fam.family]!;
    styleNames[`Estilo de tabla: ${s.name}`] = `Table Style: ${en}`;
  }
}
registerMessages('en', styleNames);
