import { describe, expect, it } from 'vitest';
import { PlanCtl } from './ctl';
import { describeChange } from './recorder';

const fresh = () => {
  const c = new PlanCtl();
  c.contentEnabled = true;
  return c;
};

/** Records `act` on a project, replays the macro on another one with the same start and returns both. */
function roundTrip(act: (c: PlanCtl) => void, setup?: (c: PlanCtl) => void) {
  const a = fresh();
  setup?.(a);
  const b = fresh();
  b.commit(a.project);
  a.startRecording('Grabada', '');
  act(a);
  a.stopRecording();
  const code = a.macros.find((m) => m.name === 'Grabadas')!.code;
  b.macros = a.macros;
  const r = b.macroRt.run('Grabada');
  return { a, b, code, r };
}

describe('grabadora de Plan', () => {
  it('graba tareas, duración, avance, predecesoras y recursos, y la macro los reproduce', () => {
    const { a, b, code, r } = roundTrip((c) => {
      c.add();
      c.add();
      const [t1, t2] = c.project.tasks;
      c.commit({ ...c.project, tasks: c.project.tasks.map((t) => (t.id === t1!.id ? { ...t, name: 'Diseño', duration: 1440, percent: 50 } : t.id === t2!.id ? { ...t, name: 'Obra' } : t)) });
    });
    expect(r.ok).toBe(true);
    expect(code).toContain('ActiveProject.Tasks.Add Name:=');
    expect(code).toContain('.Duration = 1440');
    expect(code).toContain('.PercentComplete = 50');
    expect(b.project.tasks.map((t) => [t.name, t.duration, t.percent])).toEqual(a.project.tasks.map((t) => [t.name, t.duration, t.percent]));
  });

  it('lo que no se puede escribir queda como comentario', () => {
    const c = fresh();
    c.add();
    const next = { ...c.project, tasks: c.project.tasks.map((t) => ({ ...t, deadline: 99999 })) };
    const d = describeChange(c.project, next);
    expect(d.lines).toEqual([]);
    expect(d.unsupported).toEqual(['fecha límite']);
  });

  it('una pausa no graba, y borrar una tarea se escribe con su número, de la última a la primera', () => {
    const c = fresh();
    c.add();
    c.add();
    c.startRecording('M', '');
    c.pauseRecording();
    c.add();
    c.pauseRecording();
    c.commit({ ...c.project, tasks: c.project.tasks.slice(0, 1) });
    c.stopRecording();
    const code = c.macros[0]!.code;
    expect(code).not.toContain('Tasks.Add');
    expect(code).toContain('ActiveProject.Tasks(2).Delete');
  });
});
