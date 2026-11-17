import { parseMath, toMathML } from '@suitenova/math-core';

/** Size (points) of the characters of an equation box when nothing says otherwise. */
export const EQUATION_SIZE = 28;

/** The MathML the canvas draws for the formula of an equation box (the browser lays it out). */
export function mathBoxHtml(tex: string, display: boolean): string {
  try {
    return toMathML(parseMath(tex), display);
  } catch {
    return '';
  }
}
