import { q } from './design';

/*
 * Query wizards of Access: "Find duplicates" and "Find unmatched". They write the SQL of an ordinary query, which opens in the SQL
 * view so that it can be run and changed.
 */

/** The records of `table` whose value in `fields` appears more than once. `show` are the columns to list (all when empty). */
export function duplicatesSql(table: string, fields: string[], show: string[] = []): string {
  if (!fields.length) throw new Error('Elige al menos un campo para buscar repetidos.');
  const cols = show.length ? show.map((c) => `T.${q(c)}`).join(', ') : 'T.*';
  const group = fields.map(q).join(', ');
  // rows are compared on all the fields together; an empty value does not count as a repeat
  const join = fields.map((f) => `T.${q(f)} = D.${q(f)}`).join(' AND ');
  const nonNull = fields.map((f) => `${q(f)} IS NOT NULL`).join(' AND ');
  return `SELECT ${cols}\nFROM ${q(table)} AS T\nWHERE EXISTS (\n  SELECT 1 FROM (\n    SELECT ${group} FROM ${q(table)} WHERE ${nonNull} GROUP BY ${group} HAVING COUNT(*) > 1\n  ) AS D\n  WHERE ${join}\n)\nORDER BY ${fields.map((f) => `T.${q(f)}`).join(', ')}`;
}

/** The records of `a` that have no match in `b` (`aField` = `bField`), as "Find unmatched" does. */
export function unmatchedSql(a: string, aField: string, b: string, bField: string, show: string[] = []): string {
  if (!a || !b || !aField || !bField) throw new Error('Elige las dos tablas y el campo de cada una.');
  const cols = show.length ? show.map((c) => `A.${q(c)}`).join(', ') : 'A.*';
  return `SELECT ${cols}\nFROM ${q(a)} AS A\nLEFT JOIN ${q(b)} AS B ON A.${q(aField)} = B.${q(bField)}\nWHERE B.${q(bField)} IS NULL`;
}
