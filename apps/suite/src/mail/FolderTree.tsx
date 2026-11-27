import { t } from '@suitenova/core-ui';
import { canChangeFolder, childrenOf, favoriteFolders, folderParents, folderRows, searchFolderMessages, searchFoldersOf, unreadCount, DEFAULT_SEARCH_FOLDERS, type Folder, type SearchFolder } from '@suitenova/mail-core';
import { ChevronDown, ChevronRight, Search, Star } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { emptyFolder, folderMoveItems, moveFolder, removeFolder } from './actions';
import type { OpenDialog } from './commands';
import { ContextMenu, type MenuAt, type MenuItem } from './ContextMenu';
import type { MailCtl } from './ctl';
import { MAIL_DRAG, draggedMail } from './drag';

const FOLDER_DRAG = 'application/x-nova-folder';
/** The folders where the number of unread messages says nothing. */
const QUIET = new Set(['trash', 'sent', 'drafts']);

/** The name of a folder being changed, in its place in the tree. */
function RenameField({ ctl, folder }: { ctl: MailCtl; folder: Folder }) {
  const [name, setName] = useState(folder.name);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // once it is finished, losing the focus changes nothing
  const done = useRef(false);
  const close = () => {
    done.current = true;
    ctl.editFolder(null);
  };
  const rename = async () => {
    if (done.current || busy) return;
    if (!name.trim() || name.trim() === folder.name) return close();
    setBusy(true);
    try {
      await ctl.renameFolder(folder.id, name);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ml-folder-edit">
      <input
        autoFocus
        className="ml-folder-rename"
        aria-label={t('Nombre nuevo de la carpeta')}
        aria-invalid={!!err}
        value={name}
        readOnly={busy}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setName(e.target.value);
          setErr(null);
        }}
        onBlur={() => !err && void rename()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') void rename();
          else if (e.key === 'Escape') close();
        }}
      />
      {(busy || err) && (
        <div className="ml-folder-note" role={err ? 'alert' : 'status'}>
          {err ? t(err) : t('Cambiando…')}
        </div>
      )}
    </div>
  );
}

