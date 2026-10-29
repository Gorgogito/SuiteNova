import {
  addTask, assignResource, deleteTasks, fieldContext, filteredRows, formatDate, groupTasks, insertProject, linkTasks, moveBranch, newProject, nowIn, schedule, setBaseline, shiftOutline, splitTask, subtreeEnd, unlinkTasks, updateTask, wouldCycle,
  clearBaseline, clearLeveling, levelResources, removeSplits,
  type LevelOptions, type ReportId, type Step,
  type Day, type FieldContext, type GroupNode, type Project, type Schedule, type Task, type Time,
} from '@suitenova/plan-core';
import { t } from '@suitenova/core-ui';
import { DEFAULT_COLUMNS, applyCell, isEditable } from './columns';

export type Scale = 'hour' | 'day' | 'week' | 'month';
export type PlanView = 'gantt' | 'network' | 'taskUsage' | 'resourceSheet' | 'resourceUsage' | 'resourceGraph' | 'reports';
export type Column = string;

/** Pixels per calendar day for each timeline scale. */
export const PX_PER_DAY: Record<Scale, number> = { hour: 288, day: 28, week: 9, month: 3 };
export const ROW_H = 28;

const MAX_UNDO = 100;

export const fmtDate = (d: Day): string => formatDate(d);

export type DisplayRow =
  | { key: string; kind: 'task'; index: number }
  | { key: string; kind: 'group'; depth: number; label: string; node: GroupNode; collapsed: boolean };

