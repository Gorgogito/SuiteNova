import { pmThesaurusHost, type ReviewHost, type ThesaurusHost } from '../spell';
import type { WriterCtl } from './doc';

const hosts = new WeakMap<WriterCtl, ReviewHost>();

/** Cómo ve el corrector compartido a Nova Writer: el idioma del documento y su única vista de ProseMirror. */
export function writerHost(ctl: WriterCtl): ReviewHost {
  let h = hosts.get(ctl);
  if (!h) {
    h = {
      get lang() {
        return ctl.spellLang;
      },
      setLang: (l) => ctl.setSpellLang(l),
      views: () => (ctl.mainView ? [{ id: 'main', view: ctl.mainView }] : []),
      focus: () => ctl.focus(),
      get readOnly() {
        return ctl.readOnly;
      },
    };
    hosts.set(ctl, h);
  }
  return h;
}

const thHosts = new WeakMap<WriterCtl, ThesaurusHost>();

/** El panel «Sinónimos» sobre la vista de Writer. */
export function writerThesaurusHost(ctl: WriterCtl): ThesaurusHost {
  let h = thHosts.get(ctl);
  if (!h) {
    h = pmThesaurusHost(writerHost(ctl));
    thHosts.set(ctl, h);
  }
  return h;
}
