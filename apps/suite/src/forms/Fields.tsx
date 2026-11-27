/* The boxes to answer the question types that need more than one control: ratings drawn with signs, putting in order and files. */
import { MAX_FILES, MAX_RESPONSE_MB, MB, RATING_SYMBOLS, allowedExtensions, fileProblem, isFiles, orderOf, type Answer, type Question, type UploadedFile } from '@suitenova/forms-core';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { readUpload, sizeText } from './uploads';

/** Says a text of the program in the language the form is answered in. */
export const Say = createContext<(text: string) => string>((text) => text);

/** A rating (or a recommendation from 0 to 10), with numbers or with signs, and what its ends mean. */
export function ScaleField({ q, name, value, onChange }: { q: Question; name: string; value: Answer | undefined; onChange: (v: Answer) => void }) {
  const say = useContext(Say);
  const lo = q.type === 'nps' ? 0 : 1;
  const hi = q.type === 'nps' ? 10 : q.max;
  const sign = q.type === 'rating' ? RATING_SYMBOLS.find((s) => s.id === q.symbol && s.id !== 'number') : undefined;
  const low = q.lowLabel || (q.type === 'nps' ? say('Nada probable') : '');
  const high = q.highLabel || (q.type === 'nps' ? say('Muy probable') : '');
  return (
    <div>
      <div className={`fm-scale${sign ? ' fm-signs' : ''}`} role="radiogroup" aria-label={q.title}>
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => (
          <label key={n} className={value === n ? 'is-on' : ''} title={String(n)}>
            <input type="radio" name={name} aria-label={String(n)} checked={value === n} onChange={() => onChange(n)} />
            <span aria-hidden="true">{sign ? (typeof value === 'number' && n <= value ? sign.on : sign.off) : n}</span>
          </label>
        ))}
      </div>
      {(low || high) && (
        <div className="fm-ends">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
    </div>
  );
}

/** Putting things in order: dragging them, or with the arrows. It counts once something is moved or the order is accepted. */
export function RankField({ q, seed, value, onChange }: { q: Question; seed: string; value: Answer | undefined; onChange: (v: Answer) => void }) {
  const say = useContext(Say);
  const given = Array.isArray(value) ? (value as string[]).filter((x) => q.options.includes(x)) : [];
  const start = orderOf(q, seed);
  const order = given.length ? [...given, ...start.filter((x) => !given.includes(x))] : start;
  const chosen = given.length === q.options.length;
  const dragged = useRef<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  // the arrow that was pressed keeps the focus, on the same thing in its new place
  const focus = useRef<{ at: number; arrow: 0 | 1 } | null>(null);
  useEffect(() => {
    const f = focus.current;
    if (!f) return;
    focus.current = null;
    const arrows = list.current?.children[f.at]?.querySelectorAll('button');
    const wanted = arrows?.[f.arrow];
    (wanted && !wanted.disabled ? wanted : arrows?.[1 - f.arrow])?.focus();
  });
  const move = (from: number, to: number) => {
    const next = [...order];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };
  return (
    <div>
      <ol className="fm-items" aria-label={q.title} ref={list}>
        {order.map((item, i) => (
          <li
            key={item}
            draggable
            onDragStart={(e) => {
              dragged.current = i;
              e.dataTransfer.setData('text/plain', item);
            }}
            onDragOver={(e) => dragged.current !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragged.current !== null && dragged.current !== i) move(dragged.current, i);
              dragged.current = null;
            }}
            onDragEnd={() => (dragged.current = null)}
          >
            <span className="fm-place">{i + 1}.</span>
            <span className="fm-item">{item}</span>
            <button
              type="button"
              aria-label={say(`Subir ${item}`)}
              disabled={i === 0}
              onClick={() => {
                focus.current = { at: i - 1, arrow: 0 };
                move(i, i - 1);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={say(`Bajar ${item}`)}
              disabled={i === order.length - 1}
              onClick={() => {
                focus.current = { at: i + 1, arrow: 1 };
                move(i, i + 1);
              }}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
      {chosen ? (
        <p className="fm-muted" role="status">
          {say('Orden elegido.')}
        </p>
      ) : (
        <button type="button" className="fm-add" onClick={() => onChange(order)}>
          {say('Dejar este orden')}
        </button>
      )}
    </div>
  );
}

/** Files to send with the response. `othersSize`: what the files of the other questions weigh. */
export function FileField({ q, value, othersSize, error, onAdd, onChange, onReading }: { q: Question; value: Answer | undefined; othersSize: number; error?: string; onAdd: (add: (now: UploadedFile[]) => UploadedFile[]) => void; onChange: (v: Answer) => void; onReading: (by: 1 | -1) => void }) {
  const say = useContext(Say);
  const files = isFiles(value) ? value : [];
  const max = Math.min(MAX_FILES, q.maxFiles ?? 1);
  const accept = allowedExtensions(q).map((e) => `.${e}`);
  const [refused, setRefused] = useState<string[]>([]);
  const pick = async (list: File[]) => {
    const no: string[] = [];
    let total = othersSize + (max === 1 ? 0 : files.reduce((n, f) => n + f.size, 0));
    let count = max === 1 ? 0 : files.length;
    const take: File[] = [];
    for (const f of list) {
      let problem = fileProblem(q, f.name, f.size);
      if (!problem && count >= max) problem = `Puedes adjuntar como máximo ${max} archivo(s).`;
      if (!problem && total + f.size > MAX_RESPONSE_MB * MB) problem = `Entre todos, los archivos pasan de ${MAX_RESPONSE_MB} MB.`;
      if (problem) no.push(problem);
      else {
        take.push(f);
        count++;
        total += f.size;
      }
    }
    setRefused([...new Set(no)]);
    if (!take.length) return;
    onReading(1);
    try {
      const read = await Promise.all(take.map(readUpload));
      // with one file only, the new one takes the place of the old
      onAdd((now) => (max === 1 ? read.slice(0, 1) : [...now, ...read]));
    } catch (e) {
      setRefused([(e as Error).message]);
    } finally {
      onReading(-1);
    }
  };
  return (
    <div>
      <p className="fm-muted">
        {say(max === 1 ? `Un archivo de ${q.maxMb ?? 10} MB como mucho.` : `Hasta ${max} archivos de ${q.maxMb ?? 10} MB como mucho cada uno.`)}
        {accept.length > 0 && ` ${say(`Tipos: ${accept.join(', ')}.`)}`}
      </p>
      <input
        type="file"
        className="fm-file"
        multiple={max > 1}
        accept={accept.join(',') || undefined}
        aria-label={q.title}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          void pick(list);
        }}
      />
      {files.length > 0 && (
        <ul className="fm-items" aria-label={say('Archivos elegidos')}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="fm-item">
                {f.name} <span className="fm-muted">({sizeText(f.size)})</span>
              </span>
              <button type="button" aria-label={say(`Quitar ${f.name}`)} onClick={() => onChange(files.filter((_, k) => k !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {refused.map((r) => (
        <p key={r} className="fm-err" role="alert">
          {say(r)}
        </p>
      ))}
    </div>
  );
}
