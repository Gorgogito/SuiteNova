import { Icon, t } from '@suitenova/core-ui';
import { ChevronDown } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { MailUI } from './commands';
import type { MenuItem } from './ContextMenu';

/**
 * A button of the ribbon that opens a menu made at that moment (the categories, the quick steps…). The menu is drawn by
 * the program, not here: a folded group moves what is inside it and closes when the focus leaves it.
 */
export function RibbonMenu({ ui, label, icon, enabled, items }: { ui: MailUI; label: string; icon: string; enabled: () => boolean; items: () => MenuItem[] }) {
  useSyncExternalStore(ui.ctl.subscribe, ui.ctl.getVersion);
  return (
    <button
      type="button"
      className="nv-btn nv-btn--small nv-btn--menu"
      aria-label={t(label)}
      aria-haspopup="menu"
      disabled={!enabled()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        ui.showMenu({ x: r.left, y: r.bottom + 2, label: t(label), items: items() });
      }}
    >
      <Icon name={icon} size={16} />
      <span className="nv-btn__label">{t(label)}</span>
      <ChevronDown size={12} className="nv-btn__chevron" />
    </button>
  );
}
