import { t, useCommandState, useCore, type BackstageEntry, type CommandRegistry } from '@suitenova/core-ui';
import { closeThisWindow } from './platform';
import './messages';

function RadioCommand({ id }: { id: string }) {
  const { def, checked } = useCommandState(id);
  const { registry } = useCore();
  if (!def) return null;
  return (
    <label className="opt-radio">
      <input type="radio" checked={checked} onChange={() => registry.run(id)} /> {t(def.label)}
    </label>
  );
}

function OptionsPage() {
  return (
    <div className="page">
      <h1>{t('backstage.options')}</h1>
      <h2>{t('options.theme')}</h2>
      {['theme.system', 'theme.light', 'theme.dark', 'theme.contrast'].map((id) => (
        <RadioCommand key={id} id={id} />
      ))}
      <h2>{t('options.language')}</h2>
      {['lang.es', 'lang.en'].map((id) => (
        <RadioCommand key={id} id={id} />
      ))}
    </div>
  );
}

function InfoPage({ title }: { title: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p>{t('about.version', { version: '0.0.11' })}</p>
      <p>{t('about.license')}</p>
    </div>
  );
}

export function fileCommands(registry: CommandRegistry): void {
  registry.register({ id: 'file.close', label: 'cmd.file.close', icon: 'close', run: () => void closeThisWindow() });
}

export function backstageEntries(title: string): BackstageEntry[] {
  return [
    { kind: 'page', id: 'info', label: 'backstage.info', icon: 'info', render: () => <InfoPage title={title} /> },
    { kind: 'page', id: 'options', label: 'backstage.options', icon: 'settings', render: () => <OptionsPage /> },
    { kind: 'separator' },
    { kind: 'command', command: 'file.close' },
  ];
}
