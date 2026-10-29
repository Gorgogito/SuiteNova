import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, RibbonItemView, t, type RibbonItem, type RibbonTab } from '@suitenova/core-ui';
import { markTypes } from '@suitenova/writer-core';
import { ChevronDown } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { isInTable } from 'prosemirror-tables';
import { helpTab, viewTab } from '../common';
import { tagDefs } from '@suitenova/notes-core';
import { FONT_NAMES, FONT_SIZES, STYLES, TAG_SHORTCUTS, type NotesUI } from './commands';
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
];

function useCtl(ui: NotesUI) {
  useSyncExternalStore(ui.ctl.subscribe, ui.ctl.getVersion);
  return ui.ctl;
}

function ColorMenu({ ui, kind }: { ui: NotesUI; kind: 'color' | 'highlight' }) {
  const [last, setLast] = useState(kind === 'color' ? '#c00000' : '#ffff00');
  const [open, setOpen] = useState(false);
  const label = kind === 'color' ? t('Color de fuente') : t('Resaltado');
  const apply = (col: string | null) => {
    if (col) setLast(col);
    ui.ctl.run(setMark(markTypes[kind]!, col ? { value: col } : null));
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
          <div style={{ padding: '4px 8px 8px' }}>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => apply(null)}>
              {kind === 'color' ? t('Automático') : t('Sin color')}
            </button>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}

function FontGroup({ ui }: { ui: NotesUI }) {
  const c = useCtl(ui);
  const s = c.view?.state ?? null;
  const font = (s && (markAttr(s, markTypes.fontFamily!, 'value') as string | undefined)) || 'Calibri';
  const size = (s && (markAttr(s, markTypes.fontSize!, 'value') as number | undefined)) || 11;
  const names = FONT_NAMES.includes(font) ? FONT_NAMES : [font, ...FONT_NAMES];
  const sizes = FONT_SIZES.includes(size) ? FONT_SIZES : [...FONT_SIZES, size].sort((a, b) => a - b);
  const style = (s && selectionParagraph(s)?.attrs.style) || 'Normal';
  return (
    <Rows>
      <Row>
        <select className="nv-select" style={{ width: 120 }} aria-label={t('Fuente')} title={t('Fuente')} value={font} onChange={(e) => c.run(setMark(markTypes.fontFamily!, { value: e.target.value }))}>
          {names.map((n) => (
            <option key={n} value={n} style={{ fontFamily: n }}>
              {n}
            </option>
          ))}
        </select>
        <select className="nv-select" style={{ width: 56 }} aria-label={t('Tamaño de fuente')} title={t('Tamaño de fuente')} value={size} onChange={(e) => c.run(setMark(markTypes.fontSize!, { value: Number(e.target.value) }))}>
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select className="nv-select" style={{ width: 96 }} aria-label={t('Estilo de párrafo')} title={t('Estilo de párrafo')} value={style} onChange={(e) => c.run(setStyle(e.target.value))}>
          {STYLES.map(([id, label]) => (
            <option key={id} value={id}>
              {t(label)}
            </option>
          ))}
        </select>
      </Row>
      <Row>
        <Item item={btn('notes.bold')} />
        <Item item={btn('notes.italic')} />
        <Item item={btn('notes.underline')} />
        <Item item={btn('notes.strike')} />
        <Item item={btn('notes.subscript')} />
        <Item item={btn('notes.superscript')} />
        <Sep />
        <ColorMenu ui={ui} kind="highlight" />
        <ColorMenu ui={ui} kind="color" />
        <Item item={btn('notes.clearFormat')} />
      </Row>
    </Rows>
  );
}

function ParagraphGroup() {
  return (
    <Rows>
      <Row>
        <Item item={btn('notes.bullets')} />
        <Item item={btn('notes.numbering')} />
        <Sep />
        <Item item={btn('notes.indentLess')} />
        <Item item={btn('notes.indentMore')} />
      </Row>
      <Row>
        <Item item={btn('notes.alignLeft')} />
        <Item item={btn('notes.alignCenter')} />
        <Item item={btn('notes.alignRight')} />
      </Row>
    </Rows>
  );
}

