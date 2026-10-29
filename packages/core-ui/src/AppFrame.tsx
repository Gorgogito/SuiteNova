import { FluentProvider } from '@fluentui/react-components';
import { PanelTopClose, PanelTopOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Backstage, type BackstageEntry } from './Backstage';
import { RibbonTabStrip } from './TabStrip';
import { RibbonBody } from './Ribbon';
import { StatusBar, type ZoomState } from './StatusBar';
import { TellMe } from './TellMe';
import { CoreProvider } from './context';
import { coreCommands, SETTING_LOCALE, SETTING_RIBBON_COLLAPSED, SETTING_THEME } from './core-commands';
import type { CommandRegistry } from './commands';
import { Icon } from './icons';
import { getLocale, setLocale, t, useLocale, type Locale } from './i18n';
import { assignKeytips, KEYTIPS_OFF, typeKeytip, type KeytipState, type KeytipTarget } from './keytips';
import './messages';
import { allItems, itemKey, type RibbonTab } from './ribbon-model';
import { settings, useSetting } from './settings';
import { fluentTheme, MODULE_ACCENTS, resolveTheme, type ThemeMode, type ThemePreference } from './theme';
import './core-ui.css';

export function useThemeMode(): ThemeMode {
  const [pref] = useSetting<ThemePreference>(SETTING_THEME, 'system');
  const dark = useMedia('(prefers-color-scheme: dark)');
  const contrast = useMedia('(forced-colors: active)');
  return resolveTheme(pref, dark, contrast);
}

export interface AppFrameProps {
  appId: string;
  appName: string;
  registry: CommandRegistry;
  tabs: RibbonTab[];
  /** Command ids shown in the quick access toolbar. */
  qat?: string[];
  docTitle?: string;
  backstage?: BackstageEntry[];
  zoom?: ZoomState;
  statusLeft?: ReactNode;
  statusRight?: ReactNode;
  /** Content fills the area and manages its own scrolling (spreadsheets, canvases). */
  contentFill?: boolean;
  children: ReactNode;
}

function useMedia(query: string): boolean {
  const mql = useMemo(() => (typeof matchMedia === 'function' ? matchMedia(query) : null), [query]);
  return useSyncExternalStore(
    (cb) => {
      mql?.addEventListener('change', cb);
      return () => mql?.removeEventListener('change', cb);
    },
    () => mql?.matches ?? false,
  );
}

function clickItem(itemId: string): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-nv-item]')) {
    if (el.dataset.nvItem === itemId) {
      el.click();
      el.focus();
      return;
    }
  }
}

