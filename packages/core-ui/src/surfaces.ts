import { createDarkTheme, createLightTheme, type Theme } from '@fluentui/react-components';
import { brandRamp, mix, readableOn, zoneColors, type ThemeMode } from './theme';

/**
 * Panes, dialogs and the File view have colours of their own: in Dark Gray they are dark under a light ribbon, and in
 * Black the panes are darker than the ribbon. Each one is a Fluent theme whose variables are set again on that container,
 * so everything inside follows. Colours measured on Word: docs/office-temas/MEDIDAS.md.
 */
export type Surface = 'panel' | 'dialog' | 'backstage';

export const SURFACES: readonly Surface[] = ['panel', 'dialog', 'backstage'];

/** Where each surface is in the page. Panes carry the class; dialogs and the File view are ours or Fluent's. */
const SELECTORS: Record<Surface, string> = {
  panel: '.nv-panel',
  dialog: '.fui-DialogSurface',
  // the start window shares them, as the start screen of Office does
  backstage: ':is(.nv-backstage__content, .nv-startpage)',
};

type Shade = 'light' | 'darkgray' | 'black';
const shadeOf = (mode: ThemeMode): Shade => (mode === 'darkgray' || mode === 'black' ? mode : 'light');

/** background, under the mouse, pressed, selected, a second surface (headers) */
const BACKGROUNDS: Record<Surface, Partial<Record<Shade, [string, string, string, string, string]>>> = {
  panel: {
    light: ['#f0f0f0', '#e0e0e0', '#d6d6d6', '#dcdcdc', '#e6e6e6'],
    darkgray: ['#525252', '#636363', '#404040', '#666666', '#474747'],
    black: ['#0a0a0a', '#292929', '#050505', '#333333', '#141414'],
  },
  dialog: {
    darkgray: ['#525252', '#636363', '#404040', '#666666', '#474747'],
  },
  backstage: {
    light: ['#f5f5f5', '#e6e6e6', '#dcdcdc', '#e0e0e0', '#ebebeb'],
    darkgray: ['#525252', '#636363', '#404040', '#666666', '#474747'],
    black: ['#141414', '#292929', '#0a0a0a', '#333333', '#1f1f1f'],
  },
};

/** Boxes and lists, where they are not the ones Fluent would draw. */
const FIELDS: Record<Surface, Partial<Record<Shade, [string, string]>>> = {
  panel: { light: ['#ffffff', '#242424'], darkgray: ['#d4d4d4', '#242424'], black: ['#363636', '#ffffff'] },
  dialog: { darkgray: ['#bdbdbd', '#242424'] },
  backstage: { darkgray: ['#bdbdbd', '#242424'] },
};

/** Colour of the main button and of the links of a surface: the accent, darker in light and light in the dark themes. */
export function surfaceAccent(appId: string, mode: ThemeMode): string {
  const zones = zoneColors(appId, mode);
  return shadeOf(mode) === 'light' ? mix(zones['nv-accent'], '#000000', 0.1) : zones['nv-tab-line'];
}

