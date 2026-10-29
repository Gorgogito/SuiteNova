import type { ReactNode } from 'react';

export type ItemSize = 'large' | 'small';

export interface ButtonItem {
  kind: 'button';
  /** Command id; label, icon, shortcut and state come from the registry. */
  command: string;
  size?: ItemSize;
  /** Show only the icon (small buttons). */
  iconOnly?: boolean;
  keytip?: string;
}

export type MenuEntry =
  | { kind: 'command'; command: string; keytip?: string }
  | { kind: 'separator' }
  | { kind: 'header'; label: string };

export interface DropdownItem {
  kind: 'dropdown';
  id: string;
  label: string;
  icon?: string;
  size?: ItemSize;
  entries: MenuEntry[];
  /** When set, the control is a split button: the main part runs this command. */
  primaryCommand?: string;
  keytip?: string;
}

export interface CustomItem {
  kind: 'custom';
  id: string;
  /** Used for keytip assignment and search. */
  label: string;
  render: () => ReactNode;
  keytip?: string;
}

export interface SeparatorItem {
  kind: 'separator';
}

export type RibbonItem = ButtonItem | DropdownItem | CustomItem | SeparatorItem;

export interface RibbonGroup {
  id: string;
  label: string;
  /** Icon shown when the group collapses into a single button. */
  icon?: string;
  items: RibbonItem[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
  keytip?: string;
  /** Contextual tabs appear only when `visible` is true, with a coloured header. */
  contextual?: { label: string; color: string; visible: boolean };
}

export type Column =
  | { kind: 'large'; item: ButtonItem | DropdownItem }
  | { kind: 'stack'; items: (ButtonItem | DropdownItem | CustomItem)[] }
  | { kind: 'custom'; item: CustomItem }
  | { kind: 'separator' };

/**
 * Pack group items into ribbon columns: large controls get their own column,
 * consecutive small controls are stacked up to three per column.
 */
export function layoutGroup(items: RibbonItem[]): Column[] {
  const columns: Column[] = [];
  let stack: (ButtonItem | DropdownItem | CustomItem)[] = [];
  const flush = () => {
    if (stack.length) columns.push({ kind: 'stack', items: stack });
    stack = [];
  };
  for (const item of items) {
    if (item.kind === 'separator') {
      flush();
      columns.push({ kind: 'separator' });
    } else if (item.kind === 'custom') {
      flush();
      columns.push({ kind: 'custom', item });
    } else if (item.size === 'large') {
      flush();
      columns.push({ kind: 'large', item });
    } else {
      stack.push(item);
      if (stack.length === 3) flush();
    }
  }
  flush();
  return columns;
}

export function allItems(tab: RibbonTab): Exclude<RibbonItem, SeparatorItem>[] {
  return tab.groups.flatMap((g) => g.items).filter((i): i is Exclude<RibbonItem, SeparatorItem> => i.kind !== 'separator');
}

export function itemKey(item: Exclude<RibbonItem, SeparatorItem>): string {
  return item.kind === 'button' ? item.command : item.id;
}
