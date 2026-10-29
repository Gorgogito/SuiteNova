export { AppFrame, useThemeMode, type AppFrameProps } from './AppFrame';
export { Backstage, type BackstageEntry, type BackstageProps } from './Backstage';
export { CommandRegistry, formatShortcut, matchesShortcut, normalizeText, parseShortcut, type CommandDef } from './commands';
export { useCommandState, useCore } from './context';
export { coreCommands, SETTING_LOCALE, SETTING_RIBBON_COLLAPSED, SETTING_THEME } from './core-commands';
export { Icon, registerIcon, type IconComponent } from './icons';
export { getLocale, registerMessages, setLocale, t, useLocale, type Locale } from './i18n';
export { assignKeytips, typeKeytip, type KeytipState } from './keytips';
export {
  layoutGroup,
  type ButtonItem,
  type Column,
  type CustomItem,
  type DropdownItem,
  type MenuEntry,
  type RibbonGroup,
  type RibbonItem,
  type RibbonTab,
} from './ribbon-model';
export { SettingsStore, settings, useSetting, type KeyValueBackend } from './settings';
export { clampZoom, StatusBar, ZoomControl, type ZoomState } from './StatusBar';
export { brandRamp, fluentTheme, MODULE_ACCENTS, resolveTheme, type ThemeMode, type ThemePreference } from './theme';
export { RibbonItemView } from './Ribbon';
