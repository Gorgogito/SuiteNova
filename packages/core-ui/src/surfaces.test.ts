import { describe, expect, it } from 'vitest';
import { surfaceAccent, surfaceCss, surfaceTheme, SURFACES } from './surfaces';
import { contrastRatio, MODULE_ACCENTS, zoneColors, type ThemeMode } from './theme';

const MODES: ThemeMode[] = ['colorful', 'darkgray', 'black', 'white'];

describe('paneles, cuadros y vista Archivo', () => {
  it('usan los fondos medidos en Word', () => {
    const background = (mode: ThemeMode) => SURFACES.map((s) => surfaceTheme(s, 'writer', mode)!.colorNeutralBackground1);
    // pane, dialog, File view
    expect(background('colorful')).toEqual(['#f0f0f0', '#ffffff', '#f5f5f5']);
    expect(background('white')).toEqual(['#f0f0f0', '#ffffff', '#f5f5f5']);
    expect(background('darkgray')).toEqual(['#525252', '#525252', '#525252']);
    expect(background('black')).toEqual(['#0a0a0a', '#292929', '#141414']);
  });

  it('el botón principal y el título de los cuadros usan los colores medidos', () => {
    expect(surfaceAccent('writer', 'colorful')).toBe('#1651aa');
    expect(surfaceAccent('writer', 'darkgray')).toBe('#aec6f0');
    expect(surfaceAccent('writer', 'black')).toBe('#82abf1');
    expect(surfaceTheme('dialog', 'writer', 'darkgray')!.colorNeutralForegroundOnBrand).toBe('#000000');
    expect(surfaceTheme('dialog', 'writer', 'white')!.colorNeutralForegroundOnBrand).toBe('#ffffff');
    expect(zoneColors('writer', 'colorful')['nv-dialog-title']).toBe('#185abd');
    expect(zoneColors('writer', 'darkgray')['nv-dialog-title']).toBe('#aec6f0');
    expect(zoneColors('writer', 'black')).toMatchObject({ 'nv-dialog-title': '#82abf1', 'nv-menu-border': '#adadad', 'nv-bs-mark': '#82abf1' });
    expect(zoneColors('writer', 'darkgray')).toMatchObject({ 'nv-bs-nav-bg': '#343535', 'nv-menu-border': '#666666' });
  });

  it('el texto, los enlaces y los botones se leen en cada superficie, aplicación y tema', () => {
    for (const app of Object.keys(MODULE_ACCENTS)) {
      for (const mode of MODES) {
        const z = zoneColors(app, mode);
        const where = (s: string) => `${app} ${mode} ${s}`;
        for (const surface of SURFACES) {
          const th = surfaceTheme(surface, app, mode)!;
          const bg = th.colorNeutralBackground1;
          for (const fg of ['colorNeutralForeground1', 'colorNeutralForeground3', 'colorBrandForeground1'] as const) {
            expect(contrastRatio(bg, th[fg]), where(`${surface} ${fg}`)).toBeGreaterThanOrEqual(4.5);
          }
          expect(contrastRatio(th.colorBrandBackground, th.colorNeutralForegroundOnBrand), where(`${surface} botón principal`)).toBeGreaterThanOrEqual(4.5);
        }
        const dialog = surfaceTheme('dialog', app, mode)!;
        expect(contrastRatio(dialog.colorNeutralBackground1, z['nv-dialog-title']), where('título de cuadro')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(z['nv-bs-nav-bg'], z['nv-bs-nav-fg']), where('barra de Archivo')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(z['nv-bs-nav-bg'], z['nv-bs-mark']), where('apartado elegido')).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('una hoja de estilos por ventana; con el contraste alto de Windows no cambia nada', () => {
    const css = surfaceCss('writer', 'darkgray');
    for (const where of ['.nv-panel{', '.fui-DialogSurface{', ':is(.nv-backstage__content, .nv-startpage){', '.fui-DialogActions .fui-Button{']) expect(css).toContain(where);
    expect(css).toContain('--colorNeutralBackground1:#525252;');
    expect(css).toContain('color-scheme:dark;');
    // light boxes inside the dark panes, as measured
    expect(css).toContain('background-color:#d4d4d4;color:#242424;');
    expect(surfaceCss('writer', 'white')).not.toContain('.fui-DialogActions');
    expect(surfaceCss('writer', 'contrast')).toBe('');
    expect(surfaceTheme('panel', 'writer', 'contrast')).toBeNull();
  });
});
