import { useLayoutEffect, type RefObject } from 'react';

/**
 * "Shrink text on overflow". The text is drawn with font sizes multiplied by the CSS variable --sl-fs (and line spacing by --sl-ln),
 * so the best scale can be searched directly on the DOM without re-rendering.
 */
export function useAutofit(ref: RefObject<HTMLElement | null>, enabled: boolean, key: string, stored?: { font?: number; ln?: number }): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!enabled) {
      node.style.removeProperty('--sl-fs');
      node.style.removeProperty('--sl-ln');
      return;
    }
    const probe = node.firstElementChild as HTMLElement | null;
    if (!probe) return;
    const cs = getComputedStyle(node);
    const avail = node.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const apply = (fs: number) => {
      node.style.setProperty('--sl-fs', String(fs));
      node.style.setProperty('--sl-ln', String(fs >= 0.9 ? 1 : 1 - 0.2 * Math.min(1, (0.9 - fs) / 0.4)));
    };
    const over = () => probe.scrollHeight > avail + 0.5 || probe.scrollWidth > availW + 1;
    apply(1);
    if (!over()) return;
    const want = stored?.font ? stored.font / 100 : undefined;
    if (want && want < 1) {
      apply(want);
      if (!over()) return;
    }
    let lo = 0.25;
    let hi = 1;
    apply(lo);
    if (over()) return; // does not fit even at the minimum: leave it at 25%
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      apply(mid);
      if (over()) hi = mid;
      else lo = mid;
    }
    apply(Math.floor(lo * 100) / 100);
    if (over()) apply(lo);
  }, [ref, enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
