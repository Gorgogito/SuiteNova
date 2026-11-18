import { Button, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { groupIntoLines, newTextContainer, readableText, strokeBounds, strokesToSvg } from '@suitenova/notes-core';
import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { setCellAttr } from 'prosemirror-tables';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ReviewDialog } from '../spell';
import { notesHost } from './review-host';
import { TABLE_STYLES, applyTableStyle, DEFAULT_STYLE_OPTIONS, setTableProps, sortTable, findTable } from '../writer/table-tools';
import { SYMBOL_GROUPS } from '../writer/symbols';
import type { NotesCtl } from './ctl';
import { Modal } from './Dialogs';
import { recognizeImage } from './ocr';

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

export function ReadDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const text = useMemo(() => readableText(ctl.page), [ctl.page]);
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(1);
  const [size, setSize] = useState(22);
  const [spacing, setSpacing] = useState(1.6);
  const [theme, setTheme] = useState<'light' | 'cream' | 'dark'>('light');
  const [pos, setPos] = useState<{ start: number; end: number } | null>(null);
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle');
  useEffect(() => {
    if (!synth) return;
    const load = () => {
      const all = synth.getVoices();
      setVoices(all);
      setVoice((cur) => cur || all.find((v) => v.lang.toLowerCase().startsWith('es'))?.name || all[0]?.name || '');
    };
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => {
      synth.removeEventListener?.('voiceschanged', load);
      synth.cancel();
    };
  }, [synth]);
  const play = () => {
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.name === voice);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = rate;
    u.onboundary = (e) => {
      const len = e.charLength || (/\S+/.exec(text.slice(e.charIndex))?.[0].length ?? 1);
      setPos({ start: e.charIndex, end: e.charIndex + len });
    };
    u.onend = () => {
      setState('idle');
      setPos(null);
    };
    u.onerror = () => setState('idle');
    synth.speak(u);
    setState('playing');
  };
  const colors = { light: ['#fff', '#111'], cream: ['#f6edd6', '#2b2418'], dark: ['#1c1c1c', '#eee'] }[theme];
  return (
    <Modal
      wide
      title={t('Lector inmersivo')}
      onClose={() => {
        synth?.cancel();
        onClose();
      }}
      actions={closeBtn(() => {
        synth?.cancel();
        onClose();
      })}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {synth ? (
          <>
            {state !== 'playing' ? (
              <Button
                appearance="primary"
                onClick={() => {
                  if (state === 'paused') {
                    synth.resume();
                    setState('playing');
                  } else play();
                }}
              >
                {state === 'paused' ? t('Continuar') : t('Leer en voz alta')}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  synth.pause();
                  setState('paused');
                }}
              >
                {t('Pausa')}
              </Button>
            )}
            <Button
              disabled={state === 'idle'}
              onClick={() => {
                synth.cancel();
                setState('idle');
                setPos(null);
              }}
            >
              {t('Detener')}
            </Button>
            <label>
              {t('Voz')}{' '}
              <select className="nv-select" aria-label={t('Voz')} value={voice} onChange={(e) => setVoice(e.target.value)}>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Velocidad')} <input type="range" min={0.5} max={2} step={0.25} value={rate} aria-label={t('Velocidad')} onChange={(e) => setRate(Number(e.target.value))} />
            </label>
          </>
        ) : (
          <span role="alert">{t('Este sistema no tiene síntesis de voz disponible.')}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
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
          pos ? (
            <>
              {text.slice(0, pos.start)}
              <mark style={{ background: '#ffd54a', color: '#000' }}>{text.slice(pos.start, pos.end)}</mark>
              {text.slice(pos.end)}
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

// ------------------------------------------------------------------------------------------------ recorte de pantalla

/** Pide a la persona que elija una pantalla, ventana o pestaña y devuelve una captura. */
export async function captureScreen(): Promise<HTMLCanvasElement> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(t('Este sistema no permite capturar la pantalla desde el programa.'));
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 250));
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d')!.drawImage(video, 0, 0);
    return c;
  } finally {
    stream.getTracks().forEach((tr) => tr.stop());
  }
}

