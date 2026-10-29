import { useCore } from './context';
import { t } from './i18n';
import type { RibbonTab } from './ribbon-model';

interface Props {
  tabs: RibbonTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onFile: () => void;
  onDoubleClick: () => void;
}

function Tip({ id }: { id: string }) {
  const { tipFor } = useCore();
  const tip = tipFor(id);
  return tip ? <span className="nv-keytip nv-keytip--tab" aria-hidden="true">{tip}</span> : null;
}

/** File button + ribbon tabs, with arrow-key navigation (roving tabindex) and contextual tab headers. */
export function RibbonTabStrip({ tabs, activeId, onSelect, onFile, onDoubleClick }: Props) {
  const move = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (target) {
      onSelect(target.id);
      requestAnimationFrame(() => document.getElementById(`nv-tab-${target.id}`)?.focus());
    }
  };

  return (
    <div className="nv-tabstrip" role="tablist" aria-label={t('ribbon.tabs')}>
      <button type="button" className="nv-tab nv-tab--file" onClick={onFile}>
        {t('ribbon.file')}
        <Tip id="tab:file" />
      </button>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          id={`nv-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          className={`nv-tab ${tab.id === activeId ? 'is-active' : ''} ${tab.contextual ? 'nv-tab--contextual' : ''}`}
          style={tab.contextual ? { ['--nv-ctx' as string]: tab.contextual.color } : undefined}
          onClick={() => onSelect(tab.id)}
          onDoubleClick={onDoubleClick}
          onKeyDown={(e) => move(e, i)}
        >
          {tab.contextual && <span className="nv-tab__ctx">{t(tab.contextual.label)}</span>}
          {t(tab.label)}
          <Tip id={`tab:${tab.id}`} />
        </button>
      ))}
    </div>
  );
}
