import { AppFrame, CommandRegistry, clampZoom, registerMessages, t, type RibbonTab } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { helpTab, viewTab, zoomCommands } from '../common';
import { backstageEntries, fileCommands } from '../options';

registerMessages('es', {
  'pg.bold': 'Negrita',
  'pg.italic': 'Cursiva',
  'pg.underline': 'Subrayado',
  'pg.undo': 'Deshacer',
  'pg.redo': 'Rehacer',
  'pg.copy': 'Copiar',
  'pg.cut': 'Cortar',
  'pg.contextual': 'Mostrar pestaña contextual',
  'pg.ctxTab': 'Formato',
  'pg.ctxTitle': 'Herramientas de ejemplo',
  'pg.format': 'Fuente',
  'pg.clipboard': 'Portapapeles',
  'pg.edit': 'Edición',
  'pg.dev': 'Banco de pruebas',
  'pg.hint': 'Banco de pruebas de la cinta (solo desarrollo). Escribe aquí y usa los comandos; prueba Alt, Ctrl+F1 y reduce el ancho de la ventana.',
});
registerMessages('en', {
  'pg.bold': 'Bold',
  'pg.italic': 'Italic',
  'pg.underline': 'Underline',
  'pg.undo': 'Undo',
  'pg.redo': 'Redo',
  'pg.copy': 'Copy',
  'pg.cut': 'Cut',
  'pg.contextual': 'Show contextual tab',
  'pg.ctxTab': 'Format',
  'pg.ctxTitle': 'Sample tools',
  'pg.format': 'Font',
  'pg.clipboard': 'Clipboard',
  'pg.edit': 'Editing',
  'pg.dev': 'Test bench',
  'pg.hint': 'Ribbon test bench (development only). Type here and use the commands; try Alt, Ctrl+F1 and narrowing the window.',
});

const exec = (cmd: string) => document.execCommand(cmd);
const queryState = (cmd: string) => {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
};

/** Developer-only page that exercises every ribbon control type with real commands. */
export function Playground() {
  const registry = useMemo(() => new CommandRegistry(), []);
  const [zoom, setZoom] = useState(100);
  const [ctx, setCtx] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    fileCommands(registry);
    const offs = [
      registry.registerAll(zoomCommands(() => zoomRef.current, setZoom, clampZoom)),
      registry.registerAll([
        { id: 'pg.bold', label: 'pg.bold', icon: 'bold', shortcut: 'Ctrl+B', run: () => exec('bold'), checked: () => queryState('bold') },
        { id: 'pg.italic', label: 'pg.italic', icon: 'italic', shortcut: 'Ctrl+I', run: () => exec('italic'), checked: () => queryState('italic') },
        { id: 'pg.underline', label: 'pg.underline', icon: 'underline', shortcut: 'Ctrl+U', run: () => exec('underline'), checked: () => queryState('underline') },
        { id: 'pg.undo', label: 'pg.undo', icon: 'undo', run: () => exec('undo') },
        { id: 'pg.redo', label: 'pg.redo', icon: 'redo', run: () => exec('redo') },
        { id: 'pg.copy', label: 'pg.copy', icon: 'copy', run: () => exec('copy') },
        { id: 'pg.cut', label: 'pg.cut', icon: 'cut', run: () => exec('cut') },
        { id: 'pg.contextual', label: 'pg.contextual', icon: 'table', run: () => setCtx((v) => !v), checked: () => ctxRef.current },
      ]),
    ];
    const onSelection = () => registry.invalidate();
    document.addEventListener('selectionchange', onSelection);
    return () => {
      offs.forEach((o) => o());
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [registry]);

  useEffect(() => registry.invalidate(), [registry, zoom, ctx]);

  const tabs: RibbonTab[] = useMemo(
    () => [
      {
        id: 'home',
        label: 'tab.home',
        keytip: 'I',
        groups: [
          {
            id: 'clipboard',
            label: 'pg.clipboard',
            icon: 'paste',
            items: [
              { kind: 'button', command: 'pg.cut' },
              { kind: 'button', command: 'pg.copy' },
            ],
          },
          {
            id: 'font',
            label: 'pg.format',
            icon: 'bold',
            items: [
              { kind: 'button', command: 'pg.bold', iconOnly: true },
              { kind: 'button', command: 'pg.italic', iconOnly: true },
              { kind: 'button', command: 'pg.underline', iconOnly: true },
            ],
          },
          {
            id: 'edit',
            label: 'pg.edit',
            icon: 'undo',
            items: [
              {
                kind: 'dropdown',
                id: 'undoSplit',
                label: 'pg.undo',
                icon: 'undo',
                size: 'large',
                primaryCommand: 'pg.undo',
                entries: [
                  { kind: 'header', label: 'pg.edit' },
                  { kind: 'command', command: 'pg.undo' },
                  { kind: 'command', command: 'pg.redo' },
                ],
              },
              { kind: 'button', command: 'pg.contextual', size: 'large' },
            ],
          },
        ],
      },
      {
        id: 'ctx',
        label: 'pg.ctxTab',
        keytip: 'J',
        contextual: { label: 'pg.ctxTitle', color: '#c05621', visible: ctx },
        groups: [
          {
            id: 'ctxgroup',
            label: 'pg.format',
            icon: 'bold',
            items: [{ kind: 'button', command: 'pg.bold', size: 'large' }],
          },
        ],
      },
      viewTab(),
      helpTab(),
    ],
    [ctx],
  );

  return (
    <AppFrame
      appId="forms"
      appName={`SuiteNova – ${t('pg.dev')}`}
      registry={registry}
      tabs={tabs}
      qat={['pg.undo', 'pg.redo']}
      backstage={backstageEntries(t('pg.dev'))}
      zoom={{ value: zoom, onChange: setZoom }}
    >
      <div className="shell-content" style={{ zoom: zoom / 100 }}>
        <div className="banner">{t('pg.hint')}</div>
        <div className="editable" contentEditable suppressContentEditableWarning spellCheck={false}>
          SuiteNova
        </div>
      </div>
    </AppFrame>
  );
}
