import { Field, Select } from '@fluentui/react-components';
import { normalizeThemePreference, SETTING_THEME, t, THEME_PREFERENCES, useCommandState, useCore, useSetting, useThemeMode, type BackstageEntry, type CommandRegistry } from '@suitenova/core-ui';
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
  const mode = useThemeMode();
  return (
    <div className="page">
      <h1>{t('backstage.options')}</h1>
      <h2>{t('options.theme')}</h2>
      {THEME_PREFERENCES.map((p) => (
        <RadioCommand key={p} id={`theme.${p}`} />
      ))}
      {mode === 'contrast' && <p role="note">{t('theme.contrastActive')}</p>}
      <h2>{t('options.language')}</h2>
      {['lang.es', 'lang.en'].map((id) => (
        <RadioCommand key={id} id={id} />
      ))}
    </div>
  );
}

/** Where Office keeps its theme: File › Account. SuiteNova has no accounts, so the page says so. */
function AccountPage() {
  const mode = useThemeMode();
  const { registry } = useCore();
  const [saved] = useSetting<string>(SETTING_THEME, 'system');
  return (
    <div className="page">
      <h1>{t('backstage.account')}</h1>
      <p>{t('account.none')}</p>
      <Field label={t('account.theme')} className="opt-theme">
        <Select value={normalizeThemePreference(saved)} onChange={(_, d) => registry.run(`theme.${d.value}`)}>
          {THEME_PREFERENCES.map((p) => (
            <option key={p} value={p}>
              {t(`cmd.theme.${p}`)}
            </option>
          ))}
        </Select>
      </Field>
      {mode === 'contrast' && <p role="note">{t('theme.contrastActive')}</p>}
    </div>
  );
}

function InfoPage({ title }: { title: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p>{t('about.version', { version: '0.0.13' })}</p>
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
    { kind: 'page', id: 'account', label: 'backstage.account', icon: 'account', render: () => <AccountPage /> },
    { kind: 'page', id: 'options', label: 'backstage.options', icon: 'settings', render: () => <OptionsPage /> },
    { kind: 'separator' },
    { kind: 'command', command: 'file.close' },
  ];
}
