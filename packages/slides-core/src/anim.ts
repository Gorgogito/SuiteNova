import { esc } from '@suitenova/writer-core';
import type { AnimEffect, Slide, SlideElement, Timing } from './types';

/*
 * Animations. The model keeps a flat list of effects (what happens to which object, how it starts, how long it takes); the time tree
 * of PresentationML (`p:timing`) is generated from it using the same node structure PowerPoint writes for its built-in effects.
 */

export interface PresetInfo {
  id: number;
  cls: 'entr' | 'exit' | 'emph';
  label: string;
  /** the kind of animation: how the object appears */
  kind: 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'spin' | 'grow' | 'pulse' | 'colorPulse' | 'bounce' | 'float' | 'split' | 'blinds' | 'wheel' | 'random' | 'teeter' | 'transparency';
  subtypes?: { id: number; label: string; dir?: string }[];
}

const DIRS8 = [
  { id: 1, label: 'Desde arriba', dir: 'up' },
  { id: 2, label: 'Desde la derecha', dir: 'right' },
  { id: 4, label: 'Desde abajo', dir: 'down' },
  { id: 8, label: 'Desde la izquierda', dir: 'left' },
];

export const PRESETS: PresetInfo[] = [
  { id: 1, cls: 'entr', label: 'Aparecer', kind: 'appear' },
  { id: 10, cls: 'entr', label: 'Desvanecer', kind: 'fade' },
  { id: 2, cls: 'entr', label: 'Entrada volando', kind: 'fly', subtypes: DIRS8 },
  { id: 22, cls: 'entr', label: 'Barrido', kind: 'wipe', subtypes: DIRS8 },
  { id: 53, cls: 'entr', label: 'Zoom', kind: 'zoom' },
  { id: 47, cls: 'entr', label: 'Flotar hacia dentro', kind: 'float' },
  { id: 3, cls: 'entr', label: 'Persianas', kind: 'blinds' },
  { id: 16, cls: 'entr', label: 'Dividir', kind: 'split' },
  { id: 21, cls: 'entr', label: 'Rueda', kind: 'wheel' },
  { id: 12, cls: 'entr', label: 'Rebote', kind: 'bounce' },
  { id: 8, cls: 'emph', label: 'Girar', kind: 'spin' },
  { id: 6, cls: 'emph', label: 'Crecer y reducir', kind: 'grow' },
  { id: 26, cls: 'emph', label: 'Pulso', kind: 'pulse' },
  { id: 32, cls: 'emph', label: 'Balancear', kind: 'teeter' },
  { id: 9, cls: 'emph', label: 'Transparencia', kind: 'transparency' },
  { id: 1, cls: 'exit', label: 'Desaparecer', kind: 'appear' },
  { id: 10, cls: 'exit', label: 'Desvanecer (salida)', kind: 'fade' },
  { id: 2, cls: 'exit', label: 'Salida volando', kind: 'fly', subtypes: DIRS8 },
  { id: 22, cls: 'exit', label: 'Barrido (salida)', kind: 'wipe', subtypes: DIRS8 },
  { id: 53, cls: 'exit', label: 'Zoom (salida)', kind: 'zoom' },
];

export const presetInfo = (cls: string, id: number): PresetInfo | undefined => PRESETS.find((p) => p.cls === cls && p.id === id);

