import { decodeCharset, decodeQuotedPrintable } from './mime';

export interface LabeledValue {
  label: string;
  value: string;
}

export interface Contact {
  id: string;
  uid: string;
  /** Display name (FN). */
  name: string;
  first: string;
  last: string;
  org: string;
  title: string;
  emails: LabeledValue[];
  phones: LabeledValue[];
  address: string;
  url: string;
  birthday: string;
  note: string;
}

let counter = 0;
export const newContactId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newContact(): Contact {
  const id = newContactId();
  return { id, uid: `${id}@nova.local`, name: '', first: '', last: '', org: '', title: '', emails: [], phones: [], address: '', url: '', birthday: '', note: '' };
}

export const displayName = (c: Contact): string => c.name.trim() || `${c.first} ${c.last}`.trim() || c.emails[0]?.value || c.org || 'Sin nombre';

const unescapeV = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\:])/g, '$1');
const escapeV = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      cur += s[i]! + (s[i + 1] ?? '');
      i++;
    } else if (s[i] === sep) {
      out.push(cur);
      cur = '';
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}

const typeLabel = (types: string): string => {
  const t = types.toLowerCase();
  if (/cell|mobile|móvil/.test(t)) return 'móvil';
  if (/work|trabajo/.test(t)) return 'trabajo';
  if (/home|casa/.test(t)) return 'casa';
  if (/fax/.test(t)) return 'fax';
  return t.replace(/pref|voice|internet|,/g, ' ').trim() || 'otro';
};

export function parseVcf(text: string): { contacts: Contact[]; warnings: string[] } {
  const warnings: string[] = [];
  // unfold; vCard 2.1 quoted-printable values may continue with a trailing "="
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const lines: string[] = [];
  for (const l of raw) {
    const prev = lines[lines.length - 1];
    if (/^[ \t]/.test(l) && prev !== undefined) lines[lines.length - 1] = prev + l.slice(1);
    else if (prev !== undefined && /ENCODING=QUOTED-PRINTABLE/i.test(prev) && prev.endsWith('=')) lines[lines.length - 1] = prev.slice(0, -1) + l;
    else lines.push(l);
  }
  const contacts: Contact[] = [];
  let cur: Contact | null = null;
  for (const line of lines) {
    const u = line.toUpperCase();
    if (u === 'BEGIN:VCARD') {
      cur = newContact();
      continue;
    }
    if (u === 'END:VCARD') {
      if (cur) {
        if (!cur.name) cur.name = `${cur.first} ${cur.last}`.trim();
        contacts.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon).split(';');
    const name = head[0]!.toUpperCase().replace(/^ITEM\d+\./, '');
    const params = head.slice(1).map((p) => p.toUpperCase());
    let value = line.slice(colon + 1);
    const charset = params.find((p) => p.startsWith('CHARSET='))?.slice(8);
    if (params.some((p) => p.includes('ENCODING=QUOTED-PRINTABLE'))) value = decodeCharset(decodeQuotedPrintable(value), charset);
    const types = params.map((p) => p.replace(/^TYPE=/, '')).filter((p) => !p.includes('=')).join(',');
    switch (name) {
      case 'UID': cur.uid = value; break;
      case 'FN': cur.name = unescapeV(value); break;
      case 'N': {
        const p = splitUnescaped(value, ';');
        cur.last = unescapeV(p[0] ?? '');
        cur.first = unescapeV(p[1] ?? '');
        break;
      }
      case 'ORG': cur.org = splitUnescaped(value, ';').map(unescapeV).filter(Boolean).join(' – '); break;
      case 'TITLE': cur.title = unescapeV(value); break;
      case 'EMAIL': if (value) cur.emails.push({ label: typeLabel(types), value: value.trim() }); break;
      case 'TEL': if (value) cur.phones.push({ label: typeLabel(types), value: value.replace(/^tel:/i, '').trim() }); break;
      case 'ADR': cur.address ||= splitUnescaped(value, ';').map(unescapeV).filter(Boolean).join(', '); break;
      case 'URL': cur.url ||= value; break;
      case 'BDAY': cur.birthday = value.replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3'); break;
      case 'NOTE': cur.note = unescapeV(value); break;
      case 'PHOTO':
      case 'LOGO': break;
    }
  }
  if (!contacts.length && /BEGIN:VCARD/i.test(text) === false) warnings.push('El archivo no contiene tarjetas vCard.');
  return { contacts, warnings };
}

function foldV(line: string): string {
  const enc = new TextEncoder();
  let out = '';
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out ? 74 : 75)) {
      out += cur + '\r\n ';
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  return out + cur;
}

