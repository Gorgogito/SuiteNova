import { defaultSection, makeSection, nodeTypes, plainText, writerSchema } from '@suitenova/writer-core';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import type { WriterCtl } from './doc';
import { WriterRuntime } from './macros';
import { buildStory, offsetToPos, posToOffset } from './story';

const para = (t: string, attrs: Record<string, unknown> = {}) => nodeTypes.paragraph!.create(attrs, t ? writerSchema.text(t) : undefined);
const docOf = (...ps: ReturnType<typeof para>[]) => nodeTypes.doc!.create(null, [makeSection(ps, defaultSection())]);

/** A stand-in for the controller with a view that applies transactions to its state. */
function fake(...paragraphs: string[]) {
  const view = {
    state: EditorState.create({ doc: docOf(...paragraphs.map((p) => para(p))) }),
    dispatch(tr: Parameters<EditorState['apply']>[0]) {
      this.state = this.state.apply(tr);
    },
    focus() {},
  };
  const ctl = {
    mainView: view,
    macros: [] as { name: string; code: string }[],
    comments: [],
    trackChanges: false,
    contentEnabled: true,
    fileName: 'Prueba.docx',
    filePath: null,
    dirty: false,
    readOnly: false,
    title: undefined,
    touch() {},
    sections: () => [{ props: { page: { width: 595, height: 842, marginLeft: 72, marginRight: 72, marginTop: 72, marginBottom: 72 } } }],
    notes: () => [],
    words: () => ({ total: 0, selection: null }),
    setSectionProps() {},
  };
  const rt = new WriterRuntime(ctl as unknown as WriterCtl);
  const run = (code: string, proc = 'Prueba') => {
    ctl.macros = [{ name: 'Modulo1', code }];
    return rt.run(proc);
  };
  const text = () => plainText(view.state.doc);
  return { ctl, view, rt, run, text };
}

describe('story (Word character offsets)', () => {
  it('counts paragraph marks and maps offsets to positions and back', () => {
    const doc = docOf(para('Hola'), para('Mundo'));
    const s = buildStory(doc);
    expect(s.text).toBe('Hola\rMundo\r');
    expect(s.blocks.length).toBe(2);
    for (const o of [0, 2, 4, 5, 7, 10]) expect(posToOffset(s, offsetToPos(s, o))).toBe(o);
    expect(doc.textBetween(offsetToPos(s, 5), offsetToPos(s, 10))).toBe('Mundo');
  });
  it('counts inline objects as one character', () => {
    const p = nodeTypes.paragraph!.create(null, [writerSchema.text('a'), nodeTypes.field!.create({ kind: 'page' }), writerSchema.text('b')]);
    const s = buildStory(docOf(p));
    expect(s.text).toBe('a￼b\r');
    expect(offsetToPos(s, 3)).toBe(offsetToPos(s, 3));
  });
});

