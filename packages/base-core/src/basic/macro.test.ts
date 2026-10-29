import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, loadSql } from '../index';
import { TempVars, parseProcCall, runMacro, validateMacro, type BVal, type FormLike, type MacroDef, type MacroHost } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});

function setup(macros: Record<string, MacroDef> = {}) {
  const db = BaseDb.open(SQL);
  db.execute(`CREATE TABLE T (id INTEGER PRIMARY KEY, n INTEGER); INSERT INTO T VALUES (1, 10), (2, 20)`);
  db.clearUndo();
  const calls: string[] = [];
  const rec: Record<string, BVal> = { Nombre: 'Ana', Saldo: 5, Activo: true };
  const form: FormLike = {
    name: 'F1',
    table: 'T',
    record: () => ({ ...rec }),
    get: (f) => rec[f] ?? null,
    set: (f, v) => void (rec[f] = v),
    goto: (w) => void calls.push(`goto:${w}`),
    requery: () => void calls.push('requery'),
  };
  const msgs: string[] = [];
  const host: MacroHost = {
    db,
    tempVars: new TempVars(),
    form: (n) => (n === 'F1' ? form : null),
    me: () => form,
    openForm: (n, w) => void calls.push(`form:${n}:${w ?? ''}`),
    openReport: (n) => void calls.push(`report:${n}`),
    openTable: (n) => void calls.push(`table:${n}`),
    openQuery: (n) => void calls.push(`query:${n}`),
    runMacro: (n) => void calls.push(`macro:${n}`),
    close: (k, n) => void calls.push(`close:${k}:${n ?? ''}`),
    querySql: () => null,
    refresh: () => void calls.push('refresh'),
    macro: (n) => macros[n] ?? null,
    runProc: (n, a) => void calls.push(`proc:${n}(${a.join(',')})`),
    msgBox: (p, b, t) => (msgs.push(`${t}|${b}|${p}`), 1),
  };
  return { host, calls, rec, msgs, db };
}