export class PlanCtl {
  project: Project = newProject('Proyecto nuevo');
  /** Rows (indexes into project.tasks) that are selected; the last one is the active row. */
  selected: number[] = [];
  collapsed = new Set<string>();
  collapsedGroups = new Set<string>();
  view: PlanView = 'gantt';
  scale: Scale = 'week';
  showCritical = true;
  /** Baseline drawn under the bars and used for variances and earned value (0 = "Baseline"). */
  baselineShown = 0;
  columns: string[] = [...DEFAULT_COLUMNS];
  reportId: ReportId = 'overview';
  /** Time unit of the usage tables and the resource graph. */
  usageStep: Step = 'week';
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  /** Shown while a bar is being dragged; the real project changes once on release. */
  preview: Project | null = null;
  message = '';
  /** Draw every row and day (used to print); normally only the visible part is drawn. */
  fullRender = false;
  private past: Project[] = [];
  private future: Project[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private cache: { project: Project; result: Schedule | { error: string } } | null = null;
  private ctxCache: { result: Schedule; baseline: number; ctx: FieldContext } | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  touch(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** The schedule of what is on screen (the preview while dragging). Errors (no working time) come back as a message. */
  get result(): Schedule | { error: string } {
    const p = this.preview ?? this.project;
    if (this.cache?.project !== p) {
      try {
        this.cache = { project: p, result: schedule(p) };
      } catch (e) {
        this.cache = { project: p, result: { error: (e as Error).message } };
      }
    }
    return this.cache.result;
  }
  get sched(): Schedule | null {
    const r = this.result;
    return 'error' in r ? null : r;
  }
  /** Field values (with earned value against the baseline on show) for the schedule on screen. */
  get ctx(): FieldContext | null {
    const s = this.sched;
    if (!s) return null;
    if (this.ctxCache?.result !== s || this.ctxCache.baseline !== this.baselineShown) this.ctxCache = { result: s, baseline: this.baselineShown, ctx: fieldContext(this.preview ?? this.project, s, { baseline: this.baselineShown, now: nowIn(this.project.timeZone) }) };
    return this.ctxCache.ctx;
  }

  get docTitle(): string {
    return `${this.fileName ?? this.project.name}${this.dirty ? ' •' : ''}`;
  }

  // ---------- history ----------

  /** Replace the project, remembering the old one for undo. */
  commit(next: Project): void {
    if (next === this.project) return;
    this.past.push(this.project);
    if (this.past.length > MAX_UNDO) this.past.shift();
    this.future = [];
    this.project = next;
    this.preview = null;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  undo(): void {
    const p = this.past.pop();
    if (!p) return;
    this.future.push(this.project);
    this.project = p;
    this.preview = null;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  redo(): void {
    const p = this.future.pop();
    if (!p) return;
    this.past.push(this.project);
    this.project = p;
    this.preview = null;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  private fixSelection(): void {
    const n = this.project.tasks.length;
    this.selected = this.selected.filter((i) => i < n);
  }

  load(p: Project, name: string | null, path: string | null): void {
    this.project = p;
    this.past = [];
    this.future = [];
    this.preview = null;
    this.selected = [];
    this.collapsed = new Set();
    this.collapsedGroups = new Set();
    this.baselineShown = 0;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.message = '';
    this.touch();
  }
  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }
  reset(): void {
    this.load(newProject('Proyecto nuevo'), null, null);
  }

  say(msg: string): void {
    this.message = msg;
    this.touch();
  }

  // ---------- views ----------

  setView(v: PlanView): void {
    this.view = v;
    this.touch();
  }
  setScale(s: Scale): void {
    this.scale = s;
    this.touch();
  }
  setReport(id: ReportId): void {
    this.reportId = id;
    this.view = 'reports';
    this.touch();
  }
  setUsageStep(s: Step): void {
    this.usageStep = s;
    this.touch();
  }
  setShowCritical(on: boolean): void {
    this.showCritical = on;
    this.touch();
  }
  setBaselineShown(i: number): void {
    this.baselineShown = Math.max(0, Math.min(this.project.baselines.length - 1, i));
    this.touch();
  }
  setColumns(cols: string[]): void {
    this.columns = cols.length ? cols : ['name'];
    this.touch();
  }
  setFilter(id: string | null): void {
    this.commit({ ...this.project, view: { ...this.project.view, filter: id && id !== 'all' ? id : null } });
  }
  setGroup(id: string | null): void {
    this.collapsedGroups = new Set();
    this.commit({ ...this.project, view: { ...this.project.view, group: id } });
  }

  // ---------- selection and rows ----------

  get active(): number {
    return this.selected.length ? this.selected[this.selected.length - 1]! : -1;
  }
  get activeTask(): Task | null {
    return this.project.tasks[this.active] ?? null;
  }
  select(i: number, mode: 'one' | 'toggle' | 'range' = 'one'): void {
    if (i < 0 || i >= this.project.tasks.length) return;
    if (mode === 'one') this.selected = [i];
    else if (mode === 'toggle') this.selected = this.selected.includes(i) ? this.selected.filter((x) => x !== i) : [...this.selected, i];
    else {
      const a = this.active < 0 ? i : this.active;
      const rows = this.visibleRows();
      const pa = rows.indexOf(a);
      const pi = rows.indexOf(i);
      const [lo, hi] = pa < pi ? [pa, pi] : [pi, pa];
      const range = lo < 0 ? [i] : rows.slice(lo, hi + 1);
      this.selected = [...range.filter((r) => r !== a), a];
    }
    this.touch();
  }
  moveSelection(delta: number, extend = false): void {
    const rows = this.visibleRows();
    if (!rows.length) return;
    const cur = rows.indexOf(this.active);
    const next = rows[Math.max(0, Math.min(rows.length - 1, (cur < 0 ? (delta > 0 ? -1 : rows.length) : cur) + delta))]!;
    this.select(next, extend ? 'range' : 'one');
  }

  /** The rows of the table in order: tasks (not hidden by a filter or a collapsed summary) and group headings. */
  display(): DisplayRow[] {
    const ctx = this.ctx;
    const p = this.preview ?? this.project;
    if (!ctx) return [];
    const passing = filteredRows(ctx, p.view.filter);
    const grp = p.view.group ? p.groups.find((g) => g.id === p.view.group) : undefined;
    if (grp && grp.levels.length) {
      const out: DisplayRow[] = [];
      const walk = (nodes: GroupNode[], depth: number, path: string) => {
        for (const n of nodes) {
          const key = `${path}/${n.key}`;
          const collapsed = this.collapsedGroups.has(key);
          out.push({ key, kind: 'group', depth, label: n.label, node: n, collapsed });
          if (collapsed) continue;
          if (n.children.length) walk(n.children, depth + 1, key);
          else for (const i of n.tasks) out.push({ key: `t${i}`, kind: 'task', index: i });
        }
      };
      walk(groupTasks(ctx, grp, passing), 0, 'g');
      return out;
    }
    const out: DisplayRow[] = [];
    const t = p.tasks;
    const set = new Set(passing);
    for (let i = 0; i < t.length; i++) {
      if (!set.has(i)) continue;
      out.push({ key: `t${i}`, kind: 'task', index: i });
      if (this.collapsed.has(t[i]!.id) && i + 1 < t.length && t[i + 1]!.outline > t[i]!.outline) i = subtreeEnd(t, i) - 1;
    }
    return out;
  }
  /** Indexes of the task rows on screen, in order. */
  visibleRows(): number[] {
    return this.display().flatMap((r) => (r.kind === 'task' ? [r.index] : []));
  }
  get grouped(): boolean {
    const p = this.project;
    return !!p.view.group && p.groups.some((g) => g.id === p.view.group);
  }
  toggleCollapse(i: number): void {
    const t = this.project.tasks[i];
    if (!t) return;
    if (this.collapsed.has(t.id)) this.collapsed.delete(t.id);
    else this.collapsed.add(t.id);
    this.collapsed = new Set(this.collapsed);
    // a selected row hidden by the collapse would be invisible
    const vis = new Set(this.visibleRows());
    this.selected = this.selected.filter((s) => vis.has(s));
    this.touch();
  }
  toggleGroup(key: string): void {
    if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
    else this.collapsedGroups.add(key);
    this.collapsedGroups = new Set(this.collapsedGroups);
    this.touch();
  }
  setAllCollapsed(on: boolean): void {
    const t = this.project.tasks;
    this.collapsed = on ? new Set(t.filter((_, i) => i + 1 < t.length && t[i + 1]!.outline > t[i]!.outline).map((x) => x.id)) : new Set();
    const vis = new Set(this.visibleRows());
    this.selected = this.selected.filter((s) => vis.has(s));
    this.touch();
  }

  // ---------- task editing ----------

  add(init: Partial<Task> = {}): void {
    if (this.grouped) {
      this.say('Quita la agrupación para añadir tareas.');
      return;
    }
    const r = addTask(this.project, this.active >= 0 ? this.active : null, init);
    this.commit(r.project);
    this.selected = [r.index];
    this.touch();
  }
  addMilestone(): void {
    this.add({ name: 'Hito nuevo', duration: 0 });
  }
  deleteSelected(): void {
    if (!this.selected.length) return;
    const ids = this.selected.map((i) => this.project.tasks[i]!.id);
    const first = Math.min(...this.selected);
    this.commit(deleteTasks(this.project, ids));
    this.selected = this.project.tasks.length ? [Math.min(first, this.project.tasks.length - 1)] : [];
    this.touch();
  }
  canShift(delta: 1 | -1): boolean {
    if (this.active < 0 || this.grouped) return false;
    return shiftOutline(this.project, this.active, delta) !== this.project;
  }
  shift(delta: 1 | -1): void {
    if (this.active < 0) return;
    this.commit(shiftOutline(this.project, this.active, delta));
  }
  canMove(dir: -1 | 1): boolean {
    return this.active >= 0 && !this.grouped && moveBranch(this.project, this.active, dir).project !== this.project;
  }
  move(dir: -1 | 1): void {
    if (this.active < 0) return;
    const r = moveBranch(this.project, this.active, dir);
    if (r.project === this.project) return;
    this.commit(r.project);
    this.selected = [r.index];
    this.touch();
  }
  patch(index: number, patch: Partial<Task>): void {
    const t = this.project.tasks[index];
    if (t) this.commit(updateTask(this.project, t.id, patch));
  }
  setPercent(percent: number): void {
    if (!this.selected.length) return;
    let p = this.project;
    const s = this.sched;
    for (const i of this.selected) {
      const t = p.tasks[i]!;
      // percent on a summary is calculated from its children
      if (s?.tasks[i]?.summary) continue;
      p = updateTask(p, t.id, { percent });
    }
    this.commit(p);
  }
  /** Manual or automatic scheduling for the selected tasks. */
  setManual(on: boolean): void {
    const s = this.sched;
    if (!s || !this.selected.length) return;
    let p = this.project;
    for (const i of this.selected) {
      const st = s.tasks[i]!;
      if (st.summary) continue;
      p = updateTask(p, p.tasks[i]!.id, on ? { manual: true, manualStart: st.start, manualFinish: st.finish } : { manual: false, manualStart: null, manualFinish: null });
    }
    this.commit(p);
  }

  /** Link the selected tasks one after the other in row order (finish-to-start). */
  linkSelected(): string | null {
    const rows = [...this.selected].sort((a, b) => a - b);
    if (rows.length < 2) return 'Selecciona al menos dos tareas (Ctrl+clic) para vincularlas.';
    let p = this.project;
    for (let k = 1; k < rows.length; k++) {
      const r = linkTasks(p, p.tasks[rows[k - 1]!]!.id, p.tasks[rows[k]!]!.id);
      if (r.error && !/ya están vinculadas/.test(r.error)) return r.error;
      p = r.project;
    }
    this.commit(p);
    return null;
  }
  linkPair(from: string, to: string): string | null {
    const r = linkTasks(this.project, from, to);
    if (r.error) return r.error;
    this.commit(r.project);
    return null;
  }
  canUnlink(): boolean {
    const ids = new Set(this.selected.map((i) => this.project.tasks[i]!.id));
    return this.project.tasks.some((t, i) => this.selected.includes(i) && t.links.length > 0) || this.project.tasks.some((t) => t.links.some((l) => ids.has(l.task)));
  }
  /** Remove every link that touches the selected tasks. */
  unlinkSelected(): void {
    const ids = new Set(this.selected.map((i) => this.project.tasks[i]!.id));
    let p = this.project;
    for (const t of this.project.tasks) for (const l of t.links) if (ids.has(t.id) || ids.has(l.task)) p = unlinkTasks(p, l.task, t.id);
    this.commit(p);
  }

  // ---------- cell editing ----------

  cellEditable(i: number, col: Column): boolean {
    const ctx = this.ctx;
    return !!ctx && isEditable(ctx, i, col);
  }
  /** Returns an error message, or null when the text was accepted. */
  commitCell(i: number, col: Column, text: string): string | null {
    const ctx = this.ctx;
    if (!ctx || !isEditable(ctx, i, col)) return null;
    const r = applyCell(ctx, i, col, text);
    if ('error' in r) return r.error;
    this.commit(r.project);
    return null;
  }

  // ---------- bar gestures ----------

  /** Drag the bar to start at `time`: a "start no earlier than" constraint (the dates themselves for a manual task). */
  previewMove(index: number, time: Time): void {
    const t = this.project.tasks[index];
    const st = this.sched?.tasks[index];
    if (!t || !st) return;
    this.preview = t.manual ? updateTask(this.project, t.id, { manualStart: time, manualFinish: time + (st.finish - st.start) }) : updateTask(this.project, t.id, { constraint: { type: 'snet', date: time } });
    this.touch();
  }
  previewDuration(index: number, minutes: number): void {
    const t = this.project.tasks[index];
    if (!t) return;
    this.preview = updateTask(this.project, t.id, { duration: Math.max(this.scale === 'hour' ? 30 : 60, minutes) });
    this.touch();
  }
  previewPercent(index: number, percent: number): void {
    const t = this.project.tasks[index];
    if (!t) return;
    this.preview = updateTask(this.project, t.id, { percent: Math.max(0, Math.min(100, Math.round(percent))) });
    this.touch();
  }
  endGesture(apply: boolean): void {
    const p = this.preview;
    this.preview = null;
    if (apply && p) this.commit(p);
    else this.touch();
  }

  // ---------- project level ----------

  /** Save the plan as baseline `index`; `onlySelected` saves just the selected tasks and keeps the rest of the old baseline. */
  saveBaseline(index: number, onlySelected = false): void {
    const s = this.sched;
    if (!s) return;
    const ids = onlySelected ? this.selected.map((i) => this.project.tasks[i]!.id) : undefined;
    this.commit(setBaseline(this.project, s, index, nowIn(this.project.timeZone), ids));
  }
  deleteBaseline(index: number): void {
    if (this.baselineShown === index) this.baselineShown = 0;
    this.commit(clearBaseline(this.project, index));
  }
  setStatusDate(t: Time | null): void {
    this.commit({ ...this.project, statusDate: t });
  }
  setStatusToday(): void {
    this.setStatusDate(nowIn(this.project.timeZone));
  }
  wouldCycle(from: string, to: string): boolean {
    return wouldCycle(this.project, from, to);
  }

  /** Split the active task: it stops at `splitAt` and goes on at `resumeAt`. */
  splitActive(splitAt: Time, resumeAt: Time): string | null {
    const s = this.sched;
    const t = this.activeTask;
    if (!s || !t) return 'Selecciona una tarea.';
    const r = splitTask(this.project, s, t.id, splitAt, resumeAt);
    if (r.error) return r.error;
    this.commit(r.project);
    return null;
  }
  removeSplitsActive(): void {
    const t = this.activeTask;
    if (t && t.splits.length) this.commit(removeSplits(this.project, t.id));
  }

  /** Insert another project as a summary task under the active task. */
  insertSubproject(other: Project, path: string | null, stamp?: string): string[] {
    const r = insertProject(this.project, other, this.active >= 0 ? this.active : null, path, path ? { live: true, stamp } : {});
    this.commit(r.project);
    this.selected = [r.index];
    this.touch();
    return r.warnings;
  }

  /** Level the resources; returns what happened, ready to show. */
  levelResources(opts: LevelOptions): string {
    const r = levelResources(this.project, opts);
    this.commit(r.project);
    const head = r.moved.length ? t('Nivelación hecha: {n} tareas con retraso.', { n: r.moved.length }) : t('No hizo falta retrasar ninguna tarea.');
    return r.warnings.length ? `${head} ${r.warnings[0]}` : head;
  }
  clearLevel(): void {
    this.commit(clearLeveling(this.project));
    this.say(t('Se quitaron los retrasos de nivelación.'));
  }
  /** The summary under the cursor follows its file (or stops following it). */
  toggleSubprojectLive(): void {
    const task = this.activeTask;
    if (!task?.subproject?.path) return;
    const live = !task.subproject.live;
    this.commit(updateTask(this.project, task.id, { subproject: { ...task.subproject, live: live || undefined } }));
  }

  assign(taskId: string, resourceId: string, units = 1): void {
    this.commit(assignResource(this.project, taskId, resourceId, units));
  }
}
