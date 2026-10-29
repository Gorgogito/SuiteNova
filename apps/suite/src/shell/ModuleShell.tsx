import { AppFrame, clampZoom, CommandRegistry, t, useCore, type RibbonTab } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { helpTab, viewTab, zoomCommands } from '../common';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';

function ShortcutList() {
  const { registry } = useCore();
  const rows = registry
    .all()
    .map((c) => ({ c, sc: registry.shortcutLabel(c.id) }))
    .filter((r) => r.sc);
  return (
    <section className="page">
      <h2>{t('shell.shortcuts.title')}</h2>
      <table className="shortcuts">
        <tbody>
          {rows.map(({ c, sc }) => (
            <tr key={c.id}>
              <td>{t(c.label)}</td>
              <td>
                <kbd>{sc}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Window host for a module that is not implemented yet: real ribbon, theme, zoom, backstage; no editing. */
export function ModuleShell({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const [zoom, setZoom] = useState(100);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const offs = [
      registry.registerAll(zoomCommands(() => zoomRef.current, setZoom, clampZoom)),
      registry.register({
        id: 'help.shortcuts',
        label: 'cmd.help.shortcuts',
        description: 'cmd.help.shortcuts.desc',
        icon: 'keyboard',
        shortcut: 'F1',
        run: () => setShowShortcuts((v) => !v),
        checked: () => showShortcutsRef.current,
      }),
    ];
    fileCommands(registry);
    return () => offs.forEach((o) => o());
  }, [registry]);

  const showShortcutsRef = useRef(showShortcuts);
  showShortcutsRef.current = showShortcuts;
  useEffect(() => registry.invalidate(), [registry, zoom, showShortcuts]);

  const tabs: RibbonTab[] = useMemo(() => [viewTab(), helpTab()], []);

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['zoom.out', 'zoom.in']}
      docTitle={t('shell.docTitle')}
      backstage={backstageEntries(module.name)}
      zoom={{ value: zoom, onChange: setZoom, min: 10, max: 400 }}
    >
      <div className="shell-content" style={{ zoom: zoom / 100 }}>
        <div className="banner" role="note">
          {t('shell.banner', { phase: module.phase })}
        </div>
        {showShortcuts && <ShortcutList />}
      </div>
    </AppFrame>
  );
}
