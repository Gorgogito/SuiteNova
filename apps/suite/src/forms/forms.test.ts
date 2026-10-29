import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { QTYPES, serializeResponse } from '@suitenova/forms-core';
import { Workbook } from '@suitenova/calc-engine';
import { writeXlsx } from '@suitenova/xlsx-io';
import { describe, expect, it } from 'vitest';
import { readForeignForm } from './import';
import { formsCommands, type FormsUI } from './commands';
import { FORM_HEAD, FormsCtl } from './ctl';
import './messages';
import { formsTabs } from './ribbonDef';

function setup() {
  const ctl = new FormsCtl();
  const ui: FormsUI = {
    ctl,
    openDialog: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    exportHtml: async () => undefined,
    exportCsv: async () => undefined,
    importForm: async () => undefined,
    importResponses: async () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(formsCommands(ui));
  registry.register({ id: 'file.close', label: 'Cerrar', run: () => undefined });
  return { ctl, ui, registry };
}

function commandsIn(items: RibbonItem[]): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'button') return [i.command];
    if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
    return [];
  });
}

describe('Nova Forms ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { ui, registry } = setup();
    const missing: string[] = [];
    for (const tab of formsTabs(ui)) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });
  it('offers every question type', () => {
    const { ui } = setup();
    const ids = new Set(formsTabs(ui).flatMap((x) => x.groups.flatMap((g) => commandsIn(g.items))));
    for (const q of QTYPES) expect(ids.has(`forms.q.add.${q.id}`), q.id).toBe(true);
  });
  it('labels, shortcuts and key tips are unique', () => {
    const { ui, registry } = setup();
    const seen = new Map<string, string>();
    for (const c of registry.all()) {
      expect(c.label, c.id).toBeTruthy();
      for (const sc of Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []) {
        expect(seen.get(sc), `${sc} used by ${c.id} and ${seen.get(sc)}`).toBeUndefined();
        seen.set(sc, c.id);
      }
    }
    for (const tab of formsTabs(ui)) {
      const tips = tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
      expect(new Set(tips).size, tab.id).toBe(tips.length);
      for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} vs ${b}`).toBe(false);
    }
  });
  it('has an English translation for every command and question type', () => {
    const { registry } = setup();
    const prev = getLocale();
    setLocale('en');
    try {
      const missing = registry
        .all()
        .filter((c) => c.id.startsWith('forms.'))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Insertar|Abrir|Guardar|Eliminar|Duplicar|Párrafo|Número|Fecha|Resultados|Vista|Diseñar)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});

describe('FormsCtl', () => {
  it('adds questions after the selected one, with undo', () => {
    const { ctl } = setup();
    const a = ctl.addQuestion('text');
    const b = ctl.addQuestion('choice');
    expect(ctl.form.questions.map((q) => q.id)).toEqual([a.id, b.id]);
    ctl.select(a.id);
    const c = ctl.addQuestion('rating');
    expect(ctl.form.questions.map((q) => q.id)).toEqual([a.id, c.id, b.id]);
    expect(ctl.selected).toBe(c.id);
    ctl.undo();
    expect(ctl.form.questions).toHaveLength(2);
    expect(ctl.selected).toBe(FORM_HEAD);
    ctl.redo();
    expect(ctl.form.questions).toHaveLength(3);
  });
  it('duplicates, moves (conditions stay valid) and deletes with the answers', () => {
    const { ctl } = setup();
    const a = ctl.addQuestion('choice');
    const b = ctl.addQuestion('text');
    ctl.updateQuestion(b.id, { showIf: { question: a.id, op: 'eq', value: 'Opción 1' } });
    ctl.addResponse({ [a.id]: 'Opción 1', [b.id]: 'hola' });
    ctl.select(b.id);
    ctl.duplicateQuestion();
    expect(ctl.form.questions).toHaveLength(3);
    expect(new Set(ctl.form.questions.map((q) => q.id)).size).toBe(3);
    ctl.select(b.id);
    ctl.moveQuestion(-1); // b before a: its condition would look forward, so it is dropped
    expect(ctl.form.questions[0]!.id).toBe(b.id);
    expect(ctl.form.questions[0]!.showIf).toBeNull();
    expect(ctl.canMove(-1)).toBe(false);
    ctl.select(a.id);
    ctl.deleteQuestion();
    expect(ctl.form.questions.some((q) => q.id === a.id)).toBe(false);
    expect(ctl.responses[0]!.answers[a.id]).toBeUndefined();
    expect(ctl.responses[0]!.answers[b.id]).toBe('hola');
  });
  it('deleting a question removes conditions that used it', () => {
    const { ctl } = setup();
    const a = ctl.addQuestion('choice');
    const b = ctl.addQuestion('text');
    ctl.updateQuestion(b.id, { showIf: { question: a.id, op: 'eq', value: 'x' } });
    ctl.select(a.id);
    ctl.deleteQuestion();
    expect(ctl.form.questions[0]!.showIf).toBeNull();
  });
  it('imports responses (new ones only) and refuses another form', () => {
    const { ctl } = setup();
    const q = ctl.addQuestion('text');
    const r = ctl.addResponse({ [q.id]: 'Ana' });
    const file = serializeResponse(ctl.form, { id: 'ext1', at: '2025-03-01T10:00:00Z', answers: { [q.id]: 'Luis' } });
    expect(ctl.importResponses(file)).toMatchObject({ added: 1 });
    expect(ctl.importResponses(file)).toMatchObject({ added: 0 });
    expect(ctl.responses.map((x) => x.id)).toEqual([r.id, 'ext1']);
    expect(() => ctl.importResponses(serializeResponse({ ...ctl.form, id: 'otro' }, r))).toThrow(/otro formulario/);
    ctl.clearResponses();
    expect(ctl.responses).toHaveLength(0);
    ctl.undo();
    expect(ctl.responses).toHaveLength(2);
  });
  it('quiz and theme settings are undoable form changes', () => {
    const { ctl } = setup();
    ctl.setForm({ quiz: true, color: '#c50f1f' });
    expect(ctl.form).toMatchObject({ quiz: true, color: '#c50f1f' });
    expect(ctl.dirty).toBe(true);
    ctl.undo();
    expect(ctl.form.quiz).toBe(false);
  });
});

describe('Import from Microsoft Forms and Google Forms', () => {
  const rows = [
    ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Color', 'Edad'],
    ['1', '2025-03-01 10:00', '2025-03-01 10:05', 'a@x.es', 'Ana', 'Rojo', '30'],
    ['2', '2025-03-02 10:00', '2025-03-02 10:05', 'b@x.es', 'Beto', 'Azul', '41'],
    ['3', '2025-03-03 10:00', '2025-03-03 10:05', 'c@x.es', 'Cris', 'Rojo', '22'],
    ['4', '2025-03-04 10:00', '2025-03-04 10:05', 'd@x.es', 'Dani', 'Rojo', '33'],
  ];
  it('reads an .xlsx made by a spreadsheet, a .csv and a saved Google page', async () => {
    const w = new Workbook();
    rows.forEach((r, i) => r.forEach((v, j) => w.setInput(w.sheets[0]!.id, i, j, v)));
    const x = await readForeignForm('respuestas.xlsx', await writeXlsx(w));
    expect(x.form.questions.map((q) => q.title)).toEqual(['Color', 'Edad']);
    expect(x.responses).toHaveLength(4);
    const csv = await readForeignForm('respuestas.csv', new TextEncoder().encode(rows.map((r) => r.join(';')).join(String.fromCharCode(10))));
    expect(csv.form.questions.map((q) => [q.title, q.type])).toEqual([['Color', 'choice'], ['Edad', 'number']]);
    const g = await readForeignForm('f.html', new TextEncoder().encode('<script>var FB_PUBLIC_LOAD_DATA_ = [null,["d",[[1,"P",null,0,[[11,null,1]]]],null,null,null,null,null,null,"Título"],null,"n"];</script>'));
    expect(g.form.title).toBe('Título');
    await expect(readForeignForm('malo.html', new TextEncoder().encode('<p>nada</p>'))).rejects.toThrow(/No se encontró/);
  });
  it('an imported form is unsaved and opens on its results', async () => {
    const { ctl } = setup();
    const r = await readForeignForm('r.csv', new TextEncoder().encode(rows.map((x) => x.join(';')).join(String.fromCharCode(10))));
    ctl.loadImported({ form: r.form, responses: r.responses });
    expect(ctl.dirty).toBe(true);
    expect(ctl.filePath).toBeNull();
    expect(ctl.mode).toBe('results');
    expect(ctl.responses).toHaveLength(4);
  });
});
