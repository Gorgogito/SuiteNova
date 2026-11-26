import { useEffect, useState } from 'react';
import { t } from './i18n';
import type { WindowHost } from './window-host';

/** The 10 x 10 glyphs of the Windows caption buttons, drawn with a 1 px line. */
const GLYPHS = {
  minimize: 'M0 5.5H10',
  maximize: 'M0.5 0.5H9.5V9.5H0.5Z',
  restore: 'M0.5 2.5H7.5V9.5H0.5Z M2.5 2.5V0.5H9.5V7.5H7.5',
  close: 'M0 0L10 10M10 0L0 10',
};

function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true" data-glyph={name}>
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** Minimize, maximize or restore, and close, at the right end of the title bar. */
export function WindowControls({ host }: { host: WindowHost }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = () => void host.isMaximized().then((m) => alive && setMaximized(m));
    read();
    const off = host.onResize(read);
    return () => {
      alive = false;
      off();
    };
  }, [host]);

  const button = (glyph: keyof typeof GLYPHS, label: string, run: () => void) => (
    <button type="button" className={`nv-wincontrol nv-wincontrol--${glyph}`} aria-label={t(label)} title={t(label)} onClick={run}>
      <Glyph name={glyph} />
    </button>
  );

  return (
    <div className="nv-wincontrols" role="group" aria-label={t('window.controls')}>
      {button('minimize', 'window.minimize', () => host.minimize())}
      {button(maximized ? 'restore' : 'maximize', maximized ? 'window.restore' : 'window.maximize', () => host.toggleMaximize())}
      {button('close', 'window.close', () => host.close())}
    </div>
  );
}
