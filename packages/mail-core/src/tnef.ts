/*
 * TNEF, the «winmail.dat» that Outlook sends in Rich Text (format documented by Microsoft in MS-OXTNEF and MS-OXPROPS).
 * Only what can be shown is read: the attached files and the text or HTML of the message. A body kept only as
 * compressed RTF is not read.
 */

export interface TnefFile {
  filename: string;
  contentType: string;
  data: Uint8Array;
  cid?: string;
}
export interface Tnef {
  files: TnefFile[];
  html: string | null;
  text: string | null;
}

const SIGNATURE = 0x223e9f78;
const ATT = { body: 0x0002800c, props: 0x00069003, attachProps: 0x00069005, rend: 0x00069002, data: 0x0006800f, title: 0x00018010, codepage: 0x00069007 };
const PR = { body: 0x1000, html: 0x1013, data: 0x3701, shortName: 0x3704, longName: 0x3707, mime: 0x370e, cid: 0x3712, displayName: 0x3001 };

const CODEPAGES: Record<number, string> = { 65001: 'utf-8', 20127: 'utf-8', 1200: 'utf-16le', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 28591: 'windows-1252', 28592: 'iso-8859-2', 28605: 'iso-8859-15', 20866: 'koi8-r' };
const decoder = (cp: number): TextDecoder => {
  try {
    return new TextDecoder(CODEPAGES[cp] ?? (cp >= 1250 && cp <= 1258 ? `windows-${cp}` : 'windows-1252'));
  } catch {
    return new TextDecoder('windows-1252');
  }
};
const noNul = (s: string): string => s.replace(/\0+$/, '');

type PropValue = number | string | Uint8Array;

/** The MAPI properties of a block, by id. Stops quietly at the first thing that does not fit. */
function properties(b: Uint8Array, codepage: number): Map<number, PropValue> {
  const out = new Map<number, PropValue>();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (n < 0 || at + n > b.length) throw new Error('corto');
  };
  const u16 = () => (need(2), (at += 2), v.getUint16(at - 2, true));
  const u32 = () => (need(4), (at += 4), v.getUint32(at - 4, true));
  const bytes = (n: number) => (need(n), (at += n), b.subarray(at - n, at));
  const padded = (n: number) => {
    const x = bytes(n);
    at += (4 - (n % 4)) % 4;
    return x;
  };
  const fixed: Record<number, number> = { 0x0002: 4, 0x0003: 4, 0x0004: 4, 0x000a: 4, 0x000b: 4, 0x0005: 8, 0x0006: 8, 0x0007: 8, 0x0014: 8, 0x0040: 8, 0x0048: 16 };
  try {
    const count = u32();
    for (let i = 0; i < Math.min(count, 5000); i++) {
      let type = u16();
      const id = u16();
      if (id >= 0x8000) {
        bytes(16);
        if (u32() === 0) u32();
        else padded(u32());
      }
      const multi = (type & 0x1000) !== 0;
      type &= 0x0fff;
      if (type === 0x001e || type === 0x001f || type === 0x0102 || type === 0x000d) {
        const n = u32();
        for (let j = 0; j < Math.min(n, 1000); j++) {
          const data = padded(u32());
          if (j) continue;
          if (type === 0x001e) out.set(id, noNul(decoder(codepage).decode(data)));
          else if (type === 0x001f) out.set(id, noNul(new TextDecoder('utf-16le').decode(data)));
          // an object starts with the identifier of its interface
          else out.set(id, type === 0x000d ? data.subarray(16) : data);
        }
      } else if (fixed[type] !== undefined) {
        const n = multi ? u32() : 1;
        for (let j = 0; j < Math.min(n, 1000); j++) {
          const data = bytes(fixed[type]!);
          if (!j && data.length >= 4) out.set(id, new DataView(data.buffer, data.byteOffset).getUint32(0, true));
        }
      } else break;
    }
  } catch {
    // what was read before stays
  }
  return out;
}

const text = (v: PropValue | undefined): string => (typeof v === 'string' ? v : '');

const TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel', htm: 'text/html', html: 'text/html', ics: 'text/calendar', eml: 'message/rfc822' };

/** Null when the bytes are not TNEF. */
export function parseTnef(b: Uint8Array, depth = 0): Tnef | null {
  if (b.length < 6) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(0, true) !== SIGNATURE) return null;
  let codepage = 1252;
  const out: Tnef = { files: [], html: null, text: null };
  type Open = { title: string; data: Uint8Array | null; props: Map<number, PropValue> };
  let open: Open | null = null;
  const close = () => {
    if (!open) return;
    const a = open;
    open = null;
    const embedded = a.props.get(PR.data);
    const data = a.data?.length ? a.data : embedded instanceof Uint8Array ? embedded : null;
    if (!data) return;
    // a message attached inside: its files are the ones worth having
    if (depth < 3 && data.length > 6 && new DataView(data.buffer, data.byteOffset).getUint32(0, true) === SIGNATURE) {
      out.files.push(...(parseTnef(data, depth + 1)?.files ?? []));
      return;
    }
    const filename = text(a.props.get(PR.longName)) || text(a.props.get(PR.shortName)) || a.title || text(a.props.get(PR.displayName)) || 'adjunto';
    const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';
    out.files.push({ filename, contentType: text(a.props.get(PR.mime)).toLowerCase() || TYPES[ext] || 'application/octet-stream', data: data.slice(), cid: text(a.props.get(PR.cid)) || undefined });
  };
  for (let at = 6; at + 9 <= b.length; ) {
    const id = v.getUint32(at + 1, true);
    const length = v.getUint32(at + 5, true);
    const start = at + 9;
    if (length > b.length - start) break;
    const data = b.subarray(start, start + length);
    at = start + length + 2;
    if (id === ATT.codepage && length >= 4) codepage = v.getUint32(start, true);
    else if (id === ATT.rend) {
      close();
      open = { title: '', data: null, props: new Map() };
    } else if (id === ATT.title && open) open.title = noNul(decoder(codepage).decode(data));
    else if (id === ATT.data && open) open.data = data;
    else if (id === ATT.attachProps && open) open.props = properties(data, codepage);
    else if (id === ATT.body) out.text ??= noNul(decoder(codepage).decode(data)) || null;
    else if (id === ATT.props) {
      const p = properties(data, codepage);
      const html = p.get(PR.html);
      if (typeof html === 'string') out.html = html || null;
      else if (html instanceof Uint8Array) out.html = noNul(decoder(codepage).decode(html)) || null;
      if (text(p.get(PR.body))) out.text = text(p.get(PR.body));
    }
  }
  close();
  return out;
}
