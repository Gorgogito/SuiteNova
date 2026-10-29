/** mbox files (mboxrd flavour): messages separated by lines that start with "From ". */

/** Split an mbox into raw messages. Lines such as ">From " inside a message are unescaped one level. */
export function parseMbox(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    // a separator is "From " at the start of a line, after a blank line or at the beginning of the file
    if (l.startsWith('From ') && (i === 0 || lines[i - 1] === '' || cur === null)) {
      cur = [];
      out.push(cur);
      continue;
    }
    if (cur) cur.push(/^>+From /.test(l) ? l.slice(1) : l);
  }
  return out.map((m) => {
    while (m.length && m[m.length - 1] === '') m.pop();
    return m.join('\r\n') + '\r\n';
  });
}

/** Write messages as an mbox. `from` and `date` fill the separator line. */
export function writeMbox(messages: { raw: string; from?: string; date?: Date }[]): string {
  return messages
    .map((m) => {
      const sep = `From ${m.from || 'MAILER-DAEMON'} ${(m.date ?? new Date()).toUTCString().replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (.*) GMT$/, '$1 $3 $2 $5 $4')}`;
      const body = m.raw.replace(/\r?\n/g, '\n').replace(/^(>*From )/gm, '>$1').replace(/\n+$/, '');
      return `${sep}\n${body}\n`;
    })
    .join('\n');
}
