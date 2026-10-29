import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_DEFAULTS,
  WrongPasswordError,
  decryptPackage,
  defaultSection,
  emptyWriterDoc,
  encryptPackage,
  isCfb,
  isEncryptedPackage,
  makeSection,
  nodeTypes,
  plainText,
  readCfb,
  readDocx,
  writeCfb,
  writeDocx,
  writerSchema,
} from '../index';

const req = createRequire(import.meta.url);
// independent implementations, used only to check ours against
const officeCrypto = req('officecrypto-tool') as { encrypt(b: Buffer, o: { password: string }): Buffer; decrypt(b: Buffer, o: { password: string }): Promise<Buffer>; isEncrypted(b: Buffer): boolean };
const CFB = req('cfb') as { read(b: Buffer, o: { type: string }): { FileIndex: { name: string; size: number; content?: Buffer | number[] }[] }; find(c: unknown, p: string): { content: Buffer | number[]; size: number } | null; utils: { cfb_new(): unknown; cfb_add(c: unknown, p: string, d: Buffer): void }; write(c: unknown, o: { type: string }): Buffer };

const smallDoc = () => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([nodeTypes.paragraph!.create(null, writerSchema.text('Hola ñandú'))], defaultSection())]) });
const bytes = (n: number, seed = 1) => new Uint8Array(n).map((_v, i) => (i * 131 + seed * 17 + (i >> 8)) & 255);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('Compound File container', () => {
  it('writes small (mini stream) and big streams that the reference reader reads back', () => {
    const small = bytes(100);
    const mid = bytes(4095, 2);
    const big = bytes(70000, 3);
    const file = writeCfb([
      { path: 'A', data: small },
      { path: 'Store/B', data: mid },
      { path: 'Store/Deep/C', data: big },
      { path: 'Empty', data: new Uint8Array(0) },
    ]);
    expect(isCfb(file)).toBe(true);
    const c = CFB.read(Buffer.from(file), { type: 'buffer' });
    const get = (p: string) => new Uint8Array(CFB.find(c, p)!.content as Buffer);
    expect(eq(get('/A'), small)).toBe(true);
    expect(eq(get('/Store/B'), mid)).toBe(true);
    expect(eq(get('/Store/Deep/C'), big)).toBe(true);
  });

  it('reads what it writes, including paths', () => {
    const file = writeCfb([
      { path: 'EncryptionInfo', data: bytes(1200) },
      { path: 'EncryptedPackage', data: bytes(9000, 4) },
      { path: '\u0006DataSpaces/Version', data: bytes(76, 5) },
    ]);
    const got = new Map(readCfb(file).map((e) => [e.path, e.data]));
    expect(eq(got.get('EncryptionInfo')!, bytes(1200))).toBe(true);
    expect(eq(got.get('EncryptedPackage')!, bytes(9000, 4))).toBe(true);
    expect(eq(got.get('\u0006DataSpaces/Version')!, bytes(76, 5))).toBe(true);
  });

  it('reads a container written by another library', () => {
    const c = CFB.utils.cfb_new();
    CFB.utils.cfb_add(c, '/One', Buffer.from(bytes(50, 6)));
    CFB.utils.cfb_add(c, '/Dir/Two', Buffer.from(bytes(6000, 7)));
    const file = new Uint8Array(CFB.write(c, { type: 'buffer' }));
    const got = new Map(readCfb(file).map((e) => [e.path, e.data]));
    expect(eq(got.get('One')!, bytes(50, 6))).toBe(true);
    expect(eq(got.get('Dir/Two')!, bytes(6000, 7))).toBe(true);
  });

  it('handles files that need the extended allocation table (> 7 MB)', () => {
    const big = bytes(8_500_000, 9);
    const file = writeCfb([{ path: 'Big', data: big }]);
    expect(eq(readCfb(file)[0]!.data, big)).toBe(true);
    const c = CFB.read(Buffer.from(file), { type: 'buffer' });
    expect(CFB.find(c, '/Big')!.size).toBe(big.length);
  }, 60000);
});

describe('password encryption (agile)', () => {
  it('round-trips with our own reader', async () => {
    const pkg = bytes(10000, 11);
    const enc = await encryptPackage(pkg, 'secreto-ñ', 1000);
    expect(isEncryptedPackage(enc)).toBe(true);
    expect(eq(await decryptPackage(enc, 'secreto-ñ'), pkg)).toBe(true);
  });

  it('a wrong password is rejected, an empty package works', async () => {
    const enc = await encryptPackage(bytes(500), 'uno', 1000);
    await expect(decryptPackage(enc, 'dos')).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await decryptPackage(await encryptPackage(new Uint8Array(0), 'x', 1000), 'x')).length).toBe(0);
  });

  it('detects a tampered file by its integrity check', async () => {
    const enc = await encryptPackage(bytes(9000), 'clave', 1000);
    const entries = readCfb(enc);
    const pkg = entries.find((e) => e.path === 'EncryptedPackage')!;
    pkg.data[100]! ^= 1;
    await expect(decryptPackage(writeCfb(entries), 'clave')).rejects.toThrow(/integridad|dañado/);
  });

  it('what we encrypt is opened by the reference implementation', async () => {
    // the reference checks the password by looking for a valid zip, so use a real .docx
    const pkg = (await writeDocx(smallDoc())).data;
    const enc = await encryptPackage(pkg, 'Contraseña1', 100000);
    expect(officeCrypto.isEncrypted(Buffer.from(enc))).toBe(true);
    const plain = await officeCrypto.decrypt(Buffer.from(enc), { password: 'Contraseña1' });
    expect(eq(new Uint8Array(plain), pkg)).toBe(true);
    await expect(officeCrypto.decrypt(Buffer.from(enc), { password: 'otra' })).rejects.toBeTruthy();
  }, 60000);

  it('what the reference implementation encrypts, we open', async () => {
    const pkg = (await writeDocx(smallDoc())).data;
    const enc = new Uint8Array(officeCrypto.encrypt(Buffer.from(pkg), { password: 'abc123' }));
    expect(isEncryptedPackage(enc)).toBe(true);
    expect(eq(await decryptPackage(enc, 'abc123'), pkg)).toBe(true);
    await expect(decryptPackage(enc, 'abc124')).rejects.toBeInstanceOf(WrongPasswordError);
  }, 60000);

  it('carries the DataSpaces Word expects', async () => {
    const enc = await encryptPackage(bytes(100), 'k', 1000);
    const names = readCfb(enc).map((e) => e.path);
    for (const n of ['EncryptionInfo', 'EncryptedPackage', '\u0006DataSpaces/Version', '\u0006DataSpaces/DataSpaceMap', '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace', '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary']) expect(names).toContain(n);
  });

  it('a whole .docx goes through encryption and comes back readable', async () => {
    const doc = { ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([nodeTypes.paragraph!.create(null, writerSchema.text('Texto confidencial'))], defaultSection())]) };
    const { data } = await writeDocx(doc);
    const enc = await encryptPackage(data, 'pw', 2000);
    expect(new TextDecoder('latin1').decode(enc)).not.toContain('confidencial');
    const back = await readDocx(await decryptPackage(enc, 'pw'));
    expect(plainText(back.doc.body)).toBe('Texto confidencial');
  });
});
