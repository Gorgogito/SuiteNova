import { describe, expect, it } from 'vitest';
import { PlanCtl } from './ctl';

const lines = (...l: string[]) => l.join(String.fromCharCode(10));

function make(code: string) {
  const ctl = new PlanCtl();
  ctl.macros = [{ name: 'Modulo1', code }];
  ctl.contentEnabled = true;
  return ctl;
}
const run = (ctl: PlanCtl, name = 'Prueba') => ctl.macroRt.run(name);

describe('macros de Plan', () => {
  it('crea tareas con duración, predecesoras y avance, y lee las fechas calculadas', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim t1, t2, t3',
        '  Set t1 = ActiveProject.Tasks.Add("Diseño")',
        '  Set t2 = ActiveProject.Tasks.Add("Construcción")',
        '  Set t3 = ActiveProject.Tasks.Add("Entrega")',
        '  t1.Duration = 3 * 480',
        '  t2.Duration = 5 * 480',
        '  t3.Duration = 0',
        '  t2.Predecessors = "1"',
        '  t3.Predecessors = "2"',
        '  t1.PercentComplete = 100',
        '  Prueba = ActiveProject.Tasks.Count & "|" & t2.ID & "|" & t2.Predecessors & "|" & t3.Milestone & "|" & t2.Critical & "|" & (t2.Start > t1.Start) & "|" & (ActiveProject.ProjectFinish >= t3.Finish)',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe('3|2|1|-1|-1|Verdadero|Verdadero');
    expect(ctl.project.tasks.map((t) => t.name)).toEqual(['Diseño', 'Construcción', 'Entrega']);
    expect(ctl.project.tasks[0]!.percent).toBe(100);
    expect(ctl.project.tasks[1]!.links[0]!.task).toBe(ctl.project.tasks[0]!.id);
  });

  it('Add con «Before» inserta delante; nivel de esquema crea un resumen; borrar', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  ActiveProject.Tasks.Add "B"',
        '  ActiveProject.Tasks.Add "C"',
        '  ActiveProject.Tasks.Add "A", 1',
        '  ActiveProject.Tasks(2).OutlineLevel = 2',
        '  Prueba = ActiveProject.Tasks(1).Name & ActiveProject.Tasks(2).Name & ActiveProject.Tasks(3).Name & "|" & ActiveProject.Tasks(1).Summary & "|" & ActiveProject.Tasks(2).OutlineLevel',
        '  ActiveProject.Tasks(3).Delete',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe('ABC|-1|2');
    expect(ctl.project.tasks.map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('recursos y asignaciones', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim r, t',
        '  Set r = ActiveProject.Resources.Add("Ana")',
        '  r.StandardRate = 25',
        '  r.MaxUnits = 1',
        '  ActiveProject.Resources.Add("Luis").Type = pjResourceTypeWork',
        '  Set t = ActiveProject.Tasks.Add("Hacer")',
        '  t.Duration = 960',
        '  t.Assignments.Add 1, 1',
        '  Prueba = t.ResourceNames & "|" & t.Assignments.Count & "|" & t.Work & "|" & t.Cost & "|" & ActiveProject.Resources("Ana").StandardRate',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe('Ana|1|960|400|25');
  });

  it('SetField y GetField escriben y leen como la tabla, con sus mensajes de error', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim t',
        '  Set t = ActiveProject.Tasks.Add("X")',
        '  t.SetField "duration", "3d"',
        '  Prueba = t.GetField("duration") & "|" & t.Duration',
        'End Function',
        'Sub Mal()',
        '  ActiveProject.Tasks.Add("Y").SetField "duration", "xyz"',
        'End Sub',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(String(r.value)).toMatch(/^3.*\|1440$/);
    const bad = run(ctl, 'Mal');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('duración');
  });

  it('una macro es un solo paso de deshacer', () => {
    const ctl = make(lines('Sub Prueba()', '  Dim i', '  For i = 1 To 4', '    ActiveProject.Tasks.Add "T" & i', '  Next i', 'End Sub'));
    const before = ctl.project.tasks.length;
    expect(run(ctl).error ?? '').toBe('');
    expect(ctl.project.tasks.length).toBe(before + 4);
    ctl.undo();
    expect(ctl.project.tasks.length).toBe(before);
    ctl.redo();
    expect(ctl.project.tasks.length).toBe(before + 4);
  });

  it('con el contenido activo deshabilitado no corre; las macros no entran en el proyecto que se deshace', () => {
    const ctl = make('Sub Prueba()\nEnd Sub');
    ctl.contentEnabled = false;
    expect(run(ctl).ok).toBe(false);
    ctl.contentEnabled = true;
    expect(ctl.saved.macros).toEqual(ctl.macros);
    expect(ctl.project.macros).toBeUndefined();
    const reloaded = new PlanCtl();
    reloaded.load(ctl.saved, 'x.novaplan', null);
    expect(reloaded.macros).toEqual(ctl.macros);
    expect(reloaded.contentEnabled).toBe(false);
    expect(reloaded.project.macros).toBeUndefined();
  });
});
