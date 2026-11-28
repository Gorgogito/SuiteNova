import { t, type CommandRegistry } from '@suitenova/core-ui';
import { CATEGORIES, STENCILS } from '@suitenova/diagram-core';
import type { MenuItem } from '../mail/ContextMenu';
import { ARROWS, ROUTINGS, type DiagramUI } from './commands';
import type { MenuTarget } from './Stage';

/** The menu of the secondary button: commands of the registry, chosen by what was clicked. */
export function contextMenu(ui: DiagramUI, registry: CommandRegistry, target: MenuTarget): MenuItem[] {
  const cmd = (id: string, label?: string): MenuItem => {
    const def = registry.get(id)!;
    return { label: t(label ?? def.label), run: () => void registry.run(id), disabled: !registry.isEnabled(id), ...(def.checked ? { checked: def.checked() } : {}), hint: registry.shortcutLabel(id) };
  };
  const sub = (label: string, items: MenuItem[], disabled = false): MenuItem => ({ label: t(label), sub: items, disabled });
  // what is pasted from a menu goes where the menu was opened
  const paste: MenuItem = { label: t('Pegar'), run: () => void ui.paste(target.point), hint: 'Ctrl+V' };
  const clipboard: MenuItem[] = [cmd('diagram.cut'), cmd('diagram.copy'), paste, cmd('diagram.duplicate'), cmd('diagram.delete')];
  const format: MenuItem[] = [cmd('diagram.format.painter'), cmd('diagram.format.copy'), cmd('diagram.format.paste')];

  if (target.kind === 'guide') {
    return [{ label: t('Quitar la guía'), run: () => ui.ctl.removeGuideById(target.id!) }, cmd('diagram.guides.clear'), 'separator', cmd('diagram.guides.show')];
  }
  if (target.kind === 'connector') {
    return [
      ...clipboard,
      'separator',
      cmd('diagram.edittext'),
      sub('Tipo de conector', ROUTINGS.map(([r]) => cmd(`diagram.routing.${r}`))),
      sub('Extremo inicial', ARROWS.map(([a]) => cmd(`diagram.arrowStart.${a}`))),
      sub('Extremo final', ARROWS.map(([a]) => cmd(`diagram.arrowEnd.${a}`))),
      'separator',
      ...format,
      cmd('diagram.size.pane'),
    ];
  }
  if (target.kind === 'shape') {
    const shapes = CATEGORIES.filter((c) => c.id !== 'extra').map((c) => sub(c.name, STENCILS.filter((s) => s.category === c.id).map((s) => cmd(`diagram.change.${s.id}`, s.name))));
    return [
      ...clipboard,
      'separator',
      cmd('diagram.edittext'),
      sub('Cambiar forma', shapes, !registry.isEnabled('diagram.change.rect') && !registry.isEnabled('diagram.change.ellipse')),
      ...format,
      'separator',
      sub('Orden de apilado', ['diagram.front', 'diagram.forward', 'diagram.backward', 'diagram.back'].map((id) => cmd(id))),
      sub('Agrupar', [cmd('diagram.group'), cmd('diagram.ungroup'), cmd('diagram.container.wrap')]),
      sub('Reflejar y girar', ['diagram.rotate.right', 'diagram.rotate.left', 'diagram.flip.h', 'diagram.flip.v'].map((id) => cmd(id))),
      'separator',
      cmd('diagram.link'),
      cmd('diagram.data.pane'),
      cmd('diagram.comment.new'),
      cmd('diagram.size.pane'),
    ];
  }
  return [
    paste,
    cmd('diagram.selectAll'),
    'separator',
    cmd('diagram.rulers.show'),
    cmd('diagram.guides.show'),
    cmd('diagram.grid.show'),
    cmd('diagram.grid.snap'),
    cmd('diagram.snap.smart'),
    cmd('diagram.autoconnect'),
    ...(ui.ctl.basePage.guides?.length ? [cmd('diagram.guides.clear')] : []),
    'separator',
    cmd('diagram.find'),
    cmd('diagram.page.setup'),
  ];
}