/** Desplegable con todas las etiquetas (las de serie y las propias de la libreta). */
function TagMenu({ ui }: { ui: NotesUI }) {
  const c = useCtl(ui);
  const [open, setOpen] = useState(false);
  const defs = tagDefs(c.nb.tagDefs);
  const cur = c.currentTag();
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="nv-btn nv-btn--large" aria-haspopup="menu" aria-label={t('Etiquetas')} title={t('Etiquetas')}>
          <Icon name="star" />
          <span className="nv-btn__label">
            {t('Etiquetas')} <ChevronDown size={11} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nn-tagmenu" role="menu" aria-label={t('Etiquetas')}>
          {defs.map((d) => (
            <button
              key={d.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={cur === d.id}
              className={cur === d.id ? 'is-on' : ''}
              onClick={() => {
                c.setTag(d.id);
                setOpen(false);
              }}
            >
              <span style={{ color: d.color }}>{d.checkbox ? '☐' : d.symbol}</span> {t(d.label)}
              {TAG_SHORTCUTS[d.id] && <kbd>{TAG_SHORTCUTS[d.id]}</kbd>}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              c.setTag(null);
              setOpen(false);
            }}
          >
            {t('Quitar etiqueta')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              ui.openDialog('tags');
              setOpen(false);
            }}
          >
            {t('Resumen de etiquetas…')}
          </button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

const INK_COLORS = ['#000000', '#c00000', '#ed7d31', '#ffc000', '#00b050', '#0070c0', '#7030a0', '#7f7f7f'];
const HL_COLORS = ['#ffe34d', '#9be15d', '#6fd3ff', '#ff9ecb', '#ffb347'];

/** Color y grosor del lápiz o del marcador. */
function PenSettings({ ui }: { ui: NotesUI }) {
  const c = useCtl(ui);
  const hl = c.tool === 'highlighter';
  const colors = hl ? HL_COLORS : INK_COLORS;
  const cur = hl ? c.highlightColor : c.penColor;
  return (
    <Rows>
      <Row>
        <div className="nv-swatches nn-penswatches" role="group" aria-label={hl ? t('Color del marcador') : t('Color del lápiz')}>
          {colors.map((col) => (
            <button
              key={col}
              type="button"
              className={cur === col ? 'is-on' : ''}
              aria-pressed={cur === col}
              style={{ background: col }}
              aria-label={col}
              title={col}
              onClick={() => {
                if (hl) c.highlightColor = col;
                else c.penColor = col;
                c.touch();
              }}
            />
          ))}
        </div>
      </Row>
      <Row>
        <label className="nn-penw">
          {t('Grosor')}
          <input
            type="range"
            min={1}
            max={hl ? 30 : 12}
            value={c.penWidth}
            aria-label={t('Grosor del trazo')}
            onChange={(e) => {
              c.penWidth = Number(e.target.value);
              c.touch();
            }}
          />
          <output>{c.penWidth}</output>
        </label>
      </Row>
    </Rows>
  );
}

/** Mover la sección actual a un grupo. */
function GroupMove({ ui }: { ui: NotesUI }) {
  const c = useCtl(ui);
  return (
    <select
      className="nv-select"
      style={{ width: 150 }}
      aria-label={t('Mover la sección al grupo')}
      title={t('Mover la sección al grupo')}
      value={c.section.group ?? ''}
      onChange={(e) => c.moveSectionToGroup(e.target.value || null)}
    >
      <option value="">{t('(sin grupo)')}</option>
      {c.nb.groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

function OcrGroup({ ui }: { ui: NotesUI }) {
  const c = useCtl(ui);
  return (
    <Rows>
      <Row>
        <select className="nv-select" style={{ width: 150 }} aria-label={t('Idioma del reconocimiento')} title={t('Idioma del reconocimiento')} value={ui.ocrLang()} onChange={(e) => ui.setOcrLang(e.target.value)}>
          <option value="spa+eng">{t('Español e inglés')}</option>
          <option value="spa">{t('Español')}</option>
          <option value="eng">{t('Inglés')}</option>
        </select>
      </Row>
      <Row>
        <span className="nn-ocrstat" aria-live="polite">
          {c.ocr.running ? t('Reconociendo {a} de {b}…', { a: c.ocr.done + 1, b: c.ocr.total }) : c.ocr.error ? c.ocr.error : c.ocrPending ? t('{n} imágenes sin reconocer', { n: c.ocrPending }) : t('Todas las imágenes están reconocidas')}
        </span>
      </Row>
    </Rows>
  );
}

const L = (command: string, size: 'small' | 'large' = 'large', keytip?: string, iconOnly = false): RibbonItem => ({ kind: 'button', command, size, keytip, iconOnly });

/** The ribbon of Nova Notes. */
export function notesTabs(ui: NotesUI): RibbonTab[] {
  const inTable = !!ui.ctl.view && isInTable(ui.ctl.view.state);
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
          { kind: 'button', command: 'notes.paste', size: 'large', keytip: 'V' },
          { kind: 'button', command: 'notes.cut', keytip: 'X' },
          { kind: 'button', command: 'notes.copy', keytip: 'C' },
        ],
      },
      { id: 'font', label: 'Texto básico', icon: 'bold', items: [{ kind: 'custom', id: 'fontGroup', label: 'Texto básico', keytip: 'FN', render: () => <FontGroup ui={ui} /> }] },
      { id: 'paragraph', label: 'Párrafo', icon: 'alignLeft', items: [{ kind: 'custom', id: 'paraGroup', label: 'Párrafo', keytip: 'P', render: () => <ParagraphGroup /> }] },
      {
        id: 'tags',
        label: 'Etiquetas',
        icon: 'checkSquare',
        items: [L('notes.tag.todo', 'large', 'TD'), { kind: 'custom', id: 'tagMenu', label: 'Etiquetas', keytip: 'TG', render: () => <TagMenu ui={ui} /> }, L('notes.tag.summary', 'large', 'TS')],
      },
    ],
  };

  const insert: RibbonTab = {
    id: 'insert',
    label: 'Insertar',
    keytip: 'N',
    groups: [
      { id: 'pages', label: 'Páginas', icon: 'pageNew', items: [L('notes.page.new', 'large', 'PG'), L('notes.section.new', 'large', 'SC')] },
      { id: 'tables', label: 'Tablas', icon: 'tableGrid', items: [L('notes.table', 'large', 'TB')] },
      { id: 'boxes', label: 'Cuadros', icon: 'document', items: [L('notes.textbox', 'large', 'CT'), L('notes.image', 'large', 'IM')] },
      { id: 'media', label: 'Audio y vídeo', icon: 'mic', items: [L('notes.audio', 'large', 'AU'), L('notes.video', 'large', 'VI'), L('notes.media.file', 'large', 'MF')] },
      { id: 'symbols', label: 'Símbolos', icon: 'sigma', items: [L('notes.equation', 'large', 'EQ')] },
      { id: 'links', label: 'Vínculos', icon: 'link', items: [L('notes.link', 'large', 'K')] },
      { id: 'time', label: 'Hora y fecha', icon: 'calendar', items: [L('notes.date', 'small', 'FD'), L('notes.time', 'small', 'FH'), L('notes.datetime', 'small', 'FT')] },
      { id: 'templates', label: 'Plantillas', icon: 'layout', items: [L('notes.page.template', 'large', 'PL')] },
    ],
  };

  const draw: RibbonTab = {
    id: 'draw',
    label: 'Dibujar',
    keytip: 'D',
    groups: [
      {
        id: 'tools',
        label: 'Herramientas',
        icon: 'pen',
        items: [L('notes.tool.select', 'large', 'DS'), L('notes.tool.pen', 'large', 'DP'), L('notes.tool.highlighter', 'large', 'DM'), L('notes.tool.eraser', 'large', 'DB'), L('notes.tool.lasso', 'large', 'DL')],
      },
      { id: 'pen', label: 'Lápiz', icon: 'pen', items: [{ kind: 'custom', id: 'penSettings', label: 'Lápiz', keytip: 'DC', render: () => <PenSettings ui={ui} /> }] },
      {
        id: 'shapes',
        label: 'Formas',
        icon: 'shapes',
        items: [L('notes.tool.line', 'small', 'DN'), L('notes.tool.arrow', 'small', 'DF'), L('notes.tool.rect', 'small', 'DR'), L('notes.tool.ellipse', 'small', 'DE'), L('notes.ink.toShape', 'large', 'DT')],
      },
      { id: 'arrange', label: 'Organizar', icon: 'moveUp', items: [L('notes.box.front', 'small', 'DW'), L('notes.box.back', 'small', 'DK'), L('notes.box.delete', 'small', 'DX'), L('notes.ink.clear', 'small', 'DY')] },
    ],
  };

  const organize: RibbonTab = {
    id: 'organize',
    label: 'Organizar',
    keytip: 'O',
    groups: [
      {
        id: 'pageops',
        label: 'Página',
        icon: 'pageNew',
        items: [L('notes.page.duplicate', 'small', 'PD', true), L('notes.page.up', 'small', 'PU', true), L('notes.page.down', 'small', 'PW', true), L('notes.page.indent', 'small', 'PI', true), L('notes.page.outdent', 'small', 'PO', true), L('notes.page.delete', 'large', 'PX')],
      },
      { id: 'pagelook', label: 'Aspecto', icon: 'gridlines', items: [L('notes.page.style', 'large', 'PS'), L('notes.page.versions', 'large', 'PH')] },
      {
        id: 'sectionops',
        label: 'Sección',
        icon: 'list',
        items: [L('notes.section.left', 'small', 'SL', true), L('notes.section.right', 'small', 'SR', true), L('notes.section.delete', 'large', 'SX')],
      },
      {
        id: 'groups',
        label: 'Grupos de secciones',
        icon: 'folder',
        items: [L('notes.group.new', 'small', 'GN', true), L('notes.group.remove', 'small', 'GR', true), L('notes.section.outOfGroup', 'small', 'GO', true), { kind: 'custom', id: 'groupMove', label: 'Mover la sección al grupo', keytip: 'GM', render: () => <GroupMove ui={ui} /> }],
      },
      { id: 'trash', label: 'Papelera', icon: 'trash', items: [L('notes.trash', 'large', 'PA')] },
      {
        id: 'transfer',
        label: 'Importar y exportar',
        icon: 'exportFile',
        items: [
          L('notes.import', 'large', 'IP'),
          {
            kind: 'dropdown',
            id: 'exportMenu',
            label: 'Exportar página',
            icon: 'exportFile',
            size: 'large',
            keytip: 'EX',
            entries: [
              { kind: 'command', command: 'notes.export.md' },
              { kind: 'command', command: 'notes.export.html' },
              { kind: 'command', command: 'notes.export.docx' },
            ],
          },
          L('notes.email', 'large', 'EM'),
        ],
      },
    ],
  };

  const share: RibbonTab = {
    id: 'share',
    label: 'Proteger y compartir',
    keytip: 'R',
    groups: [
      { id: 'pagepw', label: 'Página', icon: 'lock', items: [L('notes.page.protect', 'large', 'RP'), L('notes.page.lock', 'large', 'RL')] },
      { id: 'secpw', label: 'Sección', icon: 'lock', items: [L('notes.section.protect', 'large', 'RS'), L('notes.section.lock', 'large', 'RK'), L('notes.lockAll', 'large', 'RA')] },
      { id: 'sharing', label: 'Compartir', icon: 'share', items: [L('notes.share', 'large', 'RC'), L('notes.merge', 'large', 'RM')] },
    ],
  };

  const find: RibbonTab = {
    id: 'find',
    label: 'Buscar',
    keytip: 'B',
    groups: [
      { id: 'search', label: 'Buscar', icon: 'search', items: [L('notes.search', 'large', 'BU'), L('notes.tag.summary', 'large', 'ET')] },
      {
        id: 'ocr',
        label: 'Texto en imágenes',
        icon: 'scanText',
        items: [L('notes.ocr.run', 'large', 'OC'), L('notes.ocr.stop', 'small', 'OS'), L('notes.image.props', 'small', 'OP'), { kind: 'custom', id: 'ocrLang', label: 'Idioma del reconocimiento', keytip: 'OL', render: () => <OcrGroup ui={ui} /> }],
      },
    ],
  };

  const table: RibbonTab = {
    id: 'tableTools',
    label: 'Tabla',
    keytip: 'TA',
    contextual: { label: 'Herramientas de tabla', color: '#7719aa', visible: inTable },
    groups: [
      {
        id: 'rowscols',
        label: 'Filas y columnas',
        icon: 'tableGrid',
        items: [L('notes.table.rowBefore', 'small', 'RA'), L('notes.table.rowAfter', 'small', 'RB'), L('notes.table.deleteRow', 'small', 'RD'), L('notes.table.colBefore', 'small', 'CL'), L('notes.table.colAfter', 'small', 'CR'), L('notes.table.deleteCol', 'small', 'CD')],
      },
      { id: 'merge', label: 'Combinar', icon: 'mergeCells', items: [L('notes.table.merge', 'large', 'MC'), L('notes.table.split', 'large', 'SP')] },
      { id: 'tabledel', label: 'Tabla', icon: 'trash', items: [L('notes.table.delete', 'large', 'TD')] },
    ],
  };

  return [home, insert, draw, organize, share, find, viewTab(), table, helpTab()];
}
