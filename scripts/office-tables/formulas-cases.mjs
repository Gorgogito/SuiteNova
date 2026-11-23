// The formula cases compared with Word: `node scripts/office-tables/formulas-cases.mjs write <dir>` writes casos.json; `... compare <dir>` compares resultados.json
// (what Word answered) with table-core's `evalFormula`. Needs the project's TypeScript through Vite (`pnpm dev` on :1420).
import { chromium } from '../../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [mode, dir, ...rest] = process.argv.slice(2);
const verbose = rest.includes('--verbose');
const T = (n, cells, row, col, formula) => ({ name: n, cells, row, col, formula });
const S = ['Producto', 'Cant', 'Precio'];
const CASES = [
  T('suma arriba con encabezado de texto', [['Cant'], ['2'], ['3'], ['']], 3, 0, '=SUM(ABOVE)'),
  T('suma arriba se detiene en la celda vacia', [['1'], ['2'], [''], ['4'], ['']], 4, 0, '=SUM(ABOVE)'),
  T('suma arriba salta el texto del medio', [['1'], ['abc'], ['3'], ['']], 3, 0, '=SUM(ABOVE)'),
  T('suma arriba con la celda de arriba vacia', [['5'], [''], ['']], 2, 0, '=SUM(ABOVE)'),
  T('suma izquierda', [['1', '2', '3', '']], 0, 3, '=SUM(LEFT)'),
  T('suma izquierda con vacia', [['1', '', '3', '']], 0, 3, '=SUM(LEFT)'),
  T('suma derecha', [['', '2', '3', '4']], 0, 0, '=SUM(RIGHT)'),
  T('suma abajo', [[''], ['2'], ['3']], 0, 0, '=SUM(BELOW)'),
  T('promedio arriba', [['2'], ['4'], ['6'], ['']], 3, 0, '=AVERAGE(ABOVE)'),
  T('contar arriba', [['2'], ['x'], ['6'], ['']], 3, 0, '=COUNT(ABOVE)'),
  T('min y max arriba', [['2'], ['9'], ['6'], ['']], 3, 0, '=MAX(ABOVE)-MIN(ABOVE)'),
  T('producto', [['2'], ['3'], ['4'], ['']], 3, 0, '=PRODUCT(ABOVE)'),
  T('referencias', [S, ['A', '2', '10'], ['B', '3', '20'], ['', '', '']], 3, 2, '=B2*C2+B3*C3'),
  T('rango', [S, ['A', '2', '10'], ['B', '3', '20'], ['C', '5', '30'], ['', '', '']], 4, 1, '=SUM(B2:B4)'),
  T('rango rectangular', [S, ['A', '2', '10'], ['B', '3', '20'], ['', '', '']], 3, 0, '=SUM(B2:C3)'),
  T('promedio de rango', [S, ['A', '2', '10'], ['B', '3', '20'], ['', '', '']], 3, 2, '=AVERAGE(C2:C3)'),
  T('referencia a texto', [['hola', '2'], ['', '']], 1, 0, '=A1+B1'),
  T('referencia a vacia', [['', '2'], ['', '']], 1, 0, '=A1+B1'),
  T('moneda con coma de miles', [['$1,200.50'], ['$800'], ['']], 2, 0, '=SUM(ABOVE)'),
  T('porcentaje en una celda', [['50%', '']], 0, 1, '=A1*2'),
  T('porcentaje suma', [['50%'], ['25%'], ['']], 2, 0, '=SUM(ABOVE)'),
  T('negativo entre parentesis', [['(5)'], ['10'], ['']], 2, 0, '=SUM(ABOVE)'),
  T('negativo con signo', [['-5'], ['10'], ['']], 2, 0, '=SUM(ABOVE)'),
  T('numero con unidad', [['12 kg'], ['8 kg'], ['']], 2, 0, '=SUM(ABOVE)'),
  T('operadores', [['']], 0, 0, '=1+2*3'),
  T('parentesis', [['']], 0, 0, '=(1+2)*3'),
  T('potencia', [['']], 0, 0, '=2^3'),
  T('porcentaje literal', [['']], 0, 0, '=50%*200'),
  T('division', [['']], 0, 0, '=10/4'),
  T('redondear', [['']], 0, 0, '=ROUND(10/3,2)'),
  T('redondear negativo medio', [['']], 0, 0, '=ROUND(-2.5,0)'),
  T('redondear 2.5', [['']], 0, 0, '=ROUND(2.5,0)'),
  T('redondear a centenas', [['']], 0, 0, '=ROUND(1234.5,-2)'),
  T('entero', [['']], 0, 0, '=INT(-2.5)'),
  T('residuo', [['']], 0, 0, '=MOD(10,3)'),
  T('residuo negativo', [['']], 0, 0, '=MOD(-1,3)'),
  T('abs', [['']], 0, 0, '=ABS(-4)'),
  T('signo', [['']], 0, 0, '=SIGN(-4)'),
  T('si', [['']], 0, 0, '=IF(2>1,100,200)'),
  T('si falso', [['']], 0, 0, '=IF(2<1,100,200)'),
  T('y', [['']], 0, 0, '=AND(1,1,0)'),
  T('o', [['']], 0, 0, '=OR(0,0,1)'),
  T('no', [['']], 0, 0, '=NOT(0)'),
  T('comparacion', [['']], 0, 0, '=1<>2'),
  T('imagen 0.00', [['2'], ['3'], ['']], 2, 0, '=SUM(ABOVE) \\# "0.00"'),
  T('imagen miles', [['1234.5'], ['1000'], ['']], 2, 0, '=SUM(ABOVE) \\# "#,##0.00"'),
  T('imagen moneda', [['1234.5'], ['']], 1, 0, '=SUM(ABOVE) \\# "$#,##0.00"'),
  T('imagen porcentaje', [['0.256'], ['']], 1, 0, '=SUM(ABOVE) \\# "0%"'),
  T('imagen negativo', [['-5'], ['']], 1, 0, '=SUM(ABOVE) \\# "0;(0)"'),
  T('imagen ceros a la izquierda', [['7'], ['']], 1, 0, '=SUM(ABOVE) \\# "000"'),
  T('resultado entero sin imagen', [['2'], ['3'], ['']], 2, 0, '=SUM(ABOVE)'),
  T('resultado decimal sin imagen', [['1'], ['2'], ['']], 2, 0, '=SUM(ABOVE)/3'),
  T('nombre en espanol', [['2'], ['3'], ['']], 2, 0, '=SUMA(ARRIBA)'),
  T('promedio en espanol', [['2'], ['4'], ['']], 2, 0, '=PROMEDIO(ARRIBA)'),
  T('division por cero', [['']], 0, 0, '=1/0'),
  T('error de sintaxis', [['']], 0, 0, '=SUM('),
  T('referencia fuera', [['']], 0, 0, '=Z99'),
];

