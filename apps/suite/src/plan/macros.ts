import { basic } from '@suitenova/base-core';
import { addTask, deleteResource, deleteTasks, formatPredecessors, linkTasks, newResource, setDuration, setWork, shiftOutline, type Project, type Task } from '@suitenova/plan-core';
import '../macros/messages';
import { collection, makeObject, type ParamTable } from '../macros/objects';
import { MacroRuntime, type MacroRun } from '../macros/runtime';
import { applyCell, cellText } from './columns';
import type { PlanCtl } from './ctl';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError, toNum, toStr, toBool } = basic;

export type { MacroRun };

/** The constants of the Project object model that macros use, by lower-case name. */
export const PJ_CONSTANTS: Record<string, number> = {
  pjresourcetypework: 0, pjresourcetypematerial: 1, pjresourcetypecost: 2,
  vbblack: 0, vbred: 255, vbgreen: 65280, vbblue: 16711680,
};

const PARAMS: ParamTable = { add: ['name', 'before'], setfield: ['field', 'value'], getfield: ['field'], selectrow: ['row', 'rowrelative'] };

/** Minutes since the epoch of the project clock ↔ a VBA date with the same wall clock. */
const toDate = (t: number): Date => {
  const d = new Date(t * 60000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
};
const toTime = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000;
const pad = (n: number) => String(n).padStart(2, '0');
/** The text the date cells read: `14/03/2025 10:30`. */
export const dateText = (d: Date): string => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const asDate = (v: BVal): Date => {
  if (v instanceof Date) return v;
  const d = new Date(toStr(v));
  if (Number.isNaN(d.getTime())) throw new BasicError(13, 'Fecha no válida.');
  return d;
};

/** Runs the macros of a project: Nova Basic with the objects of a project manager (Project, Task, Resource…). */
export class PlanRuntime extends MacroRuntime {
  constructor(readonly ctl: PlanCtl) {
    super();
  }
  get modules(): { name: string; code: string }[] {
    return this.ctl.macros;
  }
  protected enabled(): boolean {
    return this.ctl.contentEnabled;
  }
  protected changed(): void {
    this.ctl.touch();
  }
  protected hostObjects(): Record<string, BVal> {
    return { ...PJ_CONSTANTS, ...this.objects() };
  }

  /** Everything a macro does is one step of the history. */
  protected guarded(fn: () => MacroRun): MacroRun {
    if (++this.depth > 20) {
      this.depth--;
      return { ok: false, error: 'Demasiadas llamadas anidadas.' };
    }
    let result: MacroRun = { ok: true };
    try {
      if (this.depth === 1) this.ctl.undoGroup(() => (result = fn()));
      else result = fn();
    } catch (e) {
      result = this.report(e);
      this.lastAt = result.at;
    } finally {
      this.depth--;
    }
    this.ctl.touch();
    return result;
  }

  private objects(): Record<string, BVal> {
    const ctl = this.ctl;
    const make = (def: Parameters<typeof makeObject>[0]) => makeObject(def, PARAMS);
    const err = (msg: string, n = 5): never => {
      throw new BasicError(n, msg);
    };
    const proj = (): Project => ctl.project;
    const indexOf = (id: string): number => {
      const i = proj().tasks.findIndex((t) => t.id === id);
      return i < 0 ? err('La tarea ya no existe.', 91) : i;
    };
    const sched = () => ctl.sched ?? err('El proyecto no se puede calcular: ' + ('error' in ctl.result ? ctl.result.error : ''), 5);
    /** Sets a field the way typing it in the table would. */
    const setField = (id: string, col: string, text: string) => {
      const ctx = ctl.ctx ?? err('El proyecto no se puede calcular.');
      const r = applyCell(ctx, indexOf(id), col, text);
      if ('error' in r) err(r.error);
      else ctl.commit(r.project);
    };

    const assignments = (id: string): BObject =>
      make({
        type: 'Assignments',
        props: {
          count: { get: () => proj().tasks[indexOf(id)]!.assignments.length },
        },
        methods: {
          add: (a) => {
            const res = proj().resources[Math.trunc(toNum(a[0])) - 1];
            if (!res) err('No existe ese recurso.', 9);
            ctl.assign(id, res!.id, a[1] === undefined ? 1 : toNum(a[1]));
            return undefined;
          },
        },
        items: () => proj().tasks[indexOf(id)]!.assignments.map((x) => make({ type: 'Assignment', props: { resourcename: { get: () => proj().resources.find((r) => r.id === x.resource)?.name ?? '' }, units: { get: () => x.units } } })),
      });

    const task = (id: string): BObject => {
      const t = (): Task => proj().tasks[indexOf(id)]!;
      const s = () => sched().tasks[indexOf(id)]!;
      return make({
        type: 'Task',
        props: {
          id: { get: () => indexOf(id) + 1 },
          name: { get: () => t().name, set: (v) => setField(id, 'name', toStr(v)) },
          notes: { get: () => t().notes, set: (v) => setField(id, 'notes', toStr(v)) },
          duration: { get: () => s().duration, set: (v) => ctl.commit(setDuration(proj(), id, Math.max(0, Math.round(toNum(v))), t().elapsed)) },
          start: { get: () => toDate(s().start), set: (v) => setField(id, 'start', dateText(asDate(v))) },
          finish: { get: () => toDate(s().finish), set: (v) => setField(id, 'finish', dateText(asDate(v))) },
          percentcomplete: { get: () => t().percent, set: (v) => setField(id, 'percent', String(toNum(v))) },
          outlinelevel: {
            get: () => t().outline,
            set: (v) => {
              const want = Math.trunc(toNum(v));
              for (let guard = 0; guard < 20 && t().outline !== want; guard++) {
                const next = shiftOutline(proj(), indexOf(id), want > t().outline ? 1 : -1);
                if (next === proj()) err('No se puede cambiar el nivel de esquema de esa tarea.');
                ctl.commit(next);
              }
            },
          },
          summary: { get: () => (s().summary ? -1 : 0) },
          milestone: { get: () => (s().milestone ? -1 : 0) },
          critical: { get: () => (s().critical ? -1 : 0) },
          wbs: { get: () => s().wbs },
          work: { get: () => s().work, set: (v) => ctl.commit(setWork(proj(), id, Math.max(0, Math.round(toNum(v))))) },
          cost: { get: () => s().cost },
          actualcost: { get: () => s().actualCost },
          fixedcost: { get: () => t().fixedCost, set: (v) => setField(id, 'fixedCost', String(toNum(v))) },
          priority: { get: () => t().priority ?? 500, set: (v) => setField(id, 'priority', String(toNum(v))) },
          manual: { get: () => (t().manual ? -1 : 0), set: (v) => setField(id, 'manual', toBool(v) ? 'Sí' : 'No') },
          predecessors: { get: () => formatPredecessors(proj(), t()), set: (v) => setField(id, 'predecessors', toStr(v)) },
          resourcenames: { get: () => t().assignments.map((a) => proj().resources.find((r) => r.id === a.resource)?.name ?? '').filter(Boolean).join(', '), set: (v) => setField(id, 'resources', toStr(v)) },
          assignments: { get: () => assignments(id) },
        },
        methods: {
          delete: () => {
            ctl.commit(deleteTasks(proj(), [id]));
            return undefined;
          },
          outlineindent: () => {
            const next = shiftOutline(proj(), indexOf(id), 1);
            if (next === proj()) err('No se puede aumentar el nivel de esquema de esa tarea.');
            ctl.commit(next);
            return undefined;
          },
          outlineoutdent: () => {
            const next = shiftOutline(proj(), indexOf(id), -1);
            if (next === proj()) err('No se puede reducir el nivel de esquema de esa tarea.');
            ctl.commit(next);
            return undefined;
          },
          linkpredecessors: (a) => {
            const pred = (a[0] as BObject | undefined)?.get('id', []);
            const from = typeof pred === 'number' ? proj().tasks[pred - 1] : undefined;
            if (!from) err('Indica la tarea predecesora.');
            const r = linkTasks(proj(), from!.id, id);
            if (r.error) err(r.error);
            ctl.commit(r.project);
            return undefined;
          },
          setfield: (a) => {
            setField(id, toStr(a[0]), toStr(a[1]));
            return undefined;
          },
          getfield: (a) => cellText(ctl.ctx ?? err('El proyecto no se puede calcular.'), indexOf(id), toStr(a[0])),
          select: () => {
            ctl.select(indexOf(id));
            return undefined;
          },
        },
      });
    };

    const tasks = (): BObject => {
      const list = () => proj().tasks.map((x) => task(x.id));
      const base = collection('Tasks', list, (o) => toStr(o.get('name', [])));
      return make({
        type: 'Tasks',
        props: { count: { get: () => proj().tasks.length } },
        methods: {
          add: (a) => {
            const before = a[1] === undefined ? null : Math.trunc(toNum(a[1]));
            if (before !== null && (before < 1 || before > proj().tasks.length)) err('La posición está fuera del intervalo.', 9);
            const at = before === null ? proj().tasks.length : before - 1;
            const name = a[0] === undefined ? 'Tarea nueva' : toStr(a[0]);
            const made = addTask(proj(), null, { name, outline: before === null ? 1 : (proj().tasks[at]?.outline ?? 1) });
            const list = [...made.project.tasks];
            const [fresh] = list.splice(list.length - 1, 1);
            list.splice(at, 0, fresh!);
            ctl.commit({ ...made.project, tasks: list });
            return task(fresh!.id);
          },
        },
        index: base.index,
        items: base.items,
      });
    };

    const resource = (id: string): BObject => {
      const r = () => proj().resources.find((x) => x.id === id) ?? err('El recurso ya no existe.', 91);
      const set = (patch: Partial<ReturnType<typeof r>>) => ctl.commit({ ...proj(), resources: proj().resources.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
      const TYPES = ['work', 'material', 'cost'] as const;
      return make({
        type: 'Resource',
        props: {
          id: { get: () => proj().resources.findIndex((x) => x.id === id) + 1 },
          name: { get: () => r().name, set: (v) => set({ name: toStr(v) }) },
          type: { get: () => TYPES.indexOf(r().type), set: (v) => set({ type: TYPES[Math.trunc(toNum(v))] ?? 'work' }) },
          maxunits: { get: () => r().maxUnits, set: (v) => set({ maxUnits: Math.max(0, toNum(v)) }) },
          standardrate: { get: () => r().rate, set: (v) => set({ rate: Math.max(0, toNum(v)) }) },
          costperuse: { get: () => r().costPerUse, set: (v) => set({ costPerUse: Math.max(0, toNum(v)) }) },
          group: { get: () => r().group, set: (v) => set({ group: toStr(v) }) },
          emailaddress: { get: () => r().email, set: (v) => set({ email: toStr(v) }) },
        },
        methods: {
          delete: () => {
            ctl.commit(deleteResource(proj(), id));
            return undefined;
          },
        },
      });
    };

    const resources = (): BObject => {
      const base = collection('Resources', () => proj().resources.map((x) => resource(x.id)), (o) => toStr(o.get('name', [])));
      return make({
        type: 'Resources',
        props: { count: { get: () => proj().resources.length } },
        methods: {
          add: (a) => {
            const r = newResource(a[0] === undefined ? '' : toStr(a[0]));
            ctl.commit({ ...proj(), resources: [...proj().resources, r] });
            return resource(r.id);
          },
        },
        index: base.index,
        items: base.items,
      });
    };

    const project = make({
      type: 'Project',
      props: {
        name: { get: () => proj().name, set: (v) => ctl.commit({ ...proj(), name: toStr(v) }) },
        projectstart: { get: () => toDate(proj().start), set: (v) => ctl.commit({ ...proj(), start: toTime(asDate(v)) }) },
        projectfinish: { get: () => toDate(sched().finish) },
        statusdate: { get: () => (proj().statusDate === null ? undefined : toDate(proj().statusDate!)), set: (v) => ctl.setStatusDate(toTime(asDate(v))) },
        tasks: { get: () => tasks() },
        resources: { get: () => resources() },
        cost: { get: () => sched().cost },
        work: { get: () => sched().work },
      },
    });

    const app = make({
      type: 'Application',
      props: {
        name: { get: () => 'Nova Plan' },
        version: { get: () => '16.0' },
        activeproject: { get: () => project },
        projects: { get: () => collection('Projects', () => [project]) },
      },
      methods: {
        selectrow: (a) => {
          const n = Math.trunc(toNum(a[0]));
          const relative = a[1] !== undefined && toBool(a[1]);
          const i = relative ? ctl.active + n : n - 1;
          if (i < 0 || i >= proj().tasks.length) err('La fila está fuera del intervalo.', 9);
          ctl.select(i);
          return undefined;
        },
        quit: () => undefined,
      },
    });
    return { application: app, activeproject: project };
  }
}
