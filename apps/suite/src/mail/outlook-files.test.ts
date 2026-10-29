import { parseMessage } from '@suitenova/mail-core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MailCtl } from './ctl';
import { readMsg, readOutlookFile, readPst, type ImportedFolder } from './outlook-files';

/*
 * Con archivos de Outlook reales: no se incluyen en el repositorio (no son nuestros). Para ejecutar estas pruebas hay que
 * apuntar NOVA_OUTLOOK_SAMPLES a una carpeta con "Attach sample eml received.msg", "Outer mail.msg", "dist-list.pst" y
 * "enron.pst" (archivos de prueba públicos de las bibliotecas msgreader, java-libpst y pst-extractor).
 */
const dir = process.env.NOVA_OUTLOOK_SAMPLES ?? '';
const have = (f: string) => !!dir && existsSync(join(dir, f));
const load = (f: string) => new Uint8Array(readFileSync(join(dir, f)));

const flat = (t: ImportedFolder[], path: string[] = []): { path: string; n: number }[] => t.flatMap((f) => [{ path: [...path, f.name].join('/'), n: f.messages.length }, ...flat(f.children, [...path, f.name])]);

describe('archivos de Outlook inválidos', () => {
  it('un .msg o un .pst que no lo es se rechaza con un mensaje claro', async () => {
    await expect(readMsg(new TextEncoder().encode('esto no es un .msg'))).rejects.toThrow();
    await expect(readOutlookFile('x.pst', new Uint8Array(4096))).rejects.toThrow(/No es un archivo de datos de Outlook válido/);
    await expect(readOutlookFile('x.txt', new Uint8Array(10))).rejects.toThrow(/no es de Outlook/);
  });
});

describe.skipIf(!have('Attach sample eml received.msg'))('.msg reales', () => {
  it('un mensaje con un adjunto (un .eml dentro)', async () => {
    const r = await readMsg(load('Attach sample eml received.msg'));
    expect(r.messages).toBe(1);
    const m = r.tree[0]!.messages[0]!;
    const p = parseMessage(m.raw);
    expect(p.subject).toBe('Attach sample.eml');
    expect(p.from[0]!.email).toBe('hmailuser@hmailserver.test');
    expect(p.to.map((a) => a.email)).toContain('hmailuser@hmailserver.test');
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]!.data.length).toBeGreaterThan(100);
    expect(p.text?.trim().length).toBeGreaterThan(0);
  });
  it('un mensaje con mensajes adjuntos: se convierten en .eml que se pueden leer', async () => {
    const r = await readMsg(load('Outer mail.msg'));
    const p = parseMessage(r.tree[0]!.messages[0]!.raw);
    expect(p.subject).toBe('Outer mail');
    expect(p.attachments.map((a) => a.filename).sort()).toEqual(['Inner mail.eml', 'OUTER 1.pdf', 'OUTER 2.pdf']);
    expect(parseMessage(p.attachments.find((a) => a.filename.endsWith('.eml'))!.data).subject).toBe('Inner mail');
    expect(new TextDecoder('latin1').decode(p.attachments.find((a) => a.filename === 'OUTER 1.pdf')!.data.subarray(0, 5))).toBe('%PDF-');
  });
});

describe.skipIf(!have('dist-list.pst'))('.pst pequeño', () => {
  it('lee la estructura y se salta lo que no es correo', async () => {
    const r = await readPst(load('dist-list.pst'));
    expect(r.messages).toBe(0);
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.tree).toEqual([]);
  });
});

describe.skipIf(!have('enron.pst'))('.pst real (correo de Enron, archivo público de pruebas)', () => {
  it('trae todas las carpetas con su jerarquía, los mensajes y los adjuntos', { timeout: 120_000 }, async () => {
    let last = 0;
    const r = await readPst(load('enron.pst'), { onProgress: (n) => (last = n) });
    expect(r.messages).toBe(71);
    expect(last).toBe(71);
    expect(flat(r.tree).reduce((a, f) => a + f.n, 0)).toBe(71);
    const paths = flat(r.tree).map((f) => f.path);
    expect(paths).toContain('lokay-m/MLOKAY (Non-Privileged)/Personal');
    expect(paths[0]).toBe('lokay-m');
    const first = r.tree.flatMap(function all(f): ImportedFolder[] { return [f, ...f.children.flatMap(all)]; }).find((f) => f.messages.length)!;
    const p = parseMessage(first.messages[0]!.raw);
    expect(p.subject.length).toBeGreaterThan(0);
    expect(p.from[0]!.email).toMatch(/@/);
    expect(p.date).toBeInstanceOf(Date);
    const withAttachments = r.tree.flatMap(function all(f): ImportedFolder[] { return [f, ...f.children.flatMap(all)]; }).flatMap((f) => f.messages).filter((m) => parseMessage(m.raw).attachments.length > 0);
    expect(withAttachments.length).toBeGreaterThan(0);
    // se pueden meter en Nova Mail como carpetas nuevas, con subcarpetas, sin tocar lo que había
    const ctl = new MailCtl();
    const n = await ctl.importFolderTree('enron', r.tree);
    expect(n).toBe(71);
    expect(ctl.data.messages).toHaveLength(71);
    const root = ctl.data.folders.find((f) => f.name === 'enron')!;
    expect(root.parent).toBeUndefined();
    expect(ctl.data.folders.some((f) => f.parent === root.id)).toBe(true);
    expect(ctl.data.folders.filter((f) => f.system)).toHaveLength(6);
    expect(await ctl.importFolderTree('enron', r.tree)).toBe(71);
    expect(ctl.data.folders.filter((f) => f.name.startsWith('enron')).map((f) => f.name).sort()).toEqual(['enron', 'enron (2)']);
  });
  it('el límite de mensajes corta y lo avisa', async () => {
    const r = await readPst(load('enron.pst'), { maxMessages: 10 });
    expect(r.messages).toBe(10);
    expect(r.truncated).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/primeros 10 mensajes/);
  });
});

describe.skipIf(!have('pstextractortest.ost'))('.ost real (archivo de datos sin conexión de Outlook)', () => {
  it('se lee igual que un .pst: sin el nivel que solo envuelve las carpetas y sin los avisos de sincronización', async () => {
    const r = await readOutlookFile('pstextractortest.ost', load('pstextractortest.ost'));
    expect(r.messages).toBe(7);
    expect(flat(r.tree)).toEqual([{ path: 'Inbox', n: 7 }]);
    expect(r.skipped).toBeGreaterThan(0);
  });
});