export function writeVcf(contacts: Contact[]): string {
  const out: string[] = [];
  for (const c of contacts) {
    out.push('BEGIN:VCARD', 'VERSION:3.0', `UID:${c.uid}`, `FN:${escapeV(displayName(c))}`, `N:${escapeV(c.last)};${escapeV(c.first)};;;`);
    if (c.org) out.push(`ORG:${escapeV(c.org)}`);
    if (c.title) out.push(`TITLE:${escapeV(c.title)}`);
    for (const e of c.emails) out.push(`EMAIL;TYPE=${toType(e.label)}:${e.value}`);
    for (const p of c.phones) out.push(`TEL;TYPE=${toType(p.label)}:${p.value}`);
    if (c.address) out.push(`ADR;TYPE=HOME:;;${escapeV(c.address)};;;;`);
    if (c.url) out.push(`URL:${c.url}`);
    if (c.birthday) out.push(`BDAY:${c.birthday}`);
    if (c.note) out.push(`NOTE:${escapeV(c.note)}`);
    out.push('END:VCARD');
  }
  return out.map(foldV).join('\r\n') + '\r\n';
}

const toType = (label: string): string => ({ móvil: 'CELL', trabajo: 'WORK', casa: 'HOME', fax: 'FAX' })[label] ?? 'OTHER';

// ---------- CSV ----------

const ALIASES: Record<string, keyof Contact | 'email' | 'phone' | 'phoneWork' | 'phoneHome' | 'emailWork'> = {
  'first name': 'first', nombre: 'first', 'given name': 'first',
  'last name': 'last', apellidos: 'last', apellido: 'last', 'family name': 'last',
  name: 'name', 'display name': 'name', 'nombre completo': 'name',
  'e-mail address': 'email', email: 'email', 'e-mail': 'email', 'correo electrónico': 'email', 'correo electronico': 'email', correo: 'email', 'e-mail 1 - value': 'email',
  'e-mail 2 address': 'emailWork',
  'mobile phone': 'phone', 'teléfono móvil': 'phone', 'telefono movil': 'phone', phone: 'phone', teléfono: 'phone', telefono: 'phone', 'phone 1 - value': 'phone', móvil: 'phone', movil: 'phone',
  'business phone': 'phoneWork', 'teléfono del trabajo': 'phoneWork', 'telefono del trabajo': 'phoneWork',
  'home phone': 'phoneHome', 'teléfono particular': 'phoneHome',
  company: 'org', empresa: 'org', organization: 'org', organización: 'org',
  'job title': 'title', cargo: 'title', puesto: 'title',
  notes: 'note', notas: 'note',
  birthday: 'birthday', cumpleaños: 'birthday', 'fecha de nacimiento': 'birthday',
  website: 'url', 'web page': 'url', 'página web': 'url',
  'home address': 'address', dirección: 'address', direccion: 'address',
};

/** Contacts from CSV rows (header first). Recognises Outlook, Google and plain Spanish/English column names. */
export function contactsFromCsv(rows: string[][]): { contacts: Contact[]; warnings: string[] } {
  if (rows.length < 2) return { contacts: [], warnings: ['El archivo no tiene filas de datos.'] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const map = header.map((h) => ALIASES[h]);
  if (!map.some(Boolean)) return { contacts: [], warnings: ['No se reconoció ninguna columna de contacto (nombre, correo, teléfono…).'] };
  const contacts: Contact[] = [];
  for (const r of rows.slice(1)) {
    if (r.every((x) => !x.trim())) continue;
    const c = newContact();
    map.forEach((k, i) => {
      const v = (r[i] ?? '').trim();
      if (!k || !v) return;
      if (k === 'email') c.emails.push({ label: 'otro', value: v });
      else if (k === 'emailWork') c.emails.push({ label: 'trabajo', value: v });
      else if (k === 'phone') c.phones.push({ label: 'móvil', value: v });
      else if (k === 'phoneWork') c.phones.push({ label: 'trabajo', value: v });
      else if (k === 'phoneHome') c.phones.push({ label: 'casa', value: v });
      else (c as unknown as Record<string, string>)[k] = v;
    });
    if (!c.name) c.name = `${c.first} ${c.last}`.trim();
    contacts.push(c);
  }
  return { contacts, warnings: [] };
}

export function contactsToCsv(contacts: Contact[]): string[][] {
  const head = ['Nombre', 'Apellidos', 'Nombre completo', 'Correo electrónico', 'Correo electrónico 2', 'Teléfono móvil', 'Teléfono del trabajo', 'Empresa', 'Cargo', 'Dirección', 'Sitio web', 'Cumpleaños', 'Notas'];
  const rows = contacts.map((c) => [c.first, c.last, displayName(c), c.emails[0]?.value ?? '', c.emails[1]?.value ?? '', c.phones.find((p) => p.label === 'móvil')?.value ?? c.phones[0]?.value ?? '', c.phones.find((p) => p.label === 'trabajo')?.value ?? '', c.org, c.title, c.address, c.url, c.birthday, c.note]);
  return [head, ...rows];
}
