import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, RibbonItemView, t, type RibbonItem, type RibbonTab } from '@suitenova/core-ui';
import { ChevronDown } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { helpTab, viewTab } from '../common';
import { FONT_NAMES, FONT_SIZES, PALETTE, formatLabel, numberFormats, type CalcUI } from './commands';
import { chartEntries, contextualTabs, developerTab, insertGroups, pageTab, reviewTab, type ContextFlags } from './ribbonObjects';

type Leaf = Exclude<RibbonItem, { kind: 'separator' }>;

const btn = (command: string, extra: Partial<Extract<Leaf, { kind: 'button' }>> = {}): Leaf => ({ kind: 'button', command, size: 'small', iconOnly: true, ...extra });
const Item = ({ item }: { item: Leaf }) => <RibbonItemView item={item} />;
const Row = ({ children }: { children: ReactNode }) => <div className="nv-row">{children}</div>;
const Rows = ({ children }: { children: ReactNode }) => <div className="nv-rows">{children}</div>;
const Sep = () => <span className="nv-sep" role="separator" />;

function useDoc(ui: CalcUI) {
  useSyncExternalStore(ui.doc.subscribe, ui.doc.getVersion);
  return ui.doc;
}

function FontNameSelect({ ui }: { ui: CalcUI }) {
  const d = useDoc(ui);
  const def = d.wb.defaultFont.name;
  const cur = d.currentStyle().fontName ?? def;
  const names = FONT_NAMES.includes(cur) ? FONT_NAMES : [cur, ...FONT_NAMES];
  return (
    <select className="nv-select" style={{ width: 128 }} aria-label={t('Fuente')} title={t('Fuente')} value={cur} onChange={(e) => d.applyStyle({ fontName: e.target.value === def ? undefined : e.target.value }, 'Fuente')}>
      {names.map((n) => (
        <option key={n} value={n} style={{ fontFamily: n }}>
          {n}
        </option>
      ))}
    </select>
  );
}

