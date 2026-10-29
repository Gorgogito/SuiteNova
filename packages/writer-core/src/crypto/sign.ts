import type { SignatureData, WriterDoc } from '../docx/model';
import { fromBase64, toBase64 } from './sha512';

/**
 * Digital signature of a Nova Writer document. A self-signed identity (an ECDSA P-256 key pair created on this machine)
 * signs a SHA-256 digest of the content of the document; the signature travels in the Nova part of the .docx and is
 * checked again when the document opens and while it is edited. It proves the content did not change since signing and
 * that the same identity signed it; it does NOT prove who the person is (no certification authority is involved).
 */

export interface SignIdentity {
  name: string;
  email: string;
  created: string;
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export type SignatureStatus = 'valid' | 'modified' | 'invalid';

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIG = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function createIdentity(name: string, email = ''): Promise<SignIdentity> {
  const pair = await subtle().generateKey(ECDSA, true, ['sign', 'verify']);
  return {
    name,
    email,
    created: new Date().toISOString(),
    publicKey: await subtle().exportKey('jwk', pair.publicKey),
    privateKey: await subtle().exportKey('jwk', pair.privateKey),
  };
}

/** The first characters of the SHA-256 of the public key, to recognise an identity at a glance. */
export async function fingerprint(publicKey: JsonWebKey): Promise<string> {
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`${publicKey.x}.${publicKey.y}`)));
  return [...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('').replace(/(.{4})/g, '$1 ').trim().toUpperCase();
}

/** Stable JSON: keys sorted, and attributes that are only bookkeeping (ids made up at load time) left out. */
function stable(value: unknown, skip: (key: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => stable(v, skip));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      if (skip(k)) continue;
      out[k] = stable((value as Record<string, unknown>)[k], skip);
    }
    return out;
  }
  return value;
}

/** The content that a signature covers: the text and its formatting, headers and footers, comments, styles and macros. */
export function signedContent(doc: WriterDoc): string {
  const skip = (k: string) => k === 'id' || k === 'header' || k === 'footer';
  const parts = Object.keys(doc.parts)
    .sort()
    .map((k) => stable(doc.parts[k]!.toJSON(), skip));
  return JSON.stringify(
    stable(
      {
        body: doc.body.toJSON(),
        parts,
        comments: doc.comments.map((c) => ({ author: c.author, text: c.text, date: c.date, done: c.done })),
        defaults: doc.defaults,
        notes: doc.notes,
        watermark: doc.watermark,
        sources: doc.sources,
        macros: doc.macros,
        evenAndOdd: doc.evenAndOdd,
      },
      skip,
    ),
  );
}

export async function digestOf(doc: WriterDoc): Promise<string> {
  return toBase64(new Uint8Array(await subtle().digest('SHA-256', enc.encode(signedContent(doc)))));
}

const payload = (digest: string, signer: string, date: string, comment: string) => enc.encode(`nova-signature-v1\n${digest}\n${signer}\n${date}\n${comment}`);

export async function signDocument(doc: WriterDoc, identity: SignIdentity, comment = ''): Promise<SignatureData> {
  const digest = await digestOf(doc);
  const date = new Date().toISOString();
  const key = await subtle().importKey('jwk', identity.privateKey, ECDSA, false, ['sign']);
  const sig = new Uint8Array(await subtle().sign(SIG, key, payload(digest, identity.name, date, comment)));
  const certificate = JSON.stringify({ name: identity.name, email: identity.email, created: identity.created, publicKey: { kty: 'EC', crv: 'P-256', x: identity.publicKey.x, y: identity.publicKey.y }, fingerprint: await fingerprint(identity.publicKey) });
  return { signer: identity.name, date, value: toBase64(sig), certificate: toBase64(enc.encode(certificate)), digest, comment };
}

export interface CertificateInfo {
  name: string;
  email: string;
  created: string;
  fingerprint: string;
  publicKey: JsonWebKey;
}

export function readCertificate(sig: SignatureData): CertificateInfo | null {
  try {
    const c = JSON.parse(new TextDecoder().decode(fromBase64(sig.certificate))) as CertificateInfo;
    return c && c.publicKey && typeof c.name === 'string' ? c : null;
  } catch {
    return null;
  }
}

/**
 * `valid`: the content is what was signed and the signature belongs to the certificate it carries.
 * `modified`: the signature is genuine but the document changed after signing. `invalid`: the signature itself does not check.
 */
export async function verifySignature(doc: WriterDoc, sig: SignatureData): Promise<SignatureStatus> {
  const cert = readCertificate(sig);
  if (!cert) return 'invalid';
  try {
    const key = await subtle().importKey('jwk', cert.publicKey, ECDSA, false, ['verify']);
    const ok = await subtle().verify(SIG, key, fromBase64(sig.value) as BufferSource, payload(sig.digest, sig.signer, sig.date, sig.comment ?? ''));
    if (!ok) return 'invalid';
    return (await digestOf(doc)) === sig.digest ? 'valid' : 'modified';
  } catch {
    return 'invalid';
  }
}