export function ScreenClipDialog({ canvas, onInsert, onClose }: { canvas: HTMLCanvasElement; onInsert: (png: Blob, w: number, h: number) => void; onClose: () => void }) {
  const view = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const maxW = 680;
  const scale = Math.min(1, maxW / canvas.width);
  /** Relación entre el tamaño en pantalla de la vista previa y el de su lienzo (el cuadro puede ser más estrecho). */
  const cssRatio = () => {
    const r = view.current!.getBoundingClientRect();
    return r.width ? r.width / view.current!.width : 1;
  };
  useEffect(() => {
    const v = view.current!;
    v.width = Math.round(canvas.width * scale);
    v.height = Math.round(canvas.height * scale);
    v.getContext('2d')!.drawImage(canvas, 0, 0, v.width, v.height);
  }, [canvas, scale]);
  const pt = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    const k = cssRatio();
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)) / k, y: Math.max(0, Math.min(r.height, e.clientY - r.top)) / k };
  };
  const insert = () => {
    const box = rect ? { x: Math.min(rect.x1, rect.x2), y: Math.min(rect.y1, rect.y2), w: Math.abs(rect.x2 - rect.x1), h: Math.abs(rect.y2 - rect.y1) } : null;
    const useBox = box && box.w > 4 && box.h > 4;
    const sx = useBox ? box.x / scale : 0;
    const sy = useBox ? box.y / scale : 0;
    const sw = useBox ? box.w / scale : canvas.width;
    const sh = useBox ? box.h / scale : canvas.height;
    const out = document.createElement('canvas');
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    out.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    out.toBlob((b) => b && onInsert(b, out.width, out.height), 'image/png');
  };
  return (
    <Modal wide title={t('Recorte de pantalla')} onClose={onClose} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" onClick={insert}>{rect ? t('Insertar el recorte') : t('Insertar todo')}</Button></>}>
      <p className="nn-note">{t('Arrastra sobre la captura para elegir la zona; si no eliges ninguna se inserta entera.')}</p>
      <div style={{ position: 'relative', display: 'inline-block', touchAction: 'none' }}>
        <canvas
          ref={view}
          aria-label={t('Captura de pantalla')}
          data-testid="nn-clip-canvas"
          style={{ maxWidth: '100%', cursor: 'crosshair', display: 'block' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = pt(e);
            drag.current = p;
            setRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = pt(e);
            setRect({ x1: drag.current.x, y1: drag.current.y, x2: p.x, y2: p.y });
          }}
          onPointerUp={() => (drag.current = null)}
        />
        {rect && <div style={{ position: 'absolute', left: Math.min(rect.x1, rect.x2) * cssRatio(), top: Math.min(rect.y1, rect.y2) * cssRatio(), width: Math.abs(rect.x2 - rect.x1) * cssRatio(), height: Math.abs(rect.y2 - rect.y1) * cssRatio(), border: '2px dashed #0f6cbd', background: 'rgba(15,108,189,.15)', pointerEvents: 'none' }} />}
      </div>
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

const SHADES = ['#ffffff', '#fff2cc', '#e2efd9', '#dce6f4', '#fbe5d5', '#ffd9e6', '#e4dcf1', '#d9d9d9', '#bfbfbf', '#ffe34d', '#7fe38a', '#7fd4ff'];

export function NotesTableLookDialog({ ctl, onClose }: { ctl: NotesCtl; onClose: () => void }) {
  const v = ctl.view;
  const tb = v ? findTable(v.state) : null;
  const [style, setStyle] = useState('grid');
  const [header, setHeader] = useState(!!tb?.node.attrs.headerRow);
  const [banded, setBanded] = useState(false);
  const run = (fn: (s: NonNullable<typeof v>) => void) => v && fn(v);
  return (
    <Modal title={t('Aspecto de la tabla')} onClose={onClose} actions={closeBtn(onClose)}>
      <div style={field}>
        <label htmlFor="nn-tb-style">{t('Estilo')}</label>
        <select id="nn-tb-style" className="nv-select" value={style} onChange={(e) => setStyle(e.target.value)}>
          {TABLE_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.name)}
            </option>
          ))}
        </select>
      </div>
      <label className="nn-check">
        <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('Fila de encabezado')}
      </label>
      <label className="nn-check">
        <input type="checkbox" checked={banded} onChange={(e) => setBanded(e.target.checked)} /> {t('Filas alternas')}
      </label>
      <div style={{ marginTop: 8 }}>
        <Button
          appearance="primary"
          onClick={() =>
            run((view) => {
              const def = TABLE_STYLES.find((s) => s.id === style)!;
              setTableProps({ headerRow: header })(view.state, view.dispatch);
              applyTableStyle(def, { ...DEFAULT_STYLE_OPTIONS, headerRow: header, bandedRows: banded })(view.state, view.dispatch);
            })
          }
        >
          {t('Aplicar')}
        </Button>
      </div>
      <p style={{ marginTop: 14 }}>{t('Sombreado de las celdas seleccionadas')}</p>
      <div className="nv-swatches" role="group" aria-label={t('Sombreado')}>
        {SHADES.map((c) => (
          <button key={c} type="button" style={{ background: c }} aria-label={c} title={c} onClick={() => run((view) => setCellAttr('background', c)(view.state, view.dispatch))} />
        ))}
        <Button size="small" onClick={() => run((view) => setCellAttr('background', null)(view.state, view.dispatch))}>
          {t('Quitar')}
        </Button>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="nn-check">
          <input type="checkbox" defaultChecked={tb?.node.attrs.borders !== false} onChange={(e) => run((view) => setTableProps({ borders: e.target.checked })(view.state, view.dispatch))} /> {t('Mostrar los bordes')}
        </label>
      </div>
    </Modal>
  );
}

void Input;