function FontSizeSelect({ ui }: { ui: CalcUI }) {
  const d = useDoc(ui);
  const def = d.wb.defaultFont.size;
  const cur = d.currentStyle().fontSize ?? def;
  const sizes = FONT_SIZES.includes(cur) ? FONT_SIZES : [...FONT_SIZES, cur].sort((a, b) => a - b);
  return (
    <select className="nv-select" style={{ width: 52 }} aria-label={t('Tamaño de fuente')} title={t('Tamaño de fuente')} value={cur} onChange={(e) => d.applyStyle({ fontSize: Number(e.target.value) === def ? undefined : Number(e.target.value) }, 'Tamaño de fuente')}>
      {sizes.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function ColorMenu({ ui, kind }: { ui: CalcUI; kind: 'fill' | 'font' }) {
  const d = useDoc(ui);
  const [last, setLast] = useState(kind === 'fill' ? '#ffff00' : '#c00000');
  const [open, setOpen] = useState(false);
  const label = kind === 'fill' ? t('Color de relleno') : t('Color de fuente');
  const apply = (c: string | undefined) => {
    if (c) setLast(c);
    d.applyStyle(kind === 'fill' ? { bg: c } : { color: c }, label);
    setOpen(false);
    window.dispatchEvent(new Event('nova:focus-grid'));
  };
  return (
    <div className="nv-split">
      <button type="button" className="nv-btn nv-btn--small nv-colorbtn" title={label} aria-label={label} onClick={() => apply(last)}>
        <Icon name={kind === 'fill' ? 'fillColor' : 'fontColor'} />
        <span className="nv-colorbar" style={{ background: last }} />
      </button>
      <Popover open={open} onOpenChange={(_e, data) => setOpen(data.open)} positioning="below-start">
        <PopoverTrigger disableButtonEnhancement>
          <button type="button" className="nv-btn nv-btn--small nv-btn--menu" aria-label={`${label} (${t('más')})`} aria-haspopup="dialog">
            <ChevronDown size={12} />
          </button>
        </PopoverTrigger>
        <PopoverSurface>
          <div className="nv-swatches" role="group" aria-label={label}>
            {PALETTE.flat().map((c) => (
              <button key={c} type="button" style={{ background: c }} aria-label={c} title={c} onClick={() => apply(c)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px 8px' }}>
            <button type="button" className="nv-btn nv-btn--small" onClick={() => apply(undefined)}>
              {kind === 'fill' ? t('Sin relleno') : t('Automático')}
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

function NumberFormatSelect({ ui }: { ui: CalcUI }) {
  const d = useDoc(ui);
  const fmts = numberFormats(d.locale);
  const cur = d.currentStyle().numFmt;
  const curLabel = formatLabel(cur, d.locale);
  const known = Object.entries(fmts);
  const matches = known.find(([, f]) => f.code === cur)?.[0];
  return (
    <select
      className="nv-select"
      style={{ width: 150 }}
      aria-label={t('Formato de número')}
      title={t('Formato de número')}
      value={matches ?? '__custom'}
      onChange={(e) => {
        if (e.target.value === '__more') ui.openDialog('format');
        else if (e.target.value !== '__custom') d.applyStyle({ numFmt: fmts[e.target.value]!.code }, 'Formato de número');
      }}
    >
      {!matches && (
        <option value="__custom" hidden>
          {t(curLabel)}
        </option>
      )}
      {known.map(([key, f]) => (
        <option key={key} value={key}>
          {t(f.label)}
        </option>
      ))}
      <option value="__more">{t('Más formatos de número…')}</option>
    </select>
  );
}

function FontGroup({ ui }: { ui: CalcUI }) {
  return (
    <Rows>
      <Row>
        <FontNameSelect ui={ui} />
        <FontSizeSelect ui={ui} />
        <Item item={btn('calc.fontGrow')} />
        <Item item={btn('calc.fontShrink')} />
      </Row>
      <Row>
        <Item item={btn('calc.bold')} />
        <Item item={btn('calc.italic')} />
        <Item item={btn('calc.underline')} />
        <Item item={btn('calc.strike')} />
        <Sep />
        <Item
          item={{
            kind: 'dropdown',
            id: 'borders',
            label: 'Bordes',
            icon: 'gridlines',
            size: 'small',
            entries: [
              { kind: 'command', command: 'calc.border.all' },
              { kind: 'command', command: 'calc.border.outer' },
              { kind: 'command', command: 'calc.border.thick' },
              { kind: 'separator' },
              { kind: 'command', command: 'calc.border.top' },
              { kind: 'command', command: 'calc.border.bottom' },
              { kind: 'command', command: 'calc.border.left' },
              { kind: 'command', command: 'calc.border.right' },
              { kind: 'command', command: 'calc.border.topBottom' },
              { kind: 'separator' },
              { kind: 'command', command: 'calc.border.none' },
            ],
          }}
        />
        <Sep />
        <ColorMenu ui={ui} kind="fill" />
        <ColorMenu ui={ui} kind="font" />
      </Row>
    </Rows>
  );
}

function AlignGroup() {
  return (
    <Rows>
      <Row>
        <Item item={btn('calc.alignTop')} />
        <Item item={btn('calc.alignMiddle')} />
        <Item item={btn('calc.alignBottom')} />
        <Sep />
        <Item item={btn('calc.wrap', { iconOnly: false })} />
      </Row>
      <Row>
        <Item item={btn('calc.alignLeft')} />
        <Item item={btn('calc.alignCenter')} />
        <Item item={btn('calc.alignRight')} />
        <Sep />
        <Item item={btn('calc.indentLess')} />
        <Item item={btn('calc.indentMore')} />
      </Row>
    </Rows>
  );
}

function NumberGroup({ ui }: { ui: CalcUI }) {
  return (
    <Rows>
      <Row>
        <NumberFormatSelect ui={ui} />
      </Row>
      <Row>
        <Item item={btn('calc.currency')} />
        <Item item={btn('calc.percent')} />
        <Item item={btn('calc.thousands')} />
        <Sep />
        <Item item={btn('calc.decMore')} />
        <Item item={btn('calc.decLess')} />
      </Row>
    </Rows>
  );
}

/** The ribbon of Nova Calc. Every control maps to a registered command or a self-contained widget. */
export function calcTabs(ui: CalcUI, context: boolean | Partial<ContextFlags> = false): RibbonTab[] {
  const flags: ContextFlags = { chart: false, table: false, pivot: false, sparkline: false, picture: false, slicer: false, ...(typeof context === 'boolean' ? { chart: context } : context) };
  const chartSelected = flags.chart;
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
            primaryCommand: 'calc.paste',
            keytip: 'V',
            entries: [
              { kind: 'command', command: 'calc.paste' },
              { kind: 'command', command: 'calc.pasteValues' },
              { kind: 'command', command: 'calc.pasteFormulas' },
              { kind: 'command', command: 'calc.pasteFormats' },
              { kind: 'command', command: 'calc.pasteTranspose' },
            ],
          },
          { kind: 'button', command: 'calc.cut', keytip: 'X' },
          { kind: 'button', command: 'calc.copy', keytip: 'C' },
        ],
      },
      { id: 'font', label: 'Fuente', icon: 'bold', items: [{ kind: 'custom', id: 'fontGroup', label: 'Fuente', keytip: 'FN', render: () => <FontGroup ui={ui} /> }] },
      {
        id: 'align',
        label: 'Alineación',
        icon: 'alignCenter',
        items: [
          { kind: 'custom', id: 'alignGroup', label: 'Alineación', keytip: 'A', render: () => <AlignGroup /> },
          {
            kind: 'dropdown',
            id: 'mergeMenu',
            label: 'Combinar',
            icon: 'mergeCells',
            size: 'large',
            primaryCommand: 'calc.mergeCenter',
            keytip: 'M',
            entries: [
              { kind: 'command', command: 'calc.mergeCenter' },
              { kind: 'command', command: 'calc.merge' },
              { kind: 'command', command: 'calc.unmerge' },
            ],
          },
        ],
      },
      { id: 'number', label: 'Número', icon: 'percent', items: [{ kind: 'custom', id: 'numberGroup', label: 'Número', keytip: 'N', render: () => <NumberGroup ui={ui} /> }] },
      {
        id: 'styles',
        label: 'Estilos',
        icon: 'highlighter',
        items: [
          {
            kind: 'dropdown',
            id: 'cfMenu',
            label: 'Formato condicional',
            icon: 'highlighter',
            size: 'large',
            keytip: 'L',
            entries: [
              { kind: 'header', label: 'Resaltar reglas de celdas' },
              ...['gt', 'lt', 'between', 'eq', 'text', 'dup'].map((k) => ({ kind: 'command' as const, command: `calc.cf.${k}` })),
              { kind: 'header', label: 'Reglas superiores e inferiores' },
              ...['top', 'bottom', 'above', 'below'].map((k) => ({ kind: 'command' as const, command: `calc.cf.${k}` })),
              { kind: 'header', label: 'Barras de datos' },
              ...['blue', 'green', 'red', 'orange'].map((k) => ({ kind: 'command' as const, command: `calc.cf.bar.${k}` })),
              { kind: 'header', label: 'Escalas de color' },
              ...['gyr', 'ryg', 'bwr', 'wg', 'wr', 'wb'].map((k) => ({ kind: 'command' as const, command: `calc.cf.scale.${k}` })),
              { kind: 'header', label: 'Conjuntos de iconos' },
              ...['3Arrows', '3TrafficLights', '3Symbols', '3Flags', '4Arrows', '5Arrows'].map((k) => ({ kind: 'command' as const, command: `calc.cf.icons.${k}` })),
              { kind: 'separator' },
              { kind: 'command', command: 'calc.cf.new' },
              { kind: 'command', command: 'calc.cf.clearSel' },
              { kind: 'command', command: 'calc.cf.clearSheet' },
              { kind: 'command', command: 'calc.cf.manage' },
            ],
          },
        ],
      },
      {
        id: 'cells',
        label: 'Celdas',
        icon: 'tableGrid',
        items: [
          {
            kind: 'dropdown',
            id: 'insertMenu',
            label: 'Insertar',
            icon: 'plus',
            size: 'large',
            keytip: 'IC',
            entries: [
              { kind: 'command', command: 'calc.insertRows' },
              { kind: 'command', command: 'calc.insertCols' },
              { kind: 'command', command: 'calc.insertSheet' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'deleteMenu',
            label: 'Eliminar',
            icon: 'trash',
            size: 'large',
            keytip: 'D',
            entries: [
              { kind: 'command', command: 'calc.deleteRows' },
              { kind: 'command', command: 'calc.deleteCols' },
              { kind: 'command', command: 'calc.deleteSheet' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'formatMenu',
            label: 'Formato',
            icon: 'ruler',
            size: 'large',
            keytip: 'O',
            entries: [
              { kind: 'command', command: 'calc.rowHeight' },
              { kind: 'command', command: 'calc.autoFitRows' },
              { kind: 'command', command: 'calc.colWidth' },
              { kind: 'command', command: 'calc.autoFitCols' },
              { kind: 'separator' },
              { kind: 'command', command: 'calc.hideRows' },
              { kind: 'command', command: 'calc.showRows' },
              { kind: 'command', command: 'calc.hideCols' },
              { kind: 'command', command: 'calc.showCols' },
              { kind: 'separator' },
              { kind: 'command', command: 'calc.formatCells' },
            ],
          },
        ],
      },
      {
        id: 'editing',
        label: 'Edición',
        icon: 'sigma',
        items: [
          {
            kind: 'dropdown',
            id: 'sumMenu',
            label: 'Autosuma',
            icon: 'sigma',
            size: 'large',
            primaryCommand: 'calc.sum',
            keytip: 'U',
            entries: [
              { kind: 'command', command: 'calc.sum' },
              { kind: 'command', command: 'calc.average' },
              { kind: 'command', command: 'calc.count' },
              { kind: 'command', command: 'calc.max' },
              { kind: 'command', command: 'calc.min' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'fillMenu',
            label: 'Rellenar',
            icon: 'fillDown',
            size: 'small',
            keytip: 'FI',
            entries: [
              { kind: 'command', command: 'calc.fillDown' },
              { kind: 'command', command: 'calc.fillRight' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'clearMenu',
            label: 'Borrar',
            icon: 'eraser',
            size: 'small',
            keytip: 'E',
            entries: [
              { kind: 'command', command: 'calc.clearAll' },
              { kind: 'command', command: 'calc.clearFormats' },
              { kind: 'command', command: 'calc.clearContents' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'sortMenu',
            label: 'Ordenar',
            icon: 'sortAsc',
            size: 'large',
            keytip: 'S',
            entries: [
              { kind: 'command', command: 'calc.sortAsc' },
              { kind: 'command', command: 'calc.sortDesc' },
              { kind: 'command', command: 'calc.sortCustom' },
              { kind: 'separator' },
              { kind: 'command', command: 'calc.filter' },
              { kind: 'command', command: 'calc.filterClear' },
              { kind: 'command', command: 'calc.filterReapply' },
              { kind: 'separator' },
              { kind: 'command', command: 'calc.removeDup' },
            ],
          },
          {
            kind: 'dropdown',
            id: 'findMenu',
            label: 'Buscar',
            icon: 'search',
            size: 'large',
            keytip: 'FD',
            entries: [
              { kind: 'command', command: 'calc.find' },
              { kind: 'command', command: 'calc.replace' },
              { kind: 'command', command: 'calc.goto' },
            ],
          },
        ],
      },
    ],
  };

  const insertAll = insertGroups();
  const insert: RibbonTab = {
    id: 'insert',
    label: 'Insertar',
    keytip: 'N',
    groups: [
      ...insertAll.slice(0, 2),
      {
        id: 'charts',
        label: 'Gráficos',
        icon: 'chartColumn',
        items: [
          {
            kind: 'dropdown',
            id: 'chartMenu',
            label: 'Insertar gráfico',
            icon: 'chartColumn',
            size: 'large',
            primaryCommand: 'calc.chart.column',
            keytip: 'C',
            entries: chartEntries('calc.chart.'),
          },
        ],
      },
      ...insertAll.slice(2),
      {
        id: 'functions',
        label: 'Funciones',
        icon: 'fx',
        items: [{ kind: 'button', command: 'calc.insertFunction', size: 'large', keytip: 'F' }],
      },
    ],
  };

  const formulas: RibbonTab = {
    id: 'formulas',
    label: 'Fórmulas',
    keytip: 'M',
    groups: [
      {
        id: 'library',
        label: 'Biblioteca de funciones',
        icon: 'fx',
        items: [
          { kind: 'button', command: 'calc.insertFunction', size: 'large', keytip: 'F' },
          {
            kind: 'dropdown',
            id: 'sumMenu2',
            label: 'Autosuma',
            icon: 'sigma',
            size: 'large',
            primaryCommand: 'calc.sum',
            keytip: 'U',
            entries: [
              { kind: 'command', command: 'calc.sum' },
              { kind: 'command', command: 'calc.average' },
              { kind: 'command', command: 'calc.count' },
              { kind: 'command', command: 'calc.max' },
              { kind: 'command', command: 'calc.min' },
            ],
          },
        ],
      },
      {
        id: 'names',
        label: 'Nombres definidos',
        icon: 'tag',
        items: [
          { kind: 'button', command: 'calc.names', size: 'large', keytip: 'N' },
          { kind: 'button', command: 'calc.defineName', size: 'small', keytip: 'D' },
        ],
      },
      {
        id: 'audit',
        label: 'Auditoría de fórmulas',
        icon: 'fx',
        items: [{ kind: 'button', command: 'calc.showFormulas', size: 'large', keytip: 'S' }],
      },
      {
        id: 'calculation',
        label: 'Cálculo',
        icon: 'calculator',
        items: [{ kind: 'button', command: 'calc.recalc', size: 'large', keytip: 'C' }],
      },
    ],
  };

  const data: RibbonTab = {
    id: 'data',
    label: 'Datos',
    keytip: 'D',
    groups: [
      {
        id: 'sort',
        label: 'Ordenar',
        icon: 'sortAsc',
        items: [
          { kind: 'button', command: 'calc.sortAsc', size: 'small', keytip: 'A' },
          { kind: 'button', command: 'calc.sortDesc', size: 'small', keytip: 'Z' },
          { kind: 'button', command: 'calc.sortCustom', size: 'small', keytip: 'O' },
        ],
      },
      {
        id: 'filter',
        label: 'Filtro',
        icon: 'filter',
        items: [
          { kind: 'button', command: 'calc.filter', size: 'large', keytip: 'F' },
          { kind: 'button', command: 'calc.filterClear', size: 'small', keytip: 'C' },
          { kind: 'button', command: 'calc.filterReapply', size: 'small', keytip: 'V' },
        ],
      },
      {
        id: 'tools',
        label: 'Herramientas de datos',
        icon: 'listFilter',
        items: [
          { kind: 'button', command: 'calc.removeDup', size: 'large', keytip: 'R' },
          {
            kind: 'dropdown',
            id: 'validationMenu',
            label: 'Validación de datos',
            icon: 'validation',
            size: 'large',
            primaryCommand: 'calc.validation',
            keytip: 'V',
            entries: [{ kind: 'command', command: 'calc.validation' }, { kind: 'command', command: 'calc.circleInvalid' }, { kind: 'command', command: 'calc.validation.clear' }],
          },
        ],
      },
      {
        id: 'pivotData',
        label: 'Análisis',
        icon: 'pivot',
        items: [
          { kind: 'button', command: 'calc.pivot.create', size: 'large', keytip: 'T' },
          { kind: 'button', command: 'calc.pivot.refreshAll', size: 'small', keytip: 'U' },
        ],
      },
    ],
  };

  const view = viewTab();
  view.groups.unshift(
    {
      id: 'show',
      label: 'Mostrar',
      icon: 'gridlines',
      items: [
        { kind: 'button', command: 'calc.gridlines', size: 'small', keytip: 'G' },
        { kind: 'button', command: 'calc.showFormulas', size: 'small', keytip: 'F' },
      ],
    },
    {
      id: 'window',
      label: 'Ventana',
      icon: 'freeze',
      items: [
        {
          kind: 'dropdown',
          id: 'freezeMenu',
          label: 'Inmovilizar paneles',
          icon: 'freeze',
          size: 'large',
          keytip: 'P',
          entries: [
            { kind: 'command', command: 'calc.freezeCursor' },
            { kind: 'command', command: 'calc.freezeTop' },
            { kind: 'command', command: 'calc.freezeFirst' },
            { kind: 'separator' },
            { kind: 'command', command: 'calc.unfreeze' },
          ],
        },
      ],
    },
  );

  const chartTab: RibbonTab = {
    id: 'chart',
    label: 'Diseño de gráfico',
    keytip: 'G',
    contextual: { label: 'Herramientas de gráfico', color: '#c05621', visible: chartSelected },
    groups: [
      {
        id: 'chartType',
        label: 'Tipo',
        icon: 'chartColumn',
        items: [
          {
            kind: 'dropdown',
            id: 'chartTypeMenu',
            label: 'Cambiar tipo de gráfico',
            icon: 'chartColumn',
            size: 'large',
            keytip: 'TP',
            entries: chartEntries('calc.chartType.'),
          },
        ],
      },
      {
        id: 'chartElements',
        label: 'Elementos del gráfico',
        icon: 'list',
        items: [
          { kind: 'button', command: 'calc.chartTitle', size: 'small', keytip: 'TI' },
          { kind: 'button', command: 'calc.chartLegend', size: 'small', keytip: 'LE' },
          { kind: 'button', command: 'calc.chartStacked', size: 'small', keytip: 'AP' },
          { kind: 'button', command: 'calc.chartSmooth', size: 'small', keytip: 'SU' },
        ],
      },
      {
        id: 'chartData',
        label: 'Datos',
        icon: 'tableGrid',
        items: [
          { kind: 'button', command: 'calc.chartData', size: 'large', keytip: 'D' },
          { kind: 'button', command: 'calc.chartFormat', size: 'large', keytip: 'FO' },
        ],
      },
      { id: 'chartActions', label: 'Acciones', icon: 'trash', items: [{ kind: 'button', command: 'calc.chartDelete', size: 'large', keytip: 'X' }] },
    ],
  };

  const help = helpTab({ shortcuts: false });
  help.groups[0]!.items.unshift({ kind: 'button', command: 'calc.shortcuts', size: 'large', keytip: 'K' });
  return [home, insert, pageTab(), formulas, data, reviewTab(), view, developerTab(), chartTab, ...contextualTabs(ui, flags), help];
}
