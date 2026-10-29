import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_DEFAULTS,
  createIdentity,
  defaultSection,
  emptyWriterDoc,
  fingerprint,
  makeSection,
  nodeTypes,
  readCertificate,
  readDocx,
  signDocument,
  verifySignature,
  writeDocx,
  writerSchema,
  type WriterDoc,
} from '../index';

const p = (text: string) => nodeTypes.paragraph!.create(null, text ? writerSchema.text(text) : []);
const mk = (...texts: string[]): WriterDoc => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection(texts.map(p), defaultSection())]) });

describe('digital signature', () => {
  it('signs and verifies', async () => {
    const id = await createIdentity('Ana Pérez', 'ana@example.org');
    const doc = mk('Contrato', 'Cláusula uno');
    const sig = await signDocument(doc, id, 'Conforme');
    expect(sig.signer).toBe('Ana Pérez');
    expect(await verifySignature(doc, sig)).toBe('valid');
    const cert = readCertificate(sig)!;
    expect(cert.name).toBe('Ana Pérez');
    expect(cert.fingerprint).toBe(await fingerprint(id.publicKey));
    expect(JSON.stringify(cert)).not.toContain('"d"'); // the private key never travels
  });

  it('notices a change in the content', async () => {
    const id = await createIdentity('Ana');
    const sig = await signDocument(mk('Pago: 100'), id);
    expect(await verifySignature(mk('Pago: 900'), sig)).toBe('modified');
    expect(await verifySignature(mk('Pago: 100', ''), sig)).toBe('modified');
  });

  it('rejects a forged or altered signature', async () => {
    const a = await createIdentity('Ana');
    const b = await createIdentity('Beto');
    const doc = mk('Texto');
    const sig = await signDocument(doc, a);
    // the signer's name is part of what is signed
    expect(await verifySignature(doc, { ...sig, signer: 'Beto' })).toBe('invalid');
    expect(await verifySignature(doc, { ...sig, date: '2000-01-01T00:00:00.000Z' })).toBe('invalid');
    // somebody else's certificate does not validate this signature
    const other = await signDocument(doc, b);
    expect(await verifySignature(doc, { ...sig, certificate: other.certificate })).toBe('invalid');
    expect(await verifySignature(doc, { ...sig, value: 'AAAA' })).toBe('invalid');
    expect(await verifySignature(doc, { ...sig, certificate: 'bm8gZXMgdW4gY2VydGlmaWNhZG8=' })).toBe('invalid');
  });

  it('is still valid after the document goes through .docx', async () => {
    const id = await createIdentity('Ana');
    const doc = mk('Primera', 'Segunda con **negrita**');
    const sig = await signDocument(doc, id);
    const w = await writeDocx({ ...doc, signature: sig });
    const back = await readDocx(w.data);
    expect(back.doc.signature).toEqual(sig);
    expect(await verifySignature(back.doc, back.doc.signature!)).toBe('valid');
  });

  it('a document with headers, comments and sections keeps its signature through .docx', async () => {
    const id = await createIdentity('Ana');
    const base = mk('Cuerpo');
    const footer = nodeTypes.doc!.create(null, [p('Pie de página')]);
    const sec = makeSection([p('Cuerpo')], { ...defaultSection(), footer: { default: 'f1', first: null, even: null } });
    const doc: WriterDoc = { ...base, body: nodeTypes.doc!.create(null, [sec, makeSection([p('Segunda sección')], defaultSection())]), parts: { f1: footer }, comments: [{ id: 'c1', author: 'Luis', initials: 'L', date: '2026-01-02T03:04:05Z', text: 'Revisar', parent: null, done: false }] };
    const sig = await signDocument(doc, id);
    const back = await readDocx((await writeDocx({ ...doc, signature: sig })).data);
    expect(await verifySignature(back.doc, back.doc.signature!)).toBe('valid');
    // ... and editing the footer breaks it
    const edited = { ...back.doc, parts: Object.fromEntries(Object.entries(back.doc.parts).map(([k]) => [k, nodeTypes.doc!.create(null, [p('Otro pie')])])) };
    expect(await verifySignature(edited, back.doc.signature!)).toBe('modified');
  });
});
