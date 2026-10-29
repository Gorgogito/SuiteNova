import { presetInfo, type AnimEffect, type Transition } from '@suitenova/slides-core';

/*
 * Visual effects of a show drawn with the Web Animations API: transitions between slides and the animations of objects.
 * Where PowerPoint's effect has no close CSS equivalent a similar one is used (see docs/LIMITACIONES.md).
 */

const SPEED: Record<string, number> = { slow: 1000, med: 700, fast: 500 };
export const transitionMs = (t: Transition): number => t.dur ?? SPEED[t.spd ?? 'med'] ?? 700;

type Dir = 'l' | 'r' | 'u' | 'd';
const dirOf = (d: string | undefined): Dir => (d === 'r' || d === 'rd' || d === 'ru' ? 'r' : d === 'u' || d === 'lu' ? 'u' : d === 'd' || d === 'ld' ? 'd' : 'l');
const FROM: Record<Dir, [string, string]> = { l: ['-100%', '0'], r: ['100%', '0'], u: ['0', '-100%'], d: ['0', '100%'] };

const anim = (el: Element, keyframes: Keyframe[], ms: number, o: KeyframeAnimationOptions = {}): Animation => el.animate(keyframes, { duration: ms, easing: 'ease-in-out', fill: 'both', ...o });

/** Plays the transition from `old` to `next` (both full-size layers in a container); resolves when it is over. */
export function playTransition(old: HTMLElement | null, next: HTMLElement, t: Transition | undefined): Promise<void> {
  if (!t || t.type === 'none' || t.type === 'cut' || !old) return Promise.resolve();
  const ms = transitionMs(t);
  const anims: Animation[] = [];
  const d = dirOf(t.dir);
  const clip = (from: string, to: string) => anims.push(anim(next, [{ clipPath: from }, { clipPath: to }], ms));
  switch (t.type) {
    case 'fade':
      if (t.thruBlk) {
        anims.push(anim(old, [{ opacity: 1 }, { opacity: 0 }], ms / 2));
        anims.push(anim(next, [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], ms, { easing: 'linear' }));
      } else anims.push(anim(next, [{ opacity: 0 }, { opacity: 1 }], ms));
      break;
    case 'dissolve':
    case 'random':
    case 'glitter':
    case 'flash':
      anims.push(anim(next, [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }], ms));
      break;
    case 'push': {
      const [x, y] = FROM[d === 'l' ? 'r' : d === 'r' ? 'l' : d === 'u' ? 'd' : 'u'];
      const [ox, oy] = FROM[d];
      anims.push(anim(next, [{ transform: `translate(${x},${y})` }, { transform: 'translate(0,0)' }], ms));
      anims.push(anim(old, [{ transform: 'translate(0,0)' }, { transform: `translate(${ox},${oy})` }], ms));
      break;
    }
    case 'cover': {
      const [x, y] = FROM[d === 'l' ? 'r' : d === 'r' ? 'l' : d === 'u' ? 'd' : 'u'];
      anims.push(anim(next, [{ transform: `translate(${x},${y})` }, { transform: 'translate(0,0)' }], ms));
      break;
    }
    case 'pull': {
      const [ox, oy] = FROM[d];
      next.style.zIndex = '0';
      old.style.zIndex = '1';
      anims.push(anim(old, [{ transform: 'translate(0,0)' }, { transform: `translate(${ox},${oy})` }], ms));
      break;
    }
    case 'wipe': {
      const from = d === 'l' ? 'inset(0 0 0 100%)' : d === 'r' ? 'inset(0 100% 0 0)' : d === 'u' ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)';
      clip(from, 'inset(0 0 0 0)');
      break;
    }
    case 'split': {
      const inward = (t.dir ?? 'in').includes('in');
      const vert = (t.orient ?? 'horz') === 'vert';
      if (vert) clip(inward ? 'inset(0 50% 0 50%)' : 'inset(0 0 0 0)', inward ? 'inset(0 0 0 0)' : 'inset(0 50% 0 50%)');
      else clip(inward ? 'inset(50% 0 50% 0)' : 'inset(0 0 0 0)', inward ? 'inset(0 0 0 0)' : 'inset(50% 0 50% 0)');
      break;
    }
    case 'circle':
    case 'wheel':
    case 'wheelReverse':
    case 'vortex':
    case 'ripple':
      clip('circle(0% at 50% 50%)', 'circle(75% at 50% 50%)');
      break;
    case 'diamond':
    case 'plus':
    case 'newsflash':
      clip('polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)', 'polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%)');
      break;
    case 'wedge':
      clip('polygon(50% 50%, 50% 0, 50% 0)', 'polygon(50% 50%, 0 0, 100% 0, 100% 100%, 0 100%, 0 0)');
      break;
    case 'blinds':
    case 'checker':
    case 'comb':
    case 'strips':
    case 'randomBar':
    case 'honeycomb': {
      const vert = t.orient === 'vert' || t.type === 'comb';
      const mask = vert ? 'repeating-linear-gradient(90deg, #000 0 10%, transparent 10% 20%)' : 'repeating-linear-gradient(0deg, #000 0 10%, transparent 10% 20%)';
      next.style.webkitMaskImage = mask;
      next.style.maskImage = mask;
      anims.push(anim(next, [{ maskSize: vert ? '0% 100%' : '100% 0%' } as Keyframe, { maskSize: '100% 100%' } as Keyframe], ms));
      break;
    }
    case 'zoom':
      anims.push(anim(next, [{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], ms));
      break;
    case 'flip':
    case 'switch':
    case 'prism':
    case 'gallery':
    case 'conveyor':
    case 'ferris':
      anims.push(anim(old, [{ transform: 'perspective(1200px) rotateY(0)' }, { transform: 'perspective(1200px) rotateY(90deg)' }], ms / 2, { easing: 'ease-in' }));
      anims.push(anim(next, [{ transform: 'perspective(1200px) rotateY(-90deg)' }, { transform: 'perspective(1200px) rotateY(-90deg)' }, { transform: 'perspective(1200px) rotateY(0)' }], ms, { easing: 'ease-out' }));
      break;
    case 'doors':
    case 'window':
    case 'reveal':
      clip('inset(0 50% 0 50%)', 'inset(0 0 0 0)');
      break;
    case 'fall':
    case 'shred':
    case 'airplane':
    case 'origami':
    case 'flythrough':
    case 'warp':
    case 'pan':
    default:
      anims.push(anim(next, [{ opacity: 0, transform: 'scale(1.1)' }, { opacity: 1, transform: 'scale(1)' }], ms));
  }
  return Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
    for (const a of anims) a.cancel();
    next.style.removeProperty('mask-image');
    next.style.removeProperty('-webkit-mask-image');
    next.style.removeProperty('z-index');
    old.style.removeProperty('z-index');
  });
}