export function FolderTree({ ctl, openDialog }: { ctl: MailCtl; openDialog: OpenDialog }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [name, setName] = useState('');
  const [where, setWhere] = useState('local');
  const [inside, setInside] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuAt | null>(null);
  /** The folder something is being dragged over; '' is the top level. */
  const [over, setOver] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const rows = folderRows(ctl.data);
  const hidden = new Set<string>();
  for (const { folder } of rows) if (collapsed.has(folder.id) || (folder.parent && hidden.has(folder.parent))) hidden.add(folder.id);
  const current = ctl.data.folders.find((f) => f.id === ctl.folder);
  const adding = ctl.folderEdit?.kind === 'new';
  const renaming = ctl.folderEdit?.kind === 'rename' ? ctl.folderEdit.id : null;

  // what the form of a new folder starts with, also when it is opened from the ribbon or a menu
  useEffect(() => {
    if (ctl.folderEdit?.kind !== 'new') return;
    setErr(null);
    setName('');
    // por defecto la carpeta se crea donde está la que se está viendo: en su cuenta si es del servidor, o solo aquí
    setWhere(current?.remote?.account && ctl.accounts.some((a) => a.id === current.remote!.account) ? current.remote.account : 'local');
    setInside(ctl.folderEdit.inside);
  }, [ctl.folderEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    ctl.editFolder(null);
    setName('');
    setErr(null);
  };
  const commit = async () => {
    if (!name.trim()) return close();
    setBusy(true);
    try {
      const parent = inside ? ctl.folder : null;
      if (where === 'local') ctl.addFolder(name, parent);
      else await ctl.addServerFolder(where, name, parent);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const menuFor = (f: Folder): MenuItem[] => {
    const changes = canChangeFolder(f);
    const favorite = !!ctl.data.favorites?.includes(f.id);
    const items: MenuItem[] = [
      {
        label: t('Carpeta nueva dentro…'),
        run: () => {
          ctl.setFolder(f.id);
          ctl.editFolder({ kind: 'new', inside: true });
        },
      },
      { label: t('Cambiar nombre'), hint: 'F2', disabled: !changes, run: () => ctl.editFolder({ kind: 'rename', id: f.id }) },
      { label: t('Mover a'), disabled: !changes, sub: changes ? folderMoveItems(ctl, f.id) : [] },
      { label: t('Eliminar carpeta'), disabled: !changes, run: () => removeFolder(ctl, f.id) },
      'separator',
      { label: t('Marcar todo como leído'), disabled: !unreadCount(ctl.data, f.id), run: () => ctl.markFolderRead(f.id) },
    ];
    if (f.id === 'trash' || f.id === 'junk') items.push({ label: t('Vaciar la carpeta'), disabled: !ctl.data.messages.some((m) => m.folder === f.id), run: () => emptyFolder(ctl, f.id) });
    items.push({ label: favorite ? t('Quitar de Favoritos') : t('Agregar a Favoritos'), run: () => ctl.toggleFavorite(f.id) });
    return items;
  };

  /** Whether what is being dragged can be left on a folder (null: the top level). */
  const accepts = (e: DragEvent, target: Folder | null): boolean => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(MAIL_DRAG)) return !!target && !target.id.startsWith('c:');
    if (!types.includes(FOLDER_DRAG) || !dragged) return false;
    const to = target?.id ?? null;
    return (ctl.data.folders.find((f) => f.id === dragged)?.parent ?? null) !== to && folderParents(ctl.data, dragged).includes(to);
  };
  const dropOn = (target: Folder | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!accepts(e, target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setOver(target?.id ?? '');
    },
    onDragLeave: () => setOver((o) => (o === (target?.id ?? '') ? null : o)),
    onDrop: (e: DragEvent) => {
      if (!accepts(e, target)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const ids = draggedMail(e.dataTransfer);
      if (ids.length && target) ctl.moveMany(ids, target.id);
      else if (dragged) moveFolder(ctl, dragged, target?.id ?? null);
      setDragged(null);
    },
  });

  const button = (f: Folder, favorite = false) => {
    const n = unreadCount(ctl.data, f.id);
    return (
      <button
        type="button"
        className={`ml-folder-name${f.id === ctl.folder ? ' is-current' : ''}${f.id.startsWith('c:') ? ' is-container' : ''}${over === f.id ? ' is-drop' : ''}`}
        aria-current={f.id === ctl.folder}
        onClick={() => ctl.setFolder(f.id)}
        title={f.remote ? f.remote.path : undefined}
        draggable={!favorite && canChangeFolder(f)}
        onDragStart={(e) => {
          e.dataTransfer.setData(FOLDER_DRAG, f.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragged(f.id);
        }}
        onDragEnd={() => {
          setDragged(null);
          setOver(null);
        }}
        {...dropOn(f)}
        onContextMenu={(e) => {
          e.preventDefault();
          // opened with the keyboard it has no point of its own
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: e.clientX || r.left + 20, y: e.clientY || r.bottom, label: t('Carpeta {name}', { name: t(f.name) }), items: menuFor(f) });
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2' && canChangeFolder(f)) ctl.editFolder({ kind: 'rename', id: f.id });
          else if (e.key === 'Delete' && canChangeFolder(f)) removeFolder(ctl, f.id);
          else return;
          e.preventDefault();
        }}
      >
        <span>{t(f.name)}</span>
        {n > 0 && !QUIET.has(f.id) ? <b aria-label={t('{n} sin leer', { n })}>{n}</b> : null}
      </button>
    );
  };

  const favorites = favoriteFolders(ctl.data);
  const searches = searchFoldersOf(ctl.data);
  const searchMenu = (s: SearchFolder): MenuItem[] => [
    { label: t('Editar la búsqueda…'), run: () => openDialog('searchFolder', { folder: s.id }) },
    { label: t('Quitar la carpeta de búsqueda'), run: () => ctl.organize.removeSearchFolder(s.id) },
    'separator',
    { label: t('Carpeta de búsqueda nueva…'), run: () => openDialog('searchFolder') },
    { label: t('Restaurar las de partida'), disabled: DEFAULT_SEARCH_FOLDERS.every((d) => searches.some((x) => x.id === d.id)), run: () => ctl.organize.restoreSearchFolders() },
  ];
  return (
    <nav className={`ml-folders nv-panel${over === '' ? ' is-drop' : ''}`} aria-label={t('Carpetas')} {...dropOn(null)}>
      {favorites.length > 0 && (
        <section className="ml-favorites" aria-label={t('Favoritos')}>
          <h3>
            <Star size={12} aria-hidden="true" /> {t('Favoritos')}
          </h3>
          <ul>
            {favorites.map((f) => (
              <li key={f.id}>{button(f, true)}</li>
            ))}
          </ul>
        </section>
      )}
      <ul role="tree" aria-label={t('Carpetas')}>
        {rows
          .filter(({ folder }) => !(folder.parent && hidden.has(folder.parent)))
          .map(({ folder: f, depth }) => {
            const kids = childrenOf(ctl.data, f.id).length > 0;
            const open = !collapsed.has(f.id);
            return (
              <li key={f.id} role="treeitem" aria-level={depth + 1} aria-expanded={kids ? open : undefined} aria-selected={f.id === ctl.folder}>
                <div className="ml-folder-row" style={{ paddingInlineStart: depth * 14 }}>
                  {kids ? (
                    <button type="button" className="ml-folder-caret" aria-label={open ? `${t('Contraer')} ${t(f.name)}` : `${t('Expandir')} ${t(f.name)}`} onClick={() => toggle(f.id)}>
                      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    </button>
                  ) : (
                    <span className="ml-folder-caret" aria-hidden="true" />
                  )}
                  {renaming === f.id ? <RenameField ctl={ctl} folder={f} /> : button(f)}
                </div>
              </li>
            );
          })}
      </ul>
      <section className="ml-searches" aria-label={t('Carpetas de búsqueda')}>
        <h3>
          <Search size={12} aria-hidden="true" /> {t('Carpetas de búsqueda')}
          <button type="button" aria-label={t('Carpeta de búsqueda nueva…')} title={t('Carpeta de búsqueda nueva…')} onClick={() => openDialog('searchFolder')}>
            +
          </button>
        </h3>
        <ul>
          {searches.map((s) => {
            const unread = searchFolderMessages(ctl.data, s).filter((m) => !m.read).length;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`ml-folder-name${s.id === ctl.folder ? ' is-current' : ''}`}
                  aria-current={s.id === ctl.folder}
                  title={s.query}
                  onClick={() => ctl.setFolder(s.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: e.clientX || r.left + 20, y: e.clientY || r.bottom, label: t('Carpeta {name}', { name: t(s.name) }), items: searchMenu(s) });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Delete') return;
                    e.preventDefault();
                    ctl.organize.removeSearchFolder(s.id);
                  }}
                >
                  <span>{t(s.name)}</span>
                  {unread > 0 ? <b aria-label={t('{n} sin leer', { n: unread })}>{unread}</b> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {adding ? (
        <div className="ml-newfolder">
          <input
            autoFocus
            aria-label={t('Nombre de la carpeta')}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') void commit();
              else if (e.key === 'Escape') close();
            }}
          />
          {current && (
            <label>
              <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> {t('Dentro de «{name}»', { name: t(current.name) })}
            </label>
          )}
          {ctl.accounts.length > 0 && (
            <select className="nv-select" aria-label={t('Dónde crearla')} value={where} onChange={(e) => setWhere(e.target.value)}>
              <option value="local">{t('Solo en este equipo')}</option>
              {ctl.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {t('En el servidor: {name}', { name: a.name })}
                </option>
              ))}
            </select>
          )}
          <div className="ml-newfolder__buttons">
            <button type="button" disabled={busy || !name.trim()} onClick={() => void commit()}>
              {busy ? t('Creando…') : t('Crear')}
            </button>
            <button type="button" disabled={busy} onClick={close}>
              {t('Cancelar')}
            </button>
          </div>
          {err && <span role="alert">{t(err)}</span>}
        </div>
      ) : (
        <button type="button" className="ml-addfolder" onClick={() => ctl.editFolder({ kind: 'new', inside: false })}>
          + {t('Carpeta nueva')}
        </button>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </nav>
  );
}
