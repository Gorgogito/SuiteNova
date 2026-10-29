import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, RibbonItemView, t, type RibbonItem, type RibbonTab } from '@suitenova/core-ui';
import { CATEGORIES, PAGE_SIZES, STENCILS } from '@suitenova/diagram-core';
import { ChevronDown } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { helpTab, viewTab } from '../common';
import { ARROWS, DASHES, FONT_NAMES, FONT_SIZES, ROUTINGS, WIDTHS, type DiagramUI } from './commands';

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

/** A colour button with a palette. `none` adds an entry that removes the colour (fill and line only). */
function ColorMenu({ ui, kind }: { ui: DiagramUI; kind: 'fill' | 'stroke' | 'font' }) {
  const [last, setLast] = useState(kind === 'fill' ? '#cfe2f3' : kind === 'stroke' ? '#2f4f6f' : '#c00000');
  const [open, setOpen] = useState(false);
  const label = kind === 'fill' ? t('Relleno') : kind === 'stroke' ? t('Color de línea') : t('Color de fuente');
  const apply = (col: string | null) => {
    if (col) setLast(col);
    const c = ui.ctl;
    if (kind === 'fill') c.setStyle({ fill: col ?? 'none' });
    else if (kind === 'stroke') c.setStyle({ stroke: col ?? 'none' });
    else c.setFont({ color: col ?? '#1b1b1b' });
    setOpen(false);
  };
  return (
    <div className="nv-split">
      <button type="button" className="nv-btn nv-btn--small nv-colorbtn" title={label} aria-label={label} onClick={() => apply(last)}>
        <Icon name={kind === 'fill' ? 'paste' : kind === 'stroke' ? 'line' : 'fontColor'} />
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
          <div style={{ padding: '4px 8px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => apply(null)}>
              {kind === 'font' ? t('Automático') : kind === 'fill' ? t('Sin relleno') : t('Sin línea')}
            </button>
            <label className="dg-customcolor">
              {t('Otro')}
              <input type="color" aria-label={`${label}: ${t('otro color')}`} value={last} onChange={(e) => apply(e.target.value)} />
            </label>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}

function FontGroup({ ui }: { ui: DiagramUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  const f = c.selectedShapes()[0]?.font ?? c.selectedConnectors()[0]?.font;
  const family = f?.family ?? 'Segoe UI';
  const size = f?.size ?? 13;
  const names = FONT_NAMES.includes(family) ? FONT_NAMES : [family, ...FONT_NAMES];
  const sizes = FONT_SIZES.includes(size) ? FONT_SIZES : [...FONT_SIZES, size].sort((a, b) => a - b);
  const off = !c.hasSelection;
  return (
    <Rows>
      <Row>
        <select className="nv-select" style={{ width: 120 }} aria-label={t('Fuente')} title={t('Fuente')} value={family} disabled={off} onChange={(e) => c.setFont({ family: e.target.value })}>
          {names.map((n) => (
            <option key={n} value={n} style={{ fontFamily: n }}>
              {n}
            </option>
          ))}
        </select>
        <select className="nv-select" style={{ width: 56 }} aria-label={t('Tamaño de fuente')} title={t('Tamaño de fuente')} value={size} disabled={off} onChange={(e) => c.setFont({ size: Number(e.target.value) })}>
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>
      <Row>
        <Item item={btn('diagram.bold')} />
        <Item item={btn('diagram.italic')} />
        <Item item={btn('diagram.underline')} />
        <Sep />
        <ColorMenu ui={ui} kind="font" />
        <Sep />
        <Item item={btn('diagram.alignText.left')} />
        <Item item={btn('diagram.alignText.center')} />
        <Item item={btn('diagram.alignText.right')} />
      </Row>
    </Rows>
  );
}

function ShapeStyleGroup({ ui }: { ui: DiagramUI }) {
  return (
    <Rows>
      <Row>
        <ColorMenu ui={ui} kind="fill" />
        <ColorMenu ui={ui} kind="stroke" />
        <Item item={btn('diagram.shadow')} />
      </Row>
      <Row>
        <Item item={btn('diagram.valign.top')} />
        <Item item={btn('diagram.valign.middle')} />
        <Item item={btn('diagram.valign.bottom')} />
      </Row>
    </Rows>
  );
}

const sub = (label: string, prefix: string, ids: string[], keytip: string, icon = 'line'): Leaf => ({
  kind: 'dropdown',
  id: prefix,
  label,
  icon,
  size: 'small',
  keytip,
  entries: ids.map((id) => ({ kind: 'command' as const, command: id })),
});

/** The ribbon of Nova Diagram. Every item is bound to a registered command. */
export function diagramTabs(ui: DiagramUI): RibbonTab[] {
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
          { kind: 'button', command: 'diagram.paste', size: 'large', keytip: 'V' },
          { kind: 'button', command: 'diagram.cut', keytip: 'X' },
          { kind: 'button', command: 'diagram.copy', keytip: 'C' },
          { kind: 'button', command: 'diagram.duplicate', keytip: 'D' },
        ],
      },
      {
        id: 'tools',
        label: 'Herramientas',
        icon: 'pointer',
        items: [
          { kind: 'button', command: 'diagram.tool.select', size: 'large', keytip: 'PU' },
          { kind: 'button', command: 'diagram.tool.connector', size: 'large', keytip: 'KN' },
          { kind: 'button', command: 'diagram.edittext', size: 'large', keytip: 'TX' },
        ],
      },
      { id: 'font', label: 'Fuente', icon: 'bold', items: [{ kind: 'custom', id: 'fontGroup', label: 'Fuente', keytip: 'FN', render: () => <FontGroup ui={ui} /> }] },
      { id: 'shape', label: 'Forma', icon: 'shapes', items: [{ kind: 'custom', id: 'styleGroup', label: 'Forma', keytip: 'FM', render: () => <ShapeStyleGroup ui={ui} /> }] },
      {
        id: 'line',
        label: 'Línea',
        icon: 'line',
        items: [
          sub('Grosor', 'widthMenu', WIDTHS.map((w) => `diagram.width.${w}`), 'GR'),
          sub('Estilo de línea', 'dashMenu', DASHES.map(([d]) => `diagram.dash.${d}`), 'EL'),
        ],
      },
      {
        id: 'connectors',
        label: 'Conectores',
        icon: 'connector',
        items: [
          sub('Tipo de conector', 'routingMenu', ROUTINGS.map(([r]) => `diagram.routing.${r}`), 'TC', 'connector'),
          sub('Extremo inicial', 'arrowStartMenu', ARROWS.map(([a]) => `diagram.arrowStart.${a}`), 'EI', 'arrowRight'),
          sub('Extremo final', 'arrowEndMenu', ARROWS.map(([a]) => `diagram.arrowEnd.${a}`), 'EF', 'arrowRight'),
          { kind: 'button', command: 'diagram.connect', size: 'small', keytip: 'KC' },
        ],
      },
    ],
  };

  const arrange: RibbonTab = {
    id: 'arrange',
    label: 'Organizar',
    keytip: 'O',
    groups: [
      {
        id: 'order',
        label: 'Orden',
        icon: 'moveUp',
        items: [
          { kind: 'button', command: 'diagram.front', size: 'small', keytip: 'AF' },
          { kind: 'button', command: 'diagram.forward', size: 'small', keytip: 'AD' },
          { kind: 'button', command: 'diagram.back', size: 'small', keytip: 'AB' },
          { kind: 'button', command: 'diagram.backward', size: 'small', keytip: 'AT' },
        ],
      },
      {
        id: 'align',
        label: 'Alinear',
        icon: 'alignLeft',
        items: [
          {
            kind: 'dropdown',
            id: 'alignMenu',
            label: 'Alinear',
            icon: 'alignLeft',
            size: 'large',
            keytip: 'AL',
            entries: ['left', 'center', 'right', 'top', 'middle', 'bottom'].map((k) => ({ kind: 'command' as const, command: `diagram.align.${k}` })),
          },
          { kind: 'button', command: 'diagram.distribute.h', size: 'small', keytip: 'DH' },
          { kind: 'button', command: 'diagram.distribute.v', size: 'small', keytip: 'DV' },
        ],
      },
      {
        id: 'size',
        label: 'Tamaño',
        icon: 'matchB',
        items: [
          { kind: 'button', command: 'diagram.match.w', size: 'small', keytip: 'TW' },
          { kind: 'button', command: 'diagram.match.h', size: 'small', keytip: 'TH' },
          { kind: 'button', command: 'diagram.match.both', size: 'small', keytip: 'TB' },
        ],
      },
      {
        id: 'rotate',
        label: 'Girar',
        icon: 'rotateRight',
        items: [
          { kind: 'button', command: 'diagram.rotate.right', size: 'small', keytip: 'RD' },
          { kind: 'button', command: 'diagram.rotate.left', size: 'small', keytip: 'RI' },
          { kind: 'button', command: 'diagram.flip.h', size: 'small', keytip: 'RH' },
          { kind: 'button', command: 'diagram.flip.v', size: 'small', keytip: 'RV' },
        ],
      },
      {
        id: 'group',
        label: 'Agrupar',
        icon: 'group',
        items: [
          { kind: 'button', command: 'diagram.group', size: 'large', keytip: 'AG' },
          { kind: 'button', command: 'diagram.ungroup', size: 'small', keytip: 'DG' },
        ],
      },
      {
        id: 'lock',
        label: 'Proteger',
        icon: 'lock',
        items: [
          { kind: 'button', command: 'diagram.lock', size: 'small', keytip: 'BL' },
          { kind: 'button', command: 'diagram.unlock', size: 'small', keytip: 'UL' },
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
        id: 'shapes',
        label: 'Formas',
        icon: 'shapes',
        items: CATEGORIES.map((c, i) => ({
          kind: 'dropdown' as const,
          id: `cat-${c.id}`,
          label: c.name,
          icon: 'shapes',
          size: 'large' as const,
          keytip: ['FB', 'FF', 'FU', 'FR', 'FP'][i]!,
          entries: STENCILS.filter((s) => s.category === c.id).map((s) => ({ kind: 'command' as const, command: `diagram.add.${s.id}` })),
        })),
      },
      {
        id: 'pages',
        label: 'Páginas',
        icon: 'pageNew',
        items: [
          { kind: 'button', command: 'diagram.page.new', size: 'large', keytip: 'PN' },
          { kind: 'button', command: 'diagram.page.duplicate', size: 'small', keytip: 'PD' },
          { kind: 'button', command: 'diagram.page.rename', size: 'small', keytip: 'PR' },
          { kind: 'button', command: 'diagram.page.left', size: 'small', keytip: 'PL' },
          { kind: 'button', command: 'diagram.page.right', size: 'small', keytip: 'PG' },
          { kind: 'button', command: 'diagram.page.delete', size: 'small', keytip: 'PX' },
        ],
      },
    ],
  };

  const content: RibbonTab = {
    id: 'content',
    label: 'Contenido',
    keytip: 'C',
    groups: [
      {
        id: 'pictures',
        label: 'Imágenes',
        icon: 'image',
        items: [
          { kind: 'button', command: 'diagram.image.insert', size: 'large', keytip: 'IM' },
          { kind: 'button', command: 'diagram.image.contain', size: 'small', keytip: 'IA' },
          { kind: 'button', command: 'diagram.image.cover', size: 'small', keytip: 'IR' },
          { kind: 'button', command: 'diagram.image.stretch', size: 'small', keytip: 'IE' },
        ],
      },
      {
        id: 'links',
        label: 'Vínculos',
        icon: 'link',
        items: [
          { kind: 'button', command: 'diagram.link', size: 'large', keytip: 'VI' },
          { kind: 'button', command: 'diagram.link.open', size: 'small', keytip: 'VA' },
          { kind: 'button', command: 'diagram.link.remove', size: 'small', keytip: 'VQ' },
        ],
      },
      {
        id: 'data',
        label: 'Datos',
        icon: 'table',
        items: [
          { kind: 'button', command: 'diagram.data.pane', size: 'large', keytip: 'DF' },
          { kind: 'button', command: 'diagram.data.show', size: 'small', keytip: 'DM' },
          { kind: 'button', command: 'diagram.data.export', size: 'small', keytip: 'DE' },
        ],
      },
    ],
  };

  const structure: RibbonTab = {
    id: 'structure',
    label: 'Estructura',
    keytip: 'E',
    groups: [
      {
        id: 'containers',
        label: 'Contenedores',
        icon: 'container',
        items: [
          { kind: 'button', command: 'diagram.container.wrap', size: 'large', keytip: 'CW' },
          { kind: 'button', command: 'diagram.container.size.never', size: 'small', keytip: 'CT1' },
          { kind: 'button', command: 'diagram.container.size.grow', size: 'small', keytip: 'CT2' },
          { kind: 'button', command: 'diagram.container.size.fit', size: 'small', keytip: 'CT3' },
          { kind: 'button', command: 'diagram.lane.add', size: 'small', keytip: 'CL' },
          { kind: 'button', command: 'diagram.lane.remove', size: 'small', keytip: 'CQ' },
        ],
      },
      {
        id: 'layers',
        label: 'Capas',
        icon: 'layers',
        items: [
          { kind: 'button', command: 'diagram.layers.pane', size: 'large', keytip: 'CA' },
          { kind: 'button', command: 'diagram.layer.add', size: 'small', keytip: 'CN' },
          { kind: 'button', command: 'diagram.layer.assign', size: 'small', keytip: 'CS' },
        ],
      },
    ],
  };

  const design: RibbonTab = {
    id: 'design',
    label: 'Diseño',
    keytip: 'D',
    groups: [
      {
        id: 'page',
        label: 'Página',
        icon: 'file',
        items: [
          { kind: 'button', command: 'diagram.page.setup', size: 'large', keytip: 'CP' },
          { kind: 'button', command: 'diagram.page.landscape', size: 'small', keytip: 'OH' },
          { kind: 'button', command: 'diagram.page.portrait', size: 'small', keytip: 'OV' },
        ],
      },
      {
        id: 'autolayout',
        label: 'Diseño automático',
        icon: 'layout',
        items: [
          {
            kind: 'dropdown',
            id: 'layoutMenu',
            label: 'Diseño automático',
            icon: 'layout',
            size: 'large',
            keytip: 'DA',
            entries: [...['layered', 'tree', 'radial', 'circular', 'grid', 'organic'].map((k) => ({ kind: 'command' as const, command: `diagram.layout.${k}` })), { kind: 'command' as const, command: 'diagram.layout.options' }],
          },
          {
            kind: 'dropdown',
            id: 'layoutDirMenu',
            label: 'Dirección',
            icon: 'layout',
            size: 'large',
            keytip: 'DD',
            entries: ['TB', 'BT', 'LR', 'RL'].map((k) => ({ kind: 'command' as const, command: `diagram.layout.dir.${k}` })),
          },
        ],
      },
      {
        id: 'grid',
        label: 'Cuadrícula',
        icon: 'grid',
        items: [
          { kind: 'button', command: 'diagram.grid.show', size: 'large', keytip: 'GM' },
          { kind: 'button', command: 'diagram.grid.snap', size: 'large', keytip: 'GA' },
        ],
      },
      {
        id: 'export',
        label: 'Exportar',
        icon: 'exportFile',
        items: [
          { kind: 'button', command: 'diagram.import.vsdx', size: 'large', keytip: 'IV' },
          {
            kind: 'dropdown',
            id: 'exportMenu',
            label: 'Exportar',
            icon: 'exportFile',
            size: 'large',
            keytip: 'EX',
            entries: [
              { kind: 'command', command: 'diagram.export.svg' },
              { kind: 'command', command: 'diagram.export.png' },
              { kind: 'command', command: 'diagram.export.vsdx' },
              { kind: 'command', command: 'diagram.print' },
            ],
          },
        ],
      },
    ],
  };

  const view = viewTab();
  view.groups.unshift({ id: 'fit', label: 'Ventana', icon: 'zoomIn', items: [{ kind: 'button', command: 'diagram.fit', size: 'large', keytip: 'AJ' }] });
  void PAGE_SIZES;
  return [home, arrange, insert, content, structure, design, view, helpTab()];
}

