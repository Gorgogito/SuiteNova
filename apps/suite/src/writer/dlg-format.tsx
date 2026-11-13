import { Button, Checkbox, Input, Select, Tab, TabList } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { markTypes } from '@suitenova/writer-core';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { FONT_NAMES } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { markActive, markAttr, selectionParagraph, updateParagraphs } from './editing';
import { applyCharSpec, type CharSpec } from './format-tools';
import { SYMBOL_GROUPS } from './symbols';

const UNDERLINES: [string, string][] = [
  ['none', '(ninguno)'],
  ['single', 'Sencillo'],
  ['double', 'Doble'],
  ['thick', 'Grueso'],
  ['dotted', 'Punteado'],
  ['dash', 'Guiones'],
  ['dotDash', 'Guión y punto'],
  ['wavy', 'Ondulado'],
];

const num = (s: string, fallback: number): number => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
};

// ------------------------------------------------------------------------------------------------ Fuente
export function FontDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const st = c.state!;
  const fam = (markAttr(st, markTypes.fontFamily!, 'value') as string | undefined) ?? c.defaults.fontFamily;
  const [family, setFamily] = useState(fam);
  const [size, setSize] = useState(String((markAttr(st, markTypes.fontSize!, 'value') as number | undefined) ?? c.defaults.fontSize));
  const [bold, setBold] = useState(markActive(st, markTypes.strong!));
  const [italic, setItalic] = useState(markActive(st, markTypes.em!));
  const [color, setColor] = useState<string | null>((markAttr(st, markTypes.color!, 'value') as string | undefined) ?? null);
  const [uStyle, setUStyle] = useState(markActive(st, markTypes.underline!) ? ((markAttr(st, markTypes.underline!, 'style') as string | undefined) ?? 'single') : 'none');
  const [uColor, setUColor] = useState<string | null>((markAttr(st, markTypes.underline!, 'color') as string | null | undefined) ?? null);
  const [strike, setStrike] = useState(markActive(st, markTypes.strike!));
  const [dstrike, setDstrike] = useState(markActive(st, markTypes.dstrike!));
  const [sup, setSup] = useState(markActive(st, markTypes.superscript!));
  const [sub, setSub] = useState(markActive(st, markTypes.subscript!));
  const caps0 = markAttr(st, markTypes.caps!, 'value') as string | undefined;
  const [small, setSmall] = useState(caps0 === 'small');
  const [all, setAll] = useState(caps0 === 'all');
  const sp0 = (markAttr(st, markTypes.spacing!, 'value') as number | undefined) ?? 0;
  const [spacing, setSpacing] = useState<'normal' | 'expanded' | 'condensed'>(sp0 > 0 ? 'expanded' : sp0 < 0 ? 'condensed' : 'normal');
  const [spacingBy, setSpacingBy] = useState(String(Math.abs(sp0) || 1));
  const pt = Math.max(1, num(size, c.defaults.fontSize));
  const sp = spacing === 'normal' ? 0 : (spacing === 'expanded' ? 1 : -1) * Math.abs(num(spacingBy, 1));

  const apply = () => {
    const spec: CharSpec = {
      fontFamily: family === c.defaults.fontFamily ? null : family,
      fontSize: pt === c.defaults.fontSize ? null : pt,
      bold,
      italic,
      color,
      underline: uStyle === 'none' ? null : { style: uStyle, color: uColor },
      strike,
      dstrike,
      superscript: sup,
      subscript: sub,
      caps: all ? 'all' : small ? 'small' : null,
      spacing: sp === 0 ? null : sp,
    };
    const v = c.view!;
    applyCharSpec(spec)(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
  };
  const deco = uStyle === 'none' ? 'none' : `underline ${uStyle === 'double' ? 'double' : uStyle === 'dotted' ? 'dotted' : uStyle === 'dash' || uStyle === 'dotDash' ? 'dashed' : uStyle === 'wavy' ? 'wavy' : 'solid'} ${uColor ?? ''}`;
  return (
    <Modal
      title={t('Fuente')}
      onClose={onClose}
      width={560}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={apply}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 12 }}>
        <div style={field}>
          <label htmlFor="ft-fam">{t('Fuente')}</label>
          <Select id="ft-fam" value={family} onChange={(_e, v) => setFamily(v.value)}>
            {[...new Set([family, ...FONT_NAMES])].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="ft-size">{t('Tamaño')}</label>
          <Input id="ft-size" type="number" min={1} step={0.5} value={size} onChange={(_e, v) => setSize(v.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
        <Checkbox label={t('Negrita')} checked={bold} onChange={(_e, v) => setBold(!!v.checked)} />
        <Checkbox label={t('Cursiva')} checked={italic} onChange={(_e, v) => setItalic(!!v.checked)} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {t('Color de fuente')} <input type="color" aria-label={t('Color de fuente')} value={color ?? '#000000'} onChange={(e) => setColor(e.target.value)} />
          <Button size="small" onClick={() => setColor(null)}>
            {t('Automático')}
          </Button>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
        <div style={field}>
          <label htmlFor="ft-u">{t('Estilo de subrayado')}</label>
          <Select id="ft-u" value={uStyle} onChange={(_e, v) => setUStyle(v.value)}>
            {UNDERLINES.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </Select>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          {t('Color de subrayado')} <input type="color" aria-label={t('Color de subrayado')} disabled={uStyle === 'none'} value={uColor ?? '#000000'} onChange={(e) => setUColor(e.target.value)} />
        </label>
      </div>
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 10 }}>
        <legend>{t('Efectos')}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Checkbox label={t('Tachado')} checked={strike} onChange={(_e, v) => { setStrike(!!v.checked); if (v.checked) setDstrike(false); }} />
          <Checkbox label={t('Doble tachado')} checked={dstrike} onChange={(_e, v) => { setDstrike(!!v.checked); if (v.checked) setStrike(false); }} />
          <Checkbox label={t('Superíndice')} checked={sup} onChange={(_e, v) => { setSup(!!v.checked); if (v.checked) setSub(false); }} />
          <Checkbox label={t('Subíndice')} checked={sub} onChange={(_e, v) => { setSub(!!v.checked); if (v.checked) setSup(false); }} />
          <Checkbox label={t('Versalitas')} checked={small} onChange={(_e, v) => { setSmall(!!v.checked); if (v.checked) setAll(false); }} />
          <Checkbox label={t('Mayúsculas')} checked={all} onChange={(_e, v) => { setAll(!!v.checked); if (v.checked) setSmall(false); }} />
        </div>
      </fieldset>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 }}>
        <div style={field}>
          <label htmlFor="ft-sp">{t('Espaciado entre caracteres')}</label>
          <Select id="ft-sp" value={spacing} onChange={(_e, v) => setSpacing(v.value as typeof spacing)}>
            <option value="normal">{t('Normal')}</option>
            <option value="expanded">{t('Expandido')}</option>
            <option value="condensed">{t('Comprimido')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="ft-spby">{t('En (pt)')}</label>
          <Input id="ft-spby" type="number" min={0} step={0.25} disabled={spacing === 'normal'} value={spacingBy} onChange={(_e, v) => setSpacingBy(v.value)} />
        </div>
      </div>
      <div aria-label={t('Vista previa')} style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, padding: 14, textAlign: 'center', minHeight: 48 }}>
        <span
          style={{
            fontFamily: family,
            fontSize: Math.min(pt, 32),
            fontWeight: bold ? 700 : 400,
            fontStyle: italic ? 'italic' : 'normal',
            color: color ?? undefined,
            textDecoration: [deco, strike ? 'line-through' : dstrike ? 'line-through double' : ''].join(' ').trim() || 'none',
            fontVariant: small ? 'small-caps' : 'normal',
            textTransform: all ? 'uppercase' : 'none',
            letterSpacing: `${sp}pt`,
            verticalAlign: sup ? 'super' : sub ? 'sub' : 'baseline',
          }}
        >
          AaBbCcÁéÑñ 123
        </span>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ Párrafo
