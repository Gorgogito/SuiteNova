import { Button, Input } from '@fluentui/react-components';
import { getLocale, t } from '@suitenova/core-ui';
import type { Block } from '@suitenova/speech-core';
import { groupIntoLines, newTextContainer, readableLangs, readableText, strokeBounds, strokesToSvg } from '@suitenova/notes-core';
import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReviewDialog } from '../spell';
import { notesHost } from './review-host';
import { sortTable, findTable } from '../writer/table-tools';
import { SYMBOL_GROUPS } from '../writer/symbols';
import type { NotesCtl } from './ctl';
import { Modal } from './Dialogs';
import { recognizeImage } from './ocr';
import { VoiceController } from '../voice/controller';
import { speechLang } from '../voice/lang';
import '../voice/messages';
import { ReadAloudBar } from '../voice/ReadAloudBar';

const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };
const closeBtn = (onClose: () => void) => (
  <Button appearance="primary" onClick={onClose}>
    {t('Cerrar')}
  </Button>
);
const refocus = (ctl: NotesCtl) => setTimeout(() => ctl.focusEditor(), 80);

// ------------------------------------------------------------------------------------------------ ortografía y gramática

/** El cuadro F7 compartido (ortografía, gramática y estilo) sobre los cuadros de texto de la página. */
export function NotesSpellDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  return <ReviewDialog host={notesHost(ctl)} onClose={onClose} />;
}

// ------------------------------------------------------------------------------------------------ lector inmersivo y voz

