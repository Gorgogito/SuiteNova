import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { emptyDoc, formatPageNumber, markTypes, noteDoc, ptToPx, writerSchema } from '@suitenova/writer-core';
import { PAGE_GAP, type WriterCtl } from './doc';
import { backspaceCommand, deleteCommand, enterCommand, shiftTabCommand, tabCommand } from './editing';

const FIELD_RE = /<span class="nw-field[^"]*"([^>]*)>[^<]*<\/span>/g;

/** Serialize a header/footer document to HTML with its fields still unresolved. */
export function hfHtml(doc: PMNode | null): string {
  if (!doc) return '';
  const div = document.createElement('div');
  div.appendChild(DOMSerializer.fromSchema(writerSchema).serializeFragment(doc.content));
  return div.innerHTML;
}

export interface FieldContext {
  label: string;
  number: number;
  pages: number;
  section: number;
  sectionPages: number;
  title: string;
  author: string;
  file: string;
}

const attrOf = (s: string, name: string): string | null => new RegExp(`data-${name}="([^"]*)"`).exec(s)?.[1] ?? null;
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function resolveFields(html: string, c: FieldContext): string {
  return html.replace(FIELD_RE, (_m, attrs: string) => {
    const kind = attrOf(attrs, 'kind') ?? 'page';
    const result = attrOf(attrs, 'result');
    switch (kind) {
      case 'page':
        return c.label;
      case 'pages':
      case 'numpages':
        return String(c.pages);
      case 'section':
        return String(c.section);
      case 'sectionpages':
        return String(c.sectionPages);
      case 'date':
        return new Date().toLocaleDateString();
      case 'time':
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'title':
        return escape(c.title);
      case 'author':
        return escape(c.author);
      case 'filename':
        return escape(c.file);
      default:
        return result !== null ? unescape(result) : '';
    }
  });
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A small ProseMirror editor mounted once; it reports every change of its document. */
export function MiniPM({ doc, onChange, onBlur, onView, autoFocus, label, className }: { doc: PMNode | null; onChange: (doc: PMNode) => void; onBlur?: () => void; onView?: (v: EditorView | null) => void; autoFocus?: boolean; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ onChange, onBlur, onView });
  cb.current = { onChange, onBlur, onView };
  useEffect(() => {
    const el = ref.current!;
    const view = new EditorView(el, {
      state: EditorState.create({
        doc: doc ?? emptyDoc(),
        plugins: [
          history(),
          keymap({ Enter: enterCommand, Tab: tabCommand, 'Shift-Tab': shiftTabCommand, Backspace: backspaceCommand, Delete: deleteCommand, 'Mod-z': undo, 'Mod-y': redo, 'Mod-b': toggleMark(markTypes.strong!), 'Mod-i': toggleMark(markTypes.em!), 'Mod-u': toggleMark(markTypes.underline!) }),
          keymap(baseKeymap),
        ],
      }),
      attributes: { class: `nw-doc nw-mini ${className ?? ''}`, 'aria-label': label },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) cb.current.onChange(next.doc);
      },
      handleDOMEvents: {
        blur: () => {
          cb.current.onBlur?.();
          return false;
        },
      },
    });
    (el as unknown as { __view: EditorView }).__view = view;
    cb.current.onView?.(view);
    if (autoFocus) view.focus();
    return () => {
      cb.current.onView?.(null);
      view.destroy();
    };
    // the editor is created once: the document it shows afterwards is its own
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className="nw-mini-mount" />;
}

function fieldCtx(ctl: WriterCtl, index: number): FieldContext {
  const specs = ctl.pageSpecs;
  const spec = specs[index]!;
  const sections = ctl.sections();
  const sec = sections[spec.section];
  return {
    label: formatPageNumber(spec.number, sec?.props.pgNumFmt ?? 'decimal'),
    number: spec.number,
    pages: specs.length,
    section: spec.section + 1,
    sectionPages: specs.filter((s) => s.section === spec.section).length,
    title: ctl.title ?? '',
    author: ctl.author ?? '',
    file: ctl.fileName ?? '',
  };
}

/** Draws the paper: one rectangle per page with its header, footer, footnotes and watermark. Behind the editor. */
export function PageOverlay({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const rects = ctl.pageRects();
  const sections = ctl.sections();
  const wm = ctl.watermark;
  return (
    <div className="nw-pages" aria-hidden="true">
      {rects.map((r, i) => {
        const sec = sections[r.spec.section] ?? sections[0];
        if (!sec) return null;
        const p = sec.props.page;
        const variant = ctl.variantFor(r.spec);
        const header = ctl.partFor(r.spec.section, 'header', variant);
        const footer = ctl.partFor(r.spec.section, 'footer', variant);
        const fc = fieldCtx(ctl, i);
        const editing = ctl.hfEdit && ctl.hfEdit.page === i ? ctl.hfEdit : null;
        const h = editing?.kind === 'header' ? '' : hfHtml(header);
        const f = editing?.kind === 'footer' ? '' : hfHtml(footer);
        return (
          <div key={i} className={`nw-page${r.spec.blank ? ' nw-page-blank' : ''}`} style={{ top: r.topCss, left: r.left, width: r.width, height: r.height }}>
            {wm && <Watermark wm={wm} width={r.width} height={r.height} />}
            {h && (
              <div
                className="nw-hf nw-header nw-doc"
                style={{ top: ptToPx(p.headerDistance), left: ptToPx(p.marginLeft), right: ptToPx(p.marginRight), maxHeight: Math.max(0, ptToPx(p.marginTop - p.headerDistance)) }}
                dangerouslySetInnerHTML={{ __html: resolveFields(h, fc) }}
              />
            )}
            {f && (
              <div
                className="nw-hf nw-footer nw-doc"
                style={{ bottom: ptToPx(p.footerDistance), left: ptToPx(p.marginLeft), right: ptToPx(p.marginRight), maxHeight: Math.max(0, ptToPx(p.marginBottom - p.footerDistance)) }}
                dangerouslySetInnerHTML={{ __html: resolveFields(f, fc) }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Watermark({ wm, width, height }: { wm: NonNullable<WriterCtl['watermark']>; width: number; height: number }) {
  const opacity = wm.semitransparent ? 0.45 : 1;
  const angle = wm.layout === 'diagonal' ? -45 : 0;
  if (wm.image) {
    const scale = Math.max(5, wm.scale || 100) / 100;
    return <img className="nw-watermark" alt="" src={wm.image} style={{ opacity, width: width * 0.6 * scale, transform: `translate(-50%, -50%) rotate(${angle}deg)` }} />;
  }
  const text = wm.text ?? '';
  const auto = Math.min((Math.min(width, height) * 1.05) / Math.max(4, text.length * 0.62), height / 6);
  const size = wm.size > 0 ? (wm.size * 96) / 72 : auto;
  return (
    <div className="nw-watermark" style={{ opacity, color: wm.color, fontFamily: `'${wm.font}', Carlito, sans-serif`, fontSize: size, transform: `translate(-50%, -50%) rotate(${angle}deg)` }}>
      {text}
    </div>
  );
}

/** The footnote texts of a page for the editors that sit over the page (transparent catchers and in-place editors). */
export { noteDoc };
export { PAGE_GAP };
