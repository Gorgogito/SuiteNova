/**
 * A small reader and writer of Compound File Binary containers (the OLE2 files of old Office, and the wrapper of
 * password-protected .docx). Version 3 (512-byte sectors) only; no transactions, no red-black rebalancing beyond what the
 * writer needs.
 */

export interface CfbEntry {
  /** Path from the root, e.g. `\u0006DataSpaces/Version`. */
  path: string;
  data: Uint8Array;
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const NOSTREAM = 0xffffffff;

export const isCfb = (b: Uint8Array): boolean => b.length >= 512 && SIGNATURE.every((v, i) => b[i] === v);

// ------------------------------------------------------------------------------------------------ reading

interface Dir {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

/** Every stream of the container with its full path. */
export function readCfb(bytes: Uint8Array): CfbEntry[] {
  if (!isCfb(bytes)) throw new Error('No es un archivo de Office cifrado ni un contenedor OLE.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shift = dv.getUint16(30, true);
  const sectorSize = 1 << shift;
  const miniSize = 1 << dv.getUint16(32, true);
  const nFat = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const cutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true);
  const nMiniFat = dv.getUint32(64, true);
  const difStart = dv.getUint32(68, true);
  const nDif = dv.getUint32(72, true);
  const sectorAt = (i: number) => {
    const off = (i + 1) * sectorSize;
    if (off + sectorSize > bytes.length) throw new Error('El contenedor está truncado.');
    return bytes.subarray(off, off + sectorSize);
  };
  // FAT
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(76 + i * 4, true));
  let dif = difStart;
  for (let k = 0; k < nDif && dif < DIFSECT; k++) {
    const s = sectorAt(dif);
    const d = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectors.length < nFat; i++) fatSectors.push(d.getUint32(i * 4, true));
    dif = d.getUint32(sectorSize - 4, true);
  }
  const fat: number[] = [];
  for (const fs of fatSectors) {
    const s = sectorAt(fs);
    const d = new DataView(s.buffer, s.byteOffset, s.byteLength);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(d.getUint32(i * 4, true));
  }
  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    let s = start;
    while (s < DIFSECT) {
      if (out.length > table.length) throw new Error('Cadena de sectores circular.');
      out.push(s);
      s = table[s] ?? ENDOFCHAIN;
    }
    return out;
  };
  const readChain = (start: number): Uint8Array => {
    const ids = chain(start, fat);
    const out = new Uint8Array(ids.length * sectorSize);
    ids.forEach((id, i) => out.set(sectorAt(id), i * sectorSize));
    return out;
  };
  // directory
  const dirBytes = readChain(dirStart);
  const dd = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const dirs: Dir[] = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const nameLen = dd.getUint16(o + 64, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(dd.getUint16(o + i * 2, true));
    dirs.push({ name, type: dirBytes[o + 66]!, left: dd.getUint32(o + 68, true), right: dd.getUint32(o + 72, true), child: dd.getUint32(o + 76, true), start: dd.getUint32(o + 116, true), size: dd.getUint32(o + 120, true) });
  }
  const root = dirs[0];
  if (!root) throw new Error('El contenedor no tiene directorio.');
  // mini stream
  const miniFat: number[] = [];
  if (nMiniFat) {
    const mf = readChain(miniFatStart);
    const d = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    for (let i = 0; i < mf.length / 4; i++) miniFat.push(d.getUint32(i * 4, true));
  }
  const miniStream = root.size ? readChain(root.start).subarray(0, root.size) : new Uint8Array(0);
  const readStream = (e: Dir): Uint8Array => {
    if (e.size < cutoff) {
      const ids = chain(e.start, miniFat);
      const out = new Uint8Array(ids.length * miniSize);
      ids.forEach((id, i) => out.set(miniStream.subarray(id * miniSize, (id + 1) * miniSize), i * miniSize));
      return out.subarray(0, e.size);
    }
    return readChain(e.start).subarray(0, e.size);
  };
  const out: CfbEntry[] = [];
  const seen = new Set<number>();
  const walk = (id: number, prefix: string) => {
    if (id === NOSTREAM || id >= dirs.length || seen.has(id)) return;
    seen.add(id);
    const e = dirs[id]!;
    walk(e.left, prefix);
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 2) out.push({ path, data: readStream(e) });
    else if (e.type === 1) walk(e.child, path);
    walk(e.right, prefix);
  };
  walk(root.child, '');
  return out;
}

