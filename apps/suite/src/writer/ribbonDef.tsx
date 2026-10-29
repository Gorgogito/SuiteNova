import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, RibbonItemView, t, type RibbonItem, type RibbonTab } from '@suitenova/core-ui';
import { MARGIN_PRESETS, PAGE_SIZES, PARAGRAPH_STYLES, markTypes } from '@suitenova/writer-core';
import { ChevronDown } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Command } from 'prosemirror-state';
import { isInTable, setCellAttr } from 'prosemirror-tables';
import { helpTab, viewTab } from '../common';
import { FONT_NAMES, FONT_SIZES, type WriterUI } from './commands';
import { markAttr, selectionParagraph, setMark, setStyle } from './editing';

type Leaf = Exclude<RibbonItem, { kind: 'separator' }>;
const btn = (command: string, extra: Partial<Extract<Leaf, { kind: 'button' }>> = {}): Leaf => ({ kind: 'button', command, size: 'small', iconOnly: true, ...extra });
const Item = ({ item }: { item: Leaf }) => <RibbonItemView item={item} />;
const Row = ({ children }: { children: ReactNode }) => <div className="nv-row">{children}</div>;
const Rows = ({ children }: { children: ReactNode }) => <div className="nv-rows">{children}</div>;
const Sep = () => <span className="nv-sep" role="separator" />;