// ------------------------------------------------------------------------------------------------ object animations

/** The DOM nodes an effect acts on: the object, or the paragraphs of its text. */
export function targetsOf(root: HTMLElement, e: AnimEffect): HTMLElement[] {
  const el = root.querySelector<HTMLElement>(`[data-id="${CSS.escape(e.target)}"]`);
  if (!el) return [];
  if (!e.para) return [el];
  const ps = [...el.querySelectorAll<HTMLElement>('.sl-p')];
  return ps.slice(e.para[0], e.para[1] + 1);
}

export function setVisible(nodes: HTMLElement[], visible: boolean): void {
  for (const n of nodes) n.style.visibility = visible ? 'visible' : 'hidden';
}

/** Plays one effect. The final state (shown/hidden) is applied when it ends. */
export function playEffect(root: HTMLElement, e: AnimEffect, delay: number, dur: number): Promise<void> {
  const nodes = targetsOf(root, e);
  if (!nodes.length) return Promise.resolve();
  const p = presetInfo(e.cls, e.preset);
  const kind = p?.kind ?? 'fade';
  const enter = e.cls === 'entr';
  const exit = e.cls === 'exit';
  const slide = root.getBoundingClientRect();
  const done: Promise<unknown>[] = [];
  for (const n of nodes) {
    const r = n.getBoundingClientRect();
    const k = slide.width / (root.offsetWidth || slide.width);
    const opts: KeyframeAnimationOptions = { duration: Math.max(1, dur), delay, fill: 'both', easing: 'ease-in-out' };
    let frames: Keyframe[] = [];
    const shown = !enter ? { opacity: 1 } : { opacity: 1 };
    if (enter) n.style.visibility = 'hidden';
    switch (e.cls) {
      case 'emph':
        if (kind === 'spin') frames = [{ transform: 'rotate(0deg)' }, { transform: `rotate(${e.value ? Number(e.value) : 360}deg)` }];
        else if (kind === 'grow') frames = [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }];
        else if (kind === 'pulse') frames = [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }];
        else if (kind === 'teeter') frames = [{ transform: 'rotate(0)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }];
        else frames = [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }];
        break;
      default: {
        const vis: Keyframe = enter ? { opacity: 0 } : shown;
        const full: Keyframe = enter ? shown : { opacity: 0 };
        void vis;
        const from = (kf: Keyframe): Keyframe[] => (enter ? [kf, {}] : [{}, kf]);
        if (kind === 'appear') frames = [{ opacity: enter ? 1 : 1 }];
        else if (kind === 'fade') frames = from({ opacity: 0 });
        else if (kind === 'fly') {
          const dir = (e.subtype === 8 ? 'l' : e.subtype === 2 ? 'r' : e.subtype === 1 ? 'u' : 'd') as Dir;
          const dx = dir === 'l' ? -(r.right - slide.left) / k : dir === 'r' ? (slide.right - r.left) / k : 0;
          const dy = dir === 'u' ? -(r.bottom - slide.top) / k : dir === 'd' ? (slide.bottom - r.top) / k : 0;
          frames = from({ transform: `translate(${dx}px,${dy}px)` });
        } else if (kind === 'wipe') {
          const dir = e.subtype === 8 ? 'inset(0 100% 0 0)' : e.subtype === 2 ? 'inset(0 0 0 100%)' : e.subtype === 1 ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';
          frames = from({ clipPath: dir });
        } else if (kind === 'zoom' || kind === 'float' || kind === 'bounce') frames = from({ transform: kind === 'zoom' ? 'scale(0)' : 'translateY(40px)', opacity: kind === 'zoom' ? 1 : 0 });
        else if (kind === 'blinds' || kind === 'split' || kind === 'wheel') frames = from({ clipPath: kind === 'split' ? 'inset(50% 0 50% 0)' : kind === 'wheel' ? 'circle(0% at 50% 50%)' : 'inset(0 0 100% 0)' });
        else frames = from({ opacity: 0 });
        void full;
      }
    }
    const a = n.animate(frames, opts);
    done.push(
      a.finished.then(() => {
        if (enter) n.style.visibility = 'visible';
        if (exit) n.style.visibility = 'hidden';
        // keep the end state out of the animation so later steps can animate the same node
        a.cancel();
        n.style.removeProperty('opacity');
        n.style.removeProperty('transform');
        n.style.removeProperty('clip-path');
      }, () => undefined),
    );
  }
  return Promise.all(done).then(() => undefined);
}