export function newEffect(target: string, preset: PresetInfo, over: Partial<AnimEffect> = {}): AnimEffect {
  return { id: `an${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, target, cls: preset.cls, preset: preset.id, subtype: preset.subtypes?.[0]?.id, trigger: 'onClick', dur: preset.kind === 'appear' ? 1 : 500, ...over };
}

export function withTiming(slide: Slide, effects: AnimEffect[]): Slide {
  // editing the animations discards the original time tree: it is written again from the effects
  return { ...slide, timing: { effects, rawXml: undefined } };
}

// ------------------------------------------------------------------------------------------------ XML

const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function allIds(shapes: SlideElement[], out = new Map<string, number>()): Map<string, number> {
  for (const s of shapes) {
    if (s.srcId !== undefined) out.set(s.id, s.srcId);
    if (s.kind === 'group') allIds(s.children, out);
  }
  return out;
}

/** The numeric shape ids the writer will assign (same rule as the package writer: keep srcId, else take the next free). */
export function shapeIdMap(slide: Slide): Map<string, number> {
  const used = new Set<number>();
  const map = new Map<string, number>();
  let next = 2;
  const visit = (els: SlideElement[]) => {
    for (const e of els) {
      let id = e.srcId;
      if (id === undefined || used.has(id) || id < 2) id = next;
      used.add(id);
      next = Math.max(next, id + 1);
      map.set(e.id, id);
      if (e.kind === 'group') visit(e.children);
    }
  };
  visit(slide.shapes);
  void allIds;
  return map;
}

let ctn = 0;
const cTn = (attrs: string, inner: string) => `<p:cTn id="${++ctn}"${attrs}>${inner}</p:cTn>`;
const cond = (delay: number | string) => `<p:cond delay="${delay}"/>`;
const tgt = (spid: number, para?: [number, number]) => `<p:tgtEl><p:spTgt spid="${spid}">${para ? `<p:txEl><p:pRg st="${para[0]}" end="${para[1]}"/></p:txEl>` : ''}</p:spTgt></p:tgtEl>`;
const setVis = (spid: number, to: 'visible' | 'hidden', delay = 0, para?: [number, number]) =>
  `<p:set><p:cBhvr>${cTn(' dur="1" fill="hold"', `<p:stCondLst>${cond(delay)}</p:stCondLst>`)}${tgt(spid, para)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${to}"/></p:to></p:set>`;
const animEffect = (spid: number, filter: string, dur: number, transition: 'in' | 'out', para?: [number, number]) =>
  `<p:animEffect transition="${transition}" filter="${filter}"><p:cBhvr>${cTn(` dur="${dur}"`, '')}${tgt(spid, para)}</p:cBhvr></p:animEffect>`;
const anim = (spid: number, attr: string, dur: number, from: string, to: string, para?: [number, number], fmla?: string) =>
  `<p:anim calcmode="lin" valueType="num"><p:cBhvr>${cTn(` dur="${dur}" fill="hold"`, '')}${tgt(spid, para)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val>${fmla ? `<p:strVal val="${from}"/>` : `<p:strVal val="${from}"/>`}</p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;

/** Behaviours of one effect (the children of its `p:cTn`). */
function behaviours(e: AnimEffect, spid: number): string {
  const p = presetInfo(e.cls, e.preset);
  const d = e.dur ?? 500;
  const para = e.para;
  const enter = e.cls === 'entr';
  const exit = e.cls === 'exit';
  if (e.cls === 'emph') {
    switch (p?.kind) {
      case 'spin':
        return `<p:animRot by="${(e.value ? Number(e.value) : 360) * 60000}"><p:cBhvr>${cTn(` dur="${d}" fill="hold"`, '')}${tgt(spid, para)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
      case 'grow':
        return `<p:animScale><p:cBhvr>${cTn(` dur="${d}" fill="hold"`, '')}${tgt(spid, para)}</p:cBhvr><p:by x="150000" y="150000"/></p:animScale>`;
      case 'pulse':
        return `<p:animScale><p:cBhvr>${cTn(` dur="${d}" autoRev="1" fill="hold"`, '')}${tgt(spid, para)}</p:cBhvr><p:by x="105000" y="105000"/></p:animScale>`;
      case 'teeter':
        return `<p:animRot by="300000"><p:cBhvr>${cTn(` dur="${d / 4}" autoRev="1" fill="hold"`, '')}${tgt(spid, para)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
      default:
        return `<p:animEffect transition="in" filter="fade"><p:cBhvr>${cTn(` dur="${d}" autoRev="1"`, '')}${tgt(spid, para)}</p:cBhvr></p:animEffect>`;
    }
  }
  const t = exit ? 'out' : 'in';
  const vis = enter ? setVis(spid, 'visible', 0, para) : '';
  const hide = exit ? setVis(spid, 'hidden', d, para) : '';
  const eff = (filter: string) => `${vis}${animEffect(spid, filter, d, t, para)}${hide}`;
  switch (p?.kind) {
    case 'appear':
      return enter ? setVis(spid, 'visible', 0, para) : setVis(spid, 'hidden', 0, para);
    case 'fade':
      return eff('fade');
    case 'wipe': {
      const dir = DIRS8.find((x) => x.id === e.subtype)?.dir ?? 'left';
      return eff(`wipe(${dir})`);
    }
    case 'blinds':
      return eff('blinds(horizontal)');
    case 'split':
      return eff('barn(inVertical)');
    case 'wheel':
      return eff('wheel(1)');
    case 'zoom':
    case 'float':
    case 'bounce':
      return `${vis}${anim(spid, 'ppt_w', d, enter ? '0' : '#ppt_w', enter ? '#ppt_w' : '0', para)}${anim(spid, 'ppt_h', d, enter ? '0' : '#ppt_h', enter ? '#ppt_h' : '0', para)}${enter ? '' : ''}${hide}`;
    case 'fly': {
      const dir = DIRS8.find((x) => x.id === e.subtype)?.dir ?? 'left';
      const attr = dir === 'left' || dir === 'right' ? 'ppt_x' : 'ppt_y';
      const from = dir === 'left' ? '0-#ppt_w/2' : dir === 'right' ? '1+#ppt_w/2' : dir === 'up' ? '0-#ppt_h/2' : '1+#ppt_h/2';
      return `${vis}${anim(spid, attr, d, enter ? from : '#' + attr, enter ? '#' + attr : from, para)}${hide}`;
    }
    default:
      return eff('fade');
  }
}

/** The `p:timing` element for a list of effects of one slide. */
export function timingXml(slide: Slide, effects: AnimEffect[]): string {
  if (!effects.length) return '';
  ctn = 2;
  const ids = shapeIdMap(slide);
  // an effect that starts on click opens a click group; "after previous" opens a sub-group that starts when the previous one is done;
  // "with previous" joins the current sub-group
  interface Sub {
    delay: number;
    items: AnimEffect[];
  }
  const groups: Sub[][] = [];
  let groupEnd = 0;
  for (const e of effects) {
    if (e.trigger === 'onClick' || !groups.length) {
      groups.push([{ delay: 0, items: [e] }]);
      groupEnd = (e.delay ?? 0) + (e.dur ?? 500);
    } else {
      const g = groups[groups.length - 1]!;
      if (e.trigger === 'afterPrev') {
        g.push({ delay: groupEnd, items: [e] });
        groupEnd += (e.delay ?? 0) + (e.dur ?? 500);
      } else {
        const sub = g[g.length - 1]!;
        sub.items.push(e);
        groupEnd = Math.max(groupEnd, sub.delay + (e.delay ?? 0) + (e.dur ?? 500));
      }
    }
  }
  let seq = '';
  for (const g of groups) {
    let subs = '';
    for (const sub of g) {
      let items = '';
      for (const e of sub.items) {
        const spid = ids.get(e.target);
        if (spid === undefined) continue;
        const node = e.trigger === 'onClick' ? 'clickEffect' : e.trigger === 'withPrev' ? 'withEffect' : 'afterEffect';
        items += `<p:par>${cTn(` presetID="${e.preset}" presetClass="${e.cls}" presetSubtype="${e.subtype ?? 0}" fill="hold" nodeType="${node}"`, `<p:stCondLst>${cond(e.delay ?? 0)}</p:stCondLst><p:childTnLst>${behaviours(e, spid)}</p:childTnLst>`)}</p:par>`;
      }
      if (items) subs += `<p:par>${cTn(' fill="hold"', `<p:stCondLst>${cond(sub.delay)}</p:stCondLst><p:childTnLst>${items}</p:childTnLst>`)}</p:par>`;
    }
    seq += `<p:par>${cTn(' fill="hold"', `<p:stCondLst>${cond('indefinite')}</p:stCondLst><p:childTnLst>${subs}</p:childTnLst>`)}</p:par>`;
  }
  const mainSeq = `<p:cTn id="${++ctn}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${seq}</p:childTnLst></p:cTn>`;
  const nav = '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>';
  return `<p:timing ${NS_P}><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek">${mainSeq}${nav}</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

export function timingFor(slide: Slide): string {
  const t: Timing | undefined = slide.timing;
  if (!t) return '';
  return t.rawXml ?? timingXml(slide, t.effects);
}

export { esc };
