import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, loadSql } from '../index';
import { TempVars, runMacro, validateMacro, whereSql, type BVal, type FormLike, type MacroDef, type MacroHost, type MacroStep } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});

const st = (action: MacroStep['action'], args: Record<string, string> = {}, more: Partial<MacroStep> = {}): MacroStep => ({ action, args, ...more });
const mb = (text: string) => st('MessageBox', { message: text });

function setup(macros: Record<string, MacroDef> = {}) {
  const db = BaseDb.open(SQL);
  db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY, nombre TEXT, saldo REAL, zona TEXT);
    CREATE TABLE Pedidos (id INTEGER PRIMARY KEY, cliente INTEGER, total REAL);
    CREATE TABLE Log (id INTEGER PRIMARY KEY, msg TEXT);
    INSERT INTO Clientes VALUES (1, 'Ana', 10, 'Sur'), (2, 'Luis', 3, 'Norte'), (3, 'Eva', 7, 'Sur');
    INSERT INTO Pedidos VALUES (1, 1, 5), (2, 1, 7), (3, 2, 9);`);
  db.clearUndo();
  const calls: string[] = [];
  const msgs: string[] = [];
  const rec: Record<string, BVal> = { Nombre: 'Ana', Saldo: 5, Activo: true };
  const form: FormLike & { find: (f: string, v: BVal) => boolean } = {
    name: 'F1',
    table: 'Clientes',
    record: () => ({ ...rec }),
    get: (f) => rec[f] ?? null,
    set: (f, v) => void (rec[f] = v),
    goto: (w) => void calls.push(`goto:${w}`),
    requery: () => void calls.push('requery'),
    find: (f, v) => (calls.push(`find:${f}=${String(v)}`), v === 'Eva'),
  };
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
    applyFilter: (f, w) => void calls.push(`filter:${f}:${w}`),
    macro: (n) => macros[n] ?? null,
    runProc: (n, a) => void calls.push(`proc:${n}(${a.join(',')})`),
    msgBox: (p) => (msgs.push(p), 1),
  };
  return { host, calls, msgs, db, rec };
}

describe('macros: If, Else If, Else, Group', () => {
  const branches = (cond: string): MacroDef => ({
    steps: [st('If', {}, { condition: cond, children: [mb('uno')], elseIfs: [{ condition: '[Saldo] = 5', steps: [mb('dos')] }], elseSteps: [mb('tres')] }), mb('fin')],
  });
  it('runs the first branch whose condition holds, or the Else', () => {
    let s = setup();
    expect(runMacro(branches('[Saldo] > 100'), s.host)).toMatchObject({ ok: true });
    expect(s.msgs).toEqual(['dos', 'fin']);
    s = setup();
    runMacro(branches('[Saldo] = 5'), s.host);
    expect(s.msgs).toEqual(['uno', 'fin']);
    s = setup();
    s.rec.Saldo = 1;
    runMacro(branches('[Saldo] > 100'), s.host);
    expect(s.msgs).toEqual(['tres', 'fin']);
  });
  it('If blocks nest and Groups only organise', () => {
    const { host, msgs } = setup();
    const r = runMacro({ steps: [st('Group', { name: 'g' }, { children: [st('If', {}, { condition: 'True', children: [st('If', {}, { condition: '[Activo]', children: [mb('dentro')] })] })] })] }, host);
    expect(r.ok).toBe(true);
    expect(msgs).toEqual(['dentro']);
  });
  it('a disabled block is skipped whole; the count of steps is of those that ran', () => {
    const { host, msgs } = setup();
    const r = runMacro({ steps: [st('If', {}, { condition: 'True', disabled: true, children: [mb('no')] }), st('If', {}, { condition: 'True', children: [mb('a'), mb('b')] })] }, host);
    expect(msgs).toEqual(['a', 'b']);
    expect(r.ran).toBe(2);
  });
  it('an error inside a block names the step with its path', () => {
    const { host } = setup();
    const r = runMacro({ steps: [mb('x'), st('If', {}, { condition: 'True', children: [mb('y'), st('RunSQL', { sql: 'DELETE FROM Nada' })] })] }, host, 'M');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^M, paso 2\.2 \(Ejecutar SQL\):/);
    const r2 = runMacro({ steps: [st('If', {}, { condition: 'False', children: [], elseIfs: [{ condition: 'True', steps: [st('OpenTable', {}), mb('z')] }] })] }, host, 'M');
    expect(r2.ok).toBe(true);
  });
});

describe('macros: submacros and RunMacro', () => {
  const lib: MacroDef = { steps: [mb('inicio'), st('Submacro', { name: 'Saluda' }, { children: [mb('hola')] }), st('Submacro', { name: 'Adios' }, { children: [mb('adios'), st('StopMacro')] }), mb('final')] };
  it('RunMacro Macro.Sub runs only the submacro; without it, the steps outside submacros', () => {
    const { host, msgs } = setup({ Lib: lib });
    runMacro({ steps: [st('RunMacro', { macro: 'Lib.Saluda' }), st('RunMacro', { macro: 'Lib.adios' }), st('RunMacro', { macro: 'Lib' })] }, host);
    expect(msgs).toEqual(['hola', 'adios', 'inicio', 'final']);
  });
  it('.Sub is a submacro of the macro itself, and an unknown one says so', () => {
    const { host, msgs } = setup();
    const self: MacroDef = { steps: [st('RunMacro', { macro: '.Interna' }), mb('despues'), st('Submacro', { name: 'Interna' }, { children: [mb('interna')] })] };
    expect(runMacro(self, host, 'Yo').ok).toBe(true);
    expect(msgs).toEqual(['interna', 'despues']);
    const bad = runMacro({ steps: [st('RunMacro', { macro: '.Nada' })] }, host, 'Yo');
    expect(bad.error).toMatch(/No existe la submacro "Nada"/);
  });
  it('StopAllMacros stops the caller too; StopMacro only the one that runs', () => {
    const m: Record<string, MacroDef> = { Corta: { steps: [mb('c1'), st('StopMacro'), mb('c2')] }, Todo: { steps: [mb('t1'), st('StopAllMacros'), mb('t2')] } };
    let s = setup(m);
    runMacro({ steps: [st('RunMacro', { macro: 'Corta' }), mb('sigue')] }, s.host);
    expect(s.msgs).toEqual(['c1', 'sigue']);
    s = setup(m);
    runMacro({ steps: [st('RunMacro', { macro: 'Todo' }), mb('no llega')] }, s.host);
    expect(s.msgs).toEqual(['t1']);
  });
  it('local variables live through the calls of one run, and not beyond', () => {
    const m: Record<string, MacroDef> = { Usa: { steps: [st('MessageBox', { message: '="x=" & [x]' })] } };
    const { host, msgs } = setup(m);
    runMacro({ steps: [st('SetLocalVar', { name: 'x', expression: '[Saldo] * 2' }), st('RunMacro', { macro: 'Usa' })] }, host);
    expect(msgs).toEqual(['x=10']);
    const again = runMacro({ steps: [st('MessageBox', { message: '="x=" & [x]' })] }, host);
    expect(again.ok).toBe(false);
  });
});

describe('macros: OnError, RaiseError, CancelEvent', () => {
  it('OnError Next goes on after a failing step and exposes MacroError', () => {
    const { host, msgs } = setup();
    const r = runMacro({ steps: [st('OnError', { mode: 'next' }), st('RaiseError', { message: 'malo', number: '77' }), st('MessageBox', { message: '="visto: " & [MacroError.Description] & " " & [MacroError.Number]' })] }, host);
    expect(r.ok).toBe(true);
    expect(msgs).toEqual(['visto: malo 77']);
  });
  it('OnError with a macro runs it and stops; the default is to stop with the error', () => {
    const m: Record<string, MacroDef> = { Manejo: { steps: [st('Submacro', { name: 'Error' }, { children: [st('MessageBox', { message: '="falló: " & [MacroError.Description]' })] })] } };
    const { host, msgs } = setup(m);
    const r = runMacro({ steps: [st('OnError', { mode: 'macro', macro: 'Manejo.Error' }), st('RaiseError', { message: 'boom' }), mb('no')] }, host);
    expect(r.ok).toBe(true);
    expect(msgs).toEqual(['falló: boom']);
    const plain = runMacro({ steps: [st('RaiseError', { message: 'sin manejo' })] }, host, 'M');
    expect(plain).toMatchObject({ ok: false, error: 'M, paso 1 (Provocar un error): sin manejo' });
  });
  it('CancelEvent is reported to whoever started the macro', () => {
    const { host } = setup();
    expect(runMacro({ steps: [st('CancelEvent'), mb('sigue')] }, host)).toMatchObject({ ok: true, cancel: true });
    expect(runMacro({ steps: [mb('x')] }, host).cancel).toBeUndefined();
  });
});

describe('macros: data actions', () => {
  it('CreateRecord adds a row with SetField values taken from the context', () => {
    const { host, db } = setup();
    const r = runMacro({ steps: [st('SetLocalVar', { name: 'quien', expression: '"Zoe"' }), st('CreateRecord', { table: 'Clientes' }, { children: [st('SetField', { name: 'nombre', expression: '[quien]' }), st('SetField', { name: 'saldo', expression: '[Saldo] + 1' })] })] }, host);
    expect(r.ok).toBe(true);
    expect(db.execute(`SELECT nombre, saldo FROM Clientes WHERE nombre = 'Zoe'`).rows).toEqual([['Zoe', 6]]);
  });
  it('EditRecord changes the rows that meet the condition, which may use variables and form values', () => {
    const { host, db } = setup();
    runMacro({ steps: [st('SetLocalVar', { name: 'z', expression: '"Sur"' }), st('SetLocalVar', { name: 'limite', expression: '[Saldo]' }), st('EditRecord', { table: 'Clientes', where: '[zona] = [z] And [saldo] > [limite]' }, { children: [st('SetField', { name: 'saldo', expression: '0' })] })] }, host);
    // Saldo of the form is 5: Ana (Sur, 10) and Eva (Sur, 7) qualify
    expect(db.execute('SELECT id, saldo FROM Clientes ORDER BY id').rows).toEqual([[1, 0], [2, 3], [3, 0]]);
    const bad = runMacro({ steps: [st('EditRecord', { table: 'Clientes' }, { children: [st('SetField', { name: 'nada', expression: '1' })] })] }, host, 'M');
    expect(bad.error).toMatch(/no tiene el campo "nada"/);
  });
  it('LookupRecord reads the first match as [Alias.campo]; Else runs when nothing matches', () => {
    const { host, msgs } = setup();
    runMacro(
      {
        steps: [
          st('LookupRecord', { table: 'Clientes', where: '[nombre] = "Luis"', alias: 'c' }, { children: [st('MessageBox', { message: '=[c.nombre] & ":" & [c.saldo]' })], elseSteps: [mb('nadie')] }),
          st('LookupRecord', { table: 'Clientes', where: '[nombre] = "Nadie"' }, { children: [mb('hay')], elseSteps: [mb('nadie')] }),
        ],
      },
      host,
    );
    expect(msgs).toEqual(['Luis:3', 'nadie']);
  });
  it('ForEachRecord repeats for every row, and a data action inside can use the alias', () => {
    const { host, db } = setup();
    const r = runMacro(
      {
        steps: [
          st('ForEachRecord', { table: 'Pedidos', where: '[total] > 5', alias: 'p' }, { children: [st('CreateRecord', { table: 'Log' }, { children: [st('SetField', { name: 'msg', expression: '"pedido " & [p.id] & " de " & [p.cliente]' })] })] }),
        ],
      },
      host,
    );
    expect(r.ok).toBe(true);
    expect(db.execute('SELECT msg FROM Log ORDER BY id').rows).toEqual([['pedido 2 de 1'], ['pedido 3 de 2']]);
  });
  it('a value of the macro used in a condition is quoted safely', () => {
    const { host, db } = setup();
    runMacro({ steps: [st('SetLocalVar', { name: 'n', expression: '"x\' OR 1=1 --"' }), st('DeleteRecord', { table: 'Clientes', where: '[nombre] = [n]' })] }, host);
    expect(db.count('Clientes')).toBe(3);
    runMacro({ steps: [st('DeleteRecord', { table: 'Pedidos', where: '[cliente] = 1' })] }, host);
    expect(db.count('Pedidos')).toBe(1);
    expect(whereSql(host, 'Clientes', '[id] = [Otro]', { Otro: 4 })).toContain('= 4');
    expect(() => whereSql(host, 'Nada', '[id] = 1', {})).toThrow(/No existe la tabla/);
  });
  it('SetField outside Create/Edit is an error; a table that does not exist is named', () => {
    const { host } = setup();
    expect(runMacro({ steps: [st('SetField', { name: 'a', expression: '1' })] }, host).error).toMatch(/solo se puede usar dentro/);
    expect(runMacro({ steps: [st('DeleteRecord', { table: 'Nada' })] }, host).error).toMatch(/No existe la tabla "Nada"/);
  });
});

describe('macros: form actions', () => {
  it('SearchForRecord, ApplyFilter and ShowAllRecords go through the form and the host', () => {
    const { host, calls, msgs } = setup();
    runMacro({ steps: [st('SearchForRecord', { field: 'nombre', value: '"Eva"' }), st('MessageBox', { message: '=IIf([RecordFound], "sí", "no")' }), st('SearchForRecord', { field: 'nombre', value: '"Nadie"' }), st('ApplyFilter', { where: '[saldo] > 5' }), st('ShowAllRecords', { form: 'F1' })] }, host);
    expect(calls).toEqual(['find:nombre=Eva', 'find:nombre=Nadie', 'filter:F1:[saldo] > 5', 'filter:F1:']);
    expect(msgs).toEqual(['sí']);
  });
});

describe('macros: validation of blocks', () => {
  const ctx = { forms: ['F1'], reports: [], tables: ['Clientes'], queries: [], macros: ['M', 'Lib'], procs: [], subs: { lib: ['saluda'] } };
  it('checks nested steps, submacro references and misplaced steps', () => {
    const def: MacroDef = {
      steps: [
        st('If', {}, { children: [st('OpenForm', { form: 'Nada' })] }),
        st('RunMacro', { macro: 'Lib.Nada' }),
        st('RunMacro', { macro: 'Lib.saluda' }),
        st('RunMacro', { macro: '.Mia' }),
        st('RunMacro', { macro: '.Otra' }),
        st('Group', { name: 'g' }, { children: [st('Submacro', { name: 'x' }, { children: [] })] }),
        st('SetField', { name: 'a', expression: '1' }),
        st('EditRecord', { table: 'Clientes' }, { children: [st('SetField', { name: 'saldo', expression: '1 +' })] }),
        st('Submacro', { name: 'Mia' }, { children: [] }),
        st('OnError', { mode: 'macro' }),
      ],
    };
    const w = validateMacro(def, ctx, 'M');
    expect(w).toEqual([
      'Paso 1 (Si… (If)): falta la condición.',
      'Paso 1.1 (Abrir formulario): formulario "Nada" no existe.',
      'Paso 2 (Ejecutar macro): la submacro "nada" no existe en "Lib".',
      'Paso 5 (Ejecutar macro): la submacro "otra" no existe en esta macro.',
      'Paso 6.1: una submacro solo puede estar al nivel superior de la macro.',
      'Paso 7: Establecer campo solo se puede usar dentro de Crear registro o Modificar registros (o en una macro de datos).',
      'Paso 8.1 (Establecer campo): La expresión está incompleta.',
      'Paso 10 (Al producirse un error): falta "Macro de error".',
    ]);
    expect(validateMacro({ steps: [st('SetField', { name: 'a', expression: '1' })] }, ctx, 'M', { data: true })).toEqual([]);
    expect(validateMacro({ steps: [st('CancelEvent')] }, ctx, 'M', { data: true })[0]).toMatch(/no vale en una macro de datos/);
  });
});
