import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from '@fluentui/react-components';
import { AppFrame, CommandRegistry, coreCommands, t, useLocale, type BackstageEntry } from '@suitenova/core-ui';
import { exportHtml, parseProject, responsesToCsv, serializeProject, isInput, availability, pageBackground } from '@suitenova/forms-core';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useRef } from 'react';
import { pickAndRead, readPath, saveBytes } from '../fileio';
import type { ModuleInfo } from '../modules';
import { backstageEntries, fileCommands } from '../options';
import { useCloseGuard } from '../close-guard';
import { closeThisWindow, isTauri, openModuleWindow } from '../platform';
import { addRecent } from '../recents';
import { formsCommands, type FormsDialog, type FormsUI } from './commands';
import { FormsCtl } from './ctl';
import { Designer } from './Designer';
import { finishTyping } from './DraftInput';
import { SettingsBody } from './SettingsDialog';
import { Collector, collectBridge, setCollectBridge } from './collect';
import { CollectBody } from './CollectDialog';
import { InboxBanner } from './InboxBanner';
import { showNotice, systemNotices } from '../mail/notify';
import { StickyDialog } from '../mail/StickyDialog';
import { VERSION } from '../version';
import { IMPORT_FILTERS, isImportName, readForeignForm } from './import';
import './icons';
import './messages';
import './messages-image';
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
  const locale = useLocale();
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  useEffect(() => ctl.followLanguage(locale), [ctl, locale]);

  // writing the same file twice at once could break it: one after another
  const writing = useRef<Promise<unknown>>(Promise.resolve());
  const inTurn = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const done = writing.current.then(work);
    writing.current = done.catch(() => undefined);
    return done;
  }, []);

  const saveNow = useCallback(
    async (saveAs: boolean, silent = false) => {
      // not when saving by itself: the box being typed in is left alone
      if (!silent) finishTyping();
      try {
        const base = (ctl.fileName ?? ctl.form.title).replace(/\.[^.]+$/, '');
        const keep = !saveAs && ctl.filePath?.toLowerCase().endsWith('.novaforms') ? ctl.filePath : null;
        const write = async () => {
          const doc = ctl.doc;
          const saved = await saveBytes(`${safeName(base)}.novaforms`, new TextEncoder().encode(serializeProject(doc)), FM_FILTERS, keep);
          return saved && { ...saved, whole: ctl.doc === doc };
        };
        // with a dialog to choose the file nothing waits for it
        const saved = keep ? await inTurn(write) : await write();
        if (saved) {
          ctl.markSaved(saved.name, saved.path, saved.whole);
          if (!silent) addRecent({ path: saved.path, name: saved.name, app: 'forms' });
          setSaveState(t('Guardado'));
        }
      } catch (e) {
        if (!silent) window.alert(t('No se pudo guardar: {error}', { error: (e as Error).message }));
        else setSaveState(t('No se pudo guardar automáticamente'));
      }
    },
    [ctl, inTurn],
  );

  // a response that arrives is written into the file before whoever sent it is told
  const persist = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return true;
    if (!ctl.filePath?.toLowerCase().endsWith('.novaforms')) return false;
    try {
      await inTurn(async () => {
        const doc = ctl.doc;
        const saved = await saveBytes(ctl.fileName ?? 'formulario.novaforms', new TextEncoder().encode(serializeProject(doc)), FM_FILTERS, ctl.filePath);
        if (saved) {
          ctl.markSaved(saved.name, saved.path, ctl.doc === doc);
          setSaveState(t('Guardado'));
        }
      });
      return true;
    } catch {
      return false;
    }
  }, [ctl, inTurn]);
  const noticed = useRef(0);
  const collector = useMemo(
    () =>
      new Collector(ctl, persist, (count) => {
        ctl.say(t('Ha llegado una respuesta.'));
        // not more than one notice every few seconds, and none while the window is being looked at
        if (!document.hasFocus() && systemNotices() && Date.now() - noticed.current > 5000) {
          noticed.current = Date.now();
          void showNotice({ id: `forms:${ctl.form.id}`, title: ctl.form.title, body: t('Ha llegado una respuesta ({n} desde que se empezó).', { n: count }) }).catch(() => undefined);
        }
      }),
    [ctl, persist],
  );
  useSyncExternalStore(collector.subscribe, collector.getVersion);
  // the page that is served follows the form; another form stops the collecting
  const shownForm = ctl.form;
  useEffect(() => {
    if (!collector.running) return;
    const id = setTimeout(() => void collector.refresh(t('Se dejó de recoger porque se abrió otro formulario.')), 400);
    return () => clearTimeout(id);
  }, [collector, collector.running, shownForm]);
  useEffect(() => () => void collector.stop(), [collector]);
  // after reloading the page nothing is being listened to any more
  useEffect(() => {
    if (isTauri()) void collectBridge()?.stop().catch(() => undefined);
  }, []);
  const leaving = useCallback(() => !collector.running || window.confirm(t('Se están recogiendo respuestas. Si abres otro formulario, se dejará de recoger. ¿Continuar?')), [collector]);

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
          const n = r.form.questions.filter(isInput).length;
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
        finishTyping();
        if ((ctl.dirty || ctl.hasDraft) && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        if (!leaving()) return;
        const f = await pickAndRead([...FM_FILTERS, ...IMPORT_FILTERS]).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      importForm: async () => {
        finishTyping();
        if ((ctl.dirty || ctl.hasDraft) && !window.confirm(t('Hay cambios sin guardar. ¿Abrir otro archivo y descartarlos?'))) return;
        if (!leaving()) return;
        const f = await pickAndRead(IMPORT_FILTERS).catch((e) => {
          window.alert(String(e));
          return null;
        });
        if (f) await loadFile(f);
      },
      save: (saveAs) => saveNow(saveAs),
      exportHtml: async () => {
        finishTyping();
        if (!ctl.form.questions.some(isInput)) {
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
          const added = r.added === 1 ? t('1 respuesta añadida') : t('{n} respuestas añadidas', { n: r.added });
          ctl.setMode('results');
          ctl.say(r.added ? added : '');
          if (r.warnings.length || !r.added) window.alert((r.added ? added : t('No se añadió ninguna respuesta.')) + (r.warnings.length ? '\n\n' + r.warnings.join('\n') : ''));
        } catch (e) {
          window.alert(t('No se pudo importar "{name}": {error}', { name: f.name, error: (e as Error).message }));
        }
      },
      // the close guard asks about unsaved changes, here and from the title bar
      close: () => void closeThisWindow(),
    }),
    [ctl, loadFile, saveNow, leaving, module.name],
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
    (window as unknown as { __novaForms: unknown }).__novaForms = { ctl, collector, setCollectBridge, load: (text: string, name: string) => loadFile({ name, path: null, data: new TextEncoder().encode(text) }) };
  }, [ctl, collector, loadFile]);

  useCloseGuard(
    () => {
      finishTyping();
      return ctl.dirty || ctl.hasDraft;
    },
    () => (collector.running ? t('Se están recogiendo respuestas. Si cierras, la dirección dejará de funcionar. ¿Cerrar?') : null),
  );

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
  // the background of the form is seen where it is answered
  const answering = ctl.mode === 'preview' || ctl.mode === 'fill';
  const background = answering ? pageBackground(ctl.form, 'var(--nv-canvas-bg)') : null;
  const nq = ctl.form.questions.filter(isInput).length;

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
          {availability(ctl.form, Date.now()) !== 'open' && <span>{t('No admite respuestas')}</span>}
          {collector.running && (
            <button type="button" className="fm-collecting" onClick={() => setDialog('collect')}>
              ● {t('Recogiendo respuestas ({n})', { n: collector.received })}
            </button>
          )}
          {ctl.message && <span role="status">{ctl.message}</span>}
          {/* «Guardado» stops being true with the next change */}
          {saveState && !(ctl.dirty && saveState === t('Guardado')) && <span aria-live="polite">{saveState}</span>}
        </>
      }
      contentFill
    >
      <div className={`fm-app${background ? ' has-bg' : ''}`} style={{ ['--fm-color' as string]: ctl.form.color, ...(background ? { background } : {}) }}>
        <div className="fm-scroll">
          <div className="fm-page">
            <InboxBanner ctl={ctl} />
            {ctl.mode === 'design' && <Designer ctl={ctl} />}
            {ctl.mode === 'preview' && (
              <>
                <div className="fm-devices" role="group" aria-label={t('Ver como en')}>
                  {(['desktop', 'phone'] as const).map((d) => (
                    <button key={d} type="button" aria-pressed={ctl.device === d} onClick={() => ctl.setDevice(d)}>
                      {d === 'desktop' ? t('Ordenador') : t('Móvil')}
                    </button>
                  ))}
                </div>
                <div className={ctl.device === 'phone' ? 'fm-phone' : undefined}>
                  <Runner key={`p-${JSON.stringify(ctl.form).length}-${ctl.form.questions.length}`} form={ctl.form} onSubmit={null} />
                </div>
              </>
            )}
            {ctl.mode === 'fill' && <Runner key="fill" form={ctl.form} seed={ctl.seed} draft={{ answers: ctl.draft, keep: (change) => ctl.setDraft(change(ctl.draft)), page: ctl.draftPage, keepPage: (page) => ctl.setDraftPage(page), name: ctl.draftName, keepName: (name) => ctl.setDraftName(name), started: ctl.draftStarted, keepStarted: (at) => ctl.setDraftStarted(at) }} onSubmit={(a, name) => { ctl.addResponse(a, name); }} />}
            {ctl.mode === 'results' && <Results ctl={ctl} />}
          </div>
        </div>
      </div>
      <StickyDialog open={dialog === 'settings'} onClose={close} width={640}>
        {dialog === 'settings' && <SettingsBody ctl={ctl} onClose={close} />}
      </StickyDialog>
      <StickyDialog open={dialog === 'collect'} onClose={close} width={620}>
        {dialog === 'collect' && <CollectBody ctl={ctl} collector={collector} needsFile={isTauri()} onSave={() => void saveNow(false)} onClose={close} />}
      </StickyDialog>
      <Dialog open={dialog === 'about'} modalType="modal" onOpenChange={(_e, d) => !d.open && close()}>
        <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
          <DialogBody>
            <DialogTitle>{t('Acerca de Nova Forms')}</DialogTitle>
            <DialogContent>
              <p>Nova Forms {VERSION}</p>
              <p>{t('Formularios y encuestas libres (MPL-2.0) de SuiteNova. Guarda en .novaforms. No hay servicio en internet: las respuestas se recogen en tu red local o con la página web exportada. Consulta docs/LIMITACIONES.md.')}</p>
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
