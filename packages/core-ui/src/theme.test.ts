import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './commands';
import { coreCommands, SETTING_THEME } from './core-commands';
import { settings } from './settings';
import { fluentTheme, MODULE_ACCENTS, normalizeThemePreference, resolveTheme, THEME_PREFERENCES, zoneColors, type ThemeMode } from './theme';

const MODES: ThemeMode[] = ['colorful', 'darkgray', 'black', 'white', 'contrast'];

/** WCAG 2 contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

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
        for (const zone of ['titlebar', 'search', 'tabs', 'status'] as const) {
          expect(contrast(z[`nv-${zone}-bg`], z[`nv-${zone}-fg`]), `${app} ${mode} ${zone}`).toBeGreaterThanOrEqual(4.5);
        }
        // the underline of the active tab has to stand out from the tab strip
        expect(contrast(z['nv-tabs-bg'], z['nv-tab-line']), `${app} ${mode} subrayado`).toBeGreaterThanOrEqual(3);
        const f = fluentTheme(mode, app);
        if (mode !== 'contrast') expect(contrast(f.colorNeutralBackground1, f.colorNeutralForeground1), `${app} ${mode} cinta`).toBeGreaterThanOrEqual(4.5);
      }
    }
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
