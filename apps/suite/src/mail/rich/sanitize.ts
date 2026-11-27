/** HTML of a message made harmless: no scripts, frames, forms or event handlers; its style sheets are kept. */
export function sanitizeMailHtml(html: string): { styles: string; body: HTMLElement } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,frame,object,embed,meta,link,base,form,applet,portal,noscript').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(a.name.toLowerCase()) && /^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('rel', 'noopener noreferrer');
      el.removeAttribute('target');
    }
  });
  return { styles: [...doc.head.querySelectorAll('style')].map((s) => s.outerHTML).join(''), body: doc.body };
}
