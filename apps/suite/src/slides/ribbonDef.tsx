import { Icon, RibbonItemView, t, type RibbonItem, type RibbonTab } from '@suitenova/core-ui';
import type { ReactNode } from 'react';
import { helpTab, viewTab } from '../common';
import type { SlidesUI } from './commands';
import { PlaceholderGallery } from './MasterPanel';
import { ColorPicker, EffectsMenu, FillMenu, FontGroup, LayoutGallery, OutlineMenu, ShapesGallery, useUi } from './ribbonParts';
import { applyRun } from './textcmds';
import { chartFormatRibbon } from '../chart/commands';
import { LAYOUT_CATALOG, COLORS_CATALOG, STYLE_CATALOG } from '@suitenova/smartart-core';
import { isLiveSmartArt } from '@suitenova/slides-core';
import { ArtisticMenu } from './ribbonParts3';
import { BgStylesGallery, ColorsGallery, FontsGallery } from './ribbonParts3';
import { TextEffectsMenu, TextFillPicker, TextOutlinePicker } from './ribbonParts2';
import { AspectGallery, CorrectionsMenu, PictureShapeGallery, PictureStylesGallery, RecolorMenu } from './PicRibbon';
import { TableBordersMenu, TableShadingPicker, TableStyleGallery } from './TableRibbon';
import { AnimGallery, AnimOptions, AnimTiming, TransitionGallery, TransitionOptions, TransitionTiming } from './animUi';

