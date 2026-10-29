import { Button, Checkbox, Input, Select, Tab, TabList } from '@fluentui/react-components';
import { colToName, nameToCol, type PageSetup, type Rect } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { useMemo, useRef, useState } from 'react';
import type { CalcUI } from './commands';
import { parseRangeText, rectText } from './dlg-table';
import { Modal, field, row2 } from './modal';
import { printHtml, type PrintScope } from './print';

const PAPERS: PageSetup['paper'][] = ['A4', 'A3', 'A5', 'Letter', 'Legal'];

const areasText = (areas: Rect[]): string => areas.map((r) => rectText(r)).join(',');
const rowsText = (r?: { r1: number; r2: number }): string => (r ? `$${r.r1 + 1}:$${r.r2 + 1}` : '');
const colsText = (c?: { c1: number; c2: number }): string => (c ? `$${colToName(c.c1)}:$${colToName(c.c2)}` : '');

function parseRows(text: string): { r1: number; r2: number } | undefined | 'bad' {
  const s = text.trim().replace(/\$/g, '');
  if (!s) return undefined;
  const m = /^(\d+)(?::(\d+))?$/.exec(s);
  if (!m) return 'bad';
  const a = Number(m[1]) - 1;
  const b = Number(m[2] ?? m[1]) - 1;
  return a < 0 || b < 0 ? 'bad' : { r1: Math.min(a, b), r2: Math.max(a, b) };
}
function parseCols(text: string): { c1: number; c2: number } | undefined | 'bad' {
  const s = text.trim().replace(/\$/g, '').toUpperCase();
  if (!s) return undefined;
  const m = /^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/.exec(s);
  if (!m) return 'bad';
  const a = nameToCol(m[1]!);
  const b = nameToCol(m[2] ?? m[1]!);
  return a < 0 || b < 0 ? 'bad' : { c1: Math.min(a, b), c2: Math.max(a, b) };
}

