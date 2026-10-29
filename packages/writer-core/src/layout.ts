import type { Node as PMNode } from 'prosemirror-model';
import { sectionPropsOf } from './docx/model';
import { formatPageNumber, type HFKind, type SectionProps } from './sections';

/** Sections of a document in order, with their positions. */
export interface SectionInfo {
  index: number;
  node: PMNode;
  pos: number;
  props: SectionProps;
}

export function sectionList(doc: PMNode): SectionInfo[] {
  const out: SectionInfo[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === 'section') out.push({ index: out.length, node, pos, props: sectionPropsOf(node) });
  });
  return out;
}

/** The section that holds a document position. */
export function sectionAt(doc: PMNode, pos: number): SectionInfo | null {
  const list = sectionList(doc);
  let found: SectionInfo | null = null;
  for (const s of list) if (s.pos <= pos) found = s;
  return found ?? list[0] ?? null;
}

/** One page of the laid-out document. */
export interface PageInfo {
  section: number;
  /** 0-based page inside its section. */
  inSection: number;
  /** Page number shown (after restarts). */
  number: number;
  /** Number in the page number format of the section. */
  label: string;
  /** Added only so that the next section starts on an odd/even page. */
  blank: boolean;
  /** Ids of the footnotes shown at the bottom of the page. */
  notes: string[];
}

export const emptyPageInfo = (): PageInfo => ({ section: 0, inSection: 0, number: 1, label: '1', blank: false, notes: [] });

/** Display numbers and labels for pages given the section of each. */
export function numberPages(sections: SectionProps[], pageSections: { section: number; blank: boolean; notes: string[] }[]): PageInfo[] {
  const out: PageInfo[] = [];
  let last = 0;
  let inSec = 0;
  let prevSection = -1;
  for (const p of pageSections) {
    const sec = sections[p.section];
    if (p.section !== prevSection) {
      inSec = 0;
      if (sec?.pgNumStart !== null && sec?.pgNumStart !== undefined) last = sec.pgNumStart - 1;
      prevSection = p.section;
    }
    last += 1;
    out.push({ section: p.section, inSection: inSec, number: last, label: formatPageNumber(last, sec?.pgNumFmt ?? 'decimal'), blank: p.blank, notes: p.notes });
    inSec += 1;
  }
  return out;
}

/** Which header/footer variant applies to a page. */
export function hfKindFor(page: PageInfo, sec: SectionProps, evenAndOdd: boolean): HFKind {
  if (sec.titlePg && page.inSection === 0) return 'first';
  if (evenAndOdd && page.number % 2 === 0) return 'even';
  return 'default';
}

/** The part id for a section, following "same as previous" links backwards. */
export function resolvePart(sections: SectionProps[], index: number, kind: 'header' | 'footer', variant: HFKind): string | null {
  for (let i = Math.min(index, sections.length - 1); i >= 0; i--) {
    const id = sections[i]![kind][variant];
    if (id) return id;
  }
  return null;
}
