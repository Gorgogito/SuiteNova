import { Icon, RibbonItemView, t, type RibbonItem, type RibbonTab } from '@suitenova/core-ui';
import type { ReactNode } from 'react';
import { helpTab, viewTab } from '../common';
import type { SlidesUI } from './commands';
import { PlaceholderGallery } from './MasterPanel';
import { ColorPicker, EffectsMenu, FillMenu, FontGroup, LayoutGallery, OutlineMenu, ShapesGallery, useUi } from './ribbonParts';
import { applyRun } from './textcmds';
import { CorrectionsMenu, PictureShapeGallery, RecolorMenu } from './PicRibbon';
import { TableBordersMenu, TableShadingPicker, TableStyleGallery } from './TableRibbon';
import { AnimGallery, AnimOptions, AnimTiming, TransitionGallery, TransitionOptions, TransitionTiming } from './animUi';

type Leaf = Exclude<RibbonItem, { kind: 'separator' }>;
const btn = (command: string, extra: Partial<Extract<Leaf, { kind: 'button' }>> = {}): Leaf => ({ kind: 'button', command, size: 'small', iconOnly: true, ...extra });
const L = (command: string, keytip?: string): Leaf => ({ kind: 'button', command, size: 'large', keytip });
const S = (command: string, keytip?: string): Leaf => ({ kind: 'button', command, size: 'small', keytip });
const Item = ({ item }: { item: Leaf }) => <RibbonItemView item={item} />;
const Row = ({ children }: { children: ReactNode }) => <div className="nv-row">{children}</div>;
const Rows = ({ children }: { children: ReactNode }) => <div className="nv-rows">{children}</div>;
const Sep = () => <span className="nv-sep" role="separator" />;

function TextGroup({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Rows>
      <Row>
        <FontGroup ui={ui} />
        <Item item={btn('slides.fontGrow')} />
        <Item item={btn('slides.fontShrink')} />
        <Item item={btn('slides.clearFormat')} />
      </Row>
      <Row>
        <Item item={btn('slides.bold')} />
        <Item item={btn('slides.italic')} />
        <Item item={btn('slides.underline')} />
        <Item item={btn('slides.strike')} />
        <Item item={btn('slides.textShadow')} />
        <Item item={btn('slides.subscript')} />
        <Item item={btn('slides.superscript')} />
        <Item item={btn('slides.fontDialog')} />
        <Sep />
        <ColorPicker ui={ui} label={t('Resaltado del texto')} icon="highlighter" noneLabel={t('Sin color')} onPick={(clr) => applyRun(c, (r) => ({ ...r, highlight: clr ?? undefined }))} />
        <ColorPicker ui={ui} label={t('Color de fuente')} icon="fontColor" allowNone={false} onPick={(clr) => applyRun(c, (r) => ({ ...r, color: clr ?? undefined }))} />
      </Row>
    </Rows>
  );
}

function ParagraphGroup() {
  return (
    <Rows>
      <Row>
        <Item item={btn('slides.bullets')} />
        <Item item={btn('slides.numbering')} />
        <Sep />
        <Item item={btn('slides.levelDown')} />
        <Item item={btn('slides.levelUp')} />
        <Sep />
        <Item item={btn('slides.columns')} />
        <Item item={btn('slides.tabs')} />
      </Row>
      <Row>
        <Item item={btn('slides.alignLeft')} />
        <Item item={btn('slides.alignCenter')} />
        <Item item={btn('slides.alignRight')} />
        <Item item={btn('slides.alignJustify')} />
        <Item item={btn('slides.paragraphDialog')} />
      </Row>
    </Rows>
  );
}