// ------------------------------------------------------------------------------------------------ writing

interface Node {
  name: string;
  type: 1 | 2 | 5;
  data?: Uint8Array;
  kids: Node[];
  id: number;
  left: number;
  right: number;
  child: number;
  red: boolean;
  start: number;
  size: number;
}

const cmpName = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0);

/** Build a CFB from streams. Paths use `/` between storages; storages are created as needed. */
export function writeCfb(entries: CfbEntry[]): Uint8Array {
  const rootNode: Node = { name: 'Root Entry', type: 5, kids: [], id: 0, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, red: false, start: ENDOFCHAIN, size: 0 };
  for (const e of entries) {
    const parts = e.path.split('/');
    let cur = rootNode;
    parts.forEach((p, i) => {
      let n = cur.kids.find((k) => k.name === p);
      if (!n) {
        n = { name: p, type: i === parts.length - 1 ? 2 : 1, kids: [], id: -1, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, red: false, start: ENDOFCHAIN, size: 0 };
        cur.kids.push(n);
      }
      if (i === parts.length - 1) {
        n.data = e.data;
        n.size = e.data.length;
      }
      cur = n;
    });
  }
  // ids in breadth-first order and the sibling trees
  const order: Node[] = [rootNode];
  const link = (parent: Node) => {
    const kids = [...parent.kids].sort((a, b) => cmpName(a.name, b.name));
    const build = (lo: number, hi: number, depth: number): number => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi) >> 1;
      const n = kids[mid]!;
      n.left = build(lo, mid - 1, depth + 1);
      n.right = build(mid + 1, hi, depth + 1);
      return n.id;
    };
    kids.forEach((k) => {
      k.id = order.length;
      order.push(k);
    });
    // colour: the deepest level is red when it is not full, everything else black
    const maxDepth = (lo: number, hi: number): number => (lo > hi ? 0 : 1 + Math.max(maxDepth(lo, ((lo + hi) >> 1) - 1), maxDepth(((lo + hi) >> 1) + 1, hi)));
    const depthTotal = maxDepth(0, kids.length - 1);
    const full = kids.length === 2 ** depthTotal - 1;
    const paint = (lo: number, hi: number, depth: number) => {
      if (lo > hi) return;
      const mid = (lo + hi) >> 1;
      kids[mid]!.red = !full && depth === depthTotal && depthTotal > 1;
      paint(lo, mid - 1, depth + 1);
      paint(mid + 1, hi, depth + 1);
    };
    parent.child = build(0, kids.length - 1, 1);
    paint(0, kids.length - 1, 1);
    kids.forEach(link);
  };
  link(rootNode);

  // sectors
  const sectors: Uint8Array[] = [];
  const fat: number[] = [];
  const alloc = (data: Uint8Array): number => {
    const n = Math.max(1, Math.ceil(data.length / SECTOR));
    const first = sectors.length;
    for (let i = 0; i < n; i++) {
      const s = new Uint8Array(SECTOR);
      s.set(data.subarray(i * SECTOR, (i + 1) * SECTOR));
      sectors.push(s);
      fat.push(i === n - 1 ? ENDOFCHAIN : first + i + 1);
    }
    return first;
  };
  // mini stream
  const miniFat: number[] = [];
  const miniParts: Uint8Array[] = [];
  for (const n of order) {
    if (n.type !== 2) continue;
    const data = n.data ?? new Uint8Array(0);
    if (data.length === 0) {
      n.start = ENDOFCHAIN;
    } else if (data.length < CUTOFF) {
      const count = Math.ceil(data.length / MINI);
      n.start = miniFat.length;
      for (let i = 0; i < count; i++) {
        const m = new Uint8Array(MINI);
        m.set(data.subarray(i * MINI, (i + 1) * MINI));
        miniParts.push(m);
        miniFat.push(i === count - 1 ? ENDOFCHAIN : miniFat.length + 1);
      }
    } else n.start = alloc(data);
  }
  const miniStream = new Uint8Array(miniParts.length * MINI);
  miniParts.forEach((m, i) => miniStream.set(m, i * MINI));
  if (miniStream.length) {
    rootNode.start = alloc(miniStream);
    rootNode.size = miniStream.length;
  }
  let miniFatStart = ENDOFCHAIN;
  let nMiniFat = 0;
  if (miniFat.length) {
    const b = new Uint8Array(Math.ceil(miniFat.length / (SECTOR / 4)) * SECTOR).fill(0xff);
    const d = new DataView(b.buffer);
    miniFat.forEach((v, i) => d.setUint32(i * 4, v, true));
    miniFatStart = alloc(b);
    nMiniFat = b.length / SECTOR;
  }
  // directory
  const dirBytes = new Uint8Array(Math.ceil(order.length / 4) * SECTOR);
  const dv = new DataView(dirBytes.buffer);
  order.forEach((n, i) => {
    const o = i * 128;
    for (let k = 0; k < n.name.length; k++) dv.setUint16(o + k * 2, n.name.charCodeAt(k), true);
    dv.setUint16(o + 64, (n.name.length + 1) * 2, true);
    dirBytes[o + 66] = n.type;
    dirBytes[o + 67] = n.red ? 0 : 1;
    dv.setUint32(o + 68, n.left, true);
    dv.setUint32(o + 72, n.right, true);
    dv.setUint32(o + 76, n.child, true);
    dv.setUint32(o + 116, n.start, true);
    dv.setUint32(o + 120, n.size, true);
  });
  for (let i = order.length; i < dirBytes.length / 128; i++) {
    const o = i * 128;
    dv.setUint32(o + 68, NOSTREAM, true);
    dv.setUint32(o + 72, NOSTREAM, true);
    dv.setUint32(o + 76, NOSTREAM, true);
  }
  const dirStart = alloc(dirBytes);
  // FAT sectors (they describe themselves) and DIFAT sectors for big files
  const perFat = SECTOR / 4;
  let nFat = 0;
  let nDif = 0;
  for (;;) {
    const total = sectors.length + nFat + nDif;
    const needFat = Math.ceil(total / perFat);
    const needDif = needFat > 109 ? Math.ceil((needFat - 109) / (perFat - 1)) : 0;
    if (needFat === nFat && needDif === nDif) break;
    nFat = needFat;
    nDif = needDif;
  }
  const fatStart = sectors.length;
  const difStart = fatStart + nFat;
  const fatTable = [...fat];
  for (let i = 0; i < nFat; i++) fatTable.push(FATSECT);
  for (let i = 0; i < nDif; i++) fatTable.push(DIFSECT);
  while (fatTable.length < nFat * perFat) fatTable.push(FREESECT);
  const fatBytes = new Uint8Array(nFat * SECTOR);
  const fv = new DataView(fatBytes.buffer);
  fatTable.forEach((v, i) => fv.setUint32(i * 4, v, true));
  for (let i = 0; i < nFat; i++) sectors.push(fatBytes.slice(i * SECTOR, (i + 1) * SECTOR));
  const fatIds = Array.from({ length: nFat }, (_v, i) => fatStart + i);
  for (let i = 0; i < nDif; i++) {
    const s = new Uint8Array(SECTOR).fill(0xff);
    const d = new DataView(s.buffer);
    const chunk = fatIds.slice(109 + i * (perFat - 1), 109 + (i + 1) * (perFat - 1));
    chunk.forEach((v, k) => d.setUint32(k * 4, v, true));
    d.setUint32(SECTOR - 4, i === nDif - 1 ? ENDOFCHAIN : difStart + i + 1, true);
    sectors.push(s);
  }
  // header
  const out = new Uint8Array(SECTOR + sectors.length * SECTOR);
  const h = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  h.setUint16(24, 0x3e, true);
  h.setUint16(26, 3, true);
  h.setUint16(28, 0xfffe, true);
  h.setUint16(30, 9, true);
  h.setUint16(32, 6, true);
  h.setUint32(44, nFat, true);
  h.setUint32(48, dirStart, true);
  h.setUint32(56, CUTOFF, true);
  h.setUint32(60, miniFatStart, true);
  h.setUint32(64, nMiniFat, true);
  h.setUint32(68, nDif ? difStart : ENDOFCHAIN, true);
  h.setUint32(72, nDif, true);
  for (let i = 0; i < 109; i++) h.setUint32(76 + i * 4, i < fatIds.length ? fatIds[i]! : FREESECT, true);
  sectors.forEach((s, i) => out.set(s, SECTOR + i * SECTOR));
  return out;
}
