import { pmThesaurusHost, type ReviewHost, type ThesaurusHost } from '../spell';
import type { NotesCtl } from './ctl';

const hosts = new WeakMap<NotesCtl, ReviewHost>();

/** Cómo ve el corrector compartido a Nova Notes: el idioma de las notas y los cuadros de texto de la página, de arriba abajo. */
export function notesHost(ctl: NotesCtl): ReviewHost {
  let h = hosts.get(ctl);
  if (!h) {
    h = {
      get lang() {
        return ctl.spellLang;
      },
      setLang: (l) => ctl.setSpellLang(l),
      views: () =>
        [...ctl.page.containers]
          .filter((x) => x.kind === 'text')
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .flatMap((c) => {
            const view = ctl.views.get(c.id);
            return view ? [{ id: c.id, view }] : [];
          }),
      focus: () => setTimeout(() => ctl.focusEditor(), 80),
    };
    hosts.set(ctl, h);
  }
  return h;
}

const thHosts = new WeakMap<NotesCtl, ThesaurusHost>();

/** El panel «Sinónimos» sobre los cuadros de texto de Notes. */
export function notesThesaurusHost(ctl: NotesCtl): ThesaurusHost {
  let h = thHosts.get(ctl);
  if (!h) {
    h = pmThesaurusHost(notesHost(ctl));
    thHosts.set(ctl, h);
  }
  return h;
}
