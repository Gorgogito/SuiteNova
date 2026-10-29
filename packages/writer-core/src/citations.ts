import type { CiteStyle, Source } from './docx/model';

export const CITE_STYLES: { id: CiteStyle; label: string }[] = [
  { id: 'apa', label: 'APA (7.ª edición)' },
  { id: 'mla', label: 'MLA (9.ª edición)' },
  { id: 'chicago', label: 'Chicago (autor-fecha)' },
  { id: 'ieee', label: 'IEEE (numérico)' },
  { id: 'iso690', label: 'ISO 690 (numérico)' },
];

export const isNumeric = (s: CiteStyle): boolean => s === 'ieee' || s === 'iso690';

export const emptySource = (tag = ''): Source => ({ tag, type: 'book', authors: [], title: '', year: '', publisher: '', city: '', journal: '', volume: '', issue: '', pages: '', url: '', accessed: '', doi: '', edition: '' });

export const SOURCE_TYPES: { id: Source['type']; label: string }[] = [
  { id: 'book', label: 'Libro' },
  { id: 'bookSection', label: 'Sección de libro' },
  { id: 'article', label: 'Artículo de revista' },
  { id: 'conference', label: 'Actas de congreso' },
  { id: 'report', label: 'Informe' },
  { id: 'web', label: 'Sitio web' },
  { id: 'website', label: 'Documento de un sitio web' },
  { id: 'film', label: 'Película' },
  { id: 'interview', label: 'Entrevista' },
  { id: 'other', label: 'Otro' },
];

interface Person {
  last: string;
  first: string;
}

function person(name: string): Person {
  const n = name.trim();
  if (n.includes(',')) {
    const [last, first] = n.split(',').map((s) => s.trim());
    return { last: last ?? '', first: first ?? '' };
  }
  const parts = n.split(/\s+/);
  const last = parts.pop() ?? '';
  return { last, first: parts.join(' ') };
}

const initials = (first: string, withDots = true): string =>
  first
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + (withDots ? '.' : ''))
    .join(' ');

/** "Smith", "Smith y Jones", "Smith et al." for the text of a citation. */
function shortAuthors(s: Source, style: CiteStyle): string {
  const p = s.authors.map(person);
  if (!p.length) return s.title ? `${s.title.length > 30 ? s.title.slice(0, 27) + '…' : s.title}` : s.tag;
  const and = style === 'apa' ? ' y ' : style === 'mla' ? ' y ' : ' y ';
  if (p.length === 1) return p[0]!.last;
  if (p.length === 2) return `${p[0]!.last}${and}${p[1]!.last}`;
  return style === 'apa' ? `${p[0]!.last} et al.` : `${p[0]!.last} et al.`;
}

export interface CiteOptions {
  pages?: string;
  suppressAuthor?: boolean;
  suppressYear?: boolean;
  suppressTitle?: boolean;
}

/** The text of an in-text citation. `number` is the position of the source among the cited ones (numeric styles). */
export function citationText(s: Source, style: CiteStyle, opts: CiteOptions = {}, number = 1): string {
  const pages = opts.pages?.trim();
  if (isNumeric(style)) return `[${number}${pages ? `, p. ${pages}` : ''}]`;
  const a = shortAuthors(s, style);
  const y = s.year || 's. f.';
  switch (style) {
    case 'mla': {
      const parts = [opts.suppressAuthor ? '' : a, pages ?? ''].filter(Boolean);
      return `(${parts.join(' ')})`;
    }
    case 'chicago': {
      const head = [opts.suppressAuthor ? '' : a, opts.suppressYear ? '' : y].filter(Boolean).join(' ');
      return `(${head}${pages ? `, ${pages}` : ''})`;
    }
    default: {
      const head = [opts.suppressAuthor ? '' : a, opts.suppressYear ? '' : y].filter(Boolean).join(', ');
      return `(${head}${pages ? `, ${/[-–]/.test(pages) ? 'pp.' : 'p.'} ${pages}` : ''})`;
    }
  }
}

const dot = (s: string): string => (!s ? '' : /[.?!]$/.test(s) ? s : s + '.');