describe('Nova Basic with the Word object model', () => {
  it('reads and writes the text of the document', () => {
    const t = fake('Uno', 'Dos');
    const r = t.run(`Sub Prueba()\n  Debug.Print ActiveDocument.Content.Text\n  Debug.Print ActiveDocument.Paragraphs.Count\n  ActiveDocument.Paragraphs(2).Range.InsertAfter " mas"\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    expect(t.rt.console.join('|')).toContain('Uno');
    expect(t.rt.console).toContain('2');
    expect(t.text()).toBe('Uno\nDos mas');
  });

  it('formats a range: bold, italic, size, colour', () => {
    const t = fake('Texto de prueba');
    const r = t.run(`Sub Prueba()\n  With ActiveDocument.Range(0, 5)\n    .Font.Bold = True\n    .Font.Size = 20\n    .Font.Color = RGB(255, 0, 0)\n  End With\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    const marks = (w: string) => {
      let m: string[] = [];
      t.view.state.doc.descendants((n) => {
        if (n.isText && n.text!.includes(w)) m = n.marks.map((x) => x.type.name);
      });
      return m;
    };
    expect(marks('Texto')).toEqual(expect.arrayContaining(['strong', 'fontSize', 'color']));
    expect(marks('prueba')).toEqual([]);
    expect(t.run(`Sub Prueba()\n  Debug.Print ActiveDocument.Range(0, 5).Font.Bold\n  Debug.Print ActiveDocument.Range(6, 11).Font.Bold\nEnd Sub`).ok).toBe(true);
    expect(t.rt.console.slice(-2)).toEqual(['-1', '0']);
  });

  it('formats paragraphs: alignment, style, indent', () => {
    const t = fake('Titulo', 'Cuerpo');
    const r = t.run(`Sub Prueba()\n  ActiveDocument.Paragraphs(1).Range.Style = "Título 1"\n  ActiveDocument.Paragraphs(2).Alignment = wdAlignParagraphCenter\n  ActiveDocument.Paragraphs(2).Format.LeftIndent = 36\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    const ps: Record<string, unknown>[] = [];
    t.view.state.doc.descendants((n) => {
      if (n.type.name === 'paragraph') ps.push(n.attrs);
    });
    expect(ps[0]!.style).toBe('Heading1');
    expect(ps[1]!.align).toBe('center');
    expect(ps[1]!.indentLeft).toBe(36);
  });

  it('Find and Replace, whole document', () => {
    const t = fake('gato negro y gato blanco', 'otro gato');
    const r = t.run(`Sub Prueba()\n  With ActiveDocument.Content.Find\n    .Text = "gato"\n    .Replacement.Text = "perro"\n    .Execute Replace:=wdReplaceAll\n  End With\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    expect(t.text()).toBe('perro negro y perro blanco\notro perro');
  });

  it('Selection: type text and paragraphs', () => {
    const t = fake('');
    const r = t.run(`Sub Prueba()\n  Selection.TypeText "Hola"\n  Selection.TypeParagraph\n  Selection.TypeText "Adios"\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    expect(t.text()).toBe('Hola\nAdios');
  });

  it('inserting text with line breaks makes paragraphs; Delete removes a range', () => {
    const t = fake('abcdef');
    expect(t.run(`Sub Prueba()\n  ActiveDocument.Range(3, 3).InsertAfter "X" & vbCr & "Y"\n  ActiveDocument.Range(0, 1).Delete\nEnd Sub`).ok).toBe(true);
    expect(t.text()).toBe('bcX\nYdef');
  });

  it('tables: add and fill cells', () => {
    const t = fake('Antes');
    const r = t.run(`Sub Prueba()\n  Dim tb\n  Set tb = ActiveDocument.Tables.Add(ActiveDocument.Range(0, 0), 2, 2)\n  tb.Cell(1, 1).Range.Text = "A"\n  tb.Cell(2, 2).Range.Text = "D"\n  Debug.Print ActiveDocument.Tables.Count\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    expect(t.rt.console).toContain('1');
    const cells: string[] = [];
    t.view.state.doc.descendants((n) => {
      if (n.type.name === 'table_cell') cells.push(n.textContent);
    });
    expect(cells).toEqual(['A', '', '', 'D']);
  });

  it('bookmarks', () => {
    const t = fake('Texto con marca');
    const r = t.run(`Sub Prueba()\n  ActiveDocument.Bookmarks.Add "M1", ActiveDocument.Range(6, 9)\n  Debug.Print ActiveDocument.Bookmarks.Exists("M1")\n  Debug.Print ActiveDocument.Bookmarks.Count\nEnd Sub`);
    expect(r.ok, r.error).toBe(true);
    expect(t.rt.console.slice(-2)).toEqual(['Verdadero', '1']);
  });

  it('page setup of a section', () => {
    const t = fake('x');
    expect(t.run(`Sub Prueba()\n  Debug.Print ActiveDocument.Sections(1).PageSetup.PageWidth\n  Debug.Print Application.Name\nEnd Sub`).ok).toBe(true);
    expect(t.rt.console.slice(-2)).toEqual(['595', 'Nova Writer']);
  });

  it('reports errors with the line and refuses to run when content is disabled', () => {
    const t = fake('x');
    const bad = t.run(`Sub Prueba()\n  ActiveDocument.Foo = 1\nEnd Sub`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Foo/);
    expect(bad.at?.line).toBe(2);
    t.ctl.contentEnabled = false;
    expect(t.run(`Sub Prueba()\nEnd Sub`).error).toMatch(/deshabilitado/);
    expect(WriterRuntime.check('M', 'Sub A(\n')[0]?.line).toBeGreaterThan(0);
  });

  it('runs Document_Open / AutoOpen when active content is enabled', () => {
    const t = fake('x');
    t.ctl.macros = [{ name: 'M', code: `Sub AutoOpen()\n  Debug.Print "abierto"\nEnd Sub` }];
    t.rt.runOpenHandlers();
    expect(t.rt.console).toContain('abierto');
  });
});
