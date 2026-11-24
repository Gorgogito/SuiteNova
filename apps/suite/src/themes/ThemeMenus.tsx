import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { COLOR_SCHEMES, EFFECT_SCHEMES, FONT_SCHEMES, readThmx, sameColors, sameFonts, themeCatalog, withColors, withEffects, withFonts, writeThmx, type DocTheme, type NamedColors, type NamedFonts } from '@suitenova/theme-core';
import { ChevronDown, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { pickAndRead, saveBytes } from '../fileio';
import { CustomColorsDialog, CustomFontsDialog, SaveThemeDialog } from './ThemeDialogs';
import { deleteCustom, useCustomThemes, type ThemeHost } from './host';
import './messages';
import './themes.css';

const SWATCH_SLOTS = ['dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;
const THMX = [{ name: 'Tema de Office', extensions: ['thmx'] }];

function Swatches({ colors }: { colors: DocTheme['colors'] }) {
  return (
    <span className="nv-theme-sw" aria-hidden="true">
      {SWATCH_SLOTS.map((k) => (
        <i key={k} style={{ background: colors[k] }} />
      ))}
    </span>
  );
}

/** The button that opens a menu of the theme controls; `children` receives what closes it. */
function Menu({ label, icon, size, iconOnly, host, children }: { label: string; icon: string; size: 'large' | 'small'; iconOnly?: boolean; host: ThemeHost; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  host.useRefresh();
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className={`nv-btn nv-btn--${size}`} aria-haspopup="dialog" aria-label={t(label)} title={t(label)} disabled={!host.enabled()}>
          <Icon name={icon} />
          <span className="nv-btn__label">
            {!iconOnly && t(label)} <ChevronDown size={11} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverSurface>
        <div className="nv-theme-pop" role="menu" aria-label={t(label)}>
          {children(() => setOpen(false))}
        </div>
      </PopoverSurface>
    </Popover>
  );
}

interface Props {
  host: ThemeHost;
  size?: 'large' | 'small';
  iconOnly?: boolean;
}

/** One row of a list of schemes: its swatch, its name, the mark of the current one and (for the ones the person saved) a button to delete it. */
function Row({ on, label, children, onPick, onDelete }: { on: boolean; label: string; children: ReactNode; onPick: () => void; onDelete?: () => void }) {
  return (
    <div className="nv-theme-row">
      <button type="button" role="menuitemradio" aria-checked={on} className={on ? 'is-on' : ''} onClick={onPick}>
        {children}
        <span>{label}</span>
      </button>
      {onDelete && (
        <button type="button" className="nv-theme-del" aria-label={`${t('Eliminar')} ${label}`} title={t('Eliminar')} onClick={onDelete}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ colours

export function ThemeColorsMenu({ host, size = 'small', iconOnly }: Props) {
  const custom = useCustomThemes();
  const [dlg, setDlg] = useState<{ from?: NamedColors } | null>(null);
  const cur = host.theme();
  const set = (name: string, colors: NamedColors['colors']) => cur && host.apply('colors', withColors(cur, colors, name));
  return (
    <>
      <Menu label="Colores" icon="palette" size={size} iconOnly={iconOnly} host={host}>
        {(close) => (
          <>
            {custom.colors.length > 0 && <h4>{t('Personalizado')}</h4>}
            {custom.colors.map((c) => (
              <Row key={c.name} on={!!cur && sameColors(cur.colors, c.colors)} label={c.name} onPick={() => (set(c.name, c.colors), close())} onDelete={() => deleteCustom('colors', c.name)}>
                <Swatches colors={c.colors} />
              </Row>
            ))}
            <h4>{t('Office')}</h4>
            {COLOR_SCHEMES.map((s) => (
              <Row key={s.id} on={!!cur && sameColors(cur.colors, s.colors)} label={t(s.name)} onPick={() => (set(s.name, s.colors), close())}>
                <Swatches colors={s.colors} />
              </Row>
            ))}
            <hr />
            <button type="button" role="menuitem" className="nv-theme-act" onClick={() => (close(), setDlg({ from: cur ? { name: cur.colorsName, colors: cur.colors } : undefined }))}>
              {t('Personalizar colores…')}
            </button>
            <button type="button" role="menuitem" className="nv-theme-act" onClick={() => (host.apply('colors', withColors(cur ?? host.original(), host.original().colors, host.original().colorsName)), close())}>
              {t('Restablecer los colores del tema')}
            </button>
          </>
        )}
      </Menu>
      {dlg && <CustomColorsDialog start={dlg.from} onClose={() => setDlg(null)} onApply={(c) => set(c.name, c.colors)} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ fonts

export function ThemeFontsMenu({ host, size = 'small', iconOnly }: Props) {
  const custom = useCustomThemes();
  const [dlg, setDlg] = useState<{ from?: NamedFonts } | null>(null);
  const cur = host.theme();
  const set = (name: string, fonts: NamedFonts['fonts']) => cur && host.apply('fonts', withFonts(cur, fonts, name));
  const Sample = ({ f }: { f: NamedFonts['fonts'] }) => (
    <span className="nv-theme-fonts">
      <b style={{ fontFamily: f.major.latin }}>{f.major.latin}</b>
      <span style={{ fontFamily: f.minor.latin }}>{f.minor.latin}</span>
    </span>
  );
  return (
    <>
      <Menu label="Fuentes" icon="type" size={size} iconOnly={iconOnly} host={host}>
        {(close) => (
          <>
            {custom.fonts.length > 0 && <h4>{t('Personalizado')}</h4>}
            {custom.fonts.map((f) => (
              <Row key={f.name} on={!!cur && sameFonts(cur.fonts, f.fonts)} label={f.name} onPick={() => (set(f.name, f.fonts), close())} onDelete={() => deleteCustom('fonts', f.name)}>
                <Sample f={f.fonts} />
              </Row>
            ))}
            <h4>{t('Office')}</h4>
            {FONT_SCHEMES.map((s) => (
              <Row key={s.id} on={!!cur && sameFonts(cur.fonts, s.fonts)} label={t(s.name)} onPick={() => (set(s.name, s.fonts), close())}>
                <Sample f={s.fonts} />
              </Row>
            ))}
            <hr />
            <button type="button" role="menuitem" className="nv-theme-act" onClick={() => (close(), setDlg({ from: cur ? { name: cur.fontsName, fonts: cur.fonts } : undefined }))}>
              {t('Personalizar fuentes…')}
            </button>
            <button type="button" role="menuitem" className="nv-theme-act" onClick={() => (host.apply('fonts', withFonts(cur ?? host.original(), host.original().fonts, host.original().fontsName)), close())}>
              {t('Restablecer las fuentes del tema')}
            </button>
          </>
        )}
      </Menu>
      {dlg && <CustomFontsDialog start={dlg.from} onClose={() => setDlg(null)} onApply={(f) => set(f.name, f.fonts)} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ effects

export function ThemeEffectsMenu({ host, size = 'small', iconOnly }: Props) {
  const cur = host.theme();
  const curId = host.effectsId ? host.effectsId() : EFFECT_SCHEMES.find((e) => e.name === cur?.effectsName)?.id;
  return (
    <Menu label="Efectos" icon="sparkles" size={size} iconOnly={iconOnly} host={host}>
      {(close) => (
        <>
          {EFFECT_SCHEMES.map((e) => (
            <Row key={e.id} on={curId === e.id} label={t(e.name)} onPick={() => (cur && host.apply('effects', withEffects(cur, e.fmtXml, e.name)), close())}>
              <span className="nv-theme-fx" aria-hidden="true" data-fx={e.id} />
            </Row>
          ))}
          <hr />
          <button type="button" role="menuitem" className="nv-theme-act" onClick={() => (cur && host.apply('effects', withEffects(cur, host.original().fmtXml, host.original().effectsName)), close())}>
            {t('Restablecer los efectos del tema')}
          </button>
        </>
      )}
    </Menu>
  );
}

// ------------------------------------------------------------------------------------------------ whole themes

export function ThemesMenu({ host, size = 'large', iconOnly }: Props) {
  const custom = useCustomThemes();
  const [save, setSave] = useState(false);
  const [error, setError] = useState('');
  const cur = host.theme();
  const catalog = themeCatalog();
  const isCur = (th: DocTheme) => !!cur && sameColors(cur.colors, th.colors) && sameFonts(cur.fonts, th.fonts);
  const open = async (close: () => void) => {
    setError('');
    const f = await pickAndRead(THMX);
    if (!f) return;
    try {
      host.apply('theme', await readThmx(f.data));
      close();
    } catch (e) {
      setError(t('No se pudo leer «{name}»: {why}', { name: f.name, why: (e as Error).message }));
    }
  };
  const Card = ({ th, onDelete, close }: { th: DocTheme; onDelete?: () => void; close: () => void }) => (
    <div className="nv-theme-card">
      <button type="button" role="menuitemradio" aria-label={t(th.name)} aria-checked={isCur(th)} className={isCur(th) ? 'is-on' : ''} onClick={() => (host.apply('theme', th), close())}>
        <span className="nv-theme-card__page" style={{ background: th.colors.lt1, color: th.colors.dk1 }}>
          <b style={{ fontFamily: th.fonts.major.latin, color: th.colors.dk2 }}>Aa</b>
          <Swatches colors={th.colors} />
        </span>
        <span>{t(th.name)}</span>
      </button>
      {onDelete && (
        <button type="button" className="nv-theme-del" aria-label={`${t('Eliminar')} ${th.name}`} title={t('Eliminar')} onClick={onDelete}>
          <X size={12} />
        </button>
      )}
    </div>
  );
  return (
    <>
      <Menu label="Temas" icon="palette" size={size} iconOnly={iconOnly} host={host}>
        {(close) => (
          <>
            {custom.themes.length > 0 && (
              <>
                <h4>{t('Personalizado')}</h4>
                <div className="nv-theme-grid">
                  {custom.themes.map((th) => (
                    <Card key={th.name} th={th} close={close} onDelete={() => deleteCustom('themes', th.name)} />
                  ))}
                </div>
              </>
            )}
            <h4>{t('Office')}</h4>
            <div className="nv-theme-grid">
              {catalog.map((th) => (
                <Card key={th.name} th={th} close={close} />
              ))}
            </div>
            <hr />
            <button type="button" role="menuitem" className="nv-theme-act" onClick={() => void open(close)}>
              {t('Buscar temas…')}
            </button>
            <button type="button" role="menuitem" className="nv-theme-act" disabled={!cur} onClick={() => (close(), setSave(true))}>
              {t('Guardar tema actual…')}
            </button>
            <button type="button" role="menuitem" className="nv-theme-act" onClick={() => (host.apply('theme', host.original()), close())}>
              {t('Restablecer el tema')}
            </button>
            {error && (
              <p role="alert" className="nv-theme-error">
                {error}
              </p>
            )}
          </>
        )}
      </Menu>
      {save && cur && (
        <SaveThemeDialog
          theme={cur}
          onClose={() => setSave(false)}
          onFile={async (th) => {
            const bytes = await writeThmx(th);
            await saveBytes(`${th.name}.thmx`, bytes, THMX);
          }}
        />
      )}
    </>
  );
}
