// Compiles the ECMA-376 preset text warp definitions (data/presetTextWarpDefinitions.xml) into src/textwarps.json, in the same compact
// form shapes-core uses for preset shapes (guides, adjust handles and paths), so that the same formula evaluator can run them.
// Run: node scripts/build-textwarps.mjs
import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const xml = fs.readFileSync(path.join(here, '../data/presetTextWarpDefinitions.xml'), 'utf8');
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
const root = parser.parse(xml);
const top = root.find((n) => n.presetTextWarpDefinitions)?.presetTextWarpDefinitions;
if (!top) throw new Error('unexpected root');

const tag = (n) => Object.keys(n).find((k) => k !== ':@');
const attrs = (n) => n[':@'] ?? {};
const kids = (n) => n[tag(n)] ?? [];
const a = (n, k) => attrs(n)['@_' + k];

const out = {};
for (const shape of top) {
  const name = tag(shape);
  if (name === '#text') continue;
  const def = { av: {}, gd: [], ah: [], paths: [] };
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
    else if (st === 'pathLst')
      for (const p of kids(sec)) {
        const cmds = [];
        for (const c of kids(p)) {
          const ct = tag(c);
          const pts = kids(c).filter((k) => tag(k) === 'pt').map((k) => [a(k, 'x'), a(k, 'y')]);
          if (ct === 'moveTo') cmds.push(['M', ...pts[0]]);
          else if (ct === 'lnTo') cmds.push(['L', ...pts[0]]);
          else if (ct === 'arcTo') cmds.push(['A', a(c, 'wR'), a(c, 'hR'), a(c, 'stAng'), a(c, 'swAng')]);
          else if (ct === 'quadBezTo') cmds.push(['Q', ...pts.flat()]);
          else if (ct === 'cubicBezTo') cmds.push(['C', ...pts.flat()]);
          else if (ct === 'close') cmds.push(['Z']);
        }
        def.paths.push(cmds);
      }
  }
  out[name] = def;
}
const target = path.join(here, '../src/textwarps.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out));
console.log(Object.keys(out).length, 'text warps,', (fs.statSync(target).size / 1024).toFixed(0), 'KB');
