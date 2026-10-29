import { describe, expect, it } from 'vitest';
import { plainText, readRtf, writeRtf, writeDocx, readDocx } from '../index';

const U = String.fromCharCode(92) + 'u';
const WORD_LIKE = String.raw`{\rtf1\ansi\ansicpg1252\deff0\nouicompat\deflang3082{\fonttbl{\f0\fnil\fcharset0 Calibri;}{\f1\fswiss\fcharset0 Arial;}}
{\colortbl ;\red255\green0\blue0;\red0\green0\blue255;}
{\stylesheet{\s1\sbasedon0\snext0 heading 1;}{\s2 Normal;}}
{\info{\title Mi t\'edtulo}{\author Ana}}
\paperw11906\paperh16838\margl1440\margr1440\margt1440\margb1440
\viewkind4\uc1
\pard\s1\sb240\sa120\b\f0\fs32 Encabezado\b0\par
\pard\qj\li720\sa200\sl276\slmult1\f0\fs22 Texto con \b negrita\b0 , \i cursiva\i0 , \ul subrayado\ulnone , {\cf1 rojo} y \'f1and\'fa con ${U}8364? y {\f1 Arial}.\par
\pard\qc{\super 2}\tab centrado\line salto\par
{\field{\*\fldinst{HYPERLINK "https://example.org/"}}{\fldrslt{\ul\cf2 enlace}}}\par
\trowd\trgaph108\cellx2000\cellx4000
\pard\intbl A1\cell B1\cell\row
\trowd\trgaph108\cellx2000\cellx4000
\pard\intbl A2\cell B2\cell\row
\pard\page Despu\'e9s\par
}`;

const find = (doc: any, name: string) => {
  const out: any[] = [];
  doc.descendants((n: any) => { if (n.type.name === name) out.push(n); });
  return out;
};

describe('RTF reader', () => {
  const { doc } = readRtf(WORD_LIKE);
  it('reads text, accents, euro sign and metadata', () => {
    const text = plainText(doc.body);
    expect(text).toContain('Encabezado');
    expect(text).toContain('añand'.slice(0, 1) + 'ñandú'.slice(1, 3) === 'ñan' ? 'ñandú' : 'ñandú');
    expect(text).toContain('€');
    expect(doc.title).toBe('Mi tídtulo'.replace('dt', 't').replace('tí', 'tí'));
    expect(doc.author).toBe('Ana');
  });
  it('keeps character formatting', () => {
    const marks = (word: string) => {
      let m: string[] = [];
      doc.body.descendants((n: any) => { if (n.isText && n.text.includes(word)) m = n.marks.map((x: any) => x.type.name); });
      return m;
    };
    expect(marks('negrita')).toContain('strong');
    expect(marks('cursiva')).toContain('em');
    expect(marks('subrayado')).toContain('underline');
    expect(marks('rojo')).toContain('color');
    expect(marks('Arial')).toContain('fontFamily');
  });
  it('keeps paragraph formatting and heading style', () => {
    const paras = find(doc.body, 'paragraph');
    expect(paras[0].attrs.style).toBe('Heading1');
    const body = paras.find((p: any) => p.textContent.startsWith('Texto'));
    expect(body.attrs.align).toBe('justify');
    expect(body.attrs.indentLeft).toBe(36);
    expect(body.attrs.lineHeight).toBeCloseTo(1.15, 2);
  });
  it('reads page size, links, tables and page breaks', () => {
    expect(doc.body.firstChild!.attrs.page.width).toBeCloseTo(595.3, 0);
    expect(find(doc.body, 'link').length + find(doc.body, 'text').filter((t: any) => t.marks.some((m: any) => m.type.name === 'link')).length).toBeGreaterThan(0);
    const table = find(doc.body, 'table')[0];
    expect(table.childCount).toBe(2);
    expect(table.firstChild.childCount).toBe(2);
    expect(find(doc.body, 'page_break').length).toBe(1);
    expect(plainText(doc.body)).toContain('Después');
  });
  it('rejects files that are not RTF', () => {
    expect(() => readRtf('hola')).toThrow();
  });
});

describe('RTF writer', () => {
  it('round-trips the formatted document through RTF', () => {
    const first = readRtf(WORD_LIKE).doc;
    const { data } = writeRtf(first);
    const rtf = new TextDecoder().decode(data);
    expect(rtf.startsWith('{' + String.fromCharCode(92) + 'rtf1')).toBe(true);
    const back = readRtf(rtf).doc;
    expect(plainText(back.body).replace(/\s+/g, ' ')).toBe(plainText(first.body).replace(/\s+/g, ' '));
    expect(find(back.body, 'table').length).toBe(1);
    expect(find(back.body, 'page_break').length).toBe(1);
    let bold = false;
    back.body.descendants((n: any) => { if (n.isText && n.text.includes('negrita') && n.marks.some((m: any) => m.type.name === 'strong')) bold = true; });
    expect(bold).toBe(true);
    expect(back.body.firstChild!.attrs.page.width).toBeCloseTo(595.3, 0);
  });
  it('writes lists that come back as lists', async () => {
    const docx = await (async () => {
      const first = readRtf(String.raw`{\rtf1\ansi{\*\listtable{\list\listid1{\listlevel\levelnfc23}}{\list\listid2{\listlevel\levelnfc0}}}{\*\listoverridetable{\listoverride\listid1\ls1}{\listoverride\listid2\ls2}}
\pard\ls1\ilvl0 uno\par\pard\ls1\ilvl0 dos\par\pard\ls2\ilvl0 tres\par}`).doc;
      return first;
    })();
    expect(find(docx.body, 'bullet_list').length).toBe(1);
    expect(find(docx.body, 'ordered_list').length).toBe(1);
    const back = readRtf(new TextDecoder().decode(writeRtf(docx).data)).doc;
    expect(find(back.body, 'bullet_list').length).toBe(1);
    expect(find(back.body, 'ordered_list').length).toBe(1);
    expect(find(back.body, 'list_item').length).toBe(3);
  });
  it('escapes special and non-Latin characters', () => {
    const d = readRtf(String.raw`{\rtf1\ansi ${U}26085?${U}26412? \{x\} \\ }`).doc;
    const back = readRtf(new TextDecoder().decode(writeRtf(d).data)).doc;
    expect(plainText(back.body)).toContain('日本');
    expect(plainText(back.body)).toContain('{x}');
  });
  it('goes through .docx too', async () => {
    const d = readRtf(WORD_LIKE).doc;
    const back = await readDocx((await writeDocx(d)).data);
    expect(plainText(back.doc.body)).toContain('Encabezado');
  });
});
