import { t } from '@suitenova/core-ui';
import { FOLLOW_PRESETS, categoriesOf, categoryHex, hasCategory, isFollowed, isSafeSender, presetDue, quickStepsOf, type MailRecord, type Rule } from '@suitenova/mail-core';
import { categoryLabel } from './CategoryViews';
import type { OpenDialog } from './commands';
import type { MenuItem } from './ContextMenu';
import type { MailCtl } from './ctl';

/* The entries to categorise, follow up, run quick steps and deal with junk mail, shared by menus and the ribbon. */

export function categoryItems(ctl: MailCtl, open: OpenDialog): MenuItem[] {
  const records = ctl.selectedRecords;
  const ids = ctl.selectedIds();
  const listed = categoriesOf(ctl.data).map((c) => c.name);
  // also the ones the messages have and the list does not
  const extra = [...new Set(records.flatMap((m) => m.categories ?? []))].filter((n) => !listed.some((x) => x.toLowerCase() === n.toLowerCase()));
  return [
    ...[...listed, ...extra].map((name): MenuItem => {
      const all = records.length > 0 && records.every((m) => hasCategory(m, name));
      return { label: categoryLabel(name), color: categoryHex(ctl.data, name), checked: all, disabled: !records.length, run: () => ctl.categorize(ids, name, !all) };
    }),
    'separator',
    { label: t('Quitar todas las categorías'), disabled: !records.some((m) => m.categories?.length), run: () => ctl.clearCategories(ids) },
    { label: t('Administrar categorías…'), run: () => open('categories') },
  ];
}

export function followItems(ctl: MailCtl, open: OpenDialog): MenuItem[] {
  const records = ctl.selectedRecords;
  const ids = ctl.selectedIds();
  const none = !records.length;
  return [
    ...FOLLOW_PRESETS.map((p): MenuItem => ({ label: t(p.label), disabled: none, run: () => ctl.followMany(ids, presetDue(p.id, Date.now())) })),
    { label: t('Fecha y aviso…'), disabled: none, run: () => open('follow', { ids }) },
    'separator',
    { label: t('Marcar como completado'), disabled: !records.some((m) => m.flagged || m.follow?.done === undefined), run: () => ctl.completeMany(ids) },
    { label: t('Quitar la marca'), disabled: !records.some(isFollowed), run: () => ctl.setFlagMany(ids, false) },
  ];
}

export function stepItems(ctl: MailCtl, open: OpenDialog): MenuItem[] {
  return [
    ...quickStepsOf(ctl.data).map((s, i): MenuItem => ({ label: t(s.name), hint: i < 9 ? t('Ctrl+Mayús+{n}', { n: i + 1 }) : undefined, disabled: !!ctl.organize.stepProblem(s), run: () => ctl.organize.runStep(s.id) })),
    'separator',
    { label: t('Administrar pasos rápidos…'), run: () => open('quickSteps') },
  ];
}

/** A rule to start from a message: what comes from its sender goes to a folder. */
export const ruleFrom = (m: MailRecord): Rule => ({
  id: '',
  name: t('Mensajes de {name}', { name: m.from || m.fromEmail }).slice(0, 100),
  enabled: true,
  conditions: [{ kind: 'from', words: [m.fromEmail || m.from] }],
  exceptions: [],
  actions: [{ kind: 'move', folder: 'archive' }],
  stop: true,
});

export function ruleItems(ctl: MailCtl, open: OpenDialog): MenuItem[] {
  const one = ctl.single;
  return [
    { label: t('Crear una regla con este mensaje…'), disabled: !one?.fromEmail, run: () => one && open('rules', { rule: ruleFrom(one) }) },
    { label: t('Administrar y ejecutar reglas…'), run: () => open('rules') },
  ];
}

export function junkItems(ctl: MailCtl, open: OpenDialog): MenuItem[] {
  const own = ctl.ownAddresses();
  const records = ctl.selectedRecords.filter((m) => m.fromEmail && !own.has(m.fromEmail.toLowerCase()));
  const ids = records.map((m) => m.id);
  const inJunk = records.some((m) => m.folder === 'junk');
  const say = (text: string) => {
    ctl.syncMessage = text;
    ctl.touch();
  };
  return [
    {
      label: t('Bloquear remitente'),
      disabled: !records.length,
      run: () => {
        const done = ctl.organize.block(ids);
        if (done.length) say(t('Remitentes bloqueados: {list}. Sus mensajes nuevos irán a Correo no deseado.', { list: done.join(', ') }));
      },
    },
    {
      label: inJunk ? t('No es correo no deseado') : t('No bloquear nunca a este remitente'),
      disabled: !records.length || (!inJunk && records.every((m) => isSafeSender(ctl.data, m.fromEmail))),
      run: () => {
        const done = ctl.organize.trust(ids);
        if (done.length) say(t('Remitentes seguros: {list}.', { list: done.join(', ') }));
      },
    },
    'separator',
    { label: t('Remitentes bloqueados y seguros…'), run: () => open('junk') },
  ];
}
