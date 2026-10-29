export interface ModuleInfo {
  id: string;
  name: string;
  /** What it replaces functionally (shown as the card subtitle). */
  purpose: string;
  icon: string;
  /** Roadmap phase in which the module becomes usable. */
  phase: number;
  /** Has real functionality (not just the window frame). */
  available?: boolean;
  /** File extensions the module can open. */
  opens?: string[];
}

export const MODULES: ModuleInfo[] = [
  { id: 'writer', name: 'Nova Writer', purpose: 'module.writer.purpose', icon: 'file', phase: 2, available: true, opens: ['docx', 'txt', 'html'] },
  { id: 'calc', name: 'Nova Calc', purpose: 'module.calc.purpose', icon: 'table', phase: 1, available: true, opens: ['xlsx', 'csv', 'tsv'] },
  { id: 'slides', name: 'Nova Slides', purpose: 'module.slides.purpose', icon: 'presentation', phase: 3, available: true, opens: ['pptx', 'ppsx', 'potx', 'odp', 'ppt', 'pps'] },
  { id: 'base', name: 'Nova Base', purpose: 'module.base.purpose', icon: 'database', phase: 4, available: true, opens: ['sqlite', 'sqlite3', 'db'] },
  { id: 'notes', name: 'Nova Notes', purpose: 'module.notes.purpose', icon: 'notes', phase: 4, available: true, opens: ['novanotes'] },
  { id: 'mail', name: 'Nova Mail', purpose: 'module.mail.purpose', icon: 'mail', phase: 5, available: true, opens: ['novamail', 'eml', 'mbox', 'ics', 'vcf'] },
  { id: 'diagram', name: 'Nova Diagram', purpose: 'module.diagram.purpose', icon: 'diagram', phase: 6, available: true, opens: ['novadiagram', 'vsdx'] },
  { id: 'plan', name: 'Nova Plan', purpose: 'module.plan.purpose', icon: 'gantt', phase: 6, available: true, opens: ['novaplan', 'xml'] },
  { id: 'forms', name: 'Nova Forms', purpose: 'module.forms.purpose', icon: 'forms', phase: 7, available: true, opens: ['novaforms'] },
];

export function findModule(id: string | null): ModuleInfo | undefined {
  return MODULES.find((m) => m.id === id);
}
