import { defaultSection, makeSection, nodeTypes, writerSchema } from '@suitenova/writer-core';
import { AllSelection, EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { MacroRecorder } from '../macros/recorder';
import type { WriterCtl } from './doc';
import { WriterRuntime } from './macros';
import { WriterRecorder } from './recorder';
import { buildStory, offsetToPos } from './story';

const para = (t: string, attrs: Record<string, unknown> = {}) => nodeTypes.paragraph!.create(attrs, t ? writerSchema.text(t) : undefined);
const docOf = (...ps: ReturnType<typeof para>[]) => nodeTypes.doc!.create(null, [makeSection(ps, defaultSection())]);
const initial = () => docOf(para('Hola'), para('Mundo'));

interface User {
  readonly state: EditorState;
  apply(tr: Transaction): void;
  select(a: number, b?: number): void;
  /** The position of a character offset. */
  pos(off: number): number;
  type(text: string): void;
}

/** A recording session over a document: `act` receives helpers that behave like the user (select, type, format…). */
function record(act: (u: User) => void) {
  let state = EditorState.create({ doc: initial() });
  const rec = new MacroRecorder('Grabada');
  const driver = new WriterRecorder(rec, state);
  const apply = (tr: Transaction) => {
    const next = state.apply(tr);
    driver.observe(tr, state, next);
    state = next;
  };
  const pos = (off: number) => offsetToPos(buildStory(state.doc), off);
  const u: User = {
    get state() {
      return state;
    },
    apply,
    pos,
    select: (a, b = a) => apply(state.tr.setSelection(TextSelection.create(state.doc, pos(a), pos(b)))),
    type: (text) => apply(state.tr.insertText(text)),
  };
  act(u);
  return { code: rec.code(), doc: state.doc, rec };
}

/** Plays the macro on a fresh copy of the document and returns what it leaves. */
function replay(code: string) {
  let state = EditorState.create({ doc: initial() });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
    focus() {},
  };
  const ctl = { mainView: view, macros: [{ name: 'Modulo1', code }], comments: [], contentEnabled: true, touch() {}, dirty: false, readOnly: false };
  const rt = new WriterRuntime(ctl as unknown as WriterCtl);
  const r = rt.run('Grabada');
  return { r, doc: state.doc };
}

/** The document without the random id of its sections. */
const norm = (d: ReturnType<typeof initial>) => JSON.parse(JSON.stringify(d.toJSON(), (k, v) => (k === 'id' ? undefined : v)));

const same = (code: string, doc: ReturnType<typeof initial>) => {
  const { r, doc: replayed } = replay(code);
  expect(r.error ?? '').toBe('');
  expect(norm(replayed)).toEqual(norm(doc));
};

