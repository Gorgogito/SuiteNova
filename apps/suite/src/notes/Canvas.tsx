import { Button, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { contentNode, pageExtent, recognizeShape, simplify, snap, strokeBounds, strokePath, strokesInRect, type Container, type ImageContainer, type MediaContainer, type Page, type Stroke, type TextContainer } from '@suitenova/notes-core';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MathView } from '../writer/nodeviews';
import type { NotesCtl } from './ctl';
import { textPlugins } from './plugins';

const mathHost = (ctl: NotesCtl, openDialog: (k: string, arg?: unknown) => void) => ({ openDialog, openControl: () => undefined, readOnly: () => false, canFill: () => false, ctl });

// ------------------------------------------------------------------------------------------------ text boxes

function TextBox({ ctl, c, openDialog }: { ctl: NotesCtl; c: TextContainer; openDialog: (k: string, arg?: unknown) => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const initial = useRef(c.content);
  useEffect(() => {
    const el = mount.current!;
    const host = mathHost(ctl, openDialog);
    const view: EditorView = new EditorView(el, {
      state: EditorState.create({ doc: contentNode(initial.current), plugins: textPlugins(ctl) }),
      nodeViews: { math: (node, v, getPos) => new MathView(node, v, getPos as () => number | undefined, host) },
      attributes: { class: 'nw-doc nn-doc', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Cuadro de texto' },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) ctl.updateText(c.id, view.state.doc);
        else ctl.touch();
      },
      handleDOMEvents: {
        focus() {
          ctl.focusView(c.id);
          return false;
        },
        blur() {
          // un cuadro vacío que se deja sin escribir desaparece, como en OneNote
          setTimeout(() => ctl.dropIfEmpty(c.id), 150);
          return false;
        },
      },
    });
    ctl.attachView(c.id, view);
    if (ctl.focusRequest === c.id) {
      ctl.focusRequest = null;
      view.focus();
    }
    const ro = new ResizeObserver(() => ctl.setHeight(c.id, el.getBoundingClientRect().height / ((el.closest('.nn-canvas') as HTMLElement | null)?.dataset.zoom ? Number((el.closest('.nn-canvas') as HTMLElement).dataset.zoom) : 1)));
    ro.observe(el);
    return () => {
      ro.disconnect();
      ctl.detachView(c.id);
      view.destroy();
    };
    // el editor se crea una vez por cuadro y por «época» de la página; lo que se escribe vuelve a la página por dispatchTransaction
  }, [c.id, ctl.pageEpoch]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={mount} className="nn-box__text" />;
}

// ------------------------------------------------------------------------------------------------ media

function ImageBody({ ctl, c }: { ctl: NotesCtl; c: ImageContainer }) {
  const src = ctl.assetUrl(c.asset);
  return src ? <img src={src} alt={c.alt} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} /> : <div className="nn-missing">{t('Imagen no disponible')}</div>;
}

function MediaBody({ ctl, c }: { ctl: NotesCtl; c: MediaContainer }) {
  const src = ctl.assetUrl(c.asset);
  if (!src) return <div className="nn-missing">{t('Grabación no disponible')}</div>;
  return c.media === 'audio' ? (
    <div className="nn-audio">
      <span className="nn-audio__name">🎙 {c.name}</span>
      <audio controls src={src} aria-label={c.name} />
    </div>
  ) : (
    <video controls src={src} aria-label={c.name} style={{ width: '100%', height: '100%', display: 'block', background: '#000' }} />
  );
}

// ------------------------------------------------------------------------------------------------ a box on the page

function Box({ ctl, c, scale, openDialog }: { ctl: NotesCtl; c: Container; scale: number; openDialog: (k: string, arg?: unknown) => void }) {
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; mode: 'move' | 'resize'; w: number; h: number } | null>(null);
  const selected = ctl.selected === c.id;
  const start = (mode: 'move' | 'resize') => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ctl.select(c.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ctl.beginGesture();
    drag.current = { x: e.clientX, y: e.clientY, ox: c.x, oy: c.y, mode, w: c.w, h: 'h' in c ? c.h : 0 };
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    if (d.mode === 'move') ctl.liveSetPos(c.id, e.altKey ? d.ox + dx : snap(d.ox + dx, 4), e.altKey ? d.oy + dy : snap(d.oy + dy, 4));
    else ctl.liveResize(c.id, d.w + dx, c.kind === 'text' || e.shiftKey ? undefined : d.h + dy);
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ya se soltó
    }
  };
  const h = c.kind === 'text' ? undefined : c.h;
  return (
    <div
      className={`nn-box nn-box--${c.kind}${selected ? ' is-selected' : ''}`}
      data-box={c.id}
      style={{ left: c.x, top: c.y, width: c.w, height: h, zIndex: c.z }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (ctl.selected !== c.id) ctl.select(c.id);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        if (c.kind === 'image') openDialog('image', c.id);
      }}
    >
      <div className="nn-box__bar" role="button" tabIndex={-1} aria-label={t('Mover el cuadro')} title={t('Arrastra para mover el cuadro')} onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <span aria-hidden="true">⋮⋮⋮</span>
      </div>
      {c.kind === 'text' && <TextBox ctl={ctl} c={c} openDialog={openDialog} />}
      {c.kind === 'image' && <ImageBody ctl={ctl} c={c} />}
      {c.kind === 'media' && <MediaBody ctl={ctl} c={c} />}
      <div className="nn-box__rh" role="separator" aria-label={t('Cambiar el tamaño del cuadro')} onPointerDown={start('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ ink

interface Live {
  tool: Stroke['tool'];
  pts: number[];
}

function InkLayer({ ctl, page, scale, w, h }: { ctl: NotesCtl; page: Page; scale: number; w: number; h: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [live, setLiveState] = useState<Live | null>(null);
  const [rect, setRectState] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  // los eventos del puntero pueden llegar más deprisa de lo que React redibuja: el estado «vivo» se guarda también en referencias
  const liveRef = useRef<Live | null>(null);
  const rectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const setLive = (v: Live | null) => {
    liveRef.current = v;
    setLiveState(v);
  };
  const setRect = (v: { x1: number; y1: number; x2: number; y2: number } | null) => {
    rectRef.current = v;
    setRectState(v);
  };
  const [eraser, setEraser] = useState<{ x: number; y: number } | null>(null);
  const gesture = useRef<{ kind: 'draw' | 'erase' | 'lasso' | 'move'; x: number; y: number } | null>(null);
  const tool = ctl.tool;
  const active = tool !== 'select';
  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const selBounds = () => {
    const sel = page.ink.filter((s) => ctl.selectedStrokes.includes(s.id));
    if (!sel.length) return null;
    const b = sel.map(strokeBounds);
    return { x1: Math.min(...b.map((r) => r.x1)), y1: Math.min(...b.map((r) => r.y1)), x2: Math.max(...b.map((r) => r.x2)), y2: Math.max(...b.map((r) => r.y2)) };
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!active || e.button !== 0) return;
    e.preventDefault();
    svg.current!.setPointerCapture(e.pointerId);
    const p = at(e);
    if (tool === 'eraser') {
      ctl.beginInkGesture();
      gesture.current = { kind: 'erase', ...p };
      ctl.eraseStrokes(p.x, p.y, 10);
      setEraser(p);
    } else if (tool === 'lasso') {
      const b = selBounds();
      if (b && p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2) {
        ctl.beginInkGesture();
        gesture.current = { kind: 'move', ...p };
      } else {
        ctl.selectStrokes([]);
        gesture.current = { kind: 'lasso', ...p };
        setRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      }
    } else {
      gesture.current = { kind: 'draw', ...p };
      setLive({ tool: tool === 'highlighter' ? 'highlighter' : (tool as Stroke['tool']), pts: tool === 'pen' || tool === 'highlighter' ? [p.x, p.y] : [p.x, p.y, p.x, p.y] });
    }
  };
  const moveEv = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const p = at(e);
    if (tool === 'eraser') setEraser(p);
    if (!g) return;
    if (g.kind === 'erase') ctl.eraseStrokes(p.x, p.y, 10);
    else if (g.kind === 'lasso') setRect(rectRef.current ? { ...rectRef.current, x2: p.x, y2: p.y } : null);
    else if (g.kind === 'move') {
      ctl.moveSelectedStrokes(p.x - g.x, p.y - g.y);
      gesture.current = { kind: 'move', ...p };
    } else if (liveRef.current) {
      const live = liveRef.current;
      if (live.tool === 'pen' || live.tool === 'highlighter') setLive({ ...live, pts: [...live.pts, p.x, p.y] });
      else {
        let { x, y } = p;
        if (e.shiftKey) {
          const dx = x - live.pts[0]!;
          const dy = y - live.pts[1]!;
          if (live.tool === 'line' || live.tool === 'arrow') {
            if (Math.abs(dx) > Math.abs(dy) * 2) y = live.pts[1]!;
            else if (Math.abs(dy) > Math.abs(dx) * 2) x = live.pts[0]!;
          } else {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            x = live.pts[0]! + Math.sign(dx || 1) * m;
            y = live.pts[1]! + Math.sign(dy || 1) * m;
          }
        }
        setLive({ ...live, pts: [live.pts[0]!, live.pts[1]!, x, y] });
      }
    }
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    try {
      svg.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ya se soltó
    }
    if (!g) return;
    const rect = rectRef.current;
    const live = liveRef.current;
    if (g.kind === 'lasso' && rect) {
      ctl.selectStrokes(strokesInRect(page.ink, rect).map((s) => s.id));
      setRect(null);
    }
    if (g.kind === 'draw' && live) {
      let pts = live.pts;
      const shape = live.tool === 'line' || live.tool === 'arrow' || live.tool === 'rect' || live.tool === 'ellipse';
      if (!shape) pts = simplify(pts);
      const tiny = shape ? Math.hypot(pts[2]! - pts[0]!, pts[3]! - pts[1]!) < 3 : false;
      if (!tiny) {
        let s = ctl.newStrokeFrom(pts.length === 2 ? [pts[0]!, pts[1]!, pts[0]! + 0.1, pts[1]! + 0.1] : pts);
        if (!shape && ctl.inkToShape && live.tool === 'pen') s = recognizeShape(s) ?? s;
        ctl.addStroke(s);
      }
      setLive(null);
    }
  };
  const sel = selBounds();
  const liveStroke: Stroke | null = live
    ? { id: 'live', tool: live.tool, color: live.tool === 'highlighter' ? ctl.highlightColor : ctl.penColor, width: live.tool === 'highlighter' ? 18 : ctl.penWidth, opacity: live.tool === 'highlighter' ? 0.4 : 1, pts: live.pts.length === 2 ? [live.pts[0]!, live.pts[1]!, live.pts[0]! + 0.1, live.pts[1]! + 0.1] : live.pts }
    : null;
  const draw = (s: Stroke) => (
    <path key={s.id} data-stroke={s.id} d={strokePath(s)} fill="none" stroke={s.color} strokeWidth={s.width} strokeOpacity={s.opacity} strokeLinecap="round" strokeLinejoin="round" style={s.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined} />
  );
  return (
    <svg ref={svg} className={`nn-ink${active ? ' is-active' : ''} nn-ink--${tool}`} width={w} height={h} aria-label={t('Tinta y dibujo')} onPointerDown={down} onPointerMove={moveEv} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setEraser(null)}>
      {page.ink.map(draw)}
      {liveStroke && draw(liveStroke)}
      {sel && <rect x={sel.x1 - 3} y={sel.y1 - 3} width={sel.x2 - sel.x1 + 6} height={sel.y2 - sel.y1 + 6} fill="rgba(15,108,189,.06)" stroke="#0f6cbd" strokeDasharray="4 3" />}
      {rect && <rect x={Math.min(rect.x1, rect.x2)} y={Math.min(rect.y1, rect.y2)} width={Math.abs(rect.x2 - rect.x1)} height={Math.abs(rect.y2 - rect.y1)} fill="rgba(15,108,189,.08)" stroke="#0f6cbd" strokeDasharray="4 3" />}
      {eraser && tool === 'eraser' && <circle cx={eraser.x} cy={eraser.y} r={10} fill="rgba(255,255,255,.5)" stroke="#555" />}
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------ locked page

export function LockedPanel({ ctl, what }: { ctl: NotesCtl; what: 'page' | 'section' }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const target = what === 'page' ? ctl.page : ctl.section;
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      if (!(await ctl.unlock(what, pw))) setErr(t('La contraseña no es correcta.'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nn-locked" role="group" aria-label={what === 'page' ? t('Página protegida') : t('Sección protegida')}>
      <div className="nn-locked__icon" aria-hidden="true">
        🔒
      </div>
      <h2>{what === 'page' ? t('Esta página está protegida con contraseña') : t('Esta sección está protegida con contraseña')}</h2>
      {target.protect?.hint && (
        <p>
          {t('Pista:')} {target.protect.hint}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Input type="password" aria-label={t('Contraseña')} placeholder={t('Contraseña')} value={pw} onChange={(_e, d) => setPw(d.value)} autoFocus />
        <Button appearance="primary" type="submit" disabled={busy || !pw}>
          {busy ? t('Abriendo…') : t('Abrir')}
        </Button>
      </form>
      {err && <p role="alert">{err}</p>}
      <p className="nn-locked__note">{t('Si olvidas la contraseña no hay forma de recuperar el contenido.')}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the page

export function Canvas({ ctl, zoom, openDialog }: { ctl: NotesCtl; zoom: number; openDialog: (k: string, arg?: unknown) => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const page = ctl.page;
  const scale = zoom / 100;
  const ref = useRef<HTMLDivElement>(null);
  // un clic solo crea un cuadro si empezó (y no solo terminó) sobre el fondo de la página
  const downOnBackground = useRef(false);
  const { w, h } = pageExtent(page, ctl.heights);

  const at = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = ref.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    },
    [scale],
  );

  // pegar una imagen o soltar archivos sobre la página
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('.ProseMirror, input, textarea')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      ctl.emit('files', files);
    };
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      ctl.emit('files', files, at(e));
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    document.addEventListener('paste', onPaste);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragover', onOver);
    return () => {
      document.removeEventListener('paste', onPaste);
      el.removeEventListener('drop', onDrop);
      el.removeEventListener('dragover', onOver);
    };
  }, [ctl, at]);

  // teclado con un cuadro seleccionado (y sin estar escribiendo en él)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('.ProseMirror, input, textarea, select, [contenteditable="true"]');
      if (typing) return;
      if (ctl.tool === 'lasso' && ctl.selectedStrokes.length && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        ctl.deleteSelectedStrokes();
        return;
      }
      const c = ctl.selectedContainer;
      if (!c) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        ctl.deleteContainer(c.id);
      } else if (e.key === 'Escape') ctl.select(null);
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 24 : 4;
        ctl.beginGesture();
        ctl.liveMove([c.id], e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  useLayoutEffect(() => {
    if (ref.current) ref.current.dataset.zoom = String(scale);
  }, [scale]);

  const s = page.style;
  const empty = page.containers.length === 0 && page.ink.length === 0;
  return (
    <div
      ref={ref}
      className={`nn-canvas nn-rule-${s.ruling}${s.margin ? ' has-margin' : ''}`}
      data-zoom={scale}
      role="region"
      aria-label={t('Lienzo de la página')}
      style={{ width: w, height: h, zoom: scale, backgroundColor: s.color }}
      onPointerDown={(e) => {
        downOnBackground.current = e.button === 0 && e.target === ref.current;
        if (e.button !== 0 || e.target !== ref.current || ctl.tool !== 'select') return;
        ctl.select(null);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
      onClick={(e) => {
        if (e.target !== ref.current || ctl.tool !== 'select' || !downOnBackground.current) return;
        downOnBackground.current = false;
        const p = at(e);
        ctl.addTextAt(p.x, p.y);
      }}
    >
      {empty && <div className="nn-hint">{t('Haz clic en cualquier punto de la página para escribir, o arrastra aquí imágenes.')}</div>}
      {page.containers.map((c) => (
        <Box key={`${c.id}:${ctl.pageEpoch}`} ctl={ctl} c={c} scale={scale} openDialog={openDialog} />
      ))}
      <InkLayer ctl={ctl} page={page} scale={scale} w={w} h={h} />
    </div>
  );
}
