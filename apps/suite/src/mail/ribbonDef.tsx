import { registerIcon, t, type RibbonGroup, type RibbonTab } from '@suitenova/core-ui';
import { folderRows } from '@suitenova/mail-core';
import { Archive, Ban, CalendarPlus, Contact, Flag, Forward, MailOpen, MailPlus, PanelRight, Reply, ReplyAll, UserPlus } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { helpTab, viewTab } from '../common';
import type { MailUI } from './commands';
import './icons';

registerIcon('archive', Archive);
registerIcon('ban', Ban);
registerIcon('calendarPlus', CalendarPlus);
registerIcon('contacts', Contact);
registerIcon('flag', Flag);
registerIcon('forward', Forward);
registerIcon('mailOpen', MailOpen);
registerIcon('mailNew', MailPlus);
registerIcon('panelRight', PanelRight);
registerIcon('reply', Reply);
registerIcon('replyAll', ReplyAll);
registerIcon('userPlus', UserPlus);

function MoveSelect({ ui }: { ui: MailUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  const m = c.selected;
  return (
    <select
      className="nv-select"
      style={{ width: 150 }}
      aria-label={t('Mover a la carpeta')}
      title={t('Mover a la carpeta')}
      disabled={!m || c.section !== 'mail'}
      value=""
      onChange={(e) => {
        if (m && e.target.value) c.move(m.id, e.target.value);
      }}
    >
      <option value="">{t('Mover a…')}</option>
      {folderRows(c.data)
        .filter(({ folder: f }) => f.id !== m?.folder && !f.id.startsWith('c:'))
        .map(({ folder: f, depth }) => (
          <option key={f.id} value={f.id}>
            {'  '.repeat(depth)}
            {t(f.name)}
          </option>
        ))}
    </select>
  );
}

/** The ribbon of Nova Mail; the Home tab follows the section being shown. */
export function mailTabs(ui: MailUI, section: 'mail' | 'calendar' | 'contacts' | 'tasks'): RibbonTab[] {
  const groups: Record<typeof section, RibbonGroup[]> = {
    mail: [
      { id: 'new', label: 'Nuevo', icon: 'mailNew', items: [{ kind: 'button', command: 'mail.compose', size: 'large', keytip: 'N' }] },
      {
        id: 'delete',
        label: 'Eliminar',
        icon: 'trash',
        items: [
          { kind: 'button', command: 'mail.delete', size: 'large', keytip: 'D' },
          { kind: 'button', command: 'mail.archive', size: 'small', keytip: 'AR' },
          { kind: 'button', command: 'mail.junk', size: 'small', keytip: 'JK' },
          { kind: 'button', command: 'mail.emptyFolder', size: 'small', keytip: 'VF' },
        ],
      },
      {
        id: 'respond',
        label: 'Responder',
        icon: 'reply',
        items: [
          { kind: 'button', command: 'mail.reply', size: 'large', keytip: 'RP' },
          { kind: 'button', command: 'mail.replyAll', size: 'large', keytip: 'RT' },
          { kind: 'button', command: 'mail.forward', size: 'large', keytip: 'RF' },
          { kind: 'button', command: 'mail.editDraft', size: 'large', keytip: 'ED' },
        ],
      },
      { id: 'move', label: 'Mover', icon: 'archive', items: [{ kind: 'custom', id: 'moveSel', label: 'Mover', keytip: 'MV', render: () => <MoveSelect ui={ui} /> }] },
      {
        id: 'tags',
        label: 'Etiquetas',
        icon: 'flag',
        items: [
          { kind: 'button', command: 'mail.markRead', size: 'small', keytip: 'LE' },
          { kind: 'button', command: 'mail.markUnread', size: 'small', keytip: 'UL' },
          { kind: 'button', command: 'mail.flag', size: 'small', keytip: 'BA' },
        ],
      },
      { id: 'find', label: 'Buscar', icon: 'search', items: [{ kind: 'button', command: 'mail.search', size: 'large', keytip: 'BU' }] },
      {
        id: 'folders',
        label: 'Carpeta',
        icon: 'archive',
        items: [{ kind: 'button', command: 'mail.deleteFolder', size: 'large', keytip: 'EC' }],
      },
    ],
    calendar: [
      { id: 'new', label: 'Nuevo', icon: 'calendarPlus', items: [{ kind: 'button', command: 'cal.new', size: 'large', keytip: 'N' }] },
      {
        id: 'goto',
        label: 'Ir a',
        icon: 'calendar',
        items: [
          { kind: 'button', command: 'cal.today', size: 'large', keytip: 'H' },
          { kind: 'button', command: 'cal.view.day', size: 'large', keytip: 'VD' },
          { kind: 'button', command: 'cal.view.week', size: 'large', keytip: 'VS' },
          { kind: 'button', command: 'cal.view.month', size: 'large', keytip: 'VM' },
        ],
      },
    ],
    contacts: [
      { id: 'new', label: 'Nuevo', icon: 'userPlus', items: [{ kind: 'button', command: 'contact.new', size: 'large', keytip: 'N' }] },
    ],
    tasks: [
      { id: 'new', label: 'Nuevo', icon: 'checkSquare', items: [{ kind: 'button', command: 'task.new', size: 'large', keytip: 'N' }] },
    ],
  };
  const nav: RibbonGroup = {
    id: 'sections',
    label: 'Ir a',
    icon: 'mail',
    items: [
      { kind: 'button', command: 'mail.go.mail', size: 'large', keytip: 'GC' },
      { kind: 'button', command: 'mail.go.calendar', size: 'large', keytip: 'GA' },
      { kind: 'button', command: 'mail.go.contacts', size: 'large', keytip: 'GO' },
      { kind: 'button', command: 'mail.go.tasks', size: 'large', keytip: 'GT' },
    ],
  };
  const account: RibbonGroup = { id: 'account', label: 'Cuenta', icon: 'settings', items: [{ kind: 'button', command: 'mail.settings', size: 'large', keytip: 'MD' }] };
  const home: RibbonTab = { id: 'home', label: 'tab.home', keytip: 'I', groups: [...groups[section], nav, account] };

  // como en Outlook: una pestaña propia para recibir, enviar y las cuentas
  const sync: RibbonTab = {
    id: 'sync',
    label: 'Enviar y recibir',
    keytip: 'E',
    groups: [
      { id: 'receive', label: 'Enviar y recibir', icon: 'refresh', items: [{ kind: 'button', command: 'mail.sync', size: 'large', keytip: 'SY' }] },
      {
        id: 'accounts',
        label: 'Cuentas',
        icon: 'userPlus',
        items: [
          { kind: 'button', command: 'mail.accounts', size: 'large', keytip: 'CU' },
          { kind: 'button', command: 'mail.settings', size: 'large', keytip: 'MD' },
        ],
      },
    ],
  };

  const data: RibbonTab = {
    id: 'data',
    label: 'Datos',
    keytip: 'X',
    groups: [
      {
        id: 'import',
        label: 'Importar',
        icon: 'open',
        items: [
          { kind: 'button', command: 'data.import.eml', size: 'large', keytip: 'IE' },
          { kind: 'button', command: 'data.import.mbox', size: 'large', keytip: 'IM' },
          { kind: 'button', command: 'data.import.outlook', size: 'large', keytip: 'IO' },
          { kind: 'button', command: 'data.import.ics', size: 'large', keytip: 'IC' },
          { kind: 'button', command: 'data.import.contacts', size: 'large', keytip: 'IV' },
        ],
      },
      {
        id: 'export',
        label: 'Exportar',
        icon: 'exportFile',
        items: [
          { kind: 'button', command: 'data.export.eml', size: 'large', keytip: 'EE' },
          { kind: 'button', command: 'data.export.mbox', size: 'large', keytip: 'EM' },
          { kind: 'button', command: 'data.export.ics', size: 'large', keytip: 'EC' },
          { kind: 'button', command: 'data.export.vcf', size: 'small', keytip: 'EV' },
          { kind: 'button', command: 'data.export.csv', size: 'small', keytip: 'ES' },
        ],
      },
    ],
  };

  const view = viewTab({ zoom: false });
  view.groups.splice(1, 0, { id: 'pane', label: 'Disposición', icon: 'panelRight', items: [{ kind: 'button', command: 'mail.readingPane', size: 'large', keytip: 'PL' }] });
  return [home, sync, data, view, helpTab()];
}
