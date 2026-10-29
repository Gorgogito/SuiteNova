import { isEmpty, score } from './logic';
import { isInput, type Form, type Question, type Response } from './model';

export type QSummary =
  | { kind: 'counts'; question: Question; answered: number; items: { label: string; count: number; pct: number }[]; others: string[] }
  | { kind: 'rating'; question: Question; answered: number; average: number; items: { label: string; count: number; pct: number }[] }
  | { kind: 'nps'; question: Question; answered: number; score: number; promoters: number; passives: number; detractors: number; items: { label: string; count: number; pct: number }[] }
  | { kind: 'number'; question: Question; answered: number; average: number; min: number; max: number; median: number }
  | { kind: 'text'; question: Question; answered: number; values: string[] }
  | { kind: 'date'; question: Question; answered: number; values: string[] }
  | { kind: 'likert'; question: Question; answered: number; rows: { row: string; counts: number[]; average: number | null }[] }
  | { kind: 'none'; question: Question; answered: number };

export interface Summary {
  total: number;
  first: string | null;
  last: string | null;
  questions: QSummary[];
  quiz: { average: number; max: number; best: number; worst: number } | null;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function summarize(form: Form, responses: Response[]): Summary {
  const dates = responses.map((r) => r.at).sort();
  const questions: QSummary[] = [];
  for (const q of form.questions) {
    if (!isInput(q)) continue;
    const given = responses.map((r) => r.answers[q.id]).filter((a) => !isEmpty(a));
    const n = given.length;
    switch (q.type) {
      case 'choice':
      case 'dropdown':
      case 'multi': {
        const counts = new Map<string, number>(q.options.map((o) => [o, 0]));
        const others: string[] = [];
        for (const a of given) {
          for (const v of Array.isArray(a) ? a : [String(a)]) {
            if (counts.has(v)) counts.set(v, counts.get(v)! + 1);
            else others.push(v);
          }
        }
        // percentages are of the people who answered, so a multiple choice can add up to more than 100
        const items = [...counts].map(([label, count]) => ({ label, count, pct: pct(count, n) }));
        if (others.length) items.push({ label: 'Otras respuestas', count: others.length, pct: pct(others.length, n) });
        questions.push({ kind: 'counts', question: q, answered: n, items, others });
        break;
      }
      case 'rating': {
        const items = Array.from({ length: q.max }, (_, i) => ({ label: String(i + 1), count: given.filter((a) => Number(a) === i + 1).length, pct: 0 }));
        items.forEach((it) => (it.pct = pct(it.count, n)));
        questions.push({ kind: 'rating', question: q, answered: n, average: n ? given.reduce<number>((s, a) => s + Number(a), 0) / n : 0, items });
        break;
      }
      case 'nps': {
        const items = Array.from({ length: 11 }, (_, i) => ({ label: String(i), count: given.filter((a) => Number(a) === i).length, pct: 0 }));
        items.forEach((it) => (it.pct = pct(it.count, n)));
        const promoters = given.filter((a) => Number(a) >= 9).length;
        const detractors = given.filter((a) => Number(a) <= 6).length;
        questions.push({ kind: 'nps', question: q, answered: n, score: n ? Math.round(((promoters - detractors) / n) * 100) : 0, promoters, detractors, passives: n - promoters - detractors, items });
        break;
      }
      case 'number': {
        const v = given.map((a) => Number(a)).sort((a, b) => a - b);
        const median = v.length ? (v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : 0;
        questions.push({ kind: 'number', question: q, answered: n, average: n ? v.reduce((s, x) => s + x, 0) / n : 0, min: v[0] ?? 0, max: v[v.length - 1] ?? 0, median });
        break;
      }
      case 'text':
      case 'longtext':
        questions.push({ kind: 'text', question: q, answered: n, values: given.map(String) });
        break;
      case 'date':
        questions.push({ kind: 'date', question: q, answered: n, values: given.map(String).sort() });
        break;
      case 'likert': {
        const rows = q.rows.map((row) => {
          const counts = q.options.map((o) => given.filter((a) => (a as Record<string, string>)[row] === o).length);
          const total = counts.reduce((s, c) => s + c, 0);
          // the average treats the columns as 1..n
          const average = total ? counts.reduce((s, c, i) => s + c * (i + 1), 0) / total : null;
          return { row, counts, average };
        });
        questions.push({ kind: 'likert', question: q, answered: n, rows });
        break;
      }
      default:
        questions.push({ kind: 'none', question: q, answered: n });
    }
  }
  let quiz: Summary['quiz'] = null;
  if (form.quiz && responses.length) {
    const scores = responses.map((r) => score(form, r.answers));
    const max = scores[0]?.total ?? 0;
    const earned = scores.map((s) => s.earned);
    quiz = { average: earned.reduce((s, x) => s + x, 0) / earned.length, max, best: Math.max(...earned), worst: Math.min(...earned) };
  }
  return { total: responses.length, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null, questions, quiz };
}
