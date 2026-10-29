import type { ComponentType } from 'react';
import {
  Bold,
  ChartGantt,
  CircleHelp,
  ClipboardList,
  ClipboardPaste,
  Contrast,
  Copy,
  Database,
  FilePlus,
  FileText,
  FolderOpen,
  Info,
  Italic,
  Keyboard,
  Languages,
  LayoutGrid,
  Mail,
  Monitor,
  Moon,
  NotebookPen,
  PanelTopClose,
  PanelTopOpen,
  Presentation,
  Printer,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Settings,
  Square,
  Sun,
  Table2,
  Underline,
  Undo2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type IconComponent = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

const icons = new Map<string, IconComponent>(
  Object.entries({
    bold: Bold,
    close: X,
    contrast: Contrast,
    copy: Copy,
    cut: Scissors,
    database: Database,
    diagram: Workflow,
    file: FileText,
    forms: LayoutGrid,
    gantt: ChartGantt,
    help: CircleHelp,
    info: Info,
    italic: Italic,
    keyboard: Keyboard,
    language: Languages,
    mail: Mail,
    monitor: Monitor,
    moon: Moon,
    new: FilePlus,
    notes: NotebookPen,
    open: FolderOpen,
    paste: ClipboardPaste,
    ribbonCollapse: PanelTopClose,
    ribbonExpand: PanelTopOpen,
    presentation: Presentation,
    print: Printer,
    redo: Redo2,
    reset: RotateCcw,
    save: Save,
    search: Search,
    settings: Settings,
    sun: Sun,
    table: Table2,
    tasks: ClipboardList,
    underline: Underline,
    undo: Undo2,
    zoomIn: ZoomIn,
    zoomOut: ZoomOut,
  }),
);

/** Modules and apps can add their own icons. */
export function registerIcon(name: string, component: IconComponent): void {
  icons.set(name, component);
}

export function Icon({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
  const Cmp = (name && icons.get(name)) || Square;
  return <Cmp size={size} className={className} strokeWidth={1.6} />;
}
