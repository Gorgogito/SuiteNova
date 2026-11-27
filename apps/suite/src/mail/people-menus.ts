import { t } from '@suitenova/core-ui';
import { contactByEmail, displayName, formatAddress, type Address } from '@suitenova/mail-core';
import type { MenuItem } from './ContextMenu';
import type { MailCtl } from './ctl';

/** What can be done about the contact of someone who appears in a message. */
export function contactItems(ctl: MailCtl, a: Address): MenuItem[] {
  const there = contactByEmail(ctl.data.contacts, a.email);
  if (there) return [{ label: t('Ver el contacto'), run: () => ctl.openContact(there.id) }];
  const same = ctl.people.sameName(a);
  return [
    { label: t('Agregar a contactos'), run: () => ctl.people.fromAddress(a) },
    ...(same ? [{ label: t('Agregar la dirección a «{name}»', { name: displayName(same) }), run: () => ctl.people.addEmail(same.id, a.email) }] : []),
  ];
}

/** The menu of an address of the message being read. */
export function addressItems(ctl: MailCtl, a: Address): MenuItem[] {
  return [
    ...contactItems(ctl, a),
    'separator',
    { label: t('Nuevo correo a esta dirección'), run: () => ctl.newMessage(formatAddress(a)) },
    { label: t('Copiar la dirección'), run: () => void navigator.clipboard?.writeText(a.email).catch(() => undefined) },
  ];
}