if (mode === 'write') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'casos.json'), JSON.stringify(CASES));
  console.log('casos:', CASES.length);
} else if (mode === 'compare') {
  const word = JSON.parse(fs.readFileSync(path.join(dir, 'resultados.json'), 'utf8').replace(/^\uFEFF/, ''));
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://localhost:1420/?app=writer', { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror');
  const ours = await page.evaluate(
    async ({ cases, decimal }) => {
      const T = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/table-core/src/index.ts');
      return cases.map((c) => {
        const ctx = { row: c.row, col: c.col, rows: c.cells.length, cols: Math.max(...c.cells.map((r) => r.length)), text: (r, k) => c.cells[r]?.[k] ?? '', decimal };
        return T.evalFormula(c.formula, ctx);
      });
    },
    { cases: CASES, decimal: word.decimal },
  );
  await browser.close();
  let same = 0;
  const diffs = [];
  CASES.forEach((c, i) => {
    const w = word.results[i].result;
    const o = ours[i];
    const wErr = /^[!¡]|Error|error|cero|sintaxis/i.test(w);
    const ok = o.error ? wErr : !wErr && w.replace(/\s/g, '') === o.text.replace(/\s/g, '');
    if (ok) same++;
    else diffs.push(`${c.name}: ${c.formula} → Word «${w}», nosotros «${o.text}»`);
  });
  console.log(`decimal de Word '${word.decimal}', lista '${word.list}'`);
  console.log(`casos iguales: ${same} de ${CASES.length}`);
  diffs.forEach((d) => console.log('  ✘', d));
  if (verbose) CASES.forEach((c, i) => console.log('   ', c.name, '|', word.results[i].result, '|', ours[i].text));
  process.exit(diffs.length ? 1 : 0);
}