const PT_PER_CM = 28.3465;
const toCm = (pt: number) => String(Math.round((pt / PT_PER_CM) * 100) / 100);
const fromCm = (cm: string, fallback = 0) => Math.round(num(cm, fallback / PT_PER_CM) * PT_PER_CM * 10) / 10;

export function ParagraphDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const c = ui.ctl;
  const a = selectionParagraph(c.state!)?.attrs ?? {};
  const [align, setAlign] = useState<string>(a.align ?? 'left');
  const [left, setLeft] = useState(toCm(a.indentLeft ?? 0));
  const [right, setRight] = useState(toCm(a.indentRight ?? 0));
  const first0: number = a.indentFirst ?? 0;
  const [special, setSpecial] = useState<'none' | 'first' | 'hanging'>(first0 > 0 ? 'first' : first0 < 0 ? 'hanging' : 'none');
  const [specialBy, setSpecialBy] = useState(toCm(Math.abs(first0) || 36));
  const [before, setBefore] = useState(String(a.spaceBefore ?? 0));
  const [after, setAfter] = useState(String(a.spaceAfter ?? c.defaults.spaceAfter));
  const rule0 = a.lineRule === 'exact' ? 'exact' : a.lineRule === 'atLeast' ? 'atLeast' : 'multiple';
  const lh0: number = a.lineHeight ?? c.defaults.lineHeight;
  const [rule, setRule] = useState<'multiple' | 'exact' | 'atLeast'>(rule0);
  const [lineBy, setLineBy] = useState(String(lh0));
  const [keepNext, setKeepNext] = useState(!!a.keepNext);
  const [keepLines, setKeepLines] = useState(!!a.keepLines);
  const [pageBefore, setPageBefore] = useState(!!a.pageBreakBefore);
  const [outline, setOutline] = useState<string>(typeof a.outlineLevel === 'number' ? String(a.outlineLevel) : 'body');
  const apply = () => {
    const lh = Math.max(rule === 'multiple' ? 0.5 : 1, num(lineBy, lh0));
    const v = c.view!;
    updateParagraphs({
      align: align === 'left' ? null : align,
      indentLeft: fromCm(left),
      indentRight: fromCm(right),
      indentFirst: special === 'none' ? 0 : (special === 'hanging' ? -1 : 1) * fromCm(specialBy, 36),
      spaceBefore: num(before, 0) || null,
      spaceAfter: Math.max(0, num(after, c.defaults.spaceAfter)),
      lineHeight: rule === 'multiple' && lh === c.defaults.lineHeight ? null : lh,
      lineRule: rule === 'multiple' ? null : rule,
      keepNext,
      keepLines,
      pageBreakBefore: pageBefore,
      outlineLevel: outline === 'body' ? null : Number(outline),
    })(v.state, v.dispatch);
    onClose();
    focusDocSoon(ui);
  };
  const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
  return (
    <Modal
      title={t('Párrafo')}
      onClose={onClose}
      width={540}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={apply}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={row}>
        <div style={field}>
          <label htmlFor="pg-al">{t('Alineación')}</label>
          <Select id="pg-al" value={align} onChange={(_e, v) => setAlign(v.value)}>
            <option value="left">{t('Izquierda')}</option>
            <option value="center">{t('Centrada')}</option>
            <option value="right">{t('Derecha')}</option>
            <option value="justify">{t('Justificada')}</option>
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="pg-ol">{t('Nivel de esquema')}</label>
          <Select id="pg-ol" value={outline} onChange={(_e, v) => setOutline(v.value)}>
            <option value="body">{t('Texto independiente')}</option>
            {Array.from({ length: 9 }, (_x, i) => (
              <option key={i} value={String(i)}>{`${t('Nivel')} ${i + 1}`}</option>
            ))}
          </Select>
        </div>
      </div>
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 10 }}>
        <legend>{t('Sangría (cm)')}</legend>
        <div style={row}>
          <div style={field}>
            <label htmlFor="pg-l">{t('Izquierda')}</label>
            <Input id="pg-l" type="number" step={0.25} value={left} onChange={(_e, v) => setLeft(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="pg-r">{t('Derecha')}</label>
            <Input id="pg-r" type="number" step={0.25} value={right} onChange={(_e, v) => setRight(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="pg-sp">{t('Especial')}</label>
            <Select id="pg-sp" value={special} onChange={(_e, v) => setSpecial(v.value as typeof special)}>
              <option value="none">{t('(ninguna)')}</option>
              <option value="first">{t('Primera línea')}</option>
              <option value="hanging">{t('Francesa')}</option>
            </Select>
          </div>
          <div style={field}>
            <label htmlFor="pg-spby">{t('En (cm)')}</label>
            <Input id="pg-spby" type="number" step={0.25} min={0} disabled={special === 'none'} value={specialBy} onChange={(_e, v) => setSpecialBy(v.value)} />
          </div>
        </div>
      </fieldset>
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 10 }}>
        <legend>{t('Espaciado')}</legend>
        <div style={row}>
          <div style={field}>
            <label htmlFor="pg-b">{t('Anterior (pt)')}</label>
            <Input id="pg-b" type="number" min={0} step={1} value={before} onChange={(_e, v) => setBefore(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="pg-a">{t('Posterior (pt)')}</label>
            <Input id="pg-a" type="number" min={0} step={1} value={after} onChange={(_e, v) => setAfter(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="pg-lr">{t('Interlineado')}</label>
            <Select id="pg-lr" value={rule} onChange={(_e, v) => { setRule(v.value as typeof rule); setLineBy(v.value === 'multiple' ? '1.08' : '14'); }}>
              <option value="multiple">{t('Múltiple')}</option>
              <option value="atLeast">{t('Mínimo')}</option>
              <option value="exact">{t('Exacto')}</option>
            </Select>
          </div>
          <div style={field}>
            <label htmlFor="pg-lb">{rule === 'multiple' ? t('En (líneas)') : t('En (pt)')}</label>
            <Input id="pg-lb" type="number" min={rule === 'multiple' ? 0.5 : 1} step={rule === 'multiple' ? 0.05 : 0.5} value={lineBy} onChange={(_e, v) => setLineBy(v.value)} />
          </div>
        </div>
      </fieldset>
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6 }}>
        <legend>{t('Paginación')}</legend>
        <Checkbox label={t('Mantener con el siguiente')} checked={keepNext} onChange={(_e, v) => setKeepNext(!!v.checked)} />
        <Checkbox label={t('Conservar líneas juntas')} checked={keepLines} onChange={(_e, v) => setKeepLines(!!v.checked)} />
        <Checkbox label={t('Salto de página anterior')} checked={pageBefore} onChange={(_e, v) => setPageBefore(!!v.checked)} />
      </fieldset>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ Símbolo
export function SymbolDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const [group, setGroup] = useState(SYMBOL_GROUPS[0]!.id);
  const [picked, setPicked] = useState<{ ch: string; name: string } | null>(null);
  const g = SYMBOL_GROUPS.find((x) => x.id === group)!;
  const insert = (ch: string) => {
    const v = ui.ctl.view;
    if (!v) return;
    v.dispatch(v.state.tr.insertText(ch).scrollIntoView());
  };
  return (
    <Modal
      title={t('Símbolo')}
      onClose={() => {
        onClose();
        focusDocSoon(ui);
      }}
      width={620}
      actions={
        <>
          <Button disabled={!picked} appearance="primary" onClick={() => picked && insert(picked.ch)}>
            {t('Insertar')}
          </Button>
          <Button
            onClick={() => {
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <TabList selectedValue={group} onTabSelect={(_e, v) => setGroup(String(v.value))} size="small" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        {SYMBOL_GROUPS.map((x) => (
          <Tab key={x.id} value={x.id}>
            {t(x.label)}
          </Tab>
        ))}
      </TabList>
      <div role="grid" aria-label={t(g.label)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 36px)', gap: 2, maxHeight: 260, overflow: 'auto' }}>
        {g.chars.map(([ch, name]) => (
          <button
            key={ch}
            type="button"
            title={`${name} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`}
            aria-label={name}
            aria-pressed={picked?.ch === ch}
            onClick={() => setPicked({ ch, name })}
            onDoubleClick={() => insert(ch)}
            style={{ width: 36, height: 36, fontSize: 18, border: picked?.ch === ch ? '2px solid var(--colorBrandForeground1)' : '1px solid var(--colorNeutralStroke2)', background: 'var(--colorNeutralBackground1)', cursor: 'pointer', borderRadius: 4 }}
          >
            {ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ' ? '␣' : ch}
          </button>
        ))}
      </div>
      <p style={{ marginTop: 10, minHeight: 22 }}>{picked ? `${picked.name} — U+${picked.ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : t('Elija un símbolo; doble clic lo inserta.')}</p>
    </Modal>
  );
}
