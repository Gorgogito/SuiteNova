import { AppFrame, CommandRegistry, Icon, t, useSetting, type RibbonTab } from '@suitenova/core-ui';
import { clearRecents, type RecentFile } from '../recents';
import { useEffect, useMemo } from 'react';
import { helpTab, viewTab } from '../common';
import { MODULES } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { openModuleWindow } from '../platform';

export function Hub() {
  const registry = useMemo(() => new CommandRegistry(), []);
  const [recents] = useSetting<RecentFile[]>('recents', []);

  useEffect(() => {
    fileCommands(registry);
    const offs = [
      registry.registerAll(
        MODULES.map((m) => ({
          id: `open.${m.id}`,
          label: m.name,
          description: m.purpose,
          icon: m.icon,
          run: () => void openModuleWindow(m.id, m.name).catch((e) => console.error('No se pudo abrir el módulo', e)),
        })),
      ),
    ];
    return () => offs.forEach((o) => o());
  }, [registry]);

  const tabs: RibbonTab[] = useMemo(
    () => [
      {
        id: 'home',
        label: 'tab.home',
        keytip: 'I',
        groups: [
          {
            id: 'open',
            label: 'group.open',
            icon: 'new',
            items: MODULES.map((m) => ({ kind: 'button' as const, command: `open.${m.id}`, size: 'large' as const })),
          },
        ],
      },
      viewTab({ zoom: false }),
      helpTab({ shortcuts: false }),
    ],
    [],
  );

  return (
    <AppFrame appId="hub" appName={t('app.hub')} registry={registry} tabs={tabs} backstage={backstageEntries(t('app.hub'))}>
      <div className="hub">
        <h1>{t('hub.title')}</h1>
        <h2>{t('hub.apps')}</h2>
        <div className="hub__grid">
          {MODULES.map((m) => (
            <button key={m.id} type="button" className="hub__card" data-app={m.id} onClick={() => registry.run(`open.${m.id}`)}>
              <Icon name={m.icon} size={32} />
              <strong>{m.name}</strong>
              <span>{t(m.purpose)}</span>
              <em>{m.available ? t('hub.available') : t('hub.phase', { phase: m.phase })}</em>
            </button>
          ))}
        </div>
        <h2>{t('hub.recent')}</h2>
        {recents.length === 0 ? (
          <p className="hub__empty">{t('hub.recent.empty')}</p>
        ) : (
          <>
            <ul className="hub__recents">
              {recents.map((r) => (
                <li key={r.path}>
                  <button type="button" title={r.path} aria-label={t('hub.recent.open', { name: r.name })} onClick={() => void openModuleWindow(r.app, r.name, r.path)}>
                    <strong>{r.name}</strong>
                    <span>{r.path}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="hub__clear" onClick={() => clearRecents()}>
              {t('hub.recent.clear')}
            </button>
          </>
        )}
      </div>
    </AppFrame>
  );
}
