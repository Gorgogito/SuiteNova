import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useRef, useState } from 'react';
import { Dlg } from './dlg-sheet';

/** The functions the expression language of Nova Base knows (forms, reports, calculated fields) and the ones SQLite offers (query fields). */
const ACCESS_FUNCS: [string, string, string][] = [
  ['IIf', 'IIf(, , )', 'Si la condición es verdadera da el segundo valor; si no, el tercero.'],
  ['Nz', 'Nz(, 0)', 'Cambia un valor vacío por otro.'],
  ['IsNull', 'IsNull()', 'Verdadero si el valor está vacío.'],
  ['Len', 'Len()', 'Número de caracteres.'],
  ['Left', 'Left(, 1)', 'Primeros caracteres.'],
  ['Right', 'Right(, 1)', 'Últimos caracteres.'],
  ['Mid', 'Mid(, 1, 1)', 'Caracteres del medio.'],
  ['Trim', 'Trim()', 'Quita los espacios de los extremos.'],
  ['UCase', 'UCase()', 'A mayúsculas.'],
  ['LCase', 'LCase()', 'A minúsculas.'],
  ['Abs', 'Abs()', 'Valor absoluto.'],
  ['Round', 'Round(, 2)', 'Redondea.'],
  ['Int', 'Int()', 'Parte entera.'],
  ['Sqr', 'Sqrt()', 'Raíz cuadrada.'],
  ['Year', 'Year()', 'Año de una fecha.'],
  ['Month', 'Month()', 'Mes de una fecha.'],
  ['Day', 'Day()', 'Día de una fecha.'],
  ['Date', 'Date()', 'La fecha de hoy (no vale en campos calculados de tabla).'],
  ['Now', 'Now()', 'La fecha y la hora de ahora (no vale en campos calculados de tabla).'],
  ['Sum', 'Sum()', 'Suma (informes y totales).'],
  ['Count', 'Count()', 'Cuenta (informes y totales).'],
  ['Avg', 'Avg()', 'Promedio (informes y totales).'],
  ['Min', 'Min()', 'El menor (informes y totales).'],
  ['Max', 'Max()', 'El mayor (informes y totales).'],
];
const SQL_FUNCS: [string, string, string][] = [
  ['coalesce', 'coalesce(, 0)', 'El primer valor que no está vacío.'],
  ['iif', 'iif(, , )', 'Si la condición es verdadera da el segundo valor; si no, el tercero.'],
  ['length', 'length()', 'Número de caracteres.'],
  ['substr', 'substr(, 1, 1)', 'Caracteres del medio.'],
  ['upper', 'upper()', 'A mayúsculas.'],
  ['lower', 'lower()', 'A minúsculas.'],
  ['trim', 'trim()', 'Quita los espacios de los extremos.'],
  ['replace', "replace(, '', '')", 'Cambia un texto por otro.'],
  ['abs', 'abs()', 'Valor absoluto.'],
  ['round', 'round(, 2)', 'Redondea.'],
  ['strftime', "strftime('%Y', )", 'Parte de una fecha (%Y año, %m mes, %d día).'],
  ['date', "date('now')", 'La fecha de hoy.'],
  ['CAST', 'CAST( AS REAL)', 'Cambia el tipo del valor.'],
  ['CASE', 'CASE WHEN  THEN  ELSE  END', 'Varias condiciones.'],
];
const OPERATORS = ['+', '-', '*', '/', '&', '=', '<>', '<', '>', '<=', '>=', 'And', 'Or', 'Not', '(', ')'];

/** The expression builder of Access: fields, functions and operators to click, over a box with the expression. */
export function ExprBuilderButton({ fields, value, onApply, dialect = 'access', label, fieldText }: { fields: string[]; value: string; onApply: (v: string) => void; dialect?: 'access' | 'sql'; label?: string; fieldText?: (f: string) => string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);
  const funcs = dialect === 'sql' ? SQL_FUNCS : ACCESS_FUNCS;
  const insert = (piece: string, caret?: number) => {
    const el = box.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, a)}${piece}${text.slice(b)}`;
    setText(next);
    // leave the cursor inside the parentheses of a function
    const pos = a + (caret ?? piece.length);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  };
  return (
    <>
      <button type="button" className="bs-btn bs-fx" aria-label={label ?? t('Generador de expresiones')} title={t('Generador de expresiones')} onClick={() => (setText(value), setOpen(true))}>
        ƒx
      </button>
      {open && (
        <Dlg
          title={t('Generador de expresiones')}
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button onClick={() => setOpen(false)}>{t('Cancelar')}</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  onApply(text.trim());
                  setOpen(false);
                }}
              >
                {t('Aceptar')}
              </Button>
            </>
          }
        >
          <textarea ref={box} aria-label={t('Expresión del generador')} className="bs-sql" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} style={{ minHeight: 70 }} />
          <div className="bs-exprcols">
            <div role="group" aria-label={t('Campos')}>
              <b>{t('Campos')}</b>
              <ul>
                {fields.map((f) => (
                  <li key={f}>
                    <button type="button" onClick={() => insert(fieldText ? fieldText(f) : `[${f}]`)}>
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div role="group" aria-label={t('Funciones')}>
              <b>{t('Funciones')}</b>
              <ul>
                {funcs.map(([name, tpl, hint]) => (
                  <li key={name}>
                    <button type="button" title={t(hint)} onClick={() => insert(tpl, Math.max(tpl.indexOf('(') + 1, 0))}>
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div role="group" aria-label={t('Operadores')}>
              <b>{t('Operadores')}</b>
              <div className="bs-exprops">
                {OPERATORS.map((o) => (
                  <button key={o} type="button" className="bs-btn" onClick={() => insert(/^[A-Za-z]/.test(o) ? ` ${o} ` : o === '(' || o === ')' ? o : ` ${o} `)}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Dlg>
      )}
    </>
  );
}
