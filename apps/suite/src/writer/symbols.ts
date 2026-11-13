/** Caracteres del cuadro «Símbolo», por grupos. Cada uno: [carácter, nombre]. */
export interface SymbolGroup {
  id: string;
  label: string;
  chars: [string, string][];
}

const range = (from: number, to: number, name: (ch: string, code: number) => string): [string, string][] =>
  Array.from({ length: to - from + 1 }, (_x, i) => {
    const code = from + i;
    const ch = String.fromCodePoint(code);
    return [ch, name(ch, code)] as [string, string];
  });

const GREEK_L = 'αβγδεζηθικλμνξοπρςστυφχψω';
const GREEK_U = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
const GREEK_NAMES: Record<string, string> = { α: 'alfa', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'épsilon', ζ: 'dseta', η: 'eta', θ: 'zeta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'ómicron', π: 'pi', ρ: 'rho', ς: 'sigma final', σ: 'sigma', τ: 'tau', υ: 'ípsilon', φ: 'fi', χ: 'ji', ψ: 'psi', ω: 'omega' };
const greek = (): [string, string][] => [
  ...[...GREEK_L].map((c) => [c, `Letra griega minúscula ${GREEK_NAMES[c] ?? ''}`.trim()] as [string, string]),
  ...[...GREEK_U].map((c) => [c, `Letra griega mayúscula ${GREEK_NAMES[c.toLowerCase()] ?? ''}`.trim()] as [string, string]),
];

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    id: 'common',
    label: 'Más usados',
    chars: [
      ['©', 'Copyright'], ['®', 'Marca registrada'], ['™', 'Marca comercial'], ['§', 'Sección'], ['¶', 'Párrafo'], ['†', 'Daga'], ['‡', 'Doble daga'], ['•', 'Viñeta'], ['·', 'Punto medio'], ['…', 'Puntos suspensivos'],
      ['–', 'Raya corta'], ['—', 'Raya'], ['‘', 'Comilla simple izquierda'], ['’', 'Comilla simple derecha'], ['“', 'Comilla doble izquierda'], ['”', 'Comilla doble derecha'], ['«', 'Comillas angulares izquierda'], ['»', 'Comillas angulares derecha'],
      ['¡', 'Exclamación de apertura'], ['¿', 'Interrogación de apertura'], ['°', 'Grado'], ['±', 'Más menos'], ['×', 'Multiplicación'], ['÷', 'División'], ['€', 'Euro'], ['£', 'Libra'], ['¥', 'Yen'], ['¢', 'Centavo'], ['№', 'Número'], ['℃', 'Grados Celsius'],
    ],
  },
  {
    id: 'latin',
    label: 'Latín',
    chars: [...range(0xc0, 0xff, (_c, code) => `Letra latina U+${code.toString(16).toUpperCase()}`), ...range(0x100, 0x17f, (_c, code) => `Latín extendido U+${code.toString(16).toUpperCase()}`)].filter(([ch]) => ch !== '×' && ch !== '÷' || true),
  },
  { id: 'greek', label: 'Griego', chars: greek() },
  {
    id: 'math',
    label: 'Matemáticas',
    chars: [
      ['≈', 'Casi igual'], ['≠', 'Distinto'], ['≤', 'Menor o igual'], ['≥', 'Mayor o igual'], ['≡', 'Idéntico'], ['∞', 'Infinito'], ['∑', 'Sumatoria'], ['∏', 'Productoria'], ['∫', 'Integral'], ['∂', 'Diferencial parcial'],
      ['√', 'Raíz cuadrada'], ['∛', 'Raíz cúbica'], ['∈', 'Pertenece'], ['∉', 'No pertenece'], ['⊂', 'Subconjunto'], ['⊃', 'Superconjunto'], ['∪', 'Unión'], ['∩', 'Intersección'], ['∅', 'Conjunto vacío'], ['∀', 'Para todo'],
      ['∃', 'Existe'], ['¬', 'Negación'], ['∧', 'Y lógica'], ['∨', 'O lógica'], ['∴', 'Por lo tanto'], ['∵', 'Porque'], ['∝', 'Proporcional'], ['∠', 'Ángulo'], ['⊥', 'Perpendicular'], ['∥', 'Paralelo'],
      ['¼', 'Un cuarto'], ['½', 'Un medio'], ['¾', 'Tres cuartos'], ['⅓', 'Un tercio'], ['⅔', 'Dos tercios'], ['⅛', 'Un octavo'], ['²', 'Al cuadrado'], ['³', 'Al cubo'], ['¹', 'Superíndice uno'], ['‰', 'Por mil'],
    ],
  },
  {
    id: 'arrows',
    label: 'Flechas',
    chars: [
      ['←', 'Flecha izquierda'], ['↑', 'Flecha arriba'], ['→', 'Flecha derecha'], ['↓', 'Flecha abajo'], ['↔', 'Flecha izquierda y derecha'], ['↕', 'Flecha arriba y abajo'], ['↖', 'Flecha noroeste'], ['↗', 'Flecha noreste'], ['↘', 'Flecha sureste'], ['↙', 'Flecha suroeste'],
      ['⇐', 'Flecha doble izquierda'], ['⇑', 'Flecha doble arriba'], ['⇒', 'Flecha doble derecha'], ['⇓', 'Flecha doble abajo'], ['⇔', 'Flecha doble izquierda y derecha'], ['↩', 'Retorno'], ['↪', 'Giro a la derecha'], ['↺', 'Giro antihorario'], ['↻', 'Giro horario'], ['➔', 'Flecha gruesa'],
    ],
  },
  {
    id: 'currency',
    label: 'Monedas',
    chars: [['$', 'Dólar'], ['€', 'Euro'], ['£', 'Libra'], ['¥', 'Yen'], ['¢', 'Centavo'], ['₡', 'Colón'], ['₣', 'Franco'], ['₤', 'Lira'], ['₦', 'Naira'], ['₩', 'Won'], ['₪', 'Séquel'], ['₫', 'Dong'], ['₭', 'Kip'], ['₱', 'Peso'], ['₲', 'Guaraní'], ['₴', 'Grivna'], ['₹', 'Rupia'], ['₺', 'Lira turca'], ['₽', 'Rublo'], ['₿', 'Bitcoin'], ['฿', 'Baht']],
  },
  {
    id: 'shapes',
    label: 'Formas y marcas',
    chars: [
      ['■', 'Cuadrado negro'], ['□', 'Cuadrado blanco'], ['▲', 'Triángulo negro'], ['△', 'Triángulo blanco'], ['▼', 'Triángulo negro hacia abajo'], ['◆', 'Rombo negro'], ['◇', 'Rombo blanco'], ['●', 'Círculo negro'], ['○', 'Círculo blanco'], ['★', 'Estrella negra'],
      ['☆', 'Estrella blanca'], ['✓', 'Marca de verificación'], ['✔', 'Marca de verificación gruesa'], ['✗', 'Aspa'], ['✘', 'Aspa gruesa'], ['☑', 'Casilla marcada'], ['☐', 'Casilla vacía'], ['☒', 'Casilla con aspa'], ['♠', 'Pica'], ['♣', 'Trébol'],
      ['♥', 'Corazón'], ['♦', 'Diamante'], ['♪', 'Corchea'], ['♫', 'Corcheas'], ['☺', 'Cara sonriente'], ['☎', 'Teléfono'], ['✉', 'Sobre'], ['✂', 'Tijeras'], ['☀', 'Sol'], ['☂', 'Paraguas'],
    ],
  },
  {
    id: 'spaces',
    label: 'Espacios y guiones especiales',
    chars: [
      [' ', 'Espacio de no separación'], [' ', 'Espacio eme corto (en)'], [' ', 'Espacio eme (em)'], [' ', 'Espacio fino'], [' ', 'Espacio fino de no separación'], ['‑', 'Guion de no separación'], ['­', 'Guion opcional'], ['​', 'Espacio de ancho cero'],
      ['–', 'Raya corta (en)'], ['—', 'Raya (em)'], ['…', 'Puntos suspensivos'], ['−', 'Signo menos'],
    ],
  },
];
