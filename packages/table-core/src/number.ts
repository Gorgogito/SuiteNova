/** Numbers in the text of a cell: reading them (with a comma or a point as the decimal mark) and writing them with a picture such as `#,##0.00`. */

/**
 * The number a text holds, or null. Accepts a currency sign or other text before it, thousands marks, a decimal comma or point, parentheses and a
 * minus sign for negatives, and a % (5 % is 0.05). With both marks the last one is the decimal; a single one followed by exactly three digits is a
 * thousands mark when it appears more than once, otherwise it is the decimal mark (so «1,234» is 1.234; give `decimal` to decide otherwise).
 */
export function parseNumber(text: string, decimal?: '.' | ','): number | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const m = /^[^\d\-+.,]*([-+]?\s*\d[\d.,\s ]*)\s*(%?)\s*[^\d]*$/.exec(s);
  if (!m) return null;
  let x = m[1]!.replace(/[\s ]/g, '');
  const lastDot = x.lastIndexOf('.');
  const lastComma = x.lastIndexOf(',');
  if (decimal) {
    const thousands = decimal === '.' ? ',' : '.';
    x = x.split(thousands).join('');
    if (decimal === ',') x = x.replace(',', '.');
  } else if (lastDot >= 0 && lastComma >= 0) x = lastComma > lastDot ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (lastComma >= 0) x = (x.match(/,/g) ?? []).length > 1 ? x.replace(/,/g, '') : x.replace(',', '.');
  else if (lastDot >= 0 && (x.match(/\./g) ?? []).length > 1) x = x.replace(/\./g, '');
  let n = Number(x);
  if (!Number.isFinite(n)) return null;
  if (m[2]) n /= 100;
  return negative ? -n : n;
}

const group = (int: string, sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/**
 * Writes a number with a picture: `0` and `#` are digits (`0` always shows, `#` only if there is one), `,` groups thousands, `.` starts the decimals,
 * `%` multiplies by 100, and anything else (a currency sign, text between quotes) is copied. A picture with two sections `pos;neg` uses the second
 * for negatives. `decimal` and `thousands` are the marks to write (default point and comma).
 */
export function formatNumber(value: number, picture: string, decimal = '.', thousands = ','): string {
  const sections = picture.split(';');
  const neg = value < 0 && sections.length > 1;
  const pic = (neg ? sections[1] : sections[0])!;
  let v = neg ? -value : value;
  const percent = pic.includes('%');
  if (percent) v *= 100;
  const m = /^(.*?)([#0,]*[#0](?:\.[#0]+)?|\.[#0]+)(.*)$/.exec(pic.replace(/"([^"]*)"/g, (_a, t: string) => t.replace(/[#0.,]/g, (ch) => `\u0001${ch.charCodeAt(0)};`)));
  if (!m) return String(value);
  const unq = (s: string) => s.replace(/\u0001(\d+);/g, (_a, n: string) => String.fromCharCode(Number(n)));
  const [prefix, core, suffix] = [unq(m[1]!), m[2]!, unq(m[3]!)];
  const [intPic, decPic = ''] = core.split('.');
  const decimals = decPic.length;
  const minDec = (decPic.match(/0/g) ?? []).length;
  let fixed = Math.abs(v).toFixed(decimals);
  let [ip, dp = ''] = fixed.split('.');
  while (dp.length > minDec && dp.endsWith('0')) dp = dp.slice(0, -1);
  const minInt = ((intPic ?? '').replace(/,/g, '').match(/0/g) ?? []).length;
  ip = ip!.padStart(minInt, '0');
  if (ip === '0' && minInt === 0) ip = '';
  if ((intPic ?? '').includes(',')) ip = group(ip, thousands);
  fixed = ip + (dp ? decimal + dp : '');
  const sign = v < 0 && !neg && Number(fixed.replace(/[^\d]/g, '')) !== 0 ? '-' : '';
  return `${sign}${prefix}${fixed || '0'}${suffix}`;
}
