import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './commands';
import { coreCommands, SETTING_THEME } from './core-commands';
import { settings } from './settings';
import { contrastRatio, fluentTheme, MODULE_ACCENTS, normalizeThemePreference, readableOn, resolveTheme, THEME_PREFERENCES, zoneColors, type ThemeMode } from './theme';

const MODES: ThemeMode[] = ['colorful', 'darkgray', 'black', 'white', 'contrast'];

describe('temas del aplicativo', () => {
  it('ofrece los cinco temas de Office en su orden', () => {
    expect(THEME_PREFERENCES).toEqual(['colorful', 'darkgray', 'black', 'white', 'system']);
  });

  it('convierte los ajustes guardados por versiones anteriores', () => {
    expect(normalizeThemePreference('light')).toBe('colorful');
    expect(normalizeThemePreference('dark')).toBe('black');
    expect(normalizeThemePreference('contrast')).toBe('system');
    expect(normalizeThemePreference('system')).toBe('system');
    expect(normalizeThemePreference('darkgray')).toBe('darkgray');
    for (const bad of ['', 'verde', 'constructor', 7, null, undefined, {}]) expect(normalizeThemePreference(bad), String(bad)).toBe('system');
  });

  it('«sistema» sigue a Windows y el contraste alto gana a todo', () => {
    expect(resolveTheme('system', false)).toBe('white');
    expect(resolveTheme('system', true)).toBe('black');
    expect(resolveTheme('white', true)).toBe('white');
    for (const p of THEME_PREFERENCES) expect(resolveTheme(p, false, true)).toBe('contrast');
  });

  it('usa los colores medidos en Office', () => {
    expect(zoneColors('writer', 'colorful')['nv-titlebar-bg']).toBe('#185abd');
    expect(zoneColors('calc', 'colorful')['nv-titlebar-bg']).toBe('#107c41');
    expect(zoneColors('slides', 'colorful')['nv-titlebar-bg']).toBe('#c43e1c');
    expect(zoneColors('writer', 'colorful')['nv-search-bg']).toBe('#d0dcee');
    expect(zoneColors('calc', 'colorful')['nv-search-bg']).toBe('#cfe2d8');
    expect(zoneColors('slides', 'colorful')['nv-search-bg']).toBe('#efd7d1');
    expect(zoneColors('writer', 'white')['nv-titlebar-bg']).toBe('#e6e6e6');
    expect(zoneColors('writer', 'darkgray')).toMatchObject({ 'nv-tabs-bg': '#525252', 'nv-status-bg': '#525252', 'nv-tab-line': '#aec6f0' });
    expect(zoneColors('calc', 'black')).toMatchObject({ 'nv-tabs-bg': '#1a1a1a', 'nv-status-bg': '#141414', 'nv-tab-line': '#60bd82' });
    expect(zoneColors('notes', 'colorful')['nv-titlebar-bg']).toBe('#7719aa');
    expect(zoneColors('base', 'colorful')['nv-titlebar-bg']).toBe('#a4373a');
    expect(fluentTheme('colorful', 'writer').colorNeutralBackground1Hover).toBe('#f5f5f5');
    expect(fluentTheme('darkgray', 'writer').colorNeutralBackground1Hover).toBe('#d1d1d1');
    expect(fluentTheme('black', 'writer').colorNeutralBackground1Hover).toBe('#3d3d3d');
    // the ribbon surface comes from the Fluent theme
    expect(fluentTheme('colorful', 'writer').colorNeutralBackground1).toBe('#ffffff');
    expect(fluentTheme('darkgray', 'writer').colorNeutralBackground1).toBe('#bdbdbd');
    expect(fluentTheme('black', 'writer').colorNeutralBackground1).toBe('#292929');
  });

  it('publica los colores de las zonas dentro del tema de Fluent, para menús y cuadros', () => {
    const theme = fluentTheme('black', 'calc') as unknown as Record<string, string>;
    expect(theme['nv-accent']).toBe(MODULE_ACCENTS.calc);
    expect(theme['nv-tabs-bg']).toBe('#1a1a1a');
  });

  it('el texto de cada zona se lee en todas las aplicaciones y temas', () => {
    for (const app of Object.keys(MODULE_ACCENTS)) {
      for (const mode of MODES) {
        const z = zoneColors(app, mode);
        for (const zone of ['titlebar', 'search', 'tabs', 'status', 'canvas'] as const) {
          expect(contrastRatio(z[`nv-${zone}-bg`], z[`nv-${zone}-fg`]), `${app} ${mode} ${zone}`).toBeGreaterThanOrEqual(4.5);
        }
        // quick access buttons keep their icon visible under the mouse
        expect(contrastRatio(z['nv-titlebar-hover'], z['nv-titlebar-fg']), `${app} ${mode} botón de la barra de título`).toBeGreaterThanOrEqual(3);
        // the underline of the active tab has to stand out from the tab strip
        expect(contrastRatio(z['nv-tabs-bg'], z['nv-tab-line']), `${app} ${mode} subrayado`).toBeGreaterThanOrEqual(3);
        const f = fluentTheme(mode, app);
        if (mode !== 'contrast') expect(contrastRatio(f.colorNeutralBackground1, f.colorNeutralForeground1), `${app} ${mode} cinta`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('usa en el marco los estados medidos en Office', () => {
    expect(zoneColors('writer', 'colorful')['nv-titlebar-hover']).toBe('#1651aa');
    expect(zoneColors('writer', 'white')).toMatchObject({ 'nv-titlebar-hover': '#fdfdfd', 'nv-search-border': '#d6d6d6', 'nv-tab-hover': '#d1d1d1', 'nv-pressed-bg': '#ebebeb', 'nv-pressed-border': '#616161', 'nv-field-border': '#8a8a8a' });
    expect(zoneColors('writer', 'darkgray')).toMatchObject({ 'nv-search-border': '#808080', 'nv-tab-hover': '#6b6b6b', 'nv-pressed-bg': '#cccccc', 'nv-pressed-border': '#7a7a7a', 'nv-field-border': '#666666', 'nv-canvas-bg': '#555555' });
    expect(zoneColors('writer', 'black')).toMatchObject({ 'nv-search-border': '#757575', 'nv-tab-hover': '#666666', 'nv-pressed-bg': '#383838', 'nv-pressed-border': '#adadad', 'nv-field-border': '#757575', 'nv-canvas-bg': '#1c1c1c' });
    // disabled ribbon text comes from the Fluent theme
    expect(['colorful', 'darkgray', 'black'].map((m) => fluentTheme(m as ThemeMode, 'writer').colorNeutralForegroundDisabled)).toEqual(['#bdbdbd', '#858585', '#5c5c5c']);
  });

  it('el color de una pestaña contextual se lee sobre las pestañas de cualquier tema', () => {
    // the colours the products give to their contextual tabs
    const used = ['#c05621', '#2b7a4b', '#7a4e9b', '#0e7490', '#0e7c86', '#b45309', '#0f766e', '#be123c', '#7719aa', '#c55a11', '#7b2d8e', '#0f7b6c', '#2e7d32', '#7b3f00', '#2f7d6d', '#b5651d', '#8e44ad', '#7a5195', '#2b6cb0'];
    for (const mode of MODES) {
      const bg = zoneColors('writer', mode)['nv-tabs-bg'];
      for (const color of used) expect(contrastRatio(readableOn(color, bg), bg), `${color} ${mode}`).toBeGreaterThanOrEqual(4.5);
    }
    // a colour that already reads is not touched
    expect(readableOn('#7b2d8e', '#e6e6e6')).toBe('#7b2d8e');
    expect(readableOn('#7b2d8e', '#1a1a1a')).not.toBe('#7b2d8e');
  });

  it('los comandos marcan el tema guardado, también uno antiguo', () => {
    const registry = new CommandRegistry();
    registry.registerAll(coreCommands);
    const checked = () => THEME_PREFERENCES.filter((p) => registry.get(`theme.${p}`)!.checked!());
    settings.set(SETTING_THEME, 'dark');
    expect(checked()).toEqual(['black']);
    registry.run('theme.darkgray');
    expect(settings.get(SETTING_THEME, '')).toBe('darkgray');
    expect(checked()).toEqual(['darkgray']);
    settings.set(SETTING_THEME, 'system');
  });
});
