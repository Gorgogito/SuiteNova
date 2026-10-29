import type { CommandDef } from './commands';
import { setLocale, type Locale } from './i18n';
import { settings } from './settings';
import type { ThemePreference } from './theme';

export const SETTING_THEME = 'theme';
export const SETTING_LOCALE = 'locale';
export const SETTING_RIBBON_COLLAPSED = 'ribbonCollapsed';

const themeCommand = (pref: ThemePreference, icon: string): CommandDef => ({
  id: `theme.${pref}`,
  label: `cmd.theme.${pref}`,
  icon,
  run: () => settings.set(SETTING_THEME, pref),
  checked: () => settings.get<ThemePreference>(SETTING_THEME, 'system') === pref,
});

const localeCommand = (locale: Locale): CommandDef => ({
  id: `lang.${locale}`,
  label: `cmd.lang.${locale}`,
  icon: 'language',
  run: () => {
    settings.set(SETTING_LOCALE, locale);
    setLocale(locale);
  },
  checked: () => settings.get<Locale>(SETTING_LOCALE, 'es') === locale,
});

/** Commands every module gets: ribbon pinning, command search, themes and language. */
export const coreCommands: CommandDef[] = [
  {
    id: 'view.toggleRibbon',
    label: 'cmd.view.toggleRibbon',
    description: 'cmd.view.toggleRibbon.desc',
    icon: 'ribbonCollapse',
    shortcut: 'Ctrl+F1',
    run: () => settings.set(SETTING_RIBBON_COLLAPSED, !settings.get(SETTING_RIBBON_COLLAPSED, false)),
    checked: () => settings.get(SETTING_RIBBON_COLLAPSED, false),
  },
  {
    id: 'tellme.focus',
    label: 'cmd.tellme.focus',
    icon: 'search',
    shortcut: 'Alt+Q',
    run: () => document.getElementById('nv-tellme')?.focus(),
  },
  themeCommand('system', 'monitor'),
  themeCommand('light', 'sun'),
  themeCommand('dark', 'moon'),
  themeCommand('contrast', 'contrast'),
  localeCommand('es'),
  localeCommand('en'),
];