export function AppFrame(props: AppFrameProps) {
  const { appId, appName, registry, tabs, qat = [], docTitle, backstage = [], zoom, statusLeft, statusRight, contentFill, children } = props;
  useLocale();
  const [themePref] = useSetting<ThemePreference>(SETTING_THEME, 'system');
  const [localeSetting] = useSetting<Locale>(SETTING_LOCALE, 'es');
  const [collapsed] = useSetting(SETTING_RIBBON_COLLAPSED, false);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const systemContrast = useMedia('(forced-colors: active)');
  const mode = resolveTheme(themePref, systemDark, systemContrast);
  const accent = MODULE_ACCENTS[appId] ?? MODULE_ACCENTS.hub!;

  const visibleTabs = useMemo(() => tabs.filter((tab) => !tab.contextual || tab.contextual.visible), [tabs]);
  const [activeId, setActiveId] = useState(visibleTabs[0]?.id ?? '');
  const activeTab = visibleTabs.find((x) => x.id === activeId) ?? visibleTabs[0];
  const [backstageOpen, setBackstageOpen] = useState(false);
  const [popped, setPopped] = useState(false);
  const [keytips, setKeytips] = useState<KeytipState>(KEYTIPS_OFF);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => registry.registerAll(coreCommands), [registry]);
  useEffect(() => {
    if (getLocale() !== localeSetting) setLocale(localeSetting);
  }, [localeSetting]);
  useEffect(() => {
    document.title = docTitle ? `${docTitle} – ${appName}` : appName;
  }, [docTitle, appName]);

  // ---- keytips (Alt navigation) ------------------------------------------------------------
  const tabTips = useMemo(
    () =>
      assignKeytips([
        { id: 'file', label: t('ribbon.file'), preferred: t('ribbon.fileKeytip') },
        ...visibleTabs.map((x) => ({ id: x.id, label: t(x.label), preferred: x.keytip })),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTabs, localeSetting],
  );
  const itemTips = useMemo(() => {
    if (!activeTab) return new Map<string, string>();
    return assignKeytips(
      allItems(activeTab).map((it) => ({
        id: itemKey(it),
        label: it.kind === 'button' ? t(registry.get(it.command)?.label ?? it.command) : t(it.label),
        preferred: it.keytip,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, registry, localeSetting]);

  const openTab = (id: string) => {
    setActiveId(id);
    if (collapsed) setPopped(true);
  };

  const tabTargets: KeytipTarget[] = [
    { tip: tabTips.get('file') ?? 'A', activate: () => setBackstageOpen(true) },
    ...visibleTabs.map((x) => ({ tip: tabTips.get(x.id) ?? '', activate: () => openTab(x.id) })),
  ];
  const itemTargets: KeytipTarget[] = [...itemTips].map(([id, tip]) => ({ tip, activate: () => clickItem(id) }));

  const stateRef = useRef({ keytips, tabTargets, itemTargets, activeTab, visibleTabs });
  stateRef.current = { keytips, tabTargets, itemTargets, activeTab, visibleTabs };

  useEffect(() => {
    let altAlone = false;
    const onKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (e.key === 'Alt') {
        if (!e.repeat) altAlone = true;
        if (s.keytips.level !== 'off') {
          setKeytips(KEYTIPS_OFF);
          altAlone = false;
        }
        return;
      }
      altAlone = false;
      if (s.keytips.level !== 'off') {
        if (e.key === 'Escape') {
          e.preventDefault();
          setKeytips(s.keytips.level === 'items' ? { level: 'tabs', buffer: '' } : KEYTIPS_OFF);
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const targets = s.keytips.level === 'tabs' ? s.tabTargets : s.itemTargets;
          const res = typeKeytip(s.keytips, e.key, targets, (target) => {
            target.activate();
            // Choosing a tab moves to its item tips; choosing an item/File ends the mode.
            const tabHit = s.keytips.level === 'tabs' && s.tabTargets.includes(target) && target !== s.tabTargets[0];
            if (!tabHit) return KEYTIPS_OFF;
            const idx = s.tabTargets.indexOf(target) - 1;
            return { level: 'items', tabId: s.visibleTabs[idx]?.id ?? '', buffer: '' };
          });
          setKeytips(res.state);
          return;
        }
        setKeytips(KEYTIPS_OFF);
      }
      registry.handleKeyEvent(e);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && altAlone) {
        e.preventDefault(); // keep the browser/WebView from focusing its own menu
        altAlone = false;
        setKeytips({ level: 'tabs', buffer: '' });
      }
    };
    const onPointerDown = () => setKeytips(KEYTIPS_OFF);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [registry]);

  // Collapsed ribbon: a clicked tab shows the body as a popup until the user clicks elsewhere or presses Esc.
  useEffect(() => {
    if (!collapsed) setPopped(false);
  }, [collapsed]);
  useEffect(() => {
    if (!popped) return;
    const close = (e: Event) => {
      const el = e.target as Node | null;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !frameRef.current?.querySelector('.nv-ribbon')?.contains(el)) {
        setPopped(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [popped]);

  const tipFor = (id: string): string | undefined => {
    if (keytips.level === 'tabs') {
      if (!id.startsWith('tab:')) return undefined;
      const tip = tabTips.get(id.slice(4));
      return tip?.startsWith(keytips.buffer) ? tip : undefined;
    }
    if (keytips.level === 'items') {
      const tip = itemTips.get(id);
      return tip?.startsWith(keytips.buffer) ? tip : undefined;
    }
    return undefined;
  };

  const showBody = !collapsed || popped;

  return (
    <FluentProvider theme={fluentTheme(mode, accent)} data-theme={mode} data-app={appId} style={{ ['--nv-accent' as string]: accent }}>
      <CoreProvider value={{ registry, keytips, tipFor }}>
        <div className="nv-root">
        <div className="nv-frame" ref={frameRef}>
          <header className="nv-titlebar">
            <div className="nv-qat" role="toolbar" aria-label={t('qat.label')}>
              {qat.map((id) => (
                <QatButton key={id} id={id} registry={registry} />
              ))}
            </div>
            <div className="nv-title">{docTitle ? `${docTitle} – ${appName}` : appName}</div>
            <TellMe />
          </header>
          <div className="nv-ribbon">
            <div className={`nv-ribbon__tabs ${visibleTabs.some((v) => v.contextual) ? 'has-ctx' : ''}`}>
              <RibbonTabStrip
                tabs={visibleTabs}
                activeId={activeTab?.id ?? ''}
                onSelect={openTab}
                onFile={() => setBackstageOpen(true)}
                onDoubleClick={() => registry.run('view.toggleRibbon')}
              />
              <button
                type="button"
                className="nv-ribbon__pin"
                title={collapsed ? t('ribbon.expand') : t('ribbon.collapse')}
                aria-label={collapsed ? t('ribbon.expand') : t('ribbon.collapse')}
                onClick={() => registry.run('view.toggleRibbon')}
              >
                {collapsed ? <PanelTopOpen size={16} /> : <PanelTopClose size={16} />}
              </button>
            </div>
            {showBody && activeTab && (
              <div className={collapsed ? 'nv-ribbon__popup' : 'nv-ribbon__pinned'}>
                <RibbonBody tab={activeTab} />
              </div>
            )}
          </div>
          <main className={`nv-content ${contentFill ? 'nv-content--fill' : ''}`}>{children}</main>
          <StatusBar left={statusLeft} right={statusRight} zoom={zoom} />
          <Backstage open={backstageOpen} entries={backstage} onClose={() => setBackstageOpen(false)} />
        </div>
        </div>
      </CoreProvider>
    </FluentProvider>
  );
}

function QatButton({ id, registry }: { id: string; registry: CommandRegistry }) {
  useSyncExternalStore(registry.subscribe, registry.getVersion);
  const def = registry.get(id);
  if (!def) return null;
  const sc = registry.shortcutLabel(id);
  const label = sc ? `${t(def.label)} (${sc})` : t(def.label);
  return (
    <button type="button" className="nv-qat__btn" title={label} aria-label={t(def.label)} disabled={!registry.isEnabled(id)} onClick={() => registry.run(id)}>
      <Icon name={def.icon} size={16} />
    </button>
  );
}

export { settings };
