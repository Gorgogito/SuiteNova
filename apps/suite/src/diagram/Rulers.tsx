import { t } from '@suitenova/core-ui';

export const RULER = 20;

/** What of the canvas is on screen. */
export interface View {
  /** Page coordinates of the top-left corner of the canvas, and pixels of screen per unit of the page. */
  ox: number;
  oy: number;
  scale: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const STEPS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

interface Props {
  view: View;
  /** The line that follows the pointer; the canvas moves it. */
  mark: React.Ref<HTMLDivElement>;
  /** A drag from the ruler pulls out a guide: horizontal from the top one, vertical from the left one. */
  onPull: (axis: 'x' | 'y', e: React.PointerEvent) => void;
}

/** One of the two rulers, in page units (pixels). */
export function Ruler({ dir, view, mark, onPull }: Props & { dir: 'h' | 'v' }) {
  const h = dir === 'h';
  const origin = h ? view.ox : view.oy;
  const scroll = h ? view.left : view.top;
  const size = Math.max(0, h ? view.width : view.height);
  const at = (v: number) => (v - origin) * view.scale - scroll;
  const major = STEPS.find((s) => s * view.scale >= 56) ?? 10000;
  const minor = major / 5;
  const from = Math.floor((scroll / view.scale + origin) / minor);
  const to = Math.ceil(((scroll + size) / view.scale + origin) / minor);
  const ticks: React.ReactNode[] = [];
  for (let i = from; i <= to && i - from < 2000; i++) {
    const v = i * minor;
    const p = Math.round(at(v)) + 0.5;
    const big = i % 5 === 0;
    const len = big ? 9 : 4;
    ticks.push(h ? <line key={i} x1={p} y1={RULER} x2={p} y2={RULER - len} /> : <line key={i} x1={RULER} y1={p} x2={RULER - len} y2={p} />);
    if (big) {
      ticks.push(
        h ? (
          <text key={`t${i}`} x={p + 2} y={10}>
            {v}
          </text>
        ) : (
          <text key={`t${i}`} transform={`translate(10 ${p - 2}) rotate(-90)`}>
            {v}
          </text>
        ),
      );
    }
  }
  return (
    <div
      className={`dg-ruler dg-ruler--${dir}`}
      role="img"
      aria-label={h ? t('Regla horizontal: arrastra hacia abajo para poner una guía') : t('Regla vertical: arrastra hacia la derecha para poner una guía')}
      data-ruler={dir}
      title={h ? t('Arrastra hacia abajo para poner una guía') : t('Arrastra hacia la derecha para poner una guía')}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onPull(h ? 'y' : 'x', e);
      }}
    >
      <svg width={h ? size : RULER} height={h ? RULER : size} aria-hidden="true">
        {ticks}
      </svg>
      {/* a layer of its own: moving it does not draw the canvas again */}
      <div ref={mark} className="dg-ruler__mark" style={{ display: 'none' }} />
    </div>
  );
}