export function slidesTabs(ui: SlidesUI): RibbonTab[] {
  const c = ui.ctl;
  const hasShape = c.selected.some((e) => e.kind === 'shape' || e.kind === 'cxn' || e.kind === 'pic' || e.kind === 'group' || e.kind === 'table' || e.kind === 'chart');
  const home: RibbonTab = {
    id: 'home',
    label: 'tab.home',
    keytip: 'I',
    groups: [
      {
        id: 'clipboard',
        label: 'Portapapeles',
        icon: 'paste',
        items: [{ kind: 'button', command: 'slides.paste', size: 'large', keytip: 'V' }, S('slides.cut', 'X'), S('slides.copy', 'C'), S('slides.painter', 'FP'), S('slides.painter.sticky', 'FQ')],
      },
      {
        id: 'slides',
        label: 'Diapositivas',
        icon: 'slideNew',
        items: [
          { kind: 'custom', id: 'newSlide', label: 'Nueva diapositiva', keytip: 'NS', render: () => <LayoutGallery ui={ui} label="Nueva diapositiva" icon="slideNew" apply="new" /> },
          { kind: 'custom', id: 'layout', label: 'Diseño', keytip: 'DS', render: () => <LayoutGallery ui={ui} label="Diseño" icon="layout" apply="change" /> },
          S('slides.sections', 'SE'),
          S('slides.slide.duplicate', 'DD'),
          S('slides.slide.delete', 'DX'),
        ],
      },
      { id: 'font', label: 'Fuente', icon: 'bold', items: [{ kind: 'custom', id: 'textGroup', label: 'Fuente', keytip: 'FN', render: () => <TextGroup ui={ui} /> }] },
      { id: 'paragraph', label: 'Párrafo', icon: 'alignLeft', items: [{ kind: 'custom', id: 'paraGroup', label: 'Párrafo', keytip: 'P', render: () => <ParagraphGroup /> }] },
      {
        id: 'drawing',
        label: 'Dibujo',
        icon: 'shape-rect',
        items: [
          { kind: 'custom', id: 'shapes', label: 'Formas', keytip: 'FO', render: () => <ShapesGallery ui={ui} /> },
          {
            kind: 'dropdown',
            id: 'arrange',
            label: 'Organizar',
            icon: 'toFront',
            size: 'large',
            keytip: 'OR',
            entries: [
              { kind: 'command', command: 'slides.front' },
              { kind: 'command', command: 'slides.back' },
              { kind: 'command', command: 'slides.forward' },
              { kind: 'command', command: 'slides.backward' },
              { kind: 'separator' },
              { kind: 'command', command: 'slides.alignObjLeft' },
              { kind: 'command', command: 'slides.alignObjCenter' },
              { kind: 'command', command: 'slides.alignObjRight' },
              { kind: 'command', command: 'slides.alignObjTop' },
              { kind: 'command', command: 'slides.alignObjMiddle' },
              { kind: 'command', command: 'slides.alignObjBottom' },
              { kind: 'command', command: 'slides.distributeH' },
              { kind: 'command', command: 'slides.distributeV' },
              { kind: 'separator' },
              { kind: 'command', command: 'slides.group' },
              { kind: 'command', command: 'slides.ungroup' },
              { kind: 'separator' },
              { kind: 'command', command: 'slides.rotateRight' },
              { kind: 'command', command: 'slides.rotateLeft' },
              { kind: 'command', command: 'slides.flipH' },
              { kind: 'command', command: 'slides.flipV' },
            ],
          },
          { kind: 'custom', id: 'fillMenu', label: 'Relleno de forma', keytip: 'RF', render: () => <FillMenu ui={ui} /> },
          { kind: 'custom', id: 'outlineMenu', label: 'Contorno de forma', keytip: 'CF', render: () => <OutlineMenu ui={ui} /> },
          { kind: 'custom', id: 'effectsMenu', label: 'Efectos de forma', keytip: 'EF', render: () => <EffectsMenu ui={ui} /> },
        ],
      },
      { id: 'editing', label: 'Edición', icon: 'search', items: [S('slides.review.find', 'BU'), S('slides.selectAll', 'ST')] },
    ],
  };

  const insert: RibbonTab = {
    id: 'insert',
    label: 'Insertar',
    keytip: 'N',
    groups: [
      { id: 'slidesI', label: 'Diapositivas', icon: 'slideNew', items: [{ kind: 'custom', id: 'newSlide2', label: 'Nueva diapositiva', keytip: 'NS', render: () => <LayoutGallery ui={ui} label="Nueva diapositiva" icon="slideNew" apply="new" /> }] },
      { id: 'tables', label: 'Tablas', icon: 'tableGrid', items: [L('slides.insert.table', 'TB')] },
      { id: 'images', label: 'Imágenes', icon: 'image', items: [L('slides.insert.picture', 'IM')] },
      { id: 'illustr', label: 'Ilustraciones', icon: 'shape-rect', items: [{ kind: 'custom', id: 'shapes2', label: 'Formas', keytip: 'FO', render: () => <ShapesGallery ui={ui} /> }, L('slides.insert.smartart', 'SA'), L('slides.insert.chart', 'GR'), S('slides.draw.polygon', 'FF'), S('slides.draw.curve', 'FC'), S('slides.draw.scribble', 'FG')] },
      { id: 'links', label: 'Vínculos', icon: 'link', items: [L('slides.insert.hyperlink', 'K'), L('slides.action', 'AX')] },
      { id: 'comments', label: 'Comentarios', icon: 'comment', items: [L('slides.insert.comment', 'CO')] },
      { id: 'textI', label: 'Texto', icon: 'textbox', items: [L('slides.insert.textbox', 'CT'), L('slides.insert.headerFooter', 'EP'), L('slides.insert.wordart', 'WA'), S('slides.insert.equation', 'EQ')] },
      { id: 'media', label: 'Multimedia', icon: 'video', items: [L('slides.insert.video', 'VI'), L('slides.insert.audio', 'AU')] },
    ],
  };

  const design: RibbonTab = {
    id: 'design',
    label: 'Diseño',
    keytip: 'G',
    groups: [
      { id: 'themes', label: 'Temas', icon: 'palette', items: [L('slides.design.themes', 'TM')] },
      { id: 'customize', label: 'Personalizar', icon: 'ruler', items: [L('slides.slide.size', 'TA'), L('slides.design.background', 'FD')] },
    ],
  };

  const transitions: RibbonTab = {
    id: 'transitions',
    label: 'Transiciones',
    keytip: 'T',
    groups: [
      { id: 'trPreview', label: 'Vista previa', icon: 'play', items: [L('slides.trans.preview', 'TV')] },
      {
        id: 'trTo',
        label: 'Transición a esta diapositiva',
        icon: 'transition',
        items: [
          { kind: 'custom', id: 'trGallery', label: 'Transición', keytip: 'TR', render: () => <TransitionGallery ui={ui} /> },
          { kind: 'custom', id: 'trOptions', label: 'Opciones de efectos', keytip: 'TO', render: () => <TransitionOptions ui={ui} /> },
        ],
      },
      {
        id: 'trTime',
        label: 'Intervalos',
        icon: 'timer',
        items: [{ kind: 'custom', id: 'trTiming', label: 'Intervalos', keytip: 'TI', render: () => <TransitionTiming ui={ui} /> }, S('slides.trans.applyAll', 'TL')],
      },
    ],
  };

  const animations: RibbonTab = {
    id: 'animations',
    label: 'Animaciones',
    keytip: 'A',
    groups: [
      { id: 'anPreview', label: 'Vista previa', icon: 'play', items: [L('slides.anim.preview', 'AV')] },
      {
        id: 'anEffects',
        label: 'Animación',
        icon: 'sparkles',
        items: [
          { kind: 'custom', id: 'anGallery', label: 'Animación', keytip: 'AN', render: () => <AnimGallery ui={ui} mode="apply" /> },
          { kind: 'custom', id: 'anOptions', label: 'Opciones de efectos', keytip: 'AO', render: () => <AnimOptions ui={ui} /> },
        ],
      },
      {
        id: 'anAdvanced',
        label: 'Animación avanzada',
        icon: 'animOrder',
        items: [{ kind: 'custom', id: 'anAdd', label: 'Agregar animación', keytip: 'AA', render: () => <AnimGallery ui={ui} mode="add" /> }, L('slides.anim.pane', 'AP'), S('slides.anim.remove', 'AQ')],
      },
      {
        id: 'anTime',
        label: 'Intervalos',
        icon: 'timer',
        items: [{ kind: 'custom', id: 'anTiming', label: 'Intervalos', keytip: 'AT', render: () => <AnimTiming ui={ui} /> }, S('slides.anim.earlier', 'AE'), S('slides.anim.later', 'AD')],
      },
    ],
  };

  const show: RibbonTab = {
    id: 'show',
    label: 'Presentación con diapositivas',
    keytip: 'S',
    groups: [
      { id: 'start', label: 'Iniciar', icon: 'play', items: [L('slides.show.start', 'PP'), L('slides.show.current', 'PC'), L('slides.show.custom', 'PE')] },
      { id: 'setup', label: 'Configurar', icon: 'settings', items: [L('slides.show.setup', 'CP'), S('slides.slide.hide', 'OC'), L('slides.show.rehearse', 'EN')] },
      { id: 'monitors', label: 'Monitores', icon: 'monitor', items: [L('slides.show.presenter', 'MO')] },
    ],
  };

  const review: RibbonTab = {
    id: 'review',
    label: 'Revisar',
    keytip: 'R',
    groups: [
      { id: 'proof', label: 'Revisión', icon: 'spell', items: [L('slides.review.spelling', 'OR')] },
      { id: 'comm', label: 'Comentarios', icon: 'comment', items: [L('slides.insert.comment', 'CN'), L('slides.review.comments', 'CP')] },
    ],
  };

  const view = viewTab({ zoom: true });
  const viewExtra: RibbonTab = {
    id: 'viewSlides',
    label: 'Vista',
    keytip: 'W',
    groups: [
      { id: 'presViews', label: 'Vistas de presentación', icon: 'layout', items: [L('slides.view.normal', 'VN'), L('slides.view.outline', 'VE'), L('slides.view.sorter', 'VC'), L('slides.view.notes', 'VP'), L('slides.view.reading', 'VL')] },
      { id: 'masters', label: 'Vistas de patrón', icon: 'layout', items: [L('slides.view.master', 'VM')] },
      { id: 'showHide', label: 'Mostrar', icon: 'gridlines', items: [S('slides.view.grid', 'VG'), S('slides.view.ruler', 'VR'), S('slides.view.guides', 'VU'), S('slides.view.snap', 'VA'), S('slides.view.notesPane', 'VO')] },
      { id: 'guides', label: 'Guías', icon: 'ruler', items: [S('slides.view.addGuideV', 'GV'), S('slides.view.addGuideH', 'GH'), S('slides.view.clearGuides', 'GQ')] },
      { id: 'zoomG', label: 'Zoom', icon: 'zoomIn', items: [S('slides.view.fit', 'ZF')] },
    ],
  };
  void view;

  const format: RibbonTab = {
    id: 'shapeFormat',
    label: 'Formato de forma',
    keytip: 'FF',
    contextual: { label: 'Herramientas de dibujo', color: '#c55a11', visible: hasShape },
    groups: [
      { id: 'insShapes', label: 'Insertar formas', icon: 'shape-rect', items: [{ kind: 'custom', id: 'shapes3', label: 'Formas', keytip: 'FO', render: () => <ShapesGallery ui={ui} /> }] },
      {
        id: 'styles',
        label: 'Estilos de forma',
        icon: 'paintbucket',
        items: [
          { kind: 'custom', id: 'fill3', label: 'Relleno de forma', keytip: 'RF', render: () => <FillMenu ui={ui} /> },
          { kind: 'custom', id: 'outline3', label: 'Contorno de forma', keytip: 'CF', render: () => <OutlineMenu ui={ui} /> },
          { kind: 'custom', id: 'effects3', label: 'Efectos de forma', keytip: 'EF', render: () => <EffectsMenu ui={ui} /> },
          L('slides.formatPane', 'PF'),
        ],
      },
      {
        id: 'arrange2',
        label: 'Organizar',
        icon: 'toFront',
        items: [S('slides.front', 'TF'), S('slides.back', 'EF2'), S('slides.group', 'AG'), S('slides.ungroup', 'DG'), S('slides.rotateRight', 'GR2'), S('slides.flipH', 'VH')],
      },
      {
        id: 'align',
        label: 'Alinear',
        icon: 'alignCenter',
        items: [S('slides.alignObjLeft', 'AL'), S('slides.alignObjCenter', 'AC'), S('slides.alignObjRight', 'AR'), S('slides.alignObjTop', 'AT'), S('slides.alignObjMiddle', 'AM'), S('slides.alignObjBottom', 'AB'), S('slides.distributeH', 'DH'), S('slides.distributeV', 'DV')],
      },
      { id: 'size', label: 'Tamaño', icon: 'ruler', items: [L('slides.position', 'TP'), L('slides.altText', 'TX')] },
      {
        id: 'editShape',
        label: 'Editar forma',
        icon: 'freeform',
        items: [L('slides.editPoints', 'MP'), S('slides.points.delete', 'PE'), S('slides.points.corner', 'PC'), S('slides.points.smooth', 'PS'), S('slides.points.symmetric', 'PY'), S('slides.points.line', 'SR'), S('slides.points.curve', 'SV'), S('slides.points.close', 'PT')],
      },
    ],
  };

  const isTable = c.selected.length === 1 && c.selected[0]!.kind === 'table';
  const tableDesign: RibbonTab = {
    id: 'tableDesign',
    label: 'Diseño de tabla',
    keytip: 'DT',
    contextual: { label: 'Herramientas de tabla', color: '#7b2d8e', visible: isTable },
    groups: [
      { id: 'tOpts', label: 'Opciones de estilo de tabla', icon: 'tableGrid', items: [S('slides.table.firstRow', 'TE'), S('slides.table.lastRow', 'TT'), S('slides.table.bandRow', 'TB'), S('slides.table.firstCol', 'TC'), S('slides.table.lastCol', 'TU'), S('slides.table.bandCol', 'TD')] },
      {
        id: 'tStyles',
        label: 'Estilos de tabla',
        icon: 'tableGrid',
        items: [
          { kind: 'custom', id: 'tableStyles', label: 'Estilos de tabla', keytip: 'ES', render: () => <TableStyleGallery ui={ui} /> },
          { kind: 'custom', id: 'tableShading', label: 'Sombreado', keytip: 'SO', render: () => <TableShadingPicker ui={ui} /> },
          { kind: 'custom', id: 'tableBorders', label: 'Bordes', keytip: 'BO', render: () => <TableBordersMenu ui={ui} /> },
        ],
      },
    ],
  };
  const tableLayout: RibbonTab = {
    id: 'tableLayout',
    label: 'Disposición de tabla',
    keytip: 'DP',
    contextual: { label: 'Herramientas de tabla', color: '#7b2d8e', visible: isTable },
    groups: [
      { id: 'tRows', label: 'Filas y columnas', icon: 'rows', items: [S('slides.table.rowAbove', 'FA'), S('slides.table.rowBelow', 'FD'), S('slides.table.colLeft', 'CI'), S('slides.table.colRight', 'CD'), S('slides.table.deleteRows', 'EF'), S('slides.table.deleteCols', 'EC'), S('slides.table.delete', 'ET')] },
      { id: 'tMerge', label: 'Combinar', icon: 'mergeCells', items: [L('slides.table.merge', 'CB'), L('slides.table.split', 'DI')] },
      { id: 'tSize', label: 'Tamaño de celda', icon: 'ruler', items: [S('slides.table.size', 'TA'), S('slides.table.distRows', 'DF'), S('slides.table.distCols', 'DC')] },
      {
        id: 'tAlign',
        label: 'Alineación',
        icon: 'alignCenter',
        items: [S('slides.alignLeft', 'JL'), S('slides.alignCenter', 'JC'), S('slides.alignRight', 'JR'), S('slides.table.anchorTop', 'VA'), S('slides.table.anchorMiddle', 'VM'), S('slides.table.anchorBottom', 'VB'), S('slides.table.cellOptions', 'OC')],
      },
    ],
  };

  const isPic = c.selected.length > 0 && c.selected.every((e) => e.kind === 'pic');
  const picFormat: RibbonTab = {
    id: 'picFormat',
    label: 'Formato de imagen',
    keytip: 'FI',
    contextual: { label: 'Herramientas de imagen', color: '#0f7b6c', visible: isPic },
    groups: [
      {
        id: 'pAdjust',
        label: 'Ajustar',
        icon: 'contrast',
        items: [
          { kind: 'custom', id: 'picCorr', label: 'Correcciones', keytip: 'CO', render: () => <CorrectionsMenu ui={ui} /> },
          { kind: 'custom', id: 'picRecolor', label: 'Recolorear', keytip: 'RE', render: () => <RecolorMenu ui={ui} /> },
          S('slides.pic.change', 'CI2'),
          S('slides.pic.reset', 'RI'),
        ],
      },
      {
        id: 'pStyles',
        label: 'Estilos de imagen',
        icon: 'shape-rect',
        items: [
          { kind: 'custom', id: 'picShape', label: 'Forma de la imagen', keytip: 'FM', render: () => <PictureShapeGallery ui={ui} /> },
          { kind: 'custom', id: 'picOutline', label: 'Contorno', keytip: 'CN2', render: () => <OutlineMenu ui={ui} /> },
          { kind: 'custom', id: 'picEffects', label: 'Efectos', keytip: 'EP', render: () => <EffectsMenu ui={ui} /> },
        ],
      },
      { id: 'pSize', label: 'Tamaño', icon: 'crop', items: [L('slides.pic.crop', 'RC'), S('slides.pic.fill', 'RL'), S('slides.pic.fit', 'AJ'), S('slides.position', 'TP2'), S('slides.altText', 'TX2')] },
      { id: 'pArrange', label: 'Organizar', icon: 'toFront', items: [S('slides.front', 'TF2'), S('slides.back', 'EF3'), S('slides.rotateRight', 'GR3'), S('slides.flipH', 'VH2')] },
    ],
  };

  const chartTools: RibbonTab = {
    id: 'chartTools',
    label: 'Diseño de gráfico',
    keytip: 'DG',
    contextual: { label: 'Herramientas de gráfico', color: '#2e7d32', visible: c.selected.length === 1 && c.selected[0]!.kind === 'chart' },
    groups: [{ id: 'chartData', label: 'Datos', icon: 'chart', items: [L('slides.chart.edit', 'ED')] }],
  };

  const PH_ITEMS: [string, string][] = [['obj', 'Contenido'], ['body', 'Texto'], ['pic', 'Imagen'], ['chart', 'Gráfico'], ['tbl', 'Tabla'], ['media', 'Multimedia'], ['dgm', 'SmartArt']];
  const masterTab: RibbonTab = {
    id: 'master',
    label: 'Patrón de diapositivas',
    keytip: 'PD',
    contextual: { label: 'Vista Patrón', color: '#7b3f00', visible: c.view === 'master' },
    groups: [
      { id: 'mEdit', label: 'Editar patrón', icon: 'layout', items: [L('slides.master.duplicate', 'IP'), L('slides.master.addLayout', 'ID'), S('slides.master.delete', 'EL'), S('slides.master.properties', 'CN'), S('slides.master.up', 'SU'), S('slides.master.down', 'BA')] },
      {
        id: 'mLayout',
        label: 'Diseño del patrón',
        icon: 'textbox',
        items: [{ kind: 'custom', id: 'mPh', label: 'Insertar marcador de posición', keytip: 'MP', render: () => <PlaceholderGallery ui={ui} items={PH_ITEMS} /> }, S('slides.master.hideBg', 'OG')],
      },
      { id: 'mTheme', label: 'Editar tema', icon: 'palette', items: [L('slides.design.themes', 'TM2')] },
      { id: 'mBg', label: 'Fondo', icon: 'paintbucket', items: [L('slides.design.background', 'FD2')] },
      { id: 'mClose', label: 'Cerrar', icon: 'close', items: [L('slides.master.close', 'CV')] },
    ],
  };

  return [home, insert, design, transitions, animations, show, review, viewExtra, format, tableDesign, tableLayout, picFormat, chartTools, masterTab, helpTab()];
}

export { Icon };
