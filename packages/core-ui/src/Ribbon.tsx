import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Popover, PopoverSurface, PopoverTrigger, Tooltip } from '@fluentui/react-components';
import { Check, ChevronDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCommandState, useCore } from './context';
import { Icon } from './icons';
import { t } from './i18n';
import { layoutGroup, type ButtonItem, type Column, type CustomItem, type DropdownItem, type MenuEntry, type RibbonGroup, type RibbonItem, type RibbonTab } from './ribbon-model';

function KeytipBadge({ itemId }: { itemId: string }) {
  const { tipFor } = useCore();
  const tip = tipFor(itemId);
  return tip ? <span className="nv-keytip" aria-hidden="true">{tip}</span> : null;
}

function CommandTooltip({ commandId, children }: { commandId: string; children: React.ReactElement }) {
  const { def, shortcut } = useCommandState(commandId);
  if (!def) return children;
  const title = shortcut ? `${t(def.label)} (${shortcut})` : t(def.label);
  return (
    <Tooltip
      relationship="description"
      showDelay={600}
      withArrow
      content={
        <div className="nv-tooltip">
          <strong>{title}</strong>
          {def.description && <div>{t(def.description)}</div>}
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

function ButtonView({ item }: { item: ButtonItem }) {
  const { registry } = useCore();
  const { def, enabled, checked } = useCommandState(item.command);
  if (!def) return null;
  const large = item.size === 'large';
  const label = t(def.label);
  return (
    <CommandTooltip commandId={item.command}>
      <button
        type="button"
        className={`nv-btn ${large ? 'nv-btn--large' : 'nv-btn--small'}`}
        data-nv-item={item.command}
        disabled={!enabled}
        aria-pressed={def.checked ? checked : undefined}
        aria-label={label}
        onClick={() => registry.run(item.command)}
      >
        <Icon name={def.icon} size={large ? 28 : 16} />
        {!item.iconOnly && <span className="nv-btn__label">{label}</span>}
        <KeytipBadge itemId={item.command} />
      </button>
    </CommandTooltip>
  );
}

function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  const { registry } = useCore();
  return (
    <MenuList>
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <MenuDivider key={i} />;
        if (entry.kind === 'header') return <div key={i} className="nv-menu-header">{t(entry.label)}</div>;
        const def = registry.get(entry.command);
        if (!def) return null;
        const shortcut = registry.shortcutLabel(entry.command);
        return (
          <MenuItem
            key={entry.command}
            disabled={!registry.isEnabled(entry.command)}
            icon={registry.isChecked(entry.command) ? <Check size={16} /> : def.icon ? <Icon name={def.icon} /> : undefined}
            secondaryContent={shortcut}
            onClick={() => registry.run(entry.command)}
          >
            {t(def.label)}
          </MenuItem>
        );
      })}
    </MenuList>
  );
}

function DropdownView({ item }: { item: DropdownItem }) {
  const { registry } = useCore();
  const large = item.size === 'large';
  const label = t(item.label);
  const primary = item.primaryCommand ? registry.get(item.primaryCommand) : undefined;
  const trigger = (
    <button type="button" className={`nv-btn ${primary && large ? 'nv-btn--chevron' : large ? 'nv-btn--large' : 'nv-btn--small'} nv-btn--menu`} data-nv-item={item.id} aria-label={label} aria-haspopup="menu">
      {!primary && <Icon name={item.icon} size={large ? 28 : 16} />}
      {!primary && <span className="nv-btn__label">{label}</span>}
      <ChevronDown size={12} className="nv-btn__chevron" />
      <KeytipBadge itemId={item.id} />
    </button>
  );
  return (
    <div className={`nv-split ${large ? 'nv-split--large' : ''}`}>
      {primary && (
        <button
          type="button"
          className={`nv-btn ${large ? 'nv-btn--large' : 'nv-btn--small'}`}
          data-nv-item={`${item.id}:primary`}
          disabled={!registry.isEnabled(primary.id)}
          aria-label={t(primary.label)}
          onClick={() => registry.run(primary.id)}
        >
          <Icon name={item.icon ?? primary.icon} size={large ? 28 : 16} />
          {large && <span className="nv-btn__label">{label}</span>}
        </button>
      )}
      <Menu positioning="below-start">
        <MenuTrigger disableButtonEnhancement>{trigger}</MenuTrigger>
        <MenuPopover>
          <MenuEntries entries={item.entries} />
        </MenuPopover>
      </Menu>
    </div>
  );
}

