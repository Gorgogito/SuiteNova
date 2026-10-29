import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useCore } from './context';
import { Icon } from './icons';
import { t } from './i18n';

export type BackstageEntry =
  | { kind: 'page'; id: string; label: string; icon?: string; render: () => ReactNode }
  | { kind: 'command'; command: string }
  | { kind: 'separator' };

export interface BackstageProps {
  open: boolean;
  entries: BackstageEntry[];
  onClose: () => void;
}

/** Full-window "File" view. Pages render in the right pane, command entries run and close it. */
export function Backstage({ open, entries, onClose }: BackstageProps) {
  const { registry } = useCore();
  const firstPage = entries.find((e): e is Extract<BackstageEntry, { kind: 'page' }> => e.kind === 'page');
  const [pageId, setPageId] = useState(firstPage?.id);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const page = entries.find((e): e is Extract<BackstageEntry, { kind: 'page' }> => e.kind === 'page' && e.id === pageId) ?? firstPage;

  return (
    <div className="nv-backstage" role="dialog" aria-modal="true" aria-label={t('ribbon.file')}>
      <nav className="nv-backstage__nav">
        <button type="button" className="nv-backstage__back" onClick={onClose} aria-label={t('backstage.back')}>
          <ArrowLeft size={20} />
        </button>
        {entries.map((entry, i) => {
          if (entry.kind === 'separator') return <hr key={i} />;
          if (entry.kind === 'command') {
            const def = registry.get(entry.command);
            if (!def) return null;
            return (
              <button
                key={entry.command}
                type="button"
                className="nv-backstage__item"
                disabled={!registry.isEnabled(entry.command)}
                onClick={() => {
                  onClose();
                  registry.run(entry.command);
                }}
              >
                <Icon name={def.icon} size={18} />
                {t(def.label)}
              </button>
            );
          }
          return (
            <button
              key={entry.id}
              type="button"
              className={`nv-backstage__item ${page?.id === entry.id ? 'is-active' : ''}`}
              onClick={() => setPageId(entry.id)}
            >
              <Icon name={entry.icon} size={18} />
              {t(entry.label)}
            </button>
          );
        })}
      </nav>
      <section className="nv-backstage__content">{page?.render()}</section>
    </div>
  );
}