type Leaf = Exclude<RibbonItem, { kind: 'separator' }>;
const btn = (command: string, extra: Partial<Extract<Leaf, { kind: 'button' }>> = {}): Leaf => ({ kind: 'button', command, size: 'small', iconOnly: true, ...extra });
const dd = (id: string, label: string, icon: string, keytip: string, cmds: string[]): Leaf => ({ kind: 'dropdown', id, label, icon, size: 'small', iconOnly: true, keytip, entries: cmds.map((c) => (c === '-' ? { kind: 'separator' as const } : { kind: 'command' as const, command: c })) });
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
        items: [{ kind: 'dropdown', id: 'pasteMenu', label: 'Pegar', icon: 'paste', size: 'large', keytip: 'V', primaryCommand: 'slides.paste', entries: [{ kind: 'command', command: 'slides.paste' }, { kind: 'command', command: 'slides.paste.text' }] }, S('slides.cut', 'X'), S('slides.copy', 'C'), S('slides.painter', 'FP'), S('slides.painter.sticky', 'FQ')],
      },
      {
        id: 'slides',
        label: 'Diapositivas',
        icon: 'slideNew',
        items: [
          { kind: 'custom', id: 'newSlide', label: 'Nueva diapositiva', keytip: 'NS', render: () => <LayoutGallery ui={ui} label="Nueva diapositiva" icon="slideNew" apply="new" /> },
          { kind: 'custom', id: 'layout', label: 'Diseño', keytip: 'DS', render: () => <LayoutGallery ui={ui} label="Diseño" icon="layout" apply="change" /> },
          btn('slides.slide.reset', { keytip: 'RD' }),
          S('slides.sections', 'SE'),
          S('slides.slide.duplicate', 'DD'),
          btn('slides.slide.delete', { keytip: 'DX' }),
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
              { kind: 'command', command: 'slides.sel.pane' },
              { kind: 'command', command: 'slides.saveAsPicture' },
              { kind: 'separator' },
              { kind: 'command', command: 'slides.rotateRight' },
              { kind: 'command', command: 'slides.rotateLeft' },
              { kind: 'command', command: 'slides.flipH' },
              { kind: 'command', command: 'slides.flipV' },
            ],
          },
          { kind: 'custom', id: 'fillMenu', label: 'Relleno de forma', keytip: 'RF', render: () => <FillMenu ui={ui} /> },
          { kind: 'custom', id: 'outlineMenu', label: 'Contorno de forma', keytip: 'CF', render: () => <OutlineMenu ui={ui} /> },
          { kind: 'custom', id: 'effectsMenu', label: 'Efectos de forma', keytip: 'EF', render: () => <EffectsMenu ui={ui} iconOnly /> },
        ],
      },
      {
        id: 'textTools',
        label: 'Texto',
        icon: 'textDirection',
        items: [
          dd('lineSp', 'Espaciado entre líneas', 'lineSpacing', 'IL', ['slides.lineSp.10', 'slides.lineSp.15', 'slides.lineSp.20', 'slides.lineSp.25', 'slides.lineSp.30', '-', 'slides.lineSp.options']),
          dd('textDir', 'Dirección del texto', 'textDirection', 'DX', ['slides.dir.horz', 'slides.dir.vert', 'slides.dir.vert270', 'slides.dir.eaVert']),
          dd('textAnchor', 'Alinear texto', 'anchorMiddle', 'AV', ['slides.anchor.t', 'slides.anchor.ctr', 'slides.anchor.b']),
          dd('textFit', 'Ajuste automático', 'autofit', 'AF', ['slides.autofit.none', 'slides.autofit.norm', 'slides.autofit.shape']),
          dd('charSp', 'Espaciado entre caracteres', 'charSpacing', 'EC', ['slides.charSp.vtight', 'slides.charSp.tight', 'slides.charSp.normal', 'slides.charSp.loose', 'slides.charSp.vloose', '-', 'slides.charSp.options']),
          dd('changeCase', 'Cambiar mayúsculas y minúsculas', 'changeCase', 'MM', ['slides.case.sentence', 'slides.case.lower', 'slides.case.upper', 'slides.case.title', 'slides.case.toggle']),
          { kind: 'button', command: 'slides.fonts.replace', size: 'small', iconOnly: true, keytip: 'RZ' },
          dd('toSmartArt', 'Convertir en SmartArt', 'smartart', 'CS', LAYOUT_CATALOG.map((l) => `slides.toSmartArt.${l.id.split('/').pop()}`)),
        ],
      },
      { id: 'editing', label: 'Edición', icon: 'search', items: [btn('slides.review.find', { keytip: 'BU' }), btn('slides.selectAll', { keytip: 'ST' })] },
    ],
  };

  const insert: RibbonTab = {
    id: 'insert',
    label: 'Insertar',
    keytip: 'N',
    groups: [
      { id: 'slidesI', label: 'Diapositivas', icon: 'slideNew', items: [{ kind: 'custom', id: 'newSlide2', label: 'Nueva diapositiva', keytip: 'NS', render: () => <LayoutGallery ui={ui} label="Nueva diapositiva" icon="slideNew" apply="new" /> }, btn('slides.insert.reuse', { keytip: 'RU' })] },
      { id: 'tables', label: 'Tablas', icon: 'tableGrid', items: [L('slides.insert.table', 'TB')] },
      { id: 'images', label: 'Imágenes', icon: 'image', items: [L('slides.insert.picture', 'IM'), btn('slides.insert.screenshot', { keytip: 'CP' }), btn('slides.insert.album', { keytip: 'AF' }), btn('slides.insert.icons', { keytip: 'IC' })] },
      { id: 'illustr', label: 'Ilustraciones', icon: 'shape-rect', items: [{ kind: 'custom', id: 'shapes2', label: 'Formas', keytip: 'FO', render: () => <ShapesGallery ui={ui} /> }, L('slides.insert.smartart', 'SA'), L('slides.insert.chart', 'GR'), S('slides.draw.polygon', 'FF'), S('slides.draw.curve', 'FC'), S('slides.draw.scribble', 'FG')] },
      { id: 'links', label: 'Vínculos', icon: 'link', items: [L('slides.insert.hyperlink', 'K'), L('slides.action', 'AX'), dd('zoomMenu', 'Zoom', 'zoomIn', 'ZM', ['slides.insert.zoomSummary', 'slides.insert.zoomSlide'])] },
      { id: 'comments', label: 'Comentarios', icon: 'comment', items: [L('slides.insert.comment', 'CO')] },
      { id: 'textI', label: 'Texto', icon: 'textbox', items: [L('slides.insert.textbox', 'CT'), L('slides.insert.headerFooter', 'EP'), L('slides.insert.wordart', 'WA'), S('slides.insert.equation', 'EQ'), S('slides.insert.symbol', 'SY'), S('slides.insert.dateShort', 'FE'), S('slides.insert.dateLong', 'FG2'), S('slides.insert.slideNumber', 'NU')] },
      { id: 'media', label: 'Multimedia', icon: 'video', items: [L('slides.insert.video', 'VI'), L('slides.insert.audio', 'AU')] },
    ],
  };

  const design: RibbonTab = {
    id: 'design',
    label: 'Diseño',
    keytip: 'G',
    groups: [
      { id: 'themes', label: 'Temas', icon: 'palette', items: [L('slides.design.themes', 'TM')] },
      {
        id: 'variants',
        label: 'Variantes',
        icon: 'palette',
        items: [
          { kind: 'custom', id: 'varColors', label: 'Colores', keytip: 'VC', render: () => <ColorsGallery ui={ui} /> },
          { kind: 'custom', id: 'varFonts', label: 'Fuentes', keytip: 'VF', render: () => <FontsGallery ui={ui} /> },
          { kind: 'custom', id: 'varBg', label: 'Estilos de fondo', keytip: 'VE', render: () => <BgStylesGallery ui={ui} /> },
        ],
      },
      {
        id: 'customize',
        label: 'Personalizar',
        icon: 'ruler',
        items: [
          { kind: 'dropdown', id: 'slideSizeMenu', label: 'Tamaño de diapositiva', icon: 'ruler', size: 'large', keytip: 'TA', entries: [{ kind: 'command', command: 'slides.design.size.wide' }, { kind: 'command', command: 'slides.design.size.standard' }, { kind: 'separator' }, { kind: 'command', command: 'slides.design.size.custom' }] },
          L('slides.design.background', 'FD'),
        ],
      },
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
      { id: 'narr', label: 'Grabación', icon: 'mic', items: [L('slides.show.narration', 'GN')] },
    ],
  };

  const review: RibbonTab = {
    id: 'review',
    label: 'Revisar',
    keytip: 'R',
    groups: [
      { id: 'proof', label: 'Revisión', icon: 'spell', items: [
        L('slides.review.spelling', 'OR'),
        L('slides.review.thesaurus', 'SN'),
        L('slides.review.autocorrect', 'AC'),
        {
          kind: 'dropdown',
          id: 'slideLangMenu',
          label: 'Idioma',
          icon: 'globe',
          size: 'large',
          keytip: 'ID',
          entries: [
            { kind: 'command', command: 'slides.review.docLang.es' },
            { kind: 'command', command: 'slides.review.docLang.es-MX' },
            { kind: 'command', command: 'slides.review.docLang.es-PE' },
            { kind: 'command', command: 'slides.review.docLang.en' },
            { kind: 'separator' },
            { kind: 'command', command: 'slides.review.lang.default' },
            { kind: 'command', command: 'slides.review.lang.es' },
            { kind: 'command', command: 'slides.review.lang.es-MX' },
            { kind: 'command', command: 'slides.review.lang.es-PE' },
            { kind: 'command', command: 'slides.review.lang.en' },
            { kind: 'command', command: 'slides.review.noProof' },
          ],
        },
        L('slides.review.accessibility', 'CA'),
      ],
    },
      { id: 'docReview', label: 'Documento', icon: 'compareDocs', items: [L('slides.review.compare', 'CM'), L('slides.doc.properties', 'DQ')] },
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
      {
        id: 'insShapes',
        label: 'Insertar formas',
        icon: 'shape-rect',
        items: [
          { kind: 'custom', id: 'shapes3', label: 'Formas', keytip: 'FO', render: () => <ShapesGallery ui={ui} /> },
          { kind: 'custom', id: 'changeShape', label: 'Cambiar forma', keytip: 'CS', render: () => <ShapesGallery ui={ui} label="Cambiar forma" icon="changeShape" size="small" iconOnly onlyShapes onPick={(prst) => ui.ctl.changeShape(prst)} /> },
          {
            kind: 'dropdown',
            id: 'mergeShapes',
            label: 'Combinar formas',
            icon: 'shapeUnion',
            size: 'small',
            iconOnly: true,
            keytip: 'CB',
            entries: [
              { kind: 'command', command: 'slides.shape.union' },
              { kind: 'command', command: 'slides.shape.combine' },
              { kind: 'command', command: 'slides.shape.fragment' },
              { kind: 'command', command: 'slides.shape.intersect' },
              { kind: 'command', command: 'slides.shape.subtract' },
            ],
          },
        ],
      },
      {
        id: 'wordartStyles',
        label: 'Estilos de WordArt',
        icon: 'wordart',
        items: [
          { kind: 'custom', id: 'textFill', label: 'Relleno de texto', keytip: 'WF', render: () => <TextFillPicker ui={ui} /> },
          { kind: 'custom', id: 'textOutline', label: 'Contorno de texto', keytip: 'WO', render: () => <TextOutlinePicker ui={ui} /> },
          { kind: 'custom', id: 'textEffects', label: 'Efectos de texto', keytip: 'WE', render: () => <TextEffectsMenu ui={ui} /> },
        ],
      },
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
          btn('slides.pic.removeBg', { keytip: 'QF' }),
          { kind: 'custom', id: 'picArtistic', label: 'Efectos artísticos', keytip: 'EA', render: () => <ArtisticMenu ui={ui} /> },
          btn('slides.pic.compress', { keytip: 'CM' }),
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
          { kind: 'custom', id: 'picStyles', label: 'Estilos de imagen', keytip: 'EI', render: () => <PictureStylesGallery ui={ui} /> },
          { kind: 'custom', id: 'picShape', label: 'Forma de la imagen', keytip: 'FM', render: () => <PictureShapeGallery ui={ui} /> },
          { kind: 'custom', id: 'picOutline', label: 'Contorno', keytip: 'CN2', render: () => <OutlineMenu ui={ui} /> },
          { kind: 'custom', id: 'picEffects', label: 'Efectos', keytip: 'EP', render: () => <EffectsMenu ui={ui} /> },
        ],
      },
      { id: 'pSize', label: 'Tamaño', icon: 'crop', items: [L('slides.pic.crop', 'RC'), { kind: 'custom', id: 'picAspect', label: 'Relación de aspecto', keytip: 'RA', render: () => <AspectGallery ui={ui} /> }, S('slides.pic.fill', 'RL'), S('slides.pic.fit', 'AJ'), S('slides.position', 'TP2'), S('slides.altText', 'TX2')] },
      { id: 'pArrange', label: 'Organizar', icon: 'toFront', items: [S('slides.front', 'TF2'), S('slides.back', 'EF3'), S('slides.rotateRight', 'GR3'), S('slides.flipH', 'VH2')] },
    ],
  };

  const chartMenus = chartFormatRibbon({ element: 'slides.chart.el', colors: 'slides.chart.colors', style: 'slides.chart.style' });
  const chartTools: RibbonTab = {
    id: 'chartTools',
    label: 'Diseño de gráfico',
    keytip: 'DG',
    contextual: { label: 'Herramientas de gráfico', color: '#2e7d32', visible: c.selected.length === 1 && c.selected[0]!.kind === 'chart' },
    groups: [
      { id: 'chartData', label: 'Datos', icon: 'chart', items: [L('slides.chart.edit', 'ED')] },
      { id: 'chartElements', label: 'Diseños de gráfico', icon: 'chart', items: [chartMenus.element] },
      { id: 'chartStyles', label: 'Estilos de gráfico', icon: 'palette', items: [chartMenus.colors, chartMenus.styles] },
    ],
  };

  const smartTools: RibbonTab = {
    id: 'smartTools',
    label: 'Diseño de SmartArt',
    keytip: 'DS',
    contextual: { label: 'Herramientas de SmartArt', color: '#0e7c86', visible: c.selected.length === 1 && isLiveSmartArt(c.selected[0]!) },
    groups: [
      { id: 'saText', label: 'Texto', icon: 'smartart', items: [L('slides.smartart.edit', 'ES')] },
      { id: 'saLayout', label: 'Diseño', icon: 'smartart', items: [dd('saLayouts', 'Cambiar diseño', 'smartart', 'CD', LAYOUT_CATALOG.map((l) => `slides.smartart.layout.${l.id.split('/').pop()}`))] },
      {
        id: 'saStyle',
        label: 'Estilos de SmartArt',
        icon: 'palette',
        items: [
          dd('saColors', 'Cambiar colores', 'palette', 'CC', COLORS_CATALOG.map((k) => `slides.smartart.colors.${k.id.split('/').pop()}`)),
          dd('saStyles', 'Estilos rápidos', 'smartart', 'ER', STYLE_CATALOG.map((k) => `slides.smartart.style.${k.id.split('/').pop()}`)),
        ],
      },
      { id: 'saReset', label: 'Restablecer', icon: 'smartart', items: [S('slides.smartart.reflow', 'AJ2')] },
    ],
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

  const developer: RibbonTab = {
    id: 'developer',
    label: 'Programador',
    keytip: 'PR',
    groups: [
      { id: 'code', label: 'Código', icon: 'code', items: [L('slides.macroEditor', 'ED'), L('slides.macros', 'MA'), S('slides.macroEnable', 'HC'), S('slides.macroSecurity', 'SE')] },
    ],
  };
  return [home, insert, design, transitions, animations, show, review, viewExtra, developer, format, tableDesign, tableLayout, picFormat, chartTools, smartTools, masterTab, helpTab()];
}

export { Icon };
