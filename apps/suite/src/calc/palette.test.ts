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

  it('con el contraste alto toma los colores del tema de contraste de Windows, oscuro o claro', () => {
    const light = { canvas: 'rgb(255, 250, 239)', text: 'rgb(61, 61, 61)', highlight: 'rgb(144, 57, 9)', highlightText: 'rgb(255, 245, 227)' };
    expect(calcPalette('contrast', light)).toMatchObject({ forced: true, bg: light.canvas, text: light.text, headerBg: light.canvas, accent: light.highlight, accentFill: 'rgba(144,57,9,0.25)', selectedHeaderText: light.highlightText, grid: 'rgba(61,61,61,0.45)' });
    // sin poder leerlos (fuera del navegador), la cuadrícula oscura
    expect(calcPalette('contrast')).toEqual({ ...DARK, forced: true });
    // los colores del sistema no se usan en los demás temas
    expect(calcPalette('white', light)).toBe(LIGHT);
  });
});