export function RibbonItemView({ item }: { item: Exclude<RibbonItem, { kind: 'separator' }> }) {
  if (item.kind === 'button') return <ButtonView item={item} />;
  if (item.kind === 'dropdown') return <DropdownView item={item} />;
  return <div data-nv-item={item.id} className="nv-custom">{item.render()}<KeytipBadge itemId={item.id} /></div>;
}

function ColumnView({ column }: { column: Column }) {
  switch (column.kind) {
    case 'separator':
      return <div className="nv-col-sep" role="separator" />;
    case 'large':
      return <div className="nv-col nv-col--large"><RibbonItemView item={column.item} /></div>;
    case 'custom':
      return <div className="nv-col"><RibbonItemView item={column.item} /></div>;
    case 'stack':
      return (
        <div className="nv-col nv-col--stack">
          {column.items.map((it: ButtonItem | DropdownItem | CustomItem) => (
            <RibbonItemView key={it.kind === 'button' ? it.command : it.id} item={it} />
          ))}
        </div>
      );
  }
}

function GroupColumns({ group }: { group: RibbonGroup }) {
  return (
    <div className="nv-group__columns">
      {layoutGroup(group.items).map((c, i) => (
        <ColumnView key={i} column={c} />
      ))}
    </div>
  );
}

function GroupView({ group, collapsed }: { group: RibbonGroup; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="nv-group nv-group--collapsed" role="group" aria-label={t(group.label)}>
        <Popover positioning="below-start" trapFocus>
          <PopoverTrigger disableButtonEnhancement>
            <button type="button" className="nv-btn nv-btn--large nv-btn--menu" data-nv-item={`group:${group.id}`} aria-haspopup="dialog">
              <Icon name={group.icon} size={28} />
              <span className="nv-btn__label">{t(group.label)}</span>
              <ChevronDown size={12} className="nv-btn__chevron" />
            </button>
          </PopoverTrigger>
          <PopoverSurface className="nv-group-popover">
            <GroupColumns group={group} />
          </PopoverSurface>
        </Popover>
      </div>
    );
  }
  return (
    <div className="nv-group" role="group" aria-label={t(group.label)}>
      <GroupColumns group={group} />
      <div className="nv-group__label">{t(group.label)}</div>
    </div>
  );
}

/** Group body of the active tab; collapses trailing groups into popover buttons when space runs out. */
export function RibbonBody({ tab }: { tab: RibbonTab }) {
  const ref = useRef<HTMLDivElement>(null);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const [width, setWidth] = useState(0);
  const groups = tab.groups;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth((prev) => (prev === el.clientWidth ? prev : el.clientWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restart the collapse search whenever the available width or the tab changes.
  useLayoutEffect(() => {
    setCollapsedCount(0);
  }, [width, tab.id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth + 1 && collapsedCount < groups.length) {
      setCollapsedCount((c) => c + 1);
    }
  }, [collapsedCount, width, groups]);

  const firstCollapsed = groups.length - collapsedCount;
  const nodes: ReactNode[] = groups.map((g, i) => <GroupView key={g.id} group={g} collapsed={i >= firstCollapsed} />);
  return (
    <div className="nv-ribbon__body" ref={ref} role="tabpanel" aria-label={t(tab.label)}>
      {nodes}
    </div>
  );
}
