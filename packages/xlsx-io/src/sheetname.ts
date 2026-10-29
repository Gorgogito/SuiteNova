/** A sheet name as it is written in a reference: quoted when it has anything but letters, digits and underscores. */
export function quoteSheetName(name: string): string {
  return /^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}