const PALETTE = [
  ['#000000', '#7f7f7f', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'],
  ['#ffffff', '#d9d9d9', '#f4cccc', '#fce5cd', '#fff2cc', '#ffffcc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#c9daf8', '#d9d2e9', '#ead1dc'],
  ['#f2f2f2', '#bfbfbf', '#ea9999', '#f9cb9c', '#ffe599', '#ffff99', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#a4c2f4', '#b4a7d6', '#d5a6bd'],
];

function useCtl(ui: WriterUI) {
  useSyncExternalStore(ui.ctl.subscribe, ui.ctl.getVersion);
  return ui.ctl;
}

function run(ui: WriterUI, cmd: Command) {
  const v = ui.ctl.view;
  if (!v) return;
  cmd(v.state, v.dispatch, v);
  v.focus();
}

function StyleSelect({ ui }: { ui: WriterUI }) {
  const c = useCtl(ui);
  const cur = (c.state && selectionParagraph(c.state)?.attrs.style) || 'Normal';
  return (
    <select className="nv-select" style={{ width: 120 }} aria-label={t('Estilo de párrafo')} title={t('Estilo de párrafo')} value={cur} onChange={(e) => run(ui, setStyle(e.target.value))}>
      {PARAGRAPH_STYLES.filter((x) => !x.hidden).map((s) => (
        <option key={s.id} value={s.id}>
          {t(s.name)}
        </option>
      ))}
    </select>
  );
}

function FontNameSelect({ ui }: { ui: WriterUI }) {
  const c = useCtl(ui);
  const cur = (c.state && (markAttr(c.state, markTypes.fontFamily!, 'value') as string | undefined)) || c.defaults.fontFamily;
  const names = FONT_NAMES.includes(cur) ? FONT_NAMES : [cur, ...FONT_NAMES];
  return (
    <select className="nv-select" style={{ width: 128 }} aria-label={t('Fuente')} title={t('Fuente')} value={cur} onChange={(e) => run(ui, setMark(markTypes.fontFamily!, e.target.value === c.defaults.fontFamily ? null : { value: e.target.value }))}>
      {names.map((n) => (
        <option key={n} value={n} style={{ fontFamily: n }}>
          {n}
        </option>
      ))}
    </select>
  );
}

function FontSizeSelect({ ui }: { ui: WriterUI }) {
  const c = useCtl(ui);
  const cur = (c.state && (markAttr(c.state, markTypes.fontSize!, 'value') as number | undefined)) ?? c.defaults.fontSize;
  const sizes = FONT_SIZES.includes(cur) ? FONT_SIZES : [...FONT_SIZES, cur].sort((a, b) => a - b);
  return (
    <select className="nv-select" style={{ width: 56 }} aria-label={t('Tamaño de fuente')} title={t('Tamaño de fuente')} value={cur} onChange={(e) => run(ui, setMark(markTypes.fontSize!, Number(e.target.value) === c.defaults.fontSize ? null : { value: Number(e.target.value) }))}>
      {sizes.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function ColorMenu({ ui, kind }: { ui: WriterUI; kind: 'color' | 'highlight' }) {
  const [last, setLast] = useState(kind === 'color' ? '#c00000' : '#ffff00');
  const [open, setOpen] = useState(false);
  const label = kind === 'color' ? t('Color de fuente') : t('Resaltado');
  const mark = markTypes[kind]!;
  const apply = (col: string | undefined) => {
    if (col) setLast(col);
    run(ui, setMark(mark, col ? { value: col } : null));
    setOpen(false);
  };
  return (
    <div className="nv-split">
      <button type="button" className="nv-btn nv-btn--small nv-colorbtn" title={label} aria-label={label} onClick={() => apply(last)}>
        <Icon name={kind === 'color' ? 'fontColor' : 'highlighter'} />
        <span className="nv-colorbar" style={{ background: last }} />
      </button>
      <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
        <PopoverTrigger disableButtonEnhancement>
          <button type="button" className="nv-btn nv-btn--small nv-btn--menu" aria-label={`${label} (${t('más')})`} aria-haspopup="dialog">
            <ChevronDown size={12} />
          </button>
        </PopoverTrigger>
        <PopoverSurface>
          <div className="nv-swatches" role="group" aria-label={label}>
            {PALETTE.flat().map((col) => (
              <button key={col} type="button" style={{ background: col }} aria-label={col} title={col} onClick={() => apply(col)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px 8px' }}>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => apply(undefined)}>
              {kind === 'color' ? t('Automático') : t('Sin color')}
            </button>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
              {t('Más colores')}
              <input type="color" value={last} onChange={(e) => apply(e.target.value)} aria-label={t('Más colores')} />
            </label>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}

function CellShade({ ui }: { ui: WriterUI }) {
  const c = useCtl(ui);
  const [open, setOpen] = useState(false);
  const disabled = !c.state || !isInTable(c.state);
  const apply = (col: string | null) => {
    run(ui, setCellAttr('background', col));
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-btn--small" disabled={disabled} title={t('Sombreado')} aria-label={t('Sombreado')}>
          <Icon name="fillColor" />
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-swatches" role="group" aria-label={t('Sombreado')}>
          {PALETTE.flat().map((col) => (
            <button key={col} type="button" style={{ background: col }} aria-label={col} title={col} onClick={() => apply(col)} />
          ))}
        </div>
        <div style={{ padding: '4px 8px 8px' }}>
          <button type="button" className="nv-btn nv-btn--small" onClick={() => apply(null)}>
            {t('Sin relleno')}
          </button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

function FontGroup({ ui }: { ui: WriterUI }) {
  return (
    <Rows>
      <Row>
        <FontNameSelect ui={ui} />
        <FontSizeSelect ui={ui} />
        <Item item={btn('writer.fontGrow')} />
        <Item item={btn('writer.fontShrink')} />
        <Item item={btn('writer.clearFormat')} />
      </Row>
      <Row>
        <Item item={btn('writer.bold')} />
        <Item item={btn('writer.italic')} />
        <Item item={btn('writer.underline')} />
        <Item item={btn('writer.strike')} />
        <Item item={btn('writer.subscript')} />
        <Item item={btn('writer.superscript')} />
        <Sep />
        <ColorMenu ui={ui} kind="highlight" />
        <ColorMenu ui={ui} kind="color" />
      </Row>
    </Rows>
  );
}

function ParagraphGroup() {
  return (
    <Rows>
      <Row>
        <Item item={btn('writer.bullets')} />
        <Item
          item={{
            kind: 'dropdown',
            id: 'numberingMenu',
            label: 'Numeración',
            icon: 'listOrdered',
            size: 'small',
            primaryCommand: 'writer.numbering',
            entries: ['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman'].map((k) => ({ kind: 'command' as const, command: `writer.numbering.${k}` })),
          }}
        />
        <Sep />
        <Item item={btn('writer.indentLess')} />
        <Item item={btn('writer.indentMore')} />
        <Sep />
        <Item
          item={{
            kind: 'dropdown',
            id: 'lineHeightMenu',
            label: 'Interlineado',
            icon: 'lineHeight',
            size: 'small',
            entries: [
              ...[1, 1.08, 1.15, 1.5, 2, 2.5, 3].map((v) => ({ kind: 'command' as const, command: `writer.lineHeight.${v}` })),
              { kind: 'separator' as const },
              { kind: 'command' as const, command: 'writer.spaceBefore' },
              { kind: 'command' as const, command: 'writer.spaceAfter' },
              { kind: 'separator' as const },
              { kind: 'command' as const, command: 'writer.keepNext' },
              { kind: 'command' as const, command: 'writer.pageBreakBefore' },
            ],
          }}
        />
        <Item item={btn('writer.showMarks')} />
      </Row>
      <Row>
        <Item item={btn('writer.alignLeft')} />
        <Item item={btn('writer.alignCenter')} />
        <Item item={btn('writer.alignRight')} />
        <Item item={btn('writer.alignJustify')} />
      </Row>
    </Rows>
  );
}

/** The ribbon of Nova Writer. */
export interface RibbonFlags {
  inTable: boolean;
  hf: boolean;
  outline: boolean;
}

export function writerTabs(ui: WriterUI, flagsIn: boolean | Partial<RibbonFlags>): RibbonTab[] {
  const flags: RibbonFlags = { inTable: false, hf: false, outline: false, ...(typeof flagsIn === 'boolean' ? { inTable: flagsIn } : flagsIn) };
  const inTable = flags.inTable;
  const home: RibbonTab = {
    id: 'home',
    label: 'tab.home',
    keytip: 'I',
    groups: [
      {
        id: 'clipboard',
        label: 'Portapapeles',
        icon: 'paste',
        items: [
          {
            kind: 'dropdown',
            id: 'pasteMenu',
            label: 'Pegar',
            icon: 'paste',
            size: 'large',
            primaryCommand: 'writer.paste',
            keytip: 'V',
            entries: [
              { kind: 'command', command: 'writer.paste' },
              { kind: 'command', command: 'writer.pasteText' },
            ],
          },
          { kind: 'button', command: 'writer.cut', keytip: 'X' },
          { kind: 'button', command: 'writer.copy', keytip: 'C' },
        ],
      },
      { id: 'font', label: 'Fuente', icon: 'bold', items: [{ kind: 'custom', id: 'fontGroup', label: 'Fuente', keytip: 'FN', render: () => <FontGroup ui={ui} /> }] },
      { id: 'paragraph', label: 'Párrafo', icon: 'alignLeft', items: [{ kind: 'custom', id: 'paraGroup', label: 'Párrafo', keytip: 'P', render: () => <ParagraphGroup /> }] },
      {
        id: 'styles',
        label: 'Estilos',
        icon: 'document',
        items: [{ kind: 'custom', id: 'styleGroup', label: 'Estilos', keytip: 'L', render: () => <StyleSelect ui={ui} /> }],
      },
      {
        id: 'editing',
        label: 'Edición',
        icon: 'search',
        items: [
          { kind: 'button', command: 'writer.find', size: 'large', keytip: 'FD' },
          { kind: 'button', command: 'writer.replace', size: 'large', keytip: 'R' },
        ],
      },
    ],
  };

  const insert: RibbonTab = {
    id: 'insert',
    label: 'Insertar',
    keytip: 'N',
    groups: [
      {
        id: 'pages',
        label: 'Páginas',
        icon: 'pageBreak',
        items: [
          { kind: 'button', command: 'writer.pageBreak', size: 'large', keytip: 'PB' },
          {
            kind: 'dropdown',
            id: 'breaksInsertMenu',
            label: 'Saltos',
            icon: 'pageBreak',
            size: 'large',
            keytip: 'SB',
            entries: [
              { kind: 'command', command: 'writer.break.page' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.break.nextPage' },
              { kind: 'command', command: 'writer.break.continuous' },
              { kind: 'command', command: 'writer.break.evenPage' },
              { kind: 'command', command: 'writer.break.oddPage' },
            ],
          },
        ],
      },
      { id: 'tables', label: 'Tablas', icon: 'tableGrid', items: [{ kind: 'button', command: 'writer.table', size: 'large', keytip: 'T' }] },
      {
        id: 'illustrations',
        label: 'Ilustraciones',
        icon: 'image',
        items: [
          { kind: 'button', command: 'writer.image', size: 'large', keytip: 'IM' },
          {
            kind: 'dropdown',
            id: 'shapesMenu',
            label: 'Formas',
            icon: 'shapes',
            size: 'large',
            keytip: 'SH',
            entries: [
              { kind: 'command', command: 'writer.shape.textbox' },
              { kind: 'command', command: 'writer.shape.rect' },
              { kind: 'command', command: 'writer.shape.roundRect' },
              { kind: 'command', command: 'writer.shape.ellipse' },
              { kind: 'command', command: 'writer.shape.triangle' },
              { kind: 'command', command: 'writer.shape.rightTriangle' },
              { kind: 'command', command: 'writer.shape.diamond' },
              { kind: 'command', command: 'writer.shape.pentagon' },
              { kind: 'command', command: 'writer.shape.hexagon' },
              { kind: 'command', command: 'writer.shape.star5' },
              { kind: 'command', command: 'writer.shape.rightArrow' },
              { kind: 'command', command: 'writer.shape.leftArrow' },
              { kind: 'command', command: 'writer.shape.upArrow' },
              { kind: 'command', command: 'writer.shape.downArrow' },
              { kind: 'command', command: 'writer.shape.line' },
              { kind: 'command', command: 'writer.shape.callout' },
              { kind: 'command', command: 'writer.shape.cloud' },
              { kind: 'command', command: 'writer.shape.heart' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'equationMenu',
            label: 'Ecuación',
            icon: 'sigma',
            size: 'large',
            primaryCommand: 'writer.equation.insert',
            keytip: 'EQ',
            entries: [
              { kind: 'command', command: 'writer.equation.insert' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.equation.sample.0' },
              { kind: 'command', command: 'writer.equation.sample.1' },
              { kind: 'command', command: 'writer.equation.sample.2' },
              { kind: 'command', command: 'writer.equation.sample.3' },
              { kind: 'command', command: 'writer.equation.sample.4' },
              { kind: 'command', command: 'writer.equation.sample.5' },
              { kind: 'command', command: 'writer.equation.sample.6' },
              { kind: 'command', command: 'writer.equation.sample.7' },
            ],
          },
        ],
      },
      { id: 'links', label: 'Vínculos', icon: 'link', items: [{ kind: 'button', command: 'writer.link', size: 'large', keytip: 'K' }, { kind: 'button', command: 'writer.unlink', size: 'small', keytip: 'U' }, { kind: 'button', command: 'writer.bookmark.insert', size: 'small', keytip: 'BM' }, { kind: 'button', command: 'writer.xref.insert', size: 'small', keytip: 'XF' }] },
      {
        id: 'headfoot',
        label: 'Encabezado y pie',
        icon: 'panelTop',
        items: [
          { kind: 'button', command: 'writer.headerFooter', size: 'large', keytip: 'H' },
          { kind: 'button', command: 'writer.footerEdit', size: 'large', keytip: 'FE' },
          {
            kind: 'dropdown',
            id: 'pageNumMenu',
            label: 'Número de página',
            icon: 'hash',
            size: 'large',
            keytip: 'NP',
            entries: [
              { kind: 'command', command: 'writer.pageNumberBottom' },
              { kind: 'command', command: 'writer.pageNumberTop' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.removeHeaderFooter' },
            ],
          },
        ],
      },
      {
        id: 'fields',
        label: 'Texto',
        icon: 'hash',
        items: [
          { kind: 'button', command: 'writer.field.page', size: 'small', keytip: 'FP' },
          { kind: 'button', command: 'writer.field.pages', size: 'small', keytip: 'FT' },
          { kind: 'button', command: 'writer.field.date', size: 'small', keytip: 'FD2' },
        ],
      },
    ],
  };

  const layout: RibbonTab = {
    id: 'layout',
    label: 'Diseño',
    keytip: 'D',
    groups: [
      {
        id: 'pagesetup',
        label: 'Configurar página',
        icon: 'ruler',
        items: [
          {
            kind: 'dropdown',
            id: 'marginsMenu',
            label: 'Márgenes',
            icon: 'ruler',
            size: 'large',
            keytip: 'M',
            entries: Object.keys(MARGIN_PRESETS).map((k) => ({ kind: 'command' as const, command: `writer.margins.${k}` })),
          },
          {
            kind: 'dropdown',
            id: 'orientMenu',
            label: 'Orientación',
            icon: 'portrait',
            size: 'large',
            keytip: 'O',
            entries: [
              { kind: 'command', command: 'writer.orient.portrait' },
              { kind: 'command', command: 'writer.orient.landscape' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'sizeMenu',
            label: 'Tamaño',
            icon: 'document',
            size: 'large',
            keytip: 'Z',
            entries: Object.keys(PAGE_SIZES).map((k) => ({ kind: 'command' as const, command: `writer.size.${k}` })),
          },
          { kind: 'button', command: 'writer.pageSetup', size: 'large', keytip: 'C' },
          {
            kind: 'dropdown',
            id: 'columnsMenu',
            label: 'Columnas',
            icon: 'columns2',
            size: 'large',
            keytip: 'KO',
            entries: [
              { kind: 'command', command: 'writer.columns.1' },
              { kind: 'command', command: 'writer.columns.2' },
              { kind: 'command', command: 'writer.columns.3' },
              { kind: 'command', command: 'writer.columns.left' },
              { kind: 'command', command: 'writer.columns.right' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.columns.more' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'breaksMenu',
            label: 'Saltos',
            icon: 'pageBreak',
            size: 'large',
            keytip: 'SA',
            entries: [
              { kind: 'command', command: 'writer.break.page' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.break.nextPage' },
              { kind: 'command', command: 'writer.break.continuous' },
              { kind: 'command', command: 'writer.break.evenPage' },
              { kind: 'command', command: 'writer.break.oddPage' },
            ],
          },
        ],
      },
      {
        id: 'pagebg',
        label: 'Fondo de página',
        icon: 'droplet',
        items: [
          {
            kind: 'dropdown',
            id: 'watermarkMenu',
            label: 'Marca de agua',
            icon: 'droplet',
            size: 'large',
            keytip: 'WM',
            entries: [
              ...['confidential', 'draft', 'noCopy', 'urgent', 'sample'].map((k) => ({ kind: 'command' as const, command: `writer.watermark.${k}` })),
              { kind: 'separator' as const },
              { kind: 'command' as const, command: 'writer.watermark.custom' },
              { kind: 'command' as const, command: 'writer.watermark.remove' },
            ],
          },
        ],
      },
    ],
  };

  const view = viewTab();
  view.groups.splice(0, 0, {
    id: 'views',
    label: 'Vistas',
    icon: 'file',
    items: [
      { kind: 'button', command: 'writer.view.print', size: 'large', keytip: 'YP' },
      { kind: 'button', command: 'writer.view.web', size: 'large', keytip: 'YW' },
      { kind: 'button', command: 'writer.view.outline', size: 'large', keytip: 'YO' },
      { kind: 'button', command: 'writer.view.draft', size: 'large', keytip: 'YD' },
    ],
  });
  view.groups.splice(1, 0, {
    id: 'show',
    label: 'Mostrar',
    icon: 'pilcrow',
    items: [
      { kind: 'button', command: 'writer.showMarks', size: 'large', keytip: 'S' },
      { kind: 'button', command: 'writer.view.ruler', size: 'large', keytip: 'YR' },
      { kind: 'button', command: 'writer.view.nav', size: 'large', keytip: 'YN' },
      { kind: 'button', command: 'writer.zoomFit', size: 'large', keytip: 'A' },
    ],
  });

  const refs: RibbonTab = {
    id: 'references',
    label: 'Referencias',
    keytip: 'F',
    groups: [
      {
        id: 'toc',
        label: 'Tabla de contenido',
        icon: 'toc',
        items: [
          {
            kind: 'dropdown',
            id: 'tocMenu',
            label: 'Tabla de contenido',
            icon: 'toc',
            size: 'large',
            keytip: 'TC',
            entries: [
              { kind: 'command', command: 'writer.toc.auto' },
              { kind: 'command', command: 'writer.toc.custom' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.toc.remove' },
            ],
          },
          { kind: 'button', command: 'writer.toc.update', size: 'large', keytip: 'TU' },
        ],
      },
      {
        id: 'notes',
        label: 'Notas al pie',
        icon: 'footnote',
        items: [
          { kind: 'button', command: 'writer.note.footnote', size: 'large', keytip: 'NF' },
          { kind: 'button', command: 'writer.note.endnote', size: 'small', keytip: 'NE' },
          { kind: 'button', command: 'writer.note.next', size: 'small', keytip: 'NX' },
          { kind: 'button', command: 'writer.note.options', size: 'small', keytip: 'NO' },
        ],
      },
      {
        id: 'citations',
        label: 'Citas y bibliografía',
        icon: 'quote',
        items: [
          { kind: 'button', command: 'writer.cite.insert', size: 'large', keytip: 'CI' },
          { kind: 'button', command: 'writer.cite.manage', size: 'small', keytip: 'CM' },
          {
            kind: 'dropdown',
            id: 'citeStyleMenu',
            label: 'Estilo de citas',
            icon: 'quote',
            size: 'small',
            keytip: 'CS',
            entries: ['apa', 'mla', 'chicago', 'ieee', 'iso690'].map((k) => ({ kind: 'command' as const, command: `writer.cite.style.${k}` })),
          },
          { kind: 'button', command: 'writer.bib.insert', size: 'large', keytip: 'BI' },
        ],
      },
      {
        id: 'captions',
        label: 'Títulos',
        icon: 'tag',
        items: [
          { kind: 'button', command: 'writer.caption.insert', size: 'large', keytip: 'CP' },
          { kind: 'button', command: 'writer.tof.insert', size: 'small', keytip: 'TF' },
          { kind: 'button', command: 'writer.xref.insert', size: 'small', keytip: 'XR' },
          { kind: 'button', command: 'writer.fields.update', size: 'small', keytip: 'FU' },
        ],
      },
      {
        id: 'index',
        label: 'Índice',
        icon: 'bookIndex',
        items: [
          { kind: 'button', command: 'writer.index.mark', size: 'large', keytip: 'IM' },
          { kind: 'button', command: 'writer.index.insert', size: 'large', keytip: 'II' },
        ],
      },
    ],
  };

  const review: RibbonTab = {
    id: 'review',
    label: 'Revisar',
    keytip: 'R',
    groups: [
      {
        id: 'proofing',
        label: 'Revisión',
        icon: 'spell',
        items: [
          {
            kind: 'dropdown',
            id: 'spellMenu',
            label: 'Ortografía',
            icon: 'spell',
            size: 'large',
            primaryCommand: 'writer.spell.check',
            keytip: 'SP',
            entries: [
              { kind: 'command', command: 'writer.spell.check' },
              { kind: 'command', command: 'writer.spell.toggle' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.spell.lang.es' },
              { kind: 'command', command: 'writer.spell.lang.en' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.spell.dictionary' },
            ],
          },
        ],
      },
      {
        id: 'comments',
        label: 'Comentarios',
        icon: 'comment',
        items: [
          { kind: 'button', command: 'writer.comment.new', size: 'large', keytip: 'CN' },
          { kind: 'button', command: 'writer.comment.delete', size: 'small', keytip: 'CD' },
          { kind: 'button', command: 'writer.comment.prev', size: 'small', keytip: 'CP' },
          { kind: 'button', command: 'writer.comment.next', size: 'small', keytip: 'CX' },
          { kind: 'button', command: 'writer.comment.pane', size: 'large', keytip: 'CS' },
        ],
      },
      {
        id: 'tracking',
        label: 'Seguimiento',
        icon: 'trackChanges',
        items: [
          { kind: 'button', command: 'writer.track.toggle', size: 'large', keytip: 'TC' },
          {
            kind: 'dropdown',
            id: 'markupMenu',
            label: 'Marcas',
            icon: 'eye',
            size: 'large',
            keytip: 'TM',
            entries: ['all', 'simple', 'none', 'original'].map((k) => ({ kind: 'command' as const, command: `writer.track.markup.${k}` })),
          },
          { kind: 'button', command: 'writer.track.pane', size: 'large', keytip: 'TP' },
        ],
      },
      {
        id: 'changes',
        label: 'Cambios',
        icon: 'check',
        items: [
          { kind: 'button', command: 'writer.change.accept', size: 'large', keytip: 'CA' },
          { kind: 'button', command: 'writer.change.reject', size: 'large', keytip: 'CR' },
          { kind: 'button', command: 'writer.change.prev', size: 'small', keytip: 'CB' },
          { kind: 'button', command: 'writer.change.next', size: 'small', keytip: 'CF' },
          { kind: 'button', command: 'writer.change.acceptAll', size: 'small', keytip: 'CY' },
          { kind: 'button', command: 'writer.change.rejectAll', size: 'small', keytip: 'CZ' },
        ],
      },
      {
        id: 'protect',
        label: 'Proteger',
        icon: 'lock',
        items: [
          { kind: 'button', command: 'writer.protect.restrict', size: 'large', keytip: 'PR' },
          { kind: 'button', command: 'writer.protect.stop', size: 'large', keytip: 'PS' },
          { kind: 'button', command: 'writer.user.name', size: 'large', keytip: 'PU' },
        ],
      },
    ],
  };

  const outlineTab: RibbonTab = {
    id: 'outlineTools',
    label: 'Esquema',
    keytip: 'JQ',
    contextual: { label: 'Herramientas de esquema', color: '#2f7d6d', visible: flags.outline },
    groups: [
      {
        id: 'olTools',
        label: 'Herramientas de esquema',
        icon: 'list',
        items: [
          { kind: 'button', command: 'writer.outline.promote', size: 'small', keytip: 'JU' },
          { kind: 'button', command: 'writer.outline.demote', size: 'small', keytip: 'JB' },
          { kind: 'button', command: 'writer.outline.body', size: 'small', keytip: 'JO' },
          { kind: 'button', command: 'writer.outline.up', size: 'small', keytip: 'JV' },
          { kind: 'button', command: 'writer.outline.down', size: 'small', keytip: 'JW' },
        ],
      },
      {
        id: 'olData',
        label: 'Datos del esquema',
        icon: 'list',
        items: [
          { kind: 'button', command: 'writer.outline.toggle', size: 'small', keytip: 'JG' },
          { kind: 'button', command: 'writer.outline.expandAll', size: 'small', keytip: 'JK' },
          {
            kind: 'dropdown',
            id: 'olLevelMenu',
            label: 'Mostrar nivel',
            icon: 'list',
            size: 'large',
            keytip: 'JZ',
            entries: [1, 2, 3, 4, 5, 6].map((n) => ({ kind: 'command' as const, command: `writer.outline.level.${n}` })),
          },
        ],
      },
      { id: 'olClose', label: 'Cerrar', icon: 'x', items: [{ kind: 'button', command: 'writer.outline.close', size: 'large', keytip: 'JY' }] },
    ],
  };

  const hf: RibbonTab = {
    id: 'hfTools',
    label: 'Encabezado y pie',
    keytip: 'JH',
    contextual: { label: 'Herramientas de encabezado y pie', color: '#7a5195', visible: flags.hf },
    groups: [
      {
        id: 'hfInsert',
        label: 'Insertar',
        icon: 'hash',
        items: [
          { kind: 'button', command: 'writer.hf.pageNumber', size: 'large', keytip: 'JN' },
          { kind: 'button', command: 'writer.hf.pages', size: 'small', keytip: 'JT' },
          { kind: 'button', command: 'writer.hf.section', size: 'small', keytip: 'JS' },
          { kind: 'button', command: 'writer.hf.date', size: 'small', keytip: 'JD' },
          { kind: 'button', command: 'writer.hf.time', size: 'small', keytip: 'JM' },
        ],
      },
      {
        id: 'hfNav',
        label: 'Navegación',
        icon: 'chevronDown',
        items: [
          { kind: 'button', command: 'writer.hf.goHeader', size: 'small', keytip: 'JE' },
          { kind: 'button', command: 'writer.hf.goFooter', size: 'small', keytip: 'JF' },
          { kind: 'button', command: 'writer.hf.prev', size: 'small', keytip: 'JA' },
          { kind: 'button', command: 'writer.hf.next', size: 'small', keytip: 'JX' },
          { kind: 'button', command: 'writer.hf.linkPrev', size: 'large', keytip: 'JL' },
        ],
      },
      {
        id: 'hfOptions',
        label: 'Opciones',
        icon: 'file',
        items: [
          { kind: 'button', command: 'writer.hf.firstPage', size: 'large', keytip: 'JP' },
          { kind: 'button', command: 'writer.hf.evenOdd', size: 'large', keytip: 'JI' },
        ],
      },
      { id: 'hfClose', label: 'Cerrar', icon: 'x', items: [{ kind: 'button', command: 'writer.hf.close', size: 'large', keytip: 'JC' }] },
    ],
  };

  const table: RibbonTab = {
    id: 'tableTools',
    label: 'Tabla',
    keytip: 'TB',
    contextual: { label: 'Herramientas de tabla', color: '#2b6cb0', visible: inTable },
    groups: [
      {
        id: 'rowscols',
        label: 'Filas y columnas',
        icon: 'tableGrid',
        items: [
          { kind: 'button', command: 'writer.table.rowBefore', size: 'small', keytip: 'RA' },
          { kind: 'button', command: 'writer.table.rowAfter', size: 'small', keytip: 'RB' },
          { kind: 'button', command: 'writer.table.deleteRow', size: 'small', keytip: 'RD' },
          { kind: 'button', command: 'writer.table.colBefore', size: 'small', keytip: 'CL' },
          { kind: 'button', command: 'writer.table.colAfter', size: 'small', keytip: 'CR' },
          { kind: 'button', command: 'writer.table.deleteCol', size: 'small', keytip: 'CD' },
        ],
      },
      {
        id: 'merge',
        label: 'Combinar',
        icon: 'mergeCells',
        items: [
          { kind: 'button', command: 'writer.table.merge', size: 'large', keytip: 'MC' },
          { kind: 'button', command: 'writer.table.split', size: 'large', keytip: 'SC' },
        ],
      },
      {
        id: 'cellstyle',
        label: 'Celda',
        icon: 'fillColor',
        items: [
          { kind: 'custom', id: 'shade', label: 'Sombreado', keytip: 'SH', render: () => <CellShade ui={ui} /> },
          { kind: 'button', command: 'writer.table.borders', size: 'large', keytip: 'BD' },
          { kind: 'button', command: 'writer.table.valign.top', size: 'small', keytip: 'VT' },
          { kind: 'button', command: 'writer.table.valign.middle', size: 'small', keytip: 'VM' },
          { kind: 'button', command: 'writer.table.valign.bottom', size: 'small', keytip: 'VB' },
        ],
      },
      { id: 'tabledel', label: 'Tabla', icon: 'trash', items: [{ kind: 'button', command: 'writer.table.delete', size: 'large', keytip: 'TD' }] },
    ],
  };

  const developer: RibbonTab = {
    id: 'developer',
    label: 'Programador',
    keytip: 'PR',
    groups: [
      {
        id: 'controls',
        label: 'Controles',
        icon: 'formInput',
        items: [
          { kind: 'button', command: 'writer.control.text', size: 'small', keytip: 'CTe' },
          { kind: 'button', command: 'writer.control.richText', size: 'small', keytip: 'CRi' },
          { kind: 'button', command: 'writer.control.checkbox', size: 'small', keytip: 'CCh' },
          { kind: 'button', command: 'writer.control.dropdown', size: 'small', keytip: 'CDr' },
          { kind: 'button', command: 'writer.control.combo', size: 'small', keytip: 'CCo' },
          { kind: 'button', command: 'writer.control.date', size: 'small', keytip: 'CDa' },
          { kind: 'button', command: 'writer.control.properties', size: 'small', keytip: 'CP' },
          { kind: 'button', command: 'writer.control.remove', size: 'small', keytip: 'CQ' },
        ],
      },
      {
        id: 'code',
        label: 'Código',
        icon: 'script',
        items: [
          { kind: 'button', command: 'writer.macros.edit', size: 'large', keytip: 'VB' },
          { kind: 'button', command: 'writer.macros.run', size: 'large', keytip: 'MC' },
          { kind: 'button', command: 'writer.macros.enable', size: 'small', keytip: 'HC' },
        ],
      },
      {
        id: 'security',
        label: 'Seguridad',
        icon: 'shield',
        items: [
          { kind: 'button', command: 'writer.sign', size: 'large', keytip: 'FD' },
          { kind: 'button', command: 'writer.sign.view', size: 'small', keytip: 'VF' },
          { kind: 'button', command: 'writer.password.set', size: 'small', keytip: 'PW' },
          { kind: 'button', command: 'writer.password.remove', size: 'small', keytip: 'PQ' },
        ],
      },
      { id: 'protect', label: 'Proteger', icon: 'lock', items: [{ kind: 'button', command: 'writer.protect.restrict', size: 'large', keytip: 'RE' }, { kind: 'button', command: 'writer.protect.stop', size: 'large', keytip: 'DP' }] },
    ],
  };

  const mailings: RibbonTab = {
    id: 'mailings',
    label: 'Correspondencia',
    keytip: 'M',
    groups: [
      { id: 'create', label: 'Crear', icon: 'mail', items: [{ kind: 'button', command: 'writer.mail.envelope', size: 'large', keytip: 'SO' }, { kind: 'button', command: 'writer.mail.labels', size: 'large', keytip: 'ET' }] },
      {
        id: 'start',
        label: 'Iniciar combinación',
        icon: 'users',
        items: [
          {
            kind: 'dropdown',
            id: 'recipientsMenu',
            label: 'Destinatarios',
            icon: 'users',
            size: 'large',
            keytip: 'DE',
            entries: [
              { kind: 'command', command: 'writer.mail.import' },
              { kind: 'command', command: 'writer.mail.type' },
              { kind: 'separator' },
              { kind: 'command', command: 'writer.mail.edit' },
              { kind: 'command', command: 'writer.mail.unlink' },
            ],
          },
        ],
      },
      {
        id: 'fields',
        label: 'Escribir e insertar campos',
        icon: 'formInput',
        items: [
          { kind: 'button', command: 'writer.mail.field', size: 'large', keytip: 'CC' },
          { kind: 'button', command: 'writer.mail.address', size: 'small', keytip: 'BD' },
          { kind: 'button', command: 'writer.mail.greeting', size: 'small', keytip: 'LS' },
          {
            kind: 'dropdown',
            id: 'rulesMenu',
            label: 'Reglas',
            icon: 'script',
            size: 'large',
            keytip: 'RG',
            entries: [
              { kind: 'command', command: 'writer.mail.rule.IF' },
              { kind: 'command', command: 'writer.mail.rule.SKIPIF' },
              { kind: 'command', command: 'writer.mail.rule.NEXTIF' },
              { kind: 'command', command: 'writer.mail.rule.NEXT' },
            ],
          },
        ],
      },
      {
        id: 'preview',
        label: 'Vista previa de resultados',
        icon: 'eye',
        items: [
          { kind: 'button', command: 'writer.mail.preview', size: 'large', keytip: 'VP' },
          { kind: 'button', command: 'writer.mail.first', size: 'small', keytip: 'P1' },
          { kind: 'button', command: 'writer.mail.prev', size: 'small', keytip: 'PA' },
          { kind: 'button', command: 'writer.mail.next', size: 'small', keytip: 'PS' },
          { kind: 'button', command: 'writer.mail.last', size: 'small', keytip: 'PU' },
        ],
      },
      { id: 'finish', label: 'Finalizar', icon: 'mailOpen', items: [{ kind: 'button', command: 'writer.mail.finish', size: 'large', keytip: 'FC' }] },
    ],
  };

  return [home, insert, layout, refs, mailings, review, view, developer, table, hf, outlineTab, helpTab()];
}
