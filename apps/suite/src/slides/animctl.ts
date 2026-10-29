import { newEffect, updateSlide, withTiming, type AnimEffect, type PresetInfo, type Slide, type Transition } from '@suitenova/slides-core';
import type { SlidesCtl } from './ctl';

/** Operations of the Animations and Transitions tabs on the current slide. Each is one undo step. */

export const effectsOf = (s: Slide): AnimEffect[] => s.timing?.effects ?? [];

function setEffects(c: SlidesCtl, label: string, fn: (list: AnimEffect[]) => AnimEffect[]): void {
  const id = c.slide.id;
  c.apply(label, (d) => updateSlide(d, id, (s) => withTiming(s, fn(effectsOf(s)))));
}

/** Adds the animation to each selected object (one click each, in selection order). */
export function addEffect(c: SlidesCtl, preset: PresetInfo): void {
  const targets = c.selection.filter((id) => c.element(id));
  if (!targets.length) return void c.say('Seleccione un objeto para animarlo.');
  const made = targets.map((id) => newEffect(id, preset));
  setEffects(c, 'Agregar animación', (l) => [...l, ...made]);
  c.selEffect = made[made.length - 1]!.id;
  c.touch();
}

/** Applies the animation chosen in the gallery: replaces the selected one (keeping its timing), else adds. */
export function applyEffect(c: SlidesCtl, preset: PresetInfo): void {
  const sel = effectsOf(c.slide).find((e) => e.id === c.selEffect && c.selection.includes(e.target));
  if (!sel) return addEffect(c, preset);
  patchEffect(c, sel.id, { cls: preset.cls, preset: preset.id, subtype: preset.subtypes?.[0]?.id, rawXml: undefined } as Partial<AnimEffect>, 'Cambiar animación');
}

export function patchEffect(c: SlidesCtl, id: string, patch: Partial<AnimEffect>, label = 'Cambiar animación'): void {
  setEffects(c, label, (l) => l.map((e) => (e.id === id ? { ...e, ...patch, rawXml: undefined } : e)));
}

export function removeEffect(c: SlidesCtl, id: string): void {
  const l = effectsOf(c.slide);
  const i = l.findIndex((e) => e.id === id);
  setEffects(c, 'Quitar animación', (list) => list.filter((e) => e.id !== id));
  c.selEffect = l[i + 1]?.id ?? l[i - 1]?.id ?? null;
  c.touch();
}

export function moveEffect(c: SlidesCtl, id: string, delta: -1 | 1): void {
  setEffects(c, 'Reordenar animaciones', (l) => {
    const i = l.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return l;
    const out = [...l];
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  });
}

export const selectedEffect = (c: SlidesCtl): AnimEffect | undefined => effectsOf(c.slide).find((e) => e.id === c.selEffect);

// ---------------------------------------------------------------------------------------------- transitions

export function setTransition(c: SlidesCtl, fn: (t: Transition | undefined) => Transition | undefined, ids = c.selSlides, label = 'Cambiar transición'): void {
  c.apply(label, (d) => ids.reduce((acc, id) => updateSlide(acc, id, (s) => ({ ...s, transition: fn(s.transition) })), d));
}

/** Gives every slide the transition of the current one. */
export function transitionToAll(c: SlidesCtl): void {
  const cur = c.slide.transition;
  c.apply('Aplicar la transición a todas', (d) => ({ ...d, slides: d.slides.map((s) => ({ ...s, transition: cur ? { ...cur } : undefined })) }));
}

export const TRANSITIONS: { type: string; label: string; dirs?: { id: string; label: string }[]; orient?: boolean }[] = [
  { type: 'none', label: 'Ninguna' },
  { type: 'fade', label: 'Desvanecer', dirs: [{ id: 'smooth', label: 'Suave' }, { id: 'thruBlk', label: 'A través de negro' }] },
  { type: 'push', label: 'Empujar', dirs: [{ id: 'l', label: 'Desde la derecha' }, { id: 'r', label: 'Desde la izquierda' }, { id: 'd', label: 'Desde arriba' }, { id: 'u', label: 'Desde abajo' }] },
  { type: 'wipe', label: 'Barrido', dirs: [{ id: 'l', label: 'Desde la derecha' }, { id: 'r', label: 'Desde la izquierda' }, { id: 'd', label: 'Desde arriba' }, { id: 'u', label: 'Desde abajo' }] },
  { type: 'split', label: 'Dividir', dirs: [{ id: 'in', label: 'Hacia dentro' }, { id: 'out', label: 'Hacia fuera' }], orient: true },
  { type: 'cover', label: 'Cubrir', dirs: [{ id: 'l', label: 'Desde la derecha' }, { id: 'r', label: 'Desde la izquierda' }, { id: 'd', label: 'Desde arriba' }, { id: 'u', label: 'Desde abajo' }] },
  { type: 'pull', label: 'Descubrir', dirs: [{ id: 'l', label: 'Hacia la izquierda' }, { id: 'r', label: 'Hacia la derecha' }, { id: 'd', label: 'Hacia abajo' }, { id: 'u', label: 'Hacia arriba' }] },
  { type: 'dissolve', label: 'Disolver' },
  { type: 'circle', label: 'Círculo' },
  { type: 'diamond', label: 'Diamante' },
  { type: 'wedge', label: 'Cuña' },
  { type: 'blinds', label: 'Persianas', orient: true },
  { type: 'checker', label: 'Cuadros' },
  { type: 'comb', label: 'Peine' },
  { type: 'zoom', label: 'Zoom' },
  { type: 'flip', label: 'Voltear' },
  { type: 'doors', label: 'Puertas' },
  { type: 'random', label: 'Aleatoria' },
];