describe('grabadora de macros de Writer', () => {
  it('el texto tecleado seguido es una sola línea TypeText, y al reproducirla da el mismo documento', () => {
    const { code, doc } = record((u) => {
      u.select(4);
      for (const c of ' amigo') u.type(c);
    });
    expect(code).toContain('Selection.SetRange Start:=4, End:=4');
    expect(code.match(/TypeText/g)).toHaveLength(1);
    expect(code).toContain('Selection.TypeText Text:=" amigo"');
    same(code, doc);
  });

  it('la negrita, el tamaño y el color de una selección', () => {
    const { code, doc } = record((u) => {
      u.select(0, 4);
      u.apply(u.state.tr.addMark(u.pos(0), u.pos(4), writerSchema.marks.strong!.create()));
      u.apply(u.state.tr.addMark(u.pos(0), u.pos(4), writerSchema.marks.fontSize!.create({ value: 18 })));
      u.apply(u.state.tr.addMark(u.pos(0), u.pos(4), writerSchema.marks.color!.create({ value: '#ff0000' })));
    });
    expect(code).toContain('Selection.Font.Bold = True');
    expect(code).toContain('Selection.Font.Size = 18');
    expect(code).toContain('Selection.Font.Color = RGB(255, 0, 0)');
    expect(code.match(/SetRange/g)).toHaveLength(1); // la selección no cambia entre un formato y otro
    same(code, doc);
  });

  it('quitar el formato escribe False', () => {
    const { code } = record((u) => {
      u.select(0, 4);
      u.apply(u.state.tr.addMark(u.pos(0), u.pos(4), writerSchema.marks.em!.create()));
      u.apply(u.state.tr.removeMark(u.pos(0), u.pos(4), writerSchema.marks.em!));
    });
    expect(code).toContain('Selection.Font.Italic = True');
    expect(code).toContain('Selection.Font.Italic = False');
  });

  it('alineación y estilo de párrafo', () => {
    const { code, doc } = record((u) => {
      u.select(6);
      const blocks = buildStory(u.state.doc).blocks;
      u.apply(u.state.tr.setNodeMarkup(blocks[1]!.pos - 1, undefined, { ...blocks[1]!.node.attrs, align: 'center' }));
      const again = buildStory(u.state.doc).blocks;
      u.apply(u.state.tr.setNodeMarkup(again[1]!.pos - 1, undefined, { ...again[1]!.node.attrs, style: 'Heading1' }));
    });
    expect(code).toContain('Selection.ParagraphFormat.Alignment = wdAlignParagraphCenter');
    expect(code).toContain('Selection.Style = "Título 1"');
    same(code, doc);
  });

  it('Intro, Retroceso y borrar lo seleccionado', () => {
    const { code, doc } = record((u) => {
      u.select(2);
      u.apply(u.state.tr.split(u.state.selection.from)); // Intro entre «Ho» y «la»
      u.select(3);
      u.apply(u.state.tr.delete(u.pos(3) - 2, u.pos(3))); // Retroceso al principio del párrafo: vuelve a unir
      u.select(1, 3);
      u.apply(u.state.tr.delete(u.state.selection.from, u.state.selection.to)); // borra lo seleccionado
    });
    expect(code).toContain('Selection.TypeParagraph');
    expect(code).toContain('Selection.Delete');
    same(code, doc);
  });

  it('el texto tecleado con formato se escribe con su formato', () => {
    const { code, doc } = record((u) => {
      u.select(4);
      u.apply(u.state.tr.insertText('!', u.pos(4)).addMark(u.pos(4), u.pos(4) + 1, writerSchema.marks.strong!.create()));
    });
    expect(code).toContain('Selection.TypeText Text:="!"');
    expect(code).toContain('Selection.Font.Bold = True');
    same(code, doc);
  });

  it('lo que no se puede escribir como código queda como comentario', () => {
    const { code } = record((u) => {
      u.select(4);
      u.apply(u.state.tr.replaceSelectionWith(nodeTypes.field!.create({ kind: 'page' })));
    });
    expect(code).toMatch(/' \(Nova no puede grabar: /);
  });

  it('en pausa no se graba, y al seguir se parte de donde está el usuario', () => {
    let state = EditorState.create({ doc: initial() });
    const rec = new MacroRecorder('Grabada');
    const d = new WriterRecorder(rec, state);
    const go = (tr: Transaction) => {
      const next = state.apply(tr);
      d.observe(tr, state, next);
      state = next;
    };
    rec.paused = true;
    go(state.tr.insertText('XX', 5));
    rec.paused = false;
    go(state.tr.insertText('Y', 7));
    expect(rec.code()).not.toContain('XX');
    expect(rec.code()).toContain('Text:="Y"');
  });
});

describe('grabadora de macros de Writer: selección de todo el documento', () => {
  it('Ctrl+E y negrita: la selección «todo» no rompe la grabación y se escribe con sus desplazamientos', () => {
    const { code, doc } = record((u) => {
      u.apply(u.state.tr.setSelection(new AllSelection(u.state.doc)));
      u.apply(u.state.tr.addMark(u.pos(0), u.pos(11), writerSchema.marks.strong!.create()));
    });
    expect(code).toContain('Selection.Font.Bold = True');
    expect(doc.textContent).toBe('HolaMundo');
  });
});

describe('MacroRecorder', () => {
  it('escribe el Sub con comentarios y sangría, y las comillas y tabuladores salen bien escritos', () => {
    const r = new MacroRecorder('Hola', 'Saluda.\nDos líneas');
    r.type('dijo "hola"\ty');
    expect(r.code()).toBe(['Sub Hola()', "    ' Hola Macro", "    ' Saluda.", "    ' Dos líneas", '    Selection.TypeText Text:="dijo ""hola""" & vbTab & "y"', 'End Sub', ''].join('\n'));
  });
  it('guarda en el módulo Grabadas, que se crea la primera vez y crece después', () => {
    const mods: { name: string; code: string }[] = [];
    const a = new MacroRecorder('A');
    a.add('x = 1');
    a.saveInto(mods);
    const b = new MacroRecorder('B');
    b.saveInto(mods);
    expect(mods.map((m) => m.name)).toEqual(['Grabadas']);
    expect(mods[0]!.code).toContain('Sub A()');
    expect(mods[0]!.code).toContain('Sub B()');
    expect(mods[0]!.code).toContain('no se grabó ninguna acción');
  });
});
