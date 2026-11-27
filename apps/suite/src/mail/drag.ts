/** Messages being dragged from the list to a folder. */
export const MAIL_DRAG = 'application/x-nova-mail';

export function draggedMail(data: DataTransfer): string[] {
  try {
    const v = JSON.parse(data.getData(MAIL_DRAG) || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
