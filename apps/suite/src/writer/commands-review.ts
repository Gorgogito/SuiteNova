import type { CommandDef } from '@suitenova/core-ui';
import { checkProtectionPassword } from '@suitenova/writer-core';
import type { WriterUI } from './commands';
import { addCommentMark, applyChanges, changesIn, getUser, listChanges, nextChange, selectChange } from './review';

export const MARKUPS: { id: 'all' | 'simple' | 'none' | 'original'; label: string }[] = [
  { id: 'all', label: 'Todas las marcas' },
  { id: 'simple', label: 'Marcas simples' },
  { id: 'none', label: 'Sin marcas' },
  { id: 'original', label: 'Original' },
];

/** Comments, tracked changes and protection. */
export function reviewCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.mainView && !c.readOnly;
  const canComment = () => !!c.mainView && (!c.protection || c.protection.mode !== 'readOnly');
  const view = () => c.mainView!;

  // ---- comments
  add({
    id: 'writer.comment.new',
    label: 'Nuevo comentario',
    icon: 'commentAdd',
    description: 'Añade un comentario al texto seleccionado o a la palabra donde está el cursor.',
    enabled: canComment,
    run: () => {
      const user = getUser();
      const data = addCommentMark(view(), '', user);
      if (!data) return;
      c.comments = [...c.comments, data];
      c.activeComment = data.id;
      c.editingComment = data.id;
      c.showReview = true;
      c.reviewTab = 'comments';
      c.dirty = true;
      c.touch();
    },
  });
  add({ id: 'writer.comment.delete', label: 'Eliminar comentario', icon: 'trash', enabled: () => !!c.activeComment && canComment(), run: () => c.deleteComment(c.activeComment!) });
  add({ id: 'writer.comment.deleteAll', label: 'Eliminar todos los comentarios', icon: 'trash', enabled: () => c.comments.length > 0 && canComment(), run: () => c.deleteAllComments() });
  add({ id: 'writer.comment.next', label: 'Siguiente comentario', icon: 'arrowRight', enabled: () => c.comments.length > 0, run: () => c.stepComment(1) });
  add({ id: 'writer.comment.prev', label: 'Comentario anterior', icon: 'arrowLeft', enabled: () => c.comments.length > 0, run: () => c.stepComment(-1) });
  add({ id: 'writer.comment.pane', label: 'Mostrar comentarios', icon: 'comment', checked: () => c.showReview && c.reviewTab === 'comments', run: () => c.toggleReview('comments') });

  // ---- tracked changes
  add({
    id: 'writer.track.toggle',
    label: 'Control de cambios',
    icon: 'trackChanges',
    description: 'Registra lo que se escribe, se borra o se reemplaza, con su autor, para poder aceptarlo o rechazarlo.',
    enabled: () => !!c.mainView && !c.readOnly && c.protection?.mode !== 'trackedChanges',
    checked: () => c.trackChanges || c.protection?.mode === 'trackedChanges',
    run: () => {
      c.trackChanges = !c.trackChanges;
      c.dirty = true;
      c.touch();
    },
  });
  for (const m of MARKUPS) add({ id: `writer.track.markup.${m.id}`, label: m.label, icon: 'eye', checked: () => c.markup === m.id, run: () => { c.markup = m.id; c.touch(); } });
  add({ id: 'writer.track.pane', label: 'Panel de revisiones', icon: 'comment', checked: () => c.showReview && c.reviewTab === 'changes', run: () => c.toggleReview('changes') });

  const here = () => {
    const s = c.mainState;
    if (!s) return [];
    const sel = s.selection;
    return changesIn(s.doc, sel.from, sel.to);
  };
  const act = (accept: boolean, all: boolean, andNext = false) => () => {
    const v = c.mainView;
    if (!v) return;
    const changes = all ? listChanges(v.state.doc) : here();
    if (!changes.length) {
      // nothing selected: act on the next change
      const n = nextChange(v.state, 1);
      if (n && !all) applyChanges(v, [n], accept);
      return;
    }
    applyChanges(v, changes, accept);
    if (andNext) {
      const n = nextChange(v.state, 1);
      if (n) selectChange(v, n);
    }
  };
  add({ id: 'writer.change.accept', label: 'Aceptar el cambio', icon: 'check', enabled: () => ready() && listChanges(c.body).length > 0, run: act(true, false, true) });
  add({ id: 'writer.change.reject', label: 'Rechazar el cambio', icon: 'x', enabled: () => ready() && listChanges(c.body).length > 0, run: act(false, false, true) });
  add({ id: 'writer.change.acceptAll', label: 'Aceptar todos los cambios', icon: 'checkAll', enabled: () => ready() && listChanges(c.body).length > 0, run: act(true, true) });
  add({ id: 'writer.change.rejectAll', label: 'Rechazar todos los cambios', icon: 'x', enabled: () => ready() && listChanges(c.body).length > 0, run: act(false, true) });
  add({ id: 'writer.change.next', label: 'Siguiente cambio', icon: 'arrowRight', enabled: () => listChanges(c.body).length > 0, run: () => { const n = c.mainState && nextChange(c.mainState, 1); if (n) selectChange(view(), n); } });
  add({ id: 'writer.change.prev', label: 'Cambio anterior', icon: 'arrowLeft', enabled: () => listChanges(c.body).length > 0, run: () => { const n = c.mainState && nextChange(c.mainState, -1); if (n) selectChange(view(), n); } });

  // ---- protection and user
  add({ id: 'writer.protect.restrict', label: 'Restringir edición…', icon: 'lock', description: 'Limita lo que se puede cambiar en el documento, con contraseña opcional.', enabled: () => !!c.mainView && !c.protection, run: () => ui.openDialog('protect') });
  add({
    id: 'writer.protect.stop',
    label: 'Detener la protección…',
    icon: 'unlock',
    enabled: () => !!c.protection,
    run: () => {
      if (!c.protection?.hash) {
        c.setProtection(null);
        return;
      }
      ui.openDialog('unprotect');
    },
  });
  add({ id: 'writer.user.name', label: 'Nombre de usuario…', icon: 'users', run: () => ui.openDialog('user') });
  void checkProtectionPassword;
  return defs;
}
