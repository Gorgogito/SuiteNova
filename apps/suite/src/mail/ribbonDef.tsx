import { registerIcon, t, type RibbonGroup, type RibbonTab } from '@suitenova/core-ui';
import { LIST_FILTERS, SORT_KEYS, canChangeFolder, type ListFilter, type SortKey } from '@suitenova/mail-core';
import { folderMoveItems, moveTargets } from './actions';
import { Archive, ArrowDownUp, Ban, BellRing, CalendarPlus, CircleCheck, Contact, Flag, FolderSearch, Forward, Group, Inbox, ListChecks, MailOpen, MailPlus, MessagesSquare, PanelRight, Reply, ReplyAll, Send, Star, Tag, UserPlus, UserX, Zap } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { helpTab, viewTab } from '../common';
import type { MailUI } from './commands';
import { categoryItems, followItems, junkItems, ruleItems, stepItems } from './organize-menus';
import { RibbonMenu } from './RibbonMenu';
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
registerIcon('conversations', MessagesSquare);
registerIcon('groups', Group);
registerIcon('sortReverse', ArrowDownUp);
registerIcon('star', Star);
registerIcon('mailDone', CircleCheck);
registerIcon('mailBell', BellRing);
registerIcon('mailSend', Send);
registerIcon('mailTag', Tag);
registerIcon('mailRules', ListChecks);
registerIcon('mailBolt', Zap);
registerIcon('mailUserX', UserX);
registerIcon('mailInbox', Inbox);
registerIcon('mailSearchFolder', FolderSearch);

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
        if (m && e.target.value) c.moveMany(c.selectedIds(), e.target.value);
      }}
    >
      <option value="">{t('Mover a…')}</option>
      {moveTargets(c, c.selectedIds().length > 1 ? undefined : m?.folder).map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

function MoveFolderSelect({ ui }: { ui: MailUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  const can = c.section === 'mail' && canChangeFolder(c.data.folders.find((f) => f.id === c.folder));
  const items = can ? folderMoveItems(c, c.folder).filter((i) => i !== 'separator') : [];
  return (
    <select
      className="nv-select"
      style={{ width: 170 }}
      aria-label={t('Mover la carpeta a')}
      title={t('Mover la carpeta a')}
      disabled={!can}
      value=""
      onChange={(e) => {
        const i = Number(e.target.value);
        if (e.target.value) items[i]?.run?.();
      }}
    >
      <option value="">{t('Mover la carpeta a…')}</option>
      {items.map((it, i) => (
        <option key={i} value={i} disabled={it.disabled}>
          {it.label}
        </option>
      ))}
    </select>
  );
}

function ViewSelects({ ui }: { ui: MailUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  return (
    <div className="ml-ribbon-view">
      <label>
        <span>{t('Ordenar por')}</span>
        <select className="nv-select" aria-label={t('Ordenar por')} value={c.view.sort} onChange={(e) => c.setView({ sort: e.target.value as SortKey })}>
          {SORT_KEYS.map((k) => (
            <option key={k.id} value={k.id}>
              {t(k.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('Mostrar')}</span>
        <select className="nv-select" aria-label={t('Mostrar')} value={c.view.filter} onChange={(e) => c.setView({ filter: e.target.value as ListFilter })}>
          {LIST_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {t(f.label)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Where the messages go: a folder, the rules, or what is done with their senders. */
function MoveColumn({ ui }: { ui: MailUI }) {
  const c = ui.ctl;
  const inMail = () => c.section === 'mail' && !c.compose;
  return (
    <div className="ml-ribbon-stack">
      <MoveSelect ui={ui} />
      <RibbonMenu ui={ui} label="Reglas" icon="mailRules" enabled={inMail} items={() => ruleItems(c, ui.openDialog)} />
      <RibbonMenu ui={ui} label="Remitente" icon="mailUserX" enabled={inMail} items={() => junkItems(c, ui.openDialog)} />
    </div>
  );
}

/** Categories, follow-up and quick steps of the selected messages. */
function TagColumn({ ui }: { ui: MailUI }) {
  const c = ui.ctl;
  const inMail = () => c.section === 'mail' && !c.compose;
  const selected = () => inMail() && !!c.selected;
  return (
    <div className="ml-ribbon-stack">
      <RibbonMenu ui={ui} label="Categorizar" icon="mailTag" enabled={selected} items={() => categoryItems(c, ui.openDialog)} />
      <RibbonMenu ui={ui} label="Seguimiento" icon="flag" enabled={selected} items={() => followItems(c, ui.openDialog)} />
      <RibbonMenu ui={ui} label="Pasos rápidos" icon="mailBolt" enabled={inMail} items={() => stepItems(c, ui.openDialog)} />
    </div>
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
      { id: 'move', label: 'Mover', icon: 'archive', items: [{ kind: 'custom', id: 'moveSel', label: 'Mover', keytip: 'MV', render: () => <MoveColumn ui={ui} /> }] },
      {
        id: 'tags',
        label: 'Etiquetas',
        icon: 'flag',
        items: [
          // icons alone: with their names the tab did not fit at 1400 px
          { kind: 'button', command: 'mail.markRead', size: 'small', iconOnly: true, keytip: 'LE' },
          { kind: 'button', command: 'mail.markUnread', size: 'small', iconOnly: true, keytip: 'UL' },
          { kind: 'button', command: 'mail.flag', size: 'small', iconOnly: true, keytip: 'BA' },
          { kind: 'custom', id: 'tagMenus', label: 'Organizar', keytip: 'ET', render: () => <TagColumn ui={ui} /> },
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
      {
        id: 'receive',
        label: 'Enviar y recibir',
        icon: 'refresh',
        items: [
          { kind: 'button', command: 'mail.sync', size: 'large', keytip: 'SY' },
          { kind: 'button', command: 'mail.sendNow', size: 'large', keytip: 'EA' },
          { kind: 'button', command: 'mail.options', size: 'large', keytip: 'AV' },
        ],
      },
      {
        id: 'accounts',
        label: 'Cuentas',
        icon: 'userPlus',
        items: [
          { kind: 'button', command: 'mail.accounts', size: 'large', keytip: 'CU' },
          { kind: 'button', command: 'mail.settings', size: 'large', keytip: 'MD' },
          { kind: 'button', command: 'mail.signatures', size: 'large', keytip: 'FI' },
        ],
      },
    ],
  };

  // como en Outlook: una pestaña para las carpetas
  const folder: RibbonTab = {
    id: 'folder',
    label: 'Carpeta',
    keytip: 'K',
    groups: [
      {
        id: 'edit',
        label: 'Carpeta',
        icon: 'archive',
        items: [
          { kind: 'button', command: 'mail.folder.new', size: 'large', keytip: 'N' },
          { kind: 'button', command: 'mail.folder.rename', size: 'large', keytip: 'R' },
          { kind: 'button', command: 'mail.deleteFolder', size: 'large', keytip: 'EC' },
          { kind: 'custom', id: 'moveFolder', label: 'Mover la carpeta', keytip: 'MC', render: () => <MoveFolderSelect ui={ui} /> },
        ],
      },
      {
        id: 'content',
        label: 'Contenido',
        icon: 'mailOpen',
        items: [
          { kind: 'button', command: 'mail.folder.markRead', size: 'large', keytip: 'LE' },
          { kind: 'button', command: 'mail.emptyFolder', size: 'large', keytip: 'VF' },
          { kind: 'button', command: 'mail.folder.favorite', size: 'large', keytip: 'FA' },
        ],
      },
      {
        id: 'searches',
        label: 'Búsqueda',
        icon: 'mailSearchFolder',
        items: [
          { kind: 'button', command: 'mail.searchFolder.new', size: 'large', keytip: 'BN' },
          { kind: 'button', command: 'mail.advancedSearch', size: 'large', keytip: 'BV' },
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
        id: 'message',
        label: 'Mensaje',
        icon: 'mailOpen',
        items: [
          { kind: 'button', command: 'mail.print', size: 'large', keytip: 'P' },
          { kind: 'button', command: 'mail.saveAttachments', size: 'small', keytip: 'GA' },
          { kind: 'button', command: 'mail.headers', size: 'small', keytip: 'EN' },
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
  view.groups.splice(2, 0, {
    id: 'arrange',
    label: 'Organización',
    icon: 'sortReverse',
    items: [
      { kind: 'custom', id: 'viewSelects', label: 'Ordenar y filtrar', keytip: 'OF', render: () => <ViewSelects ui={ui} /> },
      { kind: 'button', command: 'mail.view.conversations', size: 'small', keytip: 'OC' },
      { kind: 'button', command: 'mail.view.reverse', size: 'small', keytip: 'OI' },
      { kind: 'button', command: 'mail.view.groups', size: 'small', keytip: 'OG' },
    ],
  });
  view.groups.push({
    id: 'voice',
    label: 'Voz',
    icon: 'volume',
    items: [
      { kind: 'button', command: 'mail.read.start', size: 'large', keytip: 'XV' },
      { kind: 'button', command: 'mail.read.stop', size: 'small', keytip: 'XP' },
    ],
  });
  view.groups.push({
    id: 'imgOcr',
    label: 'Texto de imágenes',
    icon: 'sparkles',
    items: [
      { kind: 'button', command: 'mail.ocr.dialog', size: 'large', keytip: 'XI' },
      { kind: 'button', command: 'mail.ocr.run', size: 'small', keytip: 'XM' },
      { kind: 'button', command: 'mail.ocr.runAll', size: 'small', keytip: 'XB' },
      { kind: 'button', command: 'mail.ocr.stop', size: 'small', keytip: 'XD' },
      { kind: 'button', command: 'mail.ocr.auto', size: 'small', keytip: 'XA' },
    ],
  });
  const developer: RibbonTab = {
    id: 'developer',
    label: 'Programador',
    keytip: 'PR',
    groups: [
      {
        id: 'code',
        label: 'Código',
        icon: 'code',
        items: [
          { kind: 'button', command: 'mail.macroEditor', size: 'large', keytip: 'ED' },
          { kind: 'button', command: 'mail.macros', size: 'large', keytip: 'MA' },
          { kind: 'button', command: 'mail.macroSecurity', size: 'small', keytip: 'SG' },
          { kind: 'button', command: 'mail.trustCentre', size: 'small', keytip: 'CC' },
        ],
      },
    ],
  };
  return [home, sync, folder, data, developer, view, helpTab()];
}
