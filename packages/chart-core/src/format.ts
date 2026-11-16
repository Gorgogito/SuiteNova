/*
 * Formato de números de las etiquetas de los ejes y de los estadísticos. Cada producto registra el suyo (los de Office: «0.00», «#,##0»,
 * «0%»…); mientras no haya ninguno se usa uno general.
 */
export type NumberFormatter = (value: number, format?: string) => string;

const general: NumberFormatter = (v) => (Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : String(v));
let formatter: NumberFormatter = general;

/** Registra el formato de números (p. ej. el de `calc-engine`). Sin argumento vuelve al general. */
export function setChartNumberFormatter(f?: NumberFormatter): void {
  formatter = f ?? general;
}

export const formatChartNumber: NumberFormatter = (v, f) => formatter(v, f);
