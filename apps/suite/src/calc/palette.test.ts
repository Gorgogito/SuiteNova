import { describe, expect, it } from 'vitest';
import { calcPalette, DARK, LIGHT } from './render';

describe('colores de la cuadrícula por tema', () => {
  it('la hoja es blanca en todos los temas, como en Excel, y los encabezados siguen al tema', () => {
    for (const mode of ['colorful', 'white', 'darkgray', 'black'] as const) {
      expect(calcPalette(mode), mode).toMatchObject({ bg: '#ffffff', text: '#000000', grid: '#e0e0e0' });
    }
    expect(calcPalette('white')).toBe(LIGHT);
    expect(calcPalette('colorful').headerBg).toBe('#f0f0f0');
    expect(calcPalette('darkgray')).toMatchObject({ headerBg: '#525252', headerText: '#ffffff', headerBorder: '#adadad' });
    expect(calcPalette('black')).toMatchObject({ headerBg: '#0a0a0a', headerText: '#dadada', headerBorder: '#333333' });
  });

  it('con el contraste alto de Windows la cuadrícula es oscura', () => {
    expect(calcPalette('contrast')).toBe(DARK);
  });
});
