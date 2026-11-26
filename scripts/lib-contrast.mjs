// Shared by the theme checks: the contrast of every visible text (and of what is written in boxes and lists) inside some
// containers, against the background it really has. Disabled controls are exempt, as in WCAG.
export const lowContrast = (page, scopes, minimum = 4.5, skip = null) =>
  page.evaluate(
    ([selectors, min, skipped]) => {
      const parse = (c) => {
        const n = (c.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
        const scale = c.startsWith('color(') ? 255 : 1;
        return n.length < 3 ? [0, 0, 0, 0] : [n[0] * scale, n[1] * scale, n[2] * scale, n.length > 3 ? n[3] : 1];
      };
      const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
      const background = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          // a picture or a gradient behind: it cannot be told from here
          if (s.backgroundImage !== 'none' && !s.backgroundImage.includes('url(')) return null;
          const c = parse(s.backgroundColor);
          if (c[3] > 0) layers.push(c);
          if (c[3] === 1) break;
        }
        return layers.reduceRight((under, layer) => over(layer, under), [255, 255, 255]);
      };
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const faded = (el) => {
        let opacity = 1;
        for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
        return opacity;
      };
      const bad = [];
      const measure = (el, text, scope) => {
        if (el.closest(':disabled, [aria-disabled="true"], option, optgroup, svg, [aria-hidden="true"]') || (skipped && el.closest(skipped))) return;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || s.visibility !== 'visible') return;
        const opacity = faded(el);
        if (opacity < 0.05) return;
        const bg = background(el);
        if (!bg) return;
        const color = parse(s.color);
        const fg = over([color[0], color[1], color[2], color[3] * opacity], bg);
        const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < min) {
          const cls = (e) => (typeof e.className === 'string' ? e.className.split(' ').filter((c) => !/^(f[a-z0-9]{6,}|___\w+)$/.test(c)).slice(0, 2).join('.') : '');
          bad.push(`${scope} <${el.tagName.toLowerCase()}.${cls(el) || cls(el.parentElement ?? el)}> «${text.slice(0, 24)}» ${ratio.toFixed(2)} (${s.color} sobre ${bg.map(Math.round).join(',')})`);
        }
      };
      for (const scope of selectors) {
        for (const root of document.querySelectorAll(scope)) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text) measure(node.parentElement, text, scope);
          }
          for (const field of root.querySelectorAll('input, textarea, select')) {
            if (/^(checkbox|radio|range|color|file|hidden)$/.test(field.type)) continue;
            const text = (field.tagName === 'SELECT' ? field.selectedOptions[0]?.textContent : field.value)?.trim();
            // an empty box counts too: what is typed in it will have this colour on this background
            measure(field, text || '(campo vacío)', scope);
          }
        }
      }
      return [...new Set(bad)];
    },
    [scopes, minimum, skip],
  );
