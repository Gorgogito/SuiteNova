/** The formatting buttons over the message: characters, paragraphs, lists and links, and the controls of the table the cursor is in. */
import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { markTypes, type Align } from '@suitenova/writer-core';
import { AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Highlighter, IndentDecrease, IndentIncrease, Italic, Link, List, ListOrdered, RemoveFormatting, Strikethrough, Underline, type LucideIcon } from 'lucide-react';
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, isInTable } from 'prosemirror-tables';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useState, type ReactNode } from 'react';
import { BordersMenu, ShadingMenu, StyleGallery, pmTableHost } from '../../tables';
import { changeIndent, clearFormatting, listAncestor, markActive, markAttr, selectionParagraph, setAlign, setLink, setMark, toggleList, toggleMarkCmd } from '../../writer/editing';

const FONTS = ['Calibri', 'Arial', 'Segoe UI', 'Verdana', 'Tahoma', 'Times New Roman', 'Georgia', 'Courier New'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
const COLORS: [string, string][] = [
  ['#000000', 'Negro'], ['#7f7f7f', 'Gris'], ['#c00000', 'Rojo oscuro'], ['#ff0000', 'Rojo'], ['#ed7d31', 'Naranja'], ['#bf8f00', 'Dorado'],
  ['#00b050', 'Verde'], ['#00b0f0', 'Azul claro'], ['#0070c0', 'Azul'], ['#002060', 'Azul oscuro'], ['#7030a0', 'Morado'],
];
const MARKERS: [string, string][] = [['#ffff00', 'Amarillo'], ['#00ff00', 'Verde brillante'], ['#00ffff', 'Turquesa'], ['#ff00ff', 'Rosa'], ['#d9d9d9', 'Gris claro']];

export function runIn(view: EditorView | null, command: Command): void {
  if (!view) return;
  command(view.state, view.dispatch, view);
  view.focus();
}

function Tool({ label, icon: Icon, on, disabled, run }: { label: string; icon: LucideIcon; on?: boolean; disabled?: boolean; run: () => void }) {
  return (
    // the editor keeps the selection while the button is pressed
    <button type="button" className="nv-btn nv-btn--small ml-tool" aria-label={t(label)} title={t(label)} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function ColorTool({ label, icon: Icon, colors, none, pick }: { label: string; icon: LucideIcon; colors: [string, string][]; none: string; pick: (color: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const choose = (c: string | null) => {
    setOpen(false);
    pick(c);
  };
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-btn--small ml-tool" aria-label={t(label)} title={t(label)}>
          <Icon size={16} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-swatches" role="group" aria-label={t(label)}>
          {colors.map(([c, name]) => (
            <button key={c} type="button" aria-label={t(name)} title={t(name)} style={{ background: c }} onClick={() => choose(c)} />
          ))}
        </div>
        <button type="button" className="ml-btn" onClick={() => choose(null)}>
          {t(none)}
        </button>
      </PopoverSurface>
    </Popover>
  );
}

function LinkTool({ view }: { view: EditorView | null }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const apply = (href: string | null) => {
    setOpen(false);
    if (!view) return;
    const typed = href?.trim() ?? '';
    // an address typed without its scheme is a web page, or a mail address
    const full = !typed ? null : /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : /^[^\s@/]+@[^\s@/]+$/.test(typed) ? `mailto:${typed}` : `https://${typed}`;
    if (full && !/^(https?:|mailto:|tel:)/i.test(full)) return;
    runIn(view, setLink(full, full && view.state.selection.empty ? typed : undefined));
  };
  return (
    <Popover
      open={open}
      onOpenChange={(_e, d) => {
        if (d.open) setUrl(String((view && markAttr(view.state, markTypes.link!, 'href')) ?? ''));
        setOpen(d.open);
      }}
      positioning="below-start"
    >
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-btn--small ml-tool" aria-label={t('Vínculo')} title={t('Vínculo')}>
          <Link size={16} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <form
          className="ml-linkform"
          onSubmit={(e) => {
            e.preventDefault();
            apply(url);
          }}
        >
          <input aria-label={t('Dirección del vínculo')} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
          <button type="submit" className="ml-btn">
            {t('Insertar vínculo')}
          </button>
          <button type="button" className="ml-btn" onClick={() => apply(null)}>
            {t('Quitar vínculo')}
          </button>
        </form>
      </PopoverSurface>
    </Popover>
  );
}

export function FormatBar({ view, children }: { view: EditorView | null; children?: ReactNode }) {
  const s = view?.state;
  const on = (name: string) => (s ? markActive(s, markTypes[name]!) : false);
  const para = s ? selectionParagraph(s) : null;
  const list = s ? listAncestor(s)?.node.type.name : undefined;
  const run = (c: Command) => () => runIn(view, c);
  const value = (name: string) => String((s && markAttr(s, markTypes[name]!, 'value')) ?? '');
  const mark = (name: string, v: string | number | null) => runIn(view, setMark(markTypes[name]!, v === null || v === '' ? null : { value: v }));
  const font = value('fontFamily');
  return (
    <div className="ml-format" role="toolbar" aria-label={t('Formato del mensaje')}>
      <select className="nv-select" aria-label={t('Fuente')} value={font} onChange={(e) => mark('fontFamily', e.target.value)}>
        <option value="">Calibri</option>
        {FONTS.filter((f) => f !== 'Calibri').map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        {font && !FONTS.includes(font) && <option value={font}>{font}</option>}
      </select>
      <select className="nv-select" aria-label={t('Tamaño de fuente')} value={value('fontSize')} onChange={(e) => mark('fontSize', e.target.value ? Number(e.target.value) : null)}>
        <option value="">11</option>
        {SIZES.filter((n) => n !== 11).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="nv-sep" aria-hidden="true" />
      <Tool label="Negrita" icon={Bold} on={on('strong')} run={run(toggleMarkCmd(markTypes.strong!))} />
      <Tool label="Cursiva" icon={Italic} on={on('em')} run={run(toggleMarkCmd(markTypes.em!))} />
      <Tool label="Subrayado" icon={Underline} on={on('underline')} run={run(toggleMarkCmd(markTypes.underline!))} />
      <Tool label="Tachado" icon={Strikethrough} on={on('strike')} run={run(toggleMarkCmd(markTypes.strike!))} />
      <ColorTool label="Color de fuente" icon={Baseline} colors={COLORS} none="Automático" pick={(c) => mark('color', c)} />
      <ColorTool label="Color de resaltado" icon={Highlighter} colors={MARKERS} none="Sin resaltado" pick={(c) => mark('highlight', c)} />
      <Tool label="Borrar formato" icon={RemoveFormatting} run={run(clearFormatting())} />
      <span className="nv-sep" aria-hidden="true" />
      <Tool label="Viñetas" icon={List} on={list === 'bullet_list'} run={run(toggleList('bullet'))} />
      <Tool label="Numeración" icon={ListOrdered} on={list === 'ordered_list'} run={run(toggleList('ordered'))} />
      <Tool label="Disminuir sangría" icon={IndentDecrease} run={run(changeIndent(-18))} />
      <Tool label="Aumentar sangría" icon={IndentIncrease} run={run(changeIndent(18))} />
      {(
        [
          ['left', 'Alinear a la izquierda', AlignLeft],
          ['center', 'Centrar', AlignCenter],
          ['right', 'Alinear a la derecha', AlignRight],
        ] as [Align, string, LucideIcon][]
      ).map(([a, label, icon]) => (
        <Tool key={a} label={label} icon={icon} on={(para?.attrs.align ?? 'left') === a} run={run(setAlign(a))} />
      ))}
      <LinkTool view={view} />
      {children}
    </div>
  );
}

/** Rows, columns and looks of the table the cursor is in. */
export function TableBar({ view, insert }: { view: EditorView | null; insert: (rows: number, cols: number) => void }) {
  if (!view || !isInTable(view.state)) return null;
  const host = pmTableHost({ view: () => view, useRefresh: () => {}, insert });
  const button = (label: string, command: Command) => (
    <button type="button" className="ml-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => runIn(view, command)}>
      {t(label)}
    </button>
  );
  return (
    <div className="ml-format ml-format--table" role="toolbar" aria-label={t('Herramientas de tabla')}>
      {button('Agregar fila', addRowAfter)}
      {button('Agregar columna', addColumnAfter)}
      {button('Quitar fila', deleteRow)}
      {button('Quitar columna', deleteColumn)}
      {button('Quitar tabla', deleteTable)}
      <StyleGallery host={host} />
      <ShadingMenu host={host} />
      <BordersMenu host={host} />
    </div>
  );
}
