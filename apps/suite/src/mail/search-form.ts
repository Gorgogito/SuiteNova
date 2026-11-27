/** The fields of the advanced search, written as the search box understands them. */
export interface SearchForm {
  from: string;
  to: string;
  subject: string;
  words: string;
  category: string;
  attachments: '' | 'sí' | 'no';
  state: string;
  /** Year-month-day, as a date box gives it. */
  since: string;
  until: string;
  everywhere: boolean;
}

const value = (text: string): string => {
  const v = text.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  return /\s/.test(v) ? `"${v}"` : v;
};

export function buildQuery(f: SearchForm): string {
  const out: string[] = [];
  const add = (field: string, text: string) => {
    const v = value(text);
    if (v) out.push(`${field}:${v}`);
  };
  add('de', f.from);
  add('para', f.to);
  add('asunto', f.subject);
  // each word is searched on its own, as typed in the box
  const words = f.words.trim();
  if (words) out.push(words);
  add('categoria', f.category);
  add('adjuntos', f.attachments);
  add('es', f.state);
  add('desde', f.since);
  add('hasta', f.until);
  return out.join(' ');
}
