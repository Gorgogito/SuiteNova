import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { exportHtml, parseProject, responsesToCsv, serializeProject } from '@suitenova/forms-core';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { addRecent } from '../recents';
import { formsCommands, type FormsDialog, type FormsUI } from './commands';
import { FormsCtl } from './ctl';
import { Designer } from './Designer';
import { IMPORT_FILTERS, isImportName, readForeignForm } from './import';
import './icons';
import './messages';
import { formsTabs } from './ribbonDef';
import { Results } from './Results';
import { Runner } from './Runner';
import './forms.css';

const FM_FILTERS = [{ name: 'Formulario de Nova Forms', extensions: ['novaforms'] }];
const RESP_FILTERS = [{ name: 'Respuestas', extensions: ['json', 'novaforms'] }];
const AUTOSAVE_MS = 1500;
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Formulario';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N / O / S', 'Nuevo / Abrir / Guardar'],
  ['Ctrl+Z / Y', 'Deshacer / Rehacer'],
  ['Ctrl+D', 'Duplicar la pregunta seleccionada'],
  ['Alt+Mayús+↑ / ↓', 'Mover la pregunta'],
  ['Alt', 'Atajos de la cinta (KeyTips)'],
];

export function FormsApp({ module }: { module: ModuleInfo }) {
  const registry = useMemo(() => new CommandRegistry(), []);
  const ctl = useMemo(() => new FormsCtl(), []);
  const [dialog, setDialog] = useState<FormsDialog | null>(null);
  const [saveState, setSaveState] = useState('');
  useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      try {
        const data = new TextEncoder().encode(serializeProject(ctl.doc));
        const base = (ctl.fileName ?? ctl.form.title).replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath?.toLowerCase().endsWith('.novaforms') ? ctl.filePath : null;
        const saved = await saveBytes(`${safeName(base)}.novaforms`, data, FM_FILTERS, keep);
        if (saved) {
          ctl.markSaved(saved.name, saved.path);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'forms' });
          setSaveState(t('Guardado'));
        }
      } catch (e) {
        if (!silent) window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        else setSaveState(t('No se pudo guardar automáticamente'));
      }
    },
    [ctl],
  );

  useEffect(() => {
    if (!isTauri() || !ctl.filePath || !ctl.dirty) return;
    const id = setTimeout(() => void saveNow(false, true), AUTOSAVE_MS);
    return () => clearTimeout(id);
  });

  const loadFile = useCallback(
    async (file: { name: string; path: string | null; data: Uint8Array }) => {
      try {
        if (isImportName(file.name)) {
          const r = await readForeignForm(file.name, file.data);
          ctl.loadImported({ form: r.form, responses: r.responses });
          setSaveState('');
          const n = r.form.questions.filter((q) => q.type !== 'title').length;
          window.alert(t('Se importó «{name}»: {n} preguntas y {m} respuestas. Revisa el formulario y guárdalo como .novaforms.', { name: file.name, n, m: r.responses.length }) + (r.warnings.length ? '\n\n' + r.warnings.join('\n') : ''));
          return;
        }
        const r = parseProject(new TextDecoder('utf-8').decode(file.data));
        ctl.load(r.project, file.name, file.path);
        addRecent({ path: file.path, name: file.name, app: 'forms' });
        if (r.warnings.length) window.alert(t('El formulario se abrió, pero:') + '\n\n' + r.warnings.join('\n'));
      } catch (e) {
        window.alert(t('No se pudo abrir "{name}": {error}', { name: file.name, error: (e as Error).message }));
      }
    },
    [ctl],
  );

  const ui: FormsUI = useMemo(
    () => ({
      ctl,
      openDialog: (k) => setDialog(k),
      newWindow: () => void openModuleWindow('forms', module.name),
      open: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead([...FM_FILTERS, ...IMPORT_FILTERS]).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      importForm: async () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        const f = await pickAndRead(IMPORT_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (saveAs) => saveNow(saveAs),
      exportHtml: async () => {
        if (!ctl.form.questions.some((q) => q.type !== 'title')) {
          window.alert(t('Añade al menos una pregunta antes de exportar.'));
          return;
        }
        await saveBytes(`${safeName(ctl.form.title)}.html`, new TextEncoder().encode(exportHtml(ctl.form)), [{ name: 'Página web', extensions: ['html'] }]);
      },
      exportCsv: async () => {
        await saveBytes(`${safeName(ctl.form.title)}-respuestas.csv`, new TextEncoder().encode(responsesToCsv(ctl.form, ctl.responses)), [{ name: 'CSV', extensions: ['csv'] }]);
      },
      importResponses: async () => {
        const f = await pickAndRead(RESP_FILTERS).catch(() => null);
        if (!f) return;
        try {
          const r = ctl.importResponses(new TextDecoder('utf-8').decode(f.data));
          ctl.setMode('results');
          ctl.say(r.added ? t('{n} respuestas añadidas', { n: r.added }) : '');
          if (r.warnings.length || !r.added) window.alert((r.added ? t('{n} respuestas añadidas', { n: r.added }) : t('No se añadió ninguna respuesta.')) + (r.warnings.length ? '\n\n' + r.warnings.join('\n') : ''));
        } catch (e) {
          window.alert(t('No se pudo importar "{name}": {error}', { name: f.name, error: (e as Error).message }));
        }
      },
      close: () => {
        if (ctl.dirty && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) return;
        void closeThisWindow();
      },
    }),
    [ctl, loadFile, saveNow, module.name],
  );

  useEffect(() => {
    const offs = [registry.registerAll(coreCommands), registry.registerAll(formsCommands(ui))];
    fileCommands(registry);
    const unsub = ctl.subscribe(() => registry.invalidate());
    return () => {
      offs.forEach((o) => o());
      unsub();
    };
  }, [registry, ui, ctl]);

  useEffect(() => {
    const path = new URLSearchParams(location.search).get('open');
    if (!path || !isTauri()) return;
    readPath(path).then(loadFile, (e) => window.alert(t('No se pudo abrir "{name}": {error}', { name: path, error: String(e) })));
  }, [loadFile]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __novaForms: unknown }).__novaForms = { ctl, load: (text: string, name: string) => loadFile({ name, path: null, data: new TextEncoder().encode(text) }) };
  }, [ctl, loadFile]);

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (ctl.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        unlisten = await getCurrentWindow().onCloseRequested((e) => {
          if (ctl.dirty && !ctl.filePath && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, [ctl]);

  const tabs = useMemo(() => formsTabs(ui), [ui]);
  const backstage: BackstageEntry[] = useMemo(() => {
    const pages = backstageEntries(module.name).filter((e) => e.kind === 'page');
    return [
      { kind: 'command', command: 'forms.new' },
      { kind: 'command', command: 'forms.open' },
      { kind: 'command', command: 'forms.import' },
      { kind: 'separator' },
      { kind: 'command', command: 'forms.save' },
      { kind: 'command', command: 'forms.saveAs' },
      { kind: 'command', command: 'forms.export.html' },
      { kind: 'command', command: 'forms.responses.import' },
      { kind: 'command', command: 'forms.export.csv' },
      { kind: 'separator' },
      ...pages,
      { kind: 'command', command: 'forms.about' },
      { kind: 'command', command: 'file.close' },
    ] as BackstageEntry[];
  }, [module.name]);

  const close = () => setDialog(null);
  const nq = ctl.form.questions.filter((q) => q.type !== 'title').length;

  return (
    <AppFrame
      appId={module.id}
      appName={module.name}
      registry={registry}
      tabs={tabs}
      qat={['forms.save', 'forms.undo', 'forms.redo']}
      docTitle={ctl.docTitle}
      backstage={backstage}
      statusLeft={
        <>
          <span>{nq === 1 ? t('1 pregunta') : t('{n} preguntas', { n: nq })}</span>
          <span>{ctl.responses.length === 1 ? t('1 respuesta') : t('{n} respuestas', { n: ctl.responses.length })}</span>
          {ctl.form.quiz && <span>{t('Cuestionario')}</span>}
          {ctl.message && <span role="status">{ctl.message}</span>}
          {saveState && <span aria-live="polite">{saveState}</span>}
        </>
      }
      contentFill
    >
      <div className="fm-app" style={{ ['--fm-color' as string]: ctl.form.color }}>
        <div className="fm-scroll">
          <div className="fm-page">
            {ctl.mode === 'design' && <Designer ctl={ctl} />}
            {ctl.mode === 'preview' && <Runner key={`p-${JSON.stringify(ctl.form).length}-${ctl.form.questions.length}`} form={ctl.form} onSubmit={null} />}
            {ctl.mode === 'fill' && <Runner key="fill" form={ctl.form} onSubmit={(a) => { ctl.addResponse(a); }} />}
            {ctl.mode === 'results' && <Results ctl={ctl} />}
          </div>
        </div>
      </div>
      <Dialog open={dialog === 'about'} modalType="modal" onOpenChange={(_e, d) => !d.open && close()}>
        <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
          <DialogBody>
            <DialogTitle>{t('Acerca de Nova Forms')}</DialogTitle>
            <DialogContent>
              <p>Nova Forms 0.0.7</p>
              <p>{t('Formularios y encuestas libres (MPL-2.0) de SuiteNova. Guarda en .novaforms; no tiene servidor: las respuestas se recogen con la página web exportada y se importan. Consulta docs/LIMITACIONES.md.')}</p>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="primary">{t('Cerrar')}</Button>
              </DialogTrigger>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={dialog === 'shortcuts'} modalType="modal" onOpenChange={(_e, d) => !d.open && close()}>
        <DialogSurface style={{ maxWidth: 560, width: '92vw' }}>
          <DialogBody>
            <DialogTitle>{t('Atajos de teclado')}</DialogTitle>
            <DialogContent>
              <table className="nw-shortcuts">
                <tbody>
                  {SHORTCUTS.map(([k, d]) => (
                    <tr key={k}>
                      <th scope="row">
                        <kbd>{k}</kbd>
                      </th>
                      <td>{t(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="primary">{t('Cerrar')}</Button>
              </DialogTrigger>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </AppFrame>
  );
}
