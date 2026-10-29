import { t } from '@suitenova/core-ui';
import { ptToPx, type NoteRef } from '@suitenova/writer-core';
import { useSyncExternalStore } from 'react';
import { noteHtml, type WriterCtl } from './doc';
import { NOTE_SEP } from './paginate';
import { MiniPM, hfHtml, resolveFields, type FieldContext } from './PageOverlay';
import { formatPageNumber } from '@suitenova/writer-core';

/**
 * Transparent areas above the document: the header and footer bands (double-click to edit them right on the page)
 * and the footnote areas. They sit over the editor, so the text of the document never receives their clicks.
 */
export function ZonesLayer({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const rects = ctl.pageRects();
  const sections = ctl.sections();
  const edit = ctl.hfEdit;
  const ctx = (i: number): FieldContext => {
    const spec = ctl.pageSpecs[i]!;
    const sec = sections[spec.section];
    return {
      label: formatPageNumber(spec.number, sec?.props.pgNumFmt ?? 'decimal'),
      number: spec.number,
      pages: ctl.pageSpecs.length,
      section: spec.section + 1,
      sectionPages: ctl.pageSpecs.filter((s) => s.section === spec.section).length,
      title: ctl.title ?? '',
      author: ctl.author ?? '',
      file: ctl.fileName ?? '',
    };
  };
  void ctx;
  void hfHtml;
  void resolveFields;
  return (
    <div className="nw-zones">
      {rects.map((r, i) => {
        const sec = sections[r.spec.section] ?? sections[0];
        if (!sec) return null;
        const p = sec.props.page;
        const editingHere = edit && edit.page === i ? edit : null;
        const band = (kind: 'header' | 'footer') => {
          const top = kind === 'header';
          const height = ptToPx(top ? p.marginTop : p.marginBottom);
          const isEditing = editingHere?.kind === kind;
          const variant = ctl.variantFor(r.spec);
          const linked = !ctl.hasOwnPart(r.spec.section, kind, variant) && r.spec.section > 0;
          return (
            <div
              className={`nw-zone nw-zone-${kind}${isEditing ? ' is-editing' : ''}`}
              style={{ [top ? 'top' : 'bottom']: 0, height }}
              onDoubleClick={() => !isEditing && ctl.beginHFEdit(kind, i)}
              title={isEditing ? undefined : t('Doble clic para editar el encabezado o el pie de página')}
            >
              {isEditing && (
                <>
                  <div className="nw-hf-tag" style={{ [top ? 'bottom' : 'top']: -22 }}>
                    <span>
                      {kind === 'header' ? t('Encabezado') : t('Pie de página')} · {t('Sección {n}', { n: r.spec.section + 1 })}
                      {variant === 'first' ? ` · ${t('Primera página')}` : variant === 'even' ? ` · ${t('Páginas pares')}` : ''}
                      {linked ? ` · ${t('Igual que el anterior')}` : ''}
                    </span>
                    <button type="button" className="nv-btn nv-btn--small" onClick={() => ctl.endHFEdit()}>
                      {t('Cerrar encabezado y pie de página')}
                    </button>
                  </div>
                  <div
                    className="nw-hf-edit nw-doc"
                    style={{
                      position: 'absolute',
                      left: ptToPx(p.marginLeft),
                      right: ptToPx(p.marginRight),
                      [top ? 'top' : 'bottom']: ptToPx(top ? p.headerDistance : p.footerDistance),
                      minHeight: 24,
                    }}
                  >
                    <MiniPM
                      key={`${edit!.kind}-${edit!.section}-${edit!.variant}`}
                      doc={ctl.partFor(r.spec.section, kind, variant)}
                      label={kind === 'header' ? t('Encabezado') : t('Pie de página')}
                      autoFocus
                      onView={(v) => {
                        ctl.activeView = v;
                        ctl.touch();
                      }}
                      onChange={(doc) => ctl.setPart(r.spec.section, kind, variant, doc)}
                    />
                  </div>
                </>
              )}
            </div>
          );
        };
        return (
          <div key={i} className="nw-zone-page" style={{ top: r.topCss, left: r.left, width: r.width, height: r.height }}>
            <PageNotes ctl={ctl} notes={r.spec.notes.map((nid) => ctl.notes().find((n) => n.id === nid)).filter((n): n is NoteRef => !!n)} page={p} />
            {band('header')}
            {band('footer')}
          </div>
        );
      })}
    </div>
  );
}

/** The footnotes of a page, at the bottom of its text area; double-click one to write its text. */
function PageNotes({ ctl, notes, page }: { ctl: WriterCtl; notes: NoteRef[]; page: { marginLeft: number; marginRight: number; marginBottom: number } }) {
  if (!notes.length) return null;
  return (
    <div className="nw-fn-area nw-doc" style={{ left: ptToPx(page.marginLeft), right: ptToPx(page.marginRight), bottom: ptToPx(page.marginBottom), paddingTop: NOTE_SEP }}>
      {notes.map((n) => (
        <div key={n.id} data-id={n.id} onDoubleClick={() => ctl.beginNoteEdit(n.id)} title={t('Doble clic para editar la nota')} dangerouslySetInnerHTML={{ __html: noteHtml(n.node, n.label) }} />
      ))}
    </div>
  );
}
