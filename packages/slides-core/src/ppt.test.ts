import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { readPpt } from './ppt';
import { docText } from './text';

const CFB = createRequire(import.meta.url)('cfb') as { utils: { cfb_new(): unknown; cfb_add(c: unknown, p: string, d: Buffer): void }; write(c: unknown, o: { type: string }): Buffer };

const rec = (verInst: number, type: number, body: Buffer) => {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(verInst, 0);
  h.writeUInt16LE(type, 2);
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
};
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const header = (t: number) => rec(0, 0x0f9f, u32(t));
const chars = (s: string) => rec(0, 0x0fa0, Buffer.from(s, 'utf16le'));
const bytes = (s: string) => rec(0, 0x0fa8, Buffer.from(s, 'latin1'));
const persist = () => rec(0, 0x03f3, Buffer.alloc(20));

describe('ppt (text only)', () => {
  it('reads the slides in order with their titles and bodies', () => {
    const list = rec(0x000f, 0x0ff0, Buffer.concat([persist(), header(0), chars('Plan anual'), header(1), chars('Primero\rSegundo\rTercero'), persist(), header(0), bytes('Resultados'), header(1), bytes('Ventas')]));
    const doc = rec(0x000f, 0x03e8, list);
    const c = CFB.utils.cfb_new();
    CFB.utils.cfb_add(c, '/PowerPoint Document', doc);
    const out = readPpt(new Uint8Array(CFB.write(c, { type: 'buffer' })));
    expect(out.deck.slides.length).toBe(2);
    const text = (i: number) => out.deck.slides[i]!.shapes.map((e) => (e.kind === 'shape' && e.text ? docText(e.text.doc) : '')).join('|');
    expect(text(0)).toContain('Plan anual');
    expect(text(0)).toContain('Primero\nSegundo\nTercero');
    expect(text(1)).toContain('Resultados');
    expect(out.warnings[0]).toMatch(/solo se ha importado el texto/);
  });
  it('rejects files that are not presentations', () => {
    expect(() => readPpt(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
