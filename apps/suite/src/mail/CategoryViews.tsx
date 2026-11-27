import { t } from '@suitenova/core-ui';
import { DEFAULT_CATEGORIES, categoriesOf, categoryHex, hasCategory, setCategory, type MailData } from '@suitenova/mail-core';

/* How categories are seen: their name, the chips of an item and the boxes to choose them in a form. */

/** The categories the program starts with are shown in the language of the interface; the others, as they were written. */
export const categoryLabel = (name: string): string => (DEFAULT_CATEGORIES.some((c) => c.name === name) ? t(name) : name);

export function CategoryChips({ data, names, max = 99 }: { data: MailData; names: string[] | undefined; max?: number }) {
  if (!names?.length) return null;
  return (
    <span className="ml-cats" aria-label={t('Categorías: {names}', { names: names.map(categoryLabel).join(', ') })}>
      {names.slice(0, max).map((n) => (
        <span key={n} className="ml-cat" style={{ borderColor: categoryHex(data, n) }} title={categoryLabel(n)}>
          <i style={{ background: categoryHex(data, n) }} aria-hidden="true" />
          {categoryLabel(n)}
        </span>
      ))}
      {names.length > max && <span className="ml-cat ml-cat--more">+{names.length - max}</span>}
    </span>
  );
}

/** The categories of an appointment, a contact or a task, in its form. */
export function CategoryPicker({ data, value, onChange }: { data: MailData; value: string[] | undefined; onChange: (next: string[] | undefined) => void }) {
  const listed = categoriesOf(data).map((c) => c.name);
  // one that came in a file and is not in the list can still be taken off
  const names = [...listed, ...(value ?? []).filter((n) => !listed.some((x) => x.toLowerCase() === n.toLowerCase()))];
  if (!names.length) return null;
  const item = { categories: value };
  return (
    <fieldset className="ml-catpick">
      <legend>{t('Categorías')}</legend>
      {names.map((n) => (
        <label key={n}>
          <input
            type="checkbox"
            checked={hasCategory(item, n)}
            onChange={(e) => {
              const next = { categories: value };
              setCategory(next, n, e.target.checked);
              onChange(next.categories);
            }}
          />
          <i className="ml-swatch" style={{ background: categoryHex(data, n) }} aria-hidden="true" />
          {categoryLabel(n)}
        </label>
      ))}
    </fieldset>
  );
}
