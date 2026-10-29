// Compiles the ECMA-376 preset shape definitions (data/presetShapeDefinitions.xml, as published by ECMA and shipped with
// LibreOffice under MPL-2.0) into a compact JSON used by src/geometry. Run: node scripts/build-presets.mjs
import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const xml = fs.readFileSync(path.join(here, '../data/presetShapeDefinitions.xml'), 'utf8');
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
const root = parser.parse(xml);
const top = root.find((n) => n.presetShapeDefinitons)?.presetShapeDefinitons;
if (!top) throw new Error('unexpected root');

const tag = (n) => Object.keys(n).find((k) => k !== ':@');
const attrs = (n) => n[':@'] ?? {};
const kids = (n) => n[tag(n)] ?? [];
const a = (n, k) => attrs(n)['@_' + k];
const num = (s) => (s === undefined ? undefined : Number.isNaN(Number(s)) ? s : Number(s));

const out = {};
for (const shape of top) {
  const name = tag(shape);
  if (name === '#text') continue;
  const def = { av: {}, gd: [], ah: [], cxn: [], rect: null, paths: [] };
  for (const sec of kids(shape)) {
    const st = tag(sec);
    if (st === 'avLst') for (const g of kids(sec)) def.av[a(g, 'name')] = a(g, 'fmla');
    else if (st === 'gdLst') for (const g of kids(sec)) def.gd.push([a(g, 'name'), a(g, 'fmla')]);
    else if (st === 'ahLst')
      for (const h of kids(sec)) {
        const pos = kids(h).find((k) => tag(k) === 'pos');
        const p = pos ? { x: a(pos, 'x'), y: a(pos, 'y') } : { x: '0', y: '0' };
        if (tag(h) === 'ahXY') def.ah.push({ t: 'xy', rx: a(h, 'gdRefX'), ry: a(h, 'gdRefY'), minX: a(h, 'minX'), maxX: a(h, 'maxX'), minY: a(h, 'minY'), maxY: a(h, 'maxY'), ...p });
        else def.ah.push({ t: 'polar', rr: a(h, 'gdRefR'), ra: a(h, 'gdRefAng'), minR: a(h, 'minR'), maxR: a(h, 'maxR'), minA: a(h, 'minAng'), maxA: a(h, 'maxAng'), ...p });
      }
    else if (st === 'cxnLst')
      for (const c of kids(sec)) {
        const pos = kids(c).find((k) => tag(k) === 'pos');
        def.cxn.push({ ang: a(c, 'ang'), x: a(pos, 'x'), y: a(pos, 'y') });
      }
    else if (st === 'rect') def.rect = [a(sec, 'l'), a(sec, 't'), a(sec, 'r'), a(sec, 'b')];
    else if (st === 'pathLst')
      for (const p of kids(sec)) {
        const path = { w: num(a(p, 'w')), h: num(a(p, 'h')), fill: a(p, 'fill'), stroke: a(p, 'stroke') === 'false' ? false : undefined, cmds: [] };
        for (const c of kids(p)) {
          const ct = tag(c);
          const pts = kids(c).filter((k) => tag(k) === 'pt').map((k) => [a(k, 'x'), a(k, 'y')]);
          if (ct === 'moveTo') path.cmds.push(['M', ...pts[0]]);
          else if (ct === 'lnTo') path.cmds.push(['L', ...pts[0]]);
          else if (ct === 'arcTo') path.cmds.push(['A', a(c, 'wR'), a(c, 'hR'), a(c, 'stAng'), a(c, 'swAng')]);
          else if (ct === 'quadBezTo') path.cmds.push(['Q', ...pts.flat()]);
          else if (ct === 'cubicBezTo') path.cmds.push(['C', ...pts.flat()]);
          else if (ct === 'close') path.cmds.push(['Z']);
        }
        def.paths.push(path);
      }
  }
  out[name] = def;
}
const target = path.join(here, '../src/geometry/presets.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out));
console.log(Object.keys(out).length, 'presets,', (fs.statSync(target).size / 1024).toFixed(0), 'KB');