export function ReadDialog({ ctl, onClose, autoplay = false }: { ctl: NotesCtl; onClose: () => void; autoplay?: boolean }) {
  const text = useMemo(() => readableText(ctl.page), [ctl.page]);
  // the page is read line by line with the shared reader (the same bar, speed and voices as every product); `offset` places each line in the text shown
  const voice = useMemo(() => new VoiceController(), []);
  const blocks = useMemo(() => {
    const out: (Block & { offset: number })[] = [];
    const def = getLocale() === 'en' ? 'en-US' : 'es-ES';
    // a line is cut where the language of the text changes (a run marked as English is read by an English voice)
    const spans = readableLangs(ctl.page);
    let offset = 0;
    for (const line of text.split('\n')) {
      const end = offset + line.length;
      let at = offset;
      const piece = (a: number, b: number, lang: string) => {
        const t = text.slice(a, b);
        if (t.trim()) out.push({ text: t, lang, offset: a });
      };
      for (const s of spans) {
        if (s.end <= at || s.start >= end) continue;
        if (s.start > at) piece(at, s.start, def);
        const a = Math.max(at, s.start);
        const b = Math.min(end, s.end);
        piece(a, b, speechLang(s.lang, def));
        at = b;
      }
      if (at < end) piece(at, end, def);
      offset = end + 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useSyncExternalStore(voice.subscribe, voice.getVersion);
  const [size, setSize] = useState(22);
  const [spacing, setSpacing] = useState(1.6);
  const [theme, setTheme] = useState<'light' | 'cream' | 'dark'>('light');
  useEffect(() => {
    voice.lang = getLocale() === 'en' ? 'en-US' : 'es-ES';
    if (autoplay) voice.start(blocks);
    else voice.open(blocks);
    return () => voice.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);
  const snap = voice.snapshot;
  const at = (blockIdx: number, a: number, e: number): { start: number; end: number } | null => {
    const b = blocks[blockIdx];
    return b ? { start: b.offset + a, end: b.offset + e } : null;
  };
  const pos = snap.state !== 'idle' && snap.word ? at(snap.block, snap.word.start, snap.word.end) : null;
  const piece = snap.state !== 'idle' && snap.piece ? at(snap.block, snap.piece.start, snap.piece.end) : null;
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [pos?.start]);
  const colors = { light: ['#fff', '#111'], cream: ['#f6edd6', '#2b2418'], dark: ['#1c1c1c', '#eee'] }[theme];
  const close = () => {
    voice.close();
    onClose();
  };
  // the text is drawn in up to three parts: before the sentence read, the sentence (with the word marked in it), and after it
  const part = (from: number, to: number) => text.slice(from, to);
  const sentence = piece;
  return (
    <Modal wide title={t('Lector inmersivo')} onClose={close} actions={closeBtn(close)}>
      <ReadAloudBar ctrl={voice} onClose={close} label={t('Leer en voz alta')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '8px 0' }}>
        <label>
          {t('Tamaño del texto')} <input type="range" min={14} max={48} value={size} aria-label={t('Tamaño del texto')} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <label>
          {t('Interlineado')} <input type="range" min={1.2} max={2.4} step={0.2} value={spacing} aria-label={t('Interlineado')} onChange={(e) => setSpacing(Number(e.target.value))} />
        </label>
        <label>
          {t('Fondo')}{' '}
          <select className="nv-select" aria-label={t('Fondo')} value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
            <option value="light">{t('Blanco')}</option>
            <option value="cream">{t('Crema')}</option>
            <option value="dark">{t('Oscuro')}</option>
          </select>
        </label>
      </div>
      <div className="nn-immersive" data-testid="nn-immersive" style={{ background: colors[0], color: colors[1], fontSize: size, lineHeight: spacing }}>
        {text ? (
          sentence ? (
            <>
              {part(0, sentence.start)}
              <span style={{ background: theme === 'dark' ? 'rgba(120,170,255,.25)' : 'rgba(60,140,255,.14)' }}>
                {pos && pos.start >= sentence.start && pos.end <= sentence.end ? (
                  <>
                    {part(sentence.start, pos.start)}
                    <mark ref={markRef} style={{ background: '#ffd54a', color: '#000' }}>
                      {part(pos.start, pos.end)}
                    </mark>
                    {part(pos.end, sentence.end)}
                  </>
                ) : (
                  part(sentence.start, sentence.end)
                )}
              </span>
              {part(sentence.end, text.length)}
            </>
          ) : (
            text
          )
        ) : (
          t('La página no tiene texto que leer.')
        )}
      </div>
      <p className="nn-note">{t('Lee el título y el texto de los cuadros de arriba abajo. Usa las voces que tenga instalado el sistema; no se envía nada a Internet.')}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ símbolos

export function SymbolDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const [g, setG] = useState(0);
  const group = SYMBOL_GROUPS[g]!;
  const close = () => {
    onClose();
    refocus(ctl);
  };
  return (
    <Modal title={t('Símbolo')} onClose={close} actions={closeBtn(close)}>
      <div style={field}>
        <label htmlFor="nn-sym-group">{t('Grupo')}</label>
        <select id="nn-sym-group" className="nv-select" value={g} onChange={(e) => setG(Number(e.target.value))}>
          {SYMBOL_GROUPS.map((x, i) => (
            <option key={x.id} value={i}>
              {t(x.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="nn-symgrid" role="group" aria-label={t(group.label)}>
        {group.chars.map(([ch, name]) => (
          <button
            key={ch}
            type="button"
            title={`${name} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`}
            aria-label={ch}
            onClick={() => {
              if (!ctl.view) ctl.addTextBoxFree();
              setTimeout(() => ctl.insertText(ch), 30);
            }}
          >
            {ch}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ tinta a texto

function svgToPng(svg: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(t('No se pudo dibujar la tinta para leerla.')));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export function InkToTextDialog({ ctl, lang, onClose }: { ctl: NotesCtl; lang: string; onClose: () => void }) {
  const sel = ctl.page.ink.filter((s) => ctl.selectedStrokes.includes(s.id));
  const strokes = sel.length ? sel : ctl.page.ink;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lines = groupIntoLines(strokes);
        const out: string[] = [];
        for (const line of lines) {
          const r = strokesToSvg(line, 20, 3);
          if (!r) continue;
          out.push(await recognizeImage(await svgToPng(r.svg, r.width, r.height), lang));
        }
        if (alive) setText(out.join('\n').trim());
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const insert = (replaceInk: boolean) => {
    const b = strokes.map(strokeBounds);
    const x = Math.min(...b.map((r) => r.x1));
    const y = Math.min(...b.map((r) => r.y1));
    const w = Math.max(160, Math.max(...b.map((r) => r.x2)) - x);
    const paras = text.split('\n').map((l) => nodeTypes.paragraph!.create(null, l ? writerSchema.text(l) : undefined));
    const box = newTextContainer(Math.round(x), Math.round(y), Math.round(w), nodeTypes.doc!.create(null, paras).toJSON());
    ctl.addTextContainer(box, replaceInk ? strokes.map((s) => s.id) : []);
    onClose();
  };
  return (
    <Modal
      title={t('Tinta a texto')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button disabled={busy || !text.trim()} onClick={() => insert(false)}>
            {t('Insertar como texto')}
          </Button>
          <Button appearance="primary" disabled={busy || !text.trim()} onClick={() => insert(true)}>
            {t('Sustituir la tinta')}
          </Button>
        </>
      }
    >
      <p className="nn-note">{t('Experimental: usa el reconocimiento de texto (OCR) del programa, pensado para letra de imprenta clara. La letra ligada o descuidada suele leerse mal; revisa el resultado antes de insertarlo.')}</p>
      {busy && <p role="status">{t('Leyendo la tinta…')}</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !text.trim() && <p>{t('No se reconoció ningún texto.')}</p>}
      <textarea className="nn-ocrtext" aria-label={t('Texto reconocido')} value={text} onChange={(e) => setText(e.target.value)} rows={6} style={{ width: '100%' }} />
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ tabla: ordenar y aspecto

export function NotesTableSortDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const v = ctl.view;
  const tb = v ? findTable(v.state) : null;
  const cols = tb ? (tb.node.firstChild?.childCount ?? 0) : 0;
  const [col, setCol] = useState(0);
  const [asc, setAsc] = useState(true);
  const [mode, setMode] = useState<'text' | 'number'>('text');
  const [err, setErr] = useState('');
  return (
    <Modal
      title={t('Ordenar la tabla')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              if (!v) return;
              if (sortTable(col, asc, mode)(v.state, v.dispatch)) onClose();
              else setErr(t('No se puede ordenar una tabla con celdas combinadas verticalmente.'));
            }}
          >
            {t('Ordenar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nn-sort-col">{t('Por la columna')}</label>
        <select id="nn-sort-col" className="nv-select" value={col} onChange={(e) => setCol(Number(e.target.value))}>
          {Array.from({ length: cols }, (_, i) => (
            <option key={i} value={i}>
              {t('Columna {n}', { n: i + 1 })}
            </option>
          ))}
        </select>
      </div>
      <div style={field}>
        <label htmlFor="nn-sort-mode">{t('Tipo')}</label>
        <select id="nn-sort-mode" className="nv-select" value={mode} onChange={(e) => setMode(e.target.value as 'text' | 'number')}>
          <option value="text">{t('Texto')}</option>
          <option value="number">{t('Número')}</option>
        </select>
      </div>
      <label className="nn-check">
        <input type="radio" name="nn-sort-dir" checked={asc} onChange={() => setAsc(true)} /> {t('Ascendente')}
      </label>
      <label className="nn-check">
        <input type="radio" name="nn-sort-dir" checked={!asc} onChange={() => setAsc(false)} /> {t('Descendente')}
      </label>
      <p className="nn-note">{t('Si la tabla tiene fila de encabezado, se queda arriba.')}</p>
      {err && <p role="alert">{err}</p>}
    </Modal>
  );
}

void Input;
