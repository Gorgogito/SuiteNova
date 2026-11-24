import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { FONT_SCHEMES, SCHEME_SLOTS, type DocTheme, type NamedColors, type NamedFonts, type SchemeSlot, type ThemeColors } from '@suitenova/theme-core';
import { useEffect, useState, type ReactNode } from 'react';
import { addCustomColors, addCustomFonts, addCustomTheme } from './host';
import './messages';

function Frame({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  // Fluent leaves aria-hidden on the page when the parent unmounts an open dialog: it is given back once none is left
  useEffect(
    () => () => {
      setTimeout(() => {
        if (document.querySelector('[role=dialog]')) return;
        for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
        document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
      }, 0);
    },
    [],
  );
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** The names Office gives to the 12 colours of a scheme. */
export const SLOT_LABEL: Record<SchemeSlot, string> = {
  dk1: 'Texto/fondo: oscuro 1',
  lt1: 'Texto/fondo: claro 1',
  dk2: 'Texto/fondo: oscuro 2',
  lt2: 'Texto/fondo: claro 2',
  accent1: 'Énfasis 1',
  accent2: 'Énfasis 2',
  accent3: 'Énfasis 3',
  accent4: 'Énfasis 4',
  accent5: 'Énfasis 5',
  accent6: 'Énfasis 6',
  hlink: 'Hipervínculo',
  folHlink: 'Hipervínculo visitado',
};

const FALLBACK: NamedColors['colors'] = Object.fromEntries(SCHEME_SLOTS.map((s) => [s, '#000000'])) as ThemeColors;

/** «Customize Colors»: the 12 colours of the scheme and a name; saving keeps them in the list and applies them. */
export function CustomColorsDialog({ start, onClose, onApply }: { start?: NamedColors; onClose: () => void; onApply: (c: NamedColors) => void }) {
  const [colors, setColors] = useState<ThemeColors>({ ...FALLBACK, ...(start?.colors ?? {}) });
  const [name, setName] = useState(t('Personalizado'));
  const save = () => {
    const item = { name: name.trim() || t('Personalizado'), colors };
    addCustomColors(item);
    onApply(item);
    onClose();
  };
  return (
    <Frame
      title={t('Personalizar colores del tema')}
      onClose={onClose}
      actions={
        <>
          <Button appearance="primary" onClick={save}>
            {t('Guardar')}
          </Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
        </>
      }
    >
      <div className="nv-theme-form">
        {SCHEME_SLOTS.map((s) => (
          <label key={s}>
            <span>{t(SLOT_LABEL[s])}</span>
            <input type="color" aria-label={t(SLOT_LABEL[s])} value={colors[s]} onChange={(e) => setColors({ ...colors, [s]: e.target.value })} />
          </label>
        ))}
        <label className="nv-theme-form__name">
          <span>{t('Nombre')}</span>
          <input type="text" aria-label={t('Nombre')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
    </Frame>
  );
}

const FONT_NAMES = [...new Set(FONT_SCHEMES.flatMap((s) => [s.fonts.major.latin, s.fonts.minor.latin]))].sort();

/** «Customize Fonts»: the heading and body fonts and a name. */
export function CustomFontsDialog({ start, onClose, onApply }: { start?: NamedFonts; onClose: () => void; onApply: (f: NamedFonts) => void }) {
  const [major, setMajor] = useState(start?.fonts.major.latin ?? 'Calibri Light');
  const [minor, setMinor] = useState(start?.fonts.minor.latin ?? 'Calibri');
  const [name, setName] = useState(t('Personalizado'));
  const save = () => {
    const item: NamedFonts = { name: name.trim() || t('Personalizado'), fonts: { major: { ...start?.fonts.major, latin: major.trim() || 'Calibri' }, minor: { ...start?.fonts.minor, latin: minor.trim() || 'Calibri' } } };
    addCustomFonts(item);
    onApply(item);
    onClose();
  };
  return (
    <Frame
      title={t('Personalizar fuentes del tema')}
      onClose={onClose}
      actions={
        <>
          <Button appearance="primary" onClick={save}>
            {t('Guardar')}
          </Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
        </>
      }
    >
      <datalist id="nv-theme-fontlist">
        {FONT_NAMES.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <div className="nv-theme-form">
        <label>
          <span>{t('Fuente de los títulos')}</span>
          <input type="text" list="nv-theme-fontlist" aria-label={t('Fuente de los títulos')} value={major} onChange={(e) => setMajor(e.target.value)} />
        </label>
        <label>
          <span>{t('Fuente del cuerpo')}</span>
          <input type="text" list="nv-theme-fontlist" aria-label={t('Fuente del cuerpo')} value={minor} onChange={(e) => setMinor(e.target.value)} />
        </label>
        <p className="nv-theme-sample" style={{ fontFamily: minor }}>
          <b style={{ fontFamily: major }}>{t('Título de ejemplo')}</b>
          <br />
          {t('Texto de ejemplo del cuerpo')}
        </p>
        <label className="nv-theme-form__name">
          <span>{t('Nombre')}</span>
          <input type="text" aria-label={t('Nombre')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
    </Frame>
  );
}

/** «Save current theme»: in the list of the program, and as a `.thmx` file if the person wants. */
export function SaveThemeDialog({ theme, onClose, onFile }: { theme: DocTheme; onClose: () => void; onFile: (t: DocTheme) => Promise<void> }) {
  const [name, setName] = useState(theme.name);
  const named = (): DocTheme => ({ ...theme, name: name.trim() || t('Personalizado') });
  return (
    <Frame
      title={t('Guardar tema actual')}
      onClose={onClose}
      actions={
        <>
          <Button
            appearance="primary"
            onClick={() => {
              addCustomTheme(named());
              onClose();
            }}
          >
            {t('Guardar en la galería')}
          </Button>
          <Button
            onClick={() => {
              void onFile(named()).then(onClose);
            }}
          >
            {t('Guardar como archivo…')}
          </Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
        </>
      }
    >
      <div className="nv-theme-form">
        <label className="nv-theme-form__name">
          <span>{t('Nombre')}</span>
          <input type="text" aria-label={t('Nombre')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
    </Frame>
  );
}