describe('macros', () => {
  it('run their steps in order and report how many ran', () => {
    const { host, calls } = setup();
    const r = runMacro(
      { steps: [{ action: 'OpenForm', args: { form: 'F1', where: 'id = 2' } }, { action: 'OpenReport', args: { report: 'R' } }, { action: 'OpenTable', args: { table: 'T' } }, { action: 'OpenQuery', args: { query: 'Q' } }, { action: 'Requery', args: {} }] },
      host,
    );
    expect(r).toEqual({ ok: true, ran: 5 });
    expect(calls).toEqual(['form:F1:id = 2', 'report:R', 'table:T', 'query:Q', 'requery', 'refresh']);
  });

  it('a condition decides whether a step runs; disabled steps are skipped', () => {
    const { host, calls } = setup();
    const r = runMacro(
      {
        steps: [
          { action: 'OpenTable', args: { table: 'A' }, condition: '[Saldo] > 100' },
          { action: 'OpenTable', args: { table: 'B' }, condition: '[Saldo] < 100 And [Activo]' },
          { action: 'OpenTable', args: { table: 'C' }, disabled: true },
          { action: 'OpenTable', args: { table: 'D' }, condition: 'IsNull([Nada2])' },
        ],
      },
      host,
    );
    // the last condition names a field that does not exist: that stops the macro and says which step
    expect(calls).toEqual(['table:B']);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Macro, paso 4 (Abrir tabla): No existe el campo [Nada2].');
  });

  it('StopMacro ends it early (with a condition: "if so, stop")', () => {
    const { host, calls } = setup();
    const r = runMacro({ steps: [{ action: 'OpenTable', args: { table: 'A' } }, { action: 'StopMacro', args: {}, condition: '[Saldo] = 5' }, { action: 'OpenTable', args: { table: 'B' } }] }, host);
    expect(r).toEqual({ ok: true, ran: 2 });
    expect(calls).toEqual(['table:A']);
  });

  it('SetValue writes the expression to a field of the current form or of a named one', () => {
    const { host, rec } = setup();
    const r = runMacro(
      {
        steps: [
          { action: 'SetValue', args: { item: 'Saldo', expression: '[Saldo] * 2 + 1' } },
          { action: 'SetValue', args: { item: 'Me!Nombre', expression: 'Upper([Nombre]) & "!"' } },
          { action: 'SetValue', args: { item: 'Forms!F1![Activo]', expression: 'False' } },
        ],
      },
      host,
    );
    expect(r.ok).toBe(true);
    expect(rec).toEqual({ Nombre: 'ANA!', Saldo: 11, Activo: false });
    const bad = runMacro({ steps: [{ action: 'SetValue', args: { item: 'Forms!Otro!X', expression: '1' } }] }, host);
    expect(bad.error).toMatch(/formulario "Otro" no está abierto/);
  });

  it('RunSQL: literal text or an expression; the change can be undone', () => {
    const { host, db } = setup();
    runMacro({ steps: [{ action: 'RunSQL', args: { sql: 'UPDATE T SET n = n + 1' } }, { action: 'RunSQL', args: { sql: '="UPDATE T SET n = n * " & [Saldo]' } }] }, host);
    expect(db.execute('SELECT n FROM T ORDER BY id').rows).toEqual([[55], [105]]);
    db.undo();
    db.undo();
    expect(db.execute('SELECT n FROM T ORDER BY id').rows).toEqual([[10], [20]]);
    expect(runMacro({ steps: [{ action: 'RunSQL', args: { sql: 'DELETE FROM Nada' } }] }, host).error).toMatch(/paso 1 \(Ejecutar SQL\): .*Nada/);
    expect(runMacro({ steps: [{ action: 'RunSQL', args: { sql: '  ' } }] }, host).error).toMatch(/Falta la instrucción SQL/);
  });

  it('RunMacro nests, and a macro that calls itself is stopped', () => {
    const macros: Record<string, MacroDef> = {
      Hija: { steps: [{ action: 'OpenTable', args: { table: 'H' } }] },
      Bucle: { steps: [{ action: 'RunMacro', args: { macro: 'Bucle' } }] },
    };
    const { host, calls } = setup(macros);
    expect(runMacro({ steps: [{ action: 'RunMacro', args: { macro: 'Hija' } }, { action: 'OpenTable', args: { table: 'P' } }] }, host)).toEqual({ ok: true, ran: 3 });
    expect(calls).toEqual(['table:H', 'table:P']);
    const r = runMacro(macros.Bucle!, host, 'Bucle');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/anidadas|límite/);
    expect(runMacro({ steps: [{ action: 'RunMacro', args: { macro: 'NoHay' } }] }, host).error).toMatch(/No existe la macro "NoHay"/);
  });

  it('RunCode calls a procedure with arguments evaluated from the record', () => {
    const { host, calls } = setup();
    runMacro({ steps: [{ action: 'RunCode', args: { proc: 'Avisar' } }, { action: 'RunCode', args: { proc: 'Sumar(1, [Saldo] * 2, "a,b", Upper("x"))' } }] }, host);
    expect(calls).toEqual(['proc:Avisar()', 'proc:Sumar(1,10,a,b,X)']);
    expect(parseProcCall('F( 1 , "x(y)" )', {})).toEqual({ name: 'F', args: [1, 'x(y)'] });
    expect(() => parseProcCall('1 + 2', {})).toThrow(/llamada válida/);
  });

  it('MessageBox shows text or an expression, with the type the author chose', () => {
    const { host, msgs } = setup();
    runMacro({ steps: [{ action: 'MessageBox', args: { message: 'Hola', title: 'Aviso' } }, { action: 'MessageBox', args: { message: '="Saldo de " & [Nombre] & ": " & [Saldo]', type: 'warning' } }, { action: 'MessageBox', args: { message: '¿Seguro?', type: 'question' } }] }, host);
    expect(msgs).toEqual(['Aviso|64|Hola', 'Nova Base|48|Saldo de Ana: 5', 'Nova Base|36|¿Seguro?']);
  });

  it('temporary variables are shared with the code and visible to expressions', () => {
    const { host } = setup();
    runMacro({ steps: [{ action: 'SetTempVar', args: { name: 'Limite', expression: '[Saldo] * 10' } }, { action: 'SetTempVar', args: { name: 'x', expression: '"t"' } }, { action: 'SetValue', args: { item: 'Saldo', expression: '[Limite] + 1' }, condition: '[Limite] = 50' }] }, host);
    expect(host.tempVars.values.get('limite')).toBe(50);
    expect(host.me()!.get('Saldo')).toBe(51);
    runMacro({ steps: [{ action: 'RemoveTempVar', args: { name: 'x' } }] }, host);
    expect([...host.tempVars.values.keys()]).toEqual(['limite']);
    runMacro({ steps: [{ action: 'RemoveTempVar', args: { name: '*' } }] }, host);
    expect(host.tempVars.values.size).toBe(0);
  });

  it('GoToRecord and CloseWindow go through the form and the host', () => {
    const { host, calls } = setup();
    runMacro({ steps: [{ action: 'GoToRecord', args: { record: 'last' } }, { action: 'GoToRecord', args: { record: 'first', form: 'F1' } }, { action: 'CloseWindow', args: { kind: 'form', name: 'F1' } }, { action: 'CloseWindow', args: {} }] }, host);
    expect(calls).toEqual(['goto:last', 'goto:first', 'close:form:F1', 'close:any:']);
    expect(runMacro({ steps: [{ action: 'GoToRecord', args: { record: 'next', form: 'Otro' } }] }, host).error).toMatch(/No hay un formulario/);
  });

  it('validation lists what does not exist or does not parse', () => {
    const ctx = { forms: ['F1'], reports: ['R'], tables: ['T'], queries: ['Q'], macros: ['M', 'Self'], procs: ['Avisar'] };
    const ok: MacroDef = { steps: [{ action: 'OpenForm', args: { form: 'f1' } }, { action: 'RunCode', args: { proc: 'avisar(1)' } }, { action: 'SetValue', args: { item: 'X', expression: '1+1' }, condition: '[A] > 1' }] };
    expect(validateMacro(ok, ctx)).toEqual([]);
    const bad: MacroDef = {
      steps: [
        { action: 'OpenForm', args: { form: 'Nada' } },
        { action: 'OpenReport', args: {} },
        { action: 'RunMacro', args: { macro: 'Self' } },
        { action: 'RunCode', args: { proc: 'Nope()' } },
        { action: 'SetValue', args: { item: 'X', expression: '1 +' } },
        { action: 'OpenTable', args: { table: 'T' }, condition: '[a' },
        { action: 'OpenQuery', args: { query: 'Nada' }, disabled: true },
      ],
    };
    const w = validateMacro(bad, ctx, 'Self');
    expect(w).toEqual([
      'Paso 1 (Abrir formulario): formulario "Nada" no existe.',
      'Paso 2 (Abrir informe): falta "Informe".',
      'Paso 3: la macro se llama a sí misma.',
      'Paso 4 (Ejecutar código): el procedimiento "Nope" no existe.',
      'Paso 5 (Establecer valor): La expresión está incompleta.',
      'Paso 6: la condición no es válida: Falta cerrar el corchete del campo.',
    ]);
  });

  it('an unknown action stops with a clear message instead of doing nothing', () => {
    const { host } = setup();
    const r = runMacro({ steps: [{ action: 'FormatearDisco' as never, args: {} }] }, host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/paso 1 \(FormatearDisco\): Acción desconocida/);
  });
});
