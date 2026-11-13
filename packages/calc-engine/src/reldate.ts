/**
 * Periodos de fecha relativos a «hoy» (como los del formato condicional «Fechas» y los filtros de fecha de Excel).
 * La semana empieza en domingo, como en Excel con la configuración regional habitual.
 */
import { daysInMonth, serialFromYMD, weekdayFromSerial, ymdFromSerial } from './dates';

export type RelPeriod =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'last7Days'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'nextQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'nextYear'
  | 'yearToDate';

export const REL_PERIODS: RelPeriod[] = [
  'today',
  'yesterday',
  'tomorrow',
  'last7Days',
  'thisWeek',
  'lastWeek',
  'nextWeek',
  'thisMonth',
  'lastMonth',
  'nextMonth',
  'thisQuarter',
  'lastQuarter',
  'nextQuarter',
  'thisYear',
  'lastYear',
  'nextYear',
  'yearToDate',
];

/** Primer y último día (serie) del periodo, o null si no se reconoce. */
export function periodRange(p: RelPeriod, today: number): [number, number] | null {
  const t = Math.floor(today);
  const { y, m } = ymdFromSerial(t);
  const monthRange = (offset: number): [number, number] => {
    const total = y * 12 + (m - 1) + offset;
    const yy = Math.floor(total / 12);
    const mm = (total % 12) + 1;
    return [serialFromYMD(yy, mm, 1), serialFromYMD(yy, mm, daysInMonth(yy, mm))];
  };
  const quarterRange = (offset: number): [number, number] => {
    const q = Math.floor((m - 1) / 3) + offset;
    const yy = y + Math.floor(q / 4);
    const qq = ((q % 4) + 4) % 4;
    return [serialFromYMD(yy, qq * 3 + 1, 1), serialFromYMD(yy, qq * 3 + 3, daysInMonth(yy, qq * 3 + 3))];
  };
  const weekStart = t - weekdayFromSerial(t);
  switch (p) {
    case 'today':
      return [t, t];
    case 'yesterday':
      return [t - 1, t - 1];
    case 'tomorrow':
      return [t + 1, t + 1];
    case 'last7Days':
      return [t - 6, t];
    case 'thisWeek':
      return [weekStart, weekStart + 6];
    case 'lastWeek':
      return [weekStart - 7, weekStart - 1];
    case 'nextWeek':
      return [weekStart + 7, weekStart + 13];
    case 'thisMonth':
      return monthRange(0);
    case 'lastMonth':
      return monthRange(-1);
    case 'nextMonth':
      return monthRange(1);
    case 'thisQuarter':
      return quarterRange(0);
    case 'lastQuarter':
      return quarterRange(-1);
    case 'nextQuarter':
      return quarterRange(1);
    case 'thisYear':
      return [serialFromYMD(y, 1, 1), serialFromYMD(y, 12, 31)];
    case 'lastYear':
      return [serialFromYMD(y - 1, 1, 1), serialFromYMD(y - 1, 12, 31)];
    case 'nextYear':
      return [serialFromYMD(y + 1, 1, 1), serialFromYMD(y + 1, 12, 31)];
    case 'yearToDate':
      return [serialFromYMD(y, 1, 1), t];
    default:
      return null;
  }
}

/** ¿Cae la fecha (serie, con hora o sin ella) en el periodo relativo a `today`? */
export function inPeriod(serial: number, p: RelPeriod, today: number): boolean {
  const r = periodRange(p, today);
  if (!r) return false;
  const d = Math.floor(serial);
  return d >= r[0] && d <= r[1];
}