function authorList(s: Source, style: CiteStyle): string {
  const p = s.authors.map(person);
  if (!p.length) return '';
  switch (style) {
    case 'apa': {
      const f = p.map((x) => `${x.last}, ${initials(x.first)}`.replace(/, $/, ''));
      if (f.length === 1) return f[0]!;
      if (f.length <= 20) return `${f.slice(0, -1).join(', ')}, & ${f[f.length - 1]}`;
      return `${f.slice(0, 19).join(', ')}, ... ${f[f.length - 1]}`;
    }
    case 'mla': {
      if (p.length === 1) return `${p[0]!.last}, ${p[0]!.first}`.replace(/, $/, '');
      if (p.length === 2) return `${p[0]!.last}, ${p[0]!.first}, y ${p[1]!.first} ${p[1]!.last}`;
      return `${p[0]!.last}, ${p[0]!.first}, et al.`;
    }
    case 'chicago': {
      const f = p.map((x, i) => (i === 0 ? `${x.last}, ${x.first}` : `${x.first} ${x.last}`));
      if (f.length === 1) return f[0]!;
      return `${f.slice(0, -1).join(', ')}, y ${f[f.length - 1]}`;
    }
    case 'ieee':
      return p.map((x) => `${initials(x.first)} ${x.last}`.trim()).join(', ').replace(/, ([^,]+)$/, p.length > 1 ? ', y $1' : ', $1');
    default:
      return p.map((x) => `${x.last.toUpperCase()}, ${x.first}`.replace(/, $/, '')).join('; ');
  }
}

/** A line of the bibliography. */
export function bibliographyEntry(s: Source, style: CiteStyle, number = 1): string {
  const auth = authorList(s, style);
  const pub = [s.city, s.publisher].filter(Boolean).join(': ');
  const ed = s.edition ? `${s.edition} ed.` : '';
  const where = s.journal
    ? `${s.journal}${s.volume ? `, ${s.volume}` : ''}${s.issue ? `(${s.issue})` : ''}${s.pages ? `, ${s.pages}` : ''}`
    : '';
  const link = s.doi ? `https://doi.org/${s.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : s.url;
  switch (style) {
    case 'mla': {
      const parts = [dot(auth), dot(s.title), s.journal ? dot(where) : dot([ed, s.publisher, s.year].filter(Boolean).join(', ')), link ? dot(link) : ''];
      return parts.filter(Boolean).join(' ');
    }
    case 'chicago': {
      const parts = [dot(auth), `${dot(s.year || 's. f.')}`, dot(s.title), s.journal ? dot(where) : dot([ed, pub].filter(Boolean).join('. ')), link ? dot(link) : ''];
      return parts.filter(Boolean).join(' ');
    }
    case 'ieee': {
      const parts = [auth ? `${auth},` : '', `“${s.title},”`, s.journal ? `${where}${s.year ? `, ${s.year}` : ''}.` : [ed, pub, s.year].filter(Boolean).join(', ') + '.', link ? `[En línea]. Disponible: ${link}` : ''];
      return `[${number}] ${parts.filter(Boolean).join(' ')}`;
    }
    case 'iso690': {
      const parts = [dot(auth), dot(s.title), s.journal ? dot(`${where}${s.year ? `, ${s.year}` : ''}`) : dot([ed, pub, s.year].filter(Boolean).join(', ')), link ? dot(`Disponible en: ${link}`) : ''];
      return `[${number}] ${parts.filter(Boolean).join(' ')}`;
    }
    default: {
      // APA
      const yearPart = `(${s.year || 's. f.'}).`;
      const parts = [auth ? dot(auth) : '', yearPart, dot(s.title), s.journal ? dot(where) : dot([ed, s.publisher].filter(Boolean).join(', ')), link ? link : ''];
      return parts.filter(Boolean).join(' ');
    }
  }
}

/** Sources in the order the bibliography lists them: alphabetical for author-date styles, by first citation otherwise. */
export function sortSources(sources: Source[], style: CiteStyle, citedOrder: string[]): Source[] {
  if (isNumeric(style)) {
    const rank = new Map(citedOrder.map((t, i) => [t, i]));
    return [...sources].sort((a, b) => (rank.get(a.tag) ?? 1e6) - (rank.get(b.tag) ?? 1e6));
  }
  const key = (s: Source) => (s.authors[0] ? person(s.authors[0]).last : s.title).toLocaleLowerCase();
  return [...sources].sort((a, b) => key(a).localeCompare(key(b), 'es') || (a.year || '').localeCompare(b.year || ''));
}

export const bibliographyTitle = (style: CiteStyle): string => (style === 'apa' ? 'Referencias' : style === 'mla' ? 'Obras citadas' : style === 'chicago' ? 'Bibliografía' : 'Referencias');