/** The theme of a surface, or null when Windows high contrast decides. */
export function surfaceTheme(surface: Surface, appId: string, mode: ThemeMode): Theme | null {
  if (mode === 'contrast') return null;
  const shade = shadeOf(mode);
  const dark = shade !== 'light';
  const ramp = brandRamp(zoneColors(appId, mode)['nv-accent']);
  const base = dark ? createDarkTheme(ramp) : createLightTheme(ramp);
  const accent = surfaceAccent(appId, mode);
  const away = (amount: number) => mix(accent, dark ? '#ffffff' : '#000000', amount);
  const theme: Theme = {
    ...base,
    // the main button: measured colours, with black text on the light accent of the dark themes
    colorBrandBackground: accent,
    colorBrandBackgroundHover: away(0.12),
    colorBrandBackgroundPressed: away(0.24),
    colorNeutralForegroundOnBrand: dark ? '#000000' : '#ffffff',
  };
  const bg = BACKGROUNDS[surface][shade];
  if (bg) {
    const [rest, hover, pressed, selected, second] = bg;
    Object.assign(theme, {
      colorNeutralBackground1: rest,
      colorNeutralBackground1Hover: hover,
      colorNeutralBackground1Pressed: pressed,
      colorNeutralBackground1Selected: selected,
      colorNeutralBackground2: rest,
      colorNeutralBackground2Hover: hover,
      colorNeutralBackground2Pressed: pressed,
      colorNeutralBackground2Selected: selected,
      colorNeutralBackground3: second,
      colorNeutralBackground3Hover: hover,
      colorNeutralBackground4: second,
      colorSubtleBackgroundHover: hover,
      colorSubtleBackgroundPressed: pressed,
      colorSubtleBackgroundSelected: selected,
    } satisfies Partial<Theme>);
  }
  const surfaceColor = theme.colorNeutralBackground1;
  const link = readableOn(accent, surfaceColor);
  Object.assign(theme, {
    colorBrandForeground1: link,
    colorBrandForegroundLink: link,
    colorCompoundBrandForeground1: link,
  } satisfies Partial<Theme>);
  if (shade === 'light' && surface === 'panel') {
    theme.colorNeutralForeground3 = '#555555';
    theme.colorNeutralForeground4 = '#616161';
  }
  if (shade === 'darkgray') {
    Object.assign(theme, {
      colorNeutralForeground1: '#ffffff',
      colorNeutralForeground2: '#ffffff',
      colorNeutralForeground3: '#e0e0e0',
      colorNeutralForeground4: '#cccccc',
      colorNeutralForegroundDisabled: '#999999',
      colorNeutralStroke1: '#8a8a8a',
      colorNeutralStroke2: '#6b6b6b',
      colorNeutralStroke3: '#636363',
      colorNeutralStrokeAccessible: '#d1d1d1',
      // status texts light enough for a middle gray
      colorPaletteRedForeground1: '#ffc2c6',
      colorPaletteGreenForeground1: '#b6ecb6',
      colorPaletteDarkOrangeForeground1: '#ffcfae',
      colorPaletteMarigoldForeground2: '#ffe08a',
    } satisfies Partial<Theme>);
  }
  return theme;
}

const variables = (values: object) =>
  Object.entries(values)
    .map(([name, value]) => `--${name}:${String(value)};`)
    .join('');

const BOXES = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="button"]):not([type="submit"]):not([type="file"])',
  'textarea',
  'select',
  '.fui-Input',
  '.fui-Textarea',
  '.fui-Combobox',
  '.fui-Dropdown',
  '.fui-SpinButton',
].join(',');

/** The style sheet that gives every surface its colours. */
export function surfaceCss(appId: string, mode: ThemeMode): string {
  const rules: string[] = [];
  const shade = shadeOf(mode);
  for (const surface of SURFACES) {
    const theme = surfaceTheme(surface, appId, mode);
    if (!theme) continue;
    const where = SELECTORS[surface];
    rules.push(`${where}{${variables(theme)}color-scheme:${shade === 'light' ? 'light' : 'dark'};}`);
    const field = FIELDS[surface][shade];
    if (field) {
      const [background, text] = field;
      const light = text !== '#ffffff';
      const values: Partial<Theme> = {
        colorNeutralBackground1: background,
        colorNeutralForeground1: text,
        colorNeutralForeground2: text,
        colorNeutralForeground3: light ? '#383838' : '#d6d6d6',
        colorNeutralForeground4: light ? '#424242' : '#c2c2c2',
        ...(light ? { colorNeutralStroke1: '#666666', colorNeutralStrokeAccessible: '#424242', colorSubtleBackgroundHover: '#c2c2c2' } : {}),
      };
      // :is carries more weight than a style sheet that lets its boxes inherit the (light) text of the pane
      rules.push(`${where} :is(${BOXES}){${variables(values)}color-scheme:${light ? 'light' : 'dark'};background-color:${background};color:${text};}`);
    }
  }
  // the other buttons of a dialog keep the colour of the ribbon in Dark Gray, and a visible border in Black
  if (mode === 'darkgray') {
    rules.push(`.fui-DialogActions .fui-Button{${variables({ colorNeutralBackground1: '#bdbdbd', colorNeutralBackground1Hover: '#d1d1d1', colorNeutralBackground1Pressed: '#a8a8a8', colorNeutralForeground1: '#242424', colorNeutralForeground1Hover: '#242424', colorNeutralForeground1Pressed: '#242424', colorNeutralStroke1: '#666666', colorNeutralStroke1Hover: '#4d4d4d' })}}`);
  }
  if (mode === 'black') {
    rules.push(`.fui-DialogActions .fui-Button{${variables({ colorNeutralStroke1: '#757575' })}}`);
  }
  return rules.join('\n');
}