export function PageSetupDialog({ ui, onClose, onPreview }: { ui: CalcUI; onClose: () => void; onPreview: () => void }) {
  const d = ui.doc;
  const pr = d.sheet.print;
  const g = pr.page;
  const [tab, setTab] = useState('page');
  const [orientation, setOrientation] = useState(g.orientation);
  const [paper, setPaper] = useState(g.paper);
  const [fit, setFit] = useState(g.fitWidth > 0 || g.fitHeight > 0);
  const [scale, setScale] = useState(String(g.scale));
  const [fitW, setFitW] = useState(String(g.fitWidth || 1));
  const [fitH, setFitH] = useState(String(g.fitHeight));
  const [mT, setMT] = useState(String(g.margins.top));
  const [mB, setMB] = useState(String(g.margins.bottom));
  const [mL, setML] = useState(String(g.margins.left));
  const [mR, setMR] = useState(String(g.margins.right));
  const [centerH, setCenterH] = useState(g.centerH);
  const [centerV, setCenterV] = useState(g.centerV);
  const [header, setHeader] = useState(g.header ?? '');
  const [footer, setFooter] = useState(g.footer ?? '');
  const [area, setArea] = useState(areasText(pr.areas));
  const [titleRows, setTitleRows] = useState(rowsText(pr.titleRows));
  const [titleCols, setTitleCols] = useState(colsText(pr.titleCols));
  const [grid, setGrid] = useState(g.gridlines);
  const [heads, setHeads] = useState(g.headings);
  const lastField = useRef<'header' | 'footer'>('footer');
  const num = (s: string) => Number(s.replace(',', '.'));
  const margins = [mT, mB, mL, mR].map(num);
  const areaParts = area
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => parseRangeText(x));
  const rowsParsed = parseRows(titleRows);
  const colsParsed = parseCols(titleCols);
  const ok = margins.every((m) => Number.isFinite(m) && m >= 0 && m < 10) && num(scale) >= 10 && num(scale) <= 400 && areaParts.every(Boolean) && rowsParsed !== 'bad' && colsParsed !== 'bad' && (!fit || (Number(fitW) >= 0 && Number(fitH) >= 0));
  const insertCode = (code: string) => {
    if (lastField.current === 'header') setHeader(header + code);
    else setFooter(footer + code);
  };
  const apply = (preview: boolean) => {
    d.run('Configurar página', () => [
      d.wb.editObjects(d.activeSheetId, (s) => {
        s.print.page = {
          orientation,
          paper,
          margins: { top: margins[0]!, bottom: margins[1]!, left: margins[2]!, right: margins[3]! },
          scale: fit ? 100 : Math.round(num(scale)),
          fitWidth: fit ? Math.max(0, Math.round(Number(fitW))) : 0,
          fitHeight: fit ? Math.max(0, Math.round(Number(fitH))) : 0,
          gridlines: grid,
          headings: heads,
          centerH,
          centerV,
          header,
          footer,
        };
        s.print.areas = areaParts.map((p) => p!.rect);
        s.print.titleRows = rowsParsed === 'bad' ? undefined : rowsParsed;
        s.print.titleCols = colsParsed === 'bad' ? undefined : colsParsed;
      }),
    ]);
    onClose();
    if (preview) onPreview();
  };
  return (
    <Modal
      title={t('Configurar página')}
      onClose={onClose}
      width={600}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button disabled={!ok} onClick={() => apply(true)}>
            {t('Vista previa')}
          </Button>
          <Button appearance="primary" disabled={!ok} onClick={() => apply(false)}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <TabList selectedValue={tab} onTabSelect={(_e, v) => setTab(String(v.value))} style={{ marginBottom: 12 }}>
        <Tab value="page">{t('Página')}</Tab>
        <Tab value="margins">{t('Márgenes')}</Tab>
        <Tab value="hf">{t('Encabezado y pie de página')}</Tab>
        <Tab value="sheet">{t('Hoja')}</Tab>
      </TabList>
      {tab === 'page' && (
        <>
          <div style={row2}>
            <div style={field}>
              <label htmlFor="ps-or">{t('Orientación')}</label>
              <Select id="ps-or" value={orientation} onChange={(_e, v) => setOrientation(v.value as PageSetup['orientation'])}>
                <option value="portrait">{t('Vertical')}</option>
                <option value="landscape">{t('Horizontal')}</option>
              </Select>
            </div>
            <div style={field}>
              <label htmlFor="ps-paper">{t('Tamaño del papel')}</label>
              <Select id="ps-paper" value={paper} onChange={(_e, v) => setPaper(v.value as PageSetup['paper'])}>
                {PAPERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend>{t('Escala')}</legend>
            <label style={{ display: 'block', marginBottom: 4 }}>
              <input type="radio" name="ps-scale" checked={!fit} onChange={() => setFit(false)} /> {t('Ajustar al')}{' '}
              <Input aria-label={t('Porcentaje')} style={{ width: 70 }} value={scale} disabled={fit} onChange={(_e, v) => setScale(v.value)} /> % {t('del tamaño normal')}
            </label>
            <label style={{ display: 'block' }}>
              <input type="radio" name="ps-scale" checked={fit} onChange={() => setFit(true)} /> {t('Ajustar a')}{' '}
              <Input aria-label={t('Páginas de ancho')} style={{ width: 56 }} value={fitW} disabled={!fit} onChange={(_e, v) => setFitW(v.value)} /> {t('páginas de ancho por')}{' '}
              <Input aria-label={t('Páginas de alto')} style={{ width: 56 }} value={fitH} disabled={!fit} onChange={(_e, v) => setFitH(v.value)} /> {t('de alto (0 = las necesarias)')}
            </label>
          </fieldset>
        </>
      )}
      {tab === 'margins' && (
        <>
          <p>{t('Márgenes en centímetros')}</p>
          <div style={row2}>
            {([
              ['Superior', mT, setMT],
              ['Inferior', mB, setMB],
              ['Izquierdo', mL, setML],
              ['Derecho', mR, setMR],
            ] as const).map(([label, value, set]) => (
              <div style={field} key={label}>
                <label>{t(label)}</label>
                <Input value={value} onChange={(_e, v) => set(v.value)} aria-invalid={!Number.isFinite(num(value)) || num(value) < 0} />
              </div>
            ))}
          </div>
          <Checkbox label={t('Centrar en la página horizontalmente')} checked={centerH} onChange={(_e, v) => setCenterH(!!v.checked)} />
          <Checkbox label={t('Centrar en la página verticalmente')} checked={centerV} onChange={(_e, v) => setCenterV(!!v.checked)} />
        </>
      )}
      {tab === 'hf' && (
        <>
          <div style={field}>
            <label htmlFor="ps-h">{t('Encabezado')}</label>
            <Input id="ps-h" value={header} onFocus={() => (lastField.current = 'header')} onChange={(_e, v) => setHeader(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="ps-f">{t('Pie de página')}</label>
            <Input id="ps-f" value={footer} onFocus={() => (lastField.current = 'footer')} onChange={(_e, v) => setFooter(v.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {([
              ['Número de página', '&P'],
              ['Número de páginas', '&N'],
              ['Fecha', '&D'],
              ['Hora', '&T'],
              ['Archivo', '&F'],
              ['Hoja', '&A'],
            ] as const).map(([label, code]) => (
              <Button key={code} size="small" onClick={() => insertCode(code)}>
                {t(label)}
              </Button>
            ))}
          </div>
          <small>{t('Use &L, &C y &R para la sección izquierda, central y derecha. Ejemplo: &LInforme&CPágina &P de &N&R&D')}</small>
        </>
      )}
      {tab === 'sheet' && (
        <>
          <div style={field}>
            <label htmlFor="ps-area">{t('Área de impresión')}</label>
            <Input id="ps-area" value={area} placeholder="$A$1:$F$40" onChange={(_e, v) => setArea(v.value)} aria-invalid={!areaParts.every(Boolean)} />
          </div>
          <div style={row2}>
            <div style={field}>
              <label htmlFor="ps-tr">{t('Repetir filas en extremo superior')}</label>
              <Input id="ps-tr" value={titleRows} placeholder="$1:$2" onChange={(_e, v) => setTitleRows(v.value)} aria-invalid={rowsParsed === 'bad'} />
            </div>
            <div style={field}>
              <label htmlFor="ps-tc">{t('Repetir columnas a la izquierda')}</label>
              <Input id="ps-tc" value={titleCols} placeholder="$A:$B" onChange={(_e, v) => setTitleCols(v.value)} aria-invalid={colsParsed === 'bad'} />
            </div>
          </div>
          <Checkbox label={t('Líneas de cuadrícula')} checked={grid} onChange={(_e, v) => setGrid(!!v.checked)} />
          <Checkbox label={t('Encabezados de filas y columnas')} checked={heads} onChange={(_e, v) => setHeads(!!v.checked)} />
        </>
      )}
    </Modal>
  );
}

export function PrintPreviewDialog({ ui, onClose, onSetup }: { ui: CalcUI; onClose: () => void; onSetup: () => void }) {
  const d = ui.doc;
  const [scope, setScope] = useState<PrintScope>('sheet');
  const frame = useRef<HTMLIFrameElement>(null);
  const built = useMemo(() => printHtml(d, scope), [d, scope, d.getVersion()]);
  const count = built.layout.pages.length;
  return (
    <Modal
      title={t('Vista previa de impresión')}
      onClose={onClose}
      width={980}
      actions={
        <>
          <Button onClick={onSetup}>{t('Configurar página…')}</Button>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
          <Button
            appearance="primary"
            disabled={count === 0}
            onClick={() => {
              frame.current?.contentWindow?.focus();
              frame.current?.contentWindow?.print();
            }}
          >
            {t('Imprimir / guardar como PDF…')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <label htmlFor="pp-scope">{t('Imprimir')}</label>
        <Select id="pp-scope" value={scope} onChange={(_e, v) => setScope(v.value as PrintScope)} style={{ width: 220 }}>
          <option value="sheet">{t('La hoja activa')}</option>
          <option value="selection">{t('La selección')}</option>
          <option value="workbook">{t('Todo el libro')}</option>
        </Select>
        <span role="status">{count ? t('{n} páginas', { n: count }) : t(built.layout.empty ?? 'No hay nada que imprimir.')}</span>
      </div>
      <iframe ref={frame} title={t('Vista previa de impresión')} srcDoc={built.html} style={{ width: '100%', height: '62vh', border: '1px solid var(--colorNeutralStroke2)', background: '#8a8a8a' }} />
    </Modal>
  );
}
