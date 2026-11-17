import {
  asList,
  backspace,
  del,
  end,
  fromTree,
  home,
  insertNodes,
  mkRow,
  moveLeft,
  moveRight,
  moveVertical,
  nextSlot,
  parseMath,
  parsePathKey,
  parseUnicodeMath,
  placeCursor,
  renderEdit,
  selectAll,
  selectedNodes,
  toTree,
  toUnicodeMath,
  typeChar,
  type EditState,
  type MNode,
  type Step,
} from '@suitenova/math-core';

/** Lo que hace falta de un evento de teclado (sirve el de React y el del DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/** ¿Parece LaTeX lo que se pega? (barra invertida con letras o llaves). */
const looksLikeTex = (s: string) => /\\[A-Za-z]+|[{}]/.test(s);

/**
 * El motor de edición de una ecuación, sin interfaz: guarda el estado y el historial y sabe qué hacer con una tecla, un clic o
 * un pegado. Lo usan el cuadro de ecuación (React) y la edición dentro del documento (Writer).
 */
export class MathEditing {
  st: EditState;
  private past: EditState[] = [];
  private future: EditState[] = [];
  /** El último árbol que salió de aquí (para no readoptarlo cuando el padre lo devuelve). */
  last: MNode;

  constructor(
    tree: MNode,
    /** Se llama con el árbol nuevo cada vez que cambia la ecuación. */
    private readonly onChange: (tree: MNode) => void,
    /** Se llama cuando hay que volver a dibujar (cambió el estado, aunque no la ecuación). */
    private readonly redraw: () => void,
    /** Intro con nada pendiente (aceptar). */
    private readonly onEnter?: () => void,
    /** Escape con nada pendiente (salir). */
    private readonly onEscape?: () => void,
  ) {
    this.st = fromTree(tree);
    this.last = tree;
  }

  /** Adopta una ecuación que viene de fuera. */
  adopt(tree: MNode): void {
    if (tree === this.last) return;
    this.last = tree;
    this.past = [];
    this.future = [];
    this.st = fromTree(tree);
    this.redraw();
  }

  get tree(): MNode {
    return toTree(this.st);
  }
  get linear(): string {
    return toUnicodeMath(this.tree);
  }
  html(caret: boolean): string {
    return renderEdit(this.st, caret);
  }

  /** Aplica un cambio de estado (guarda el anterior para deshacer si cambió la ecuación). */
  apply(next: EditState, record = true): void {
    if (next === this.st) return;
    const changed = next.root !== this.st.root;
    if (record && changed) {
      this.past.push(this.st);
      if (this.past.length > 200) this.past.shift();
      this.future = [];
    }
    this.st = next;
    if (changed) this.emit();
    this.redraw();
  }
  /** Para la cinta y las galerías: aplica una operación del motor al estado actual. */
  run(fn: (st: EditState) => EditState): void {
    this.apply(fn(this.st));
  }
  private emit() {
    this.last = this.tree;
    this.onChange(this.last);
  }
  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.st);
    this.st = prev;
    this.emit();
    this.redraw();
  }
  redo(): void {
    const nxt = this.future.pop();
    if (!nxt) return;
    this.past.push(this.st);
    this.st = nxt;
    this.emit();
    this.redraw();
  }

  /** Atiende una tecla; devuelve `true` si la usó (el llamador hace `preventDefault`). */
  key(e: KeyLike): boolean {
    const st = this.st;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.altKey) {
      if (k === 'z' || k === 'Z') return e.shiftKey ? (this.redo(), true) : (this.undo(), true);
      if (k === 'y' || k === 'Y') return this.redo(), true;
      if (k === 'a' || k === 'A') return this.apply(selectAll(st), false), true;
      return false; // copiar, cortar y pegar los atienden sus eventos
    }
    const go = (n: EditState, record = true) => (this.apply(n, record), true);
    switch (k) {
      case 'ArrowLeft': return go(moveLeft(st, e.shiftKey), false);
      case 'ArrowRight': return go(moveRight(st, e.shiftKey), false);
      case 'ArrowUp': return go(moveVertical(st, 'up'), false);
      case 'ArrowDown': return go(moveVertical(st, 'down'), false);
      case 'Home': return go(home(st, e.shiftKey), false);
      case 'End': return go(end(st, e.shiftKey), false);
      case 'Backspace': return go(backspace(st));
      case 'Delete': return go(del(st));
      case 'Tab':
        if (!e.shiftKey && st.path.length) return go(nextSlot(st), false);
        return false; // fuera de las estructuras el tabulador sale del editor
      case 'Enter':
        if (st.esc !== undefined) return go(typeChar(st, ' '));
        if (this.onEnter) {
          this.onEnter();
          return true;
        }
        return false;
      case 'Escape':
        if (st.esc !== undefined) {
          e.stopPropagation();
          return go({ ...st, esc: undefined }, false);
        }
        if (st.anchor !== undefined) {
          e.stopPropagation();
          return go({ ...st, anchor: undefined }, false);
        }
        if (this.onEscape) {
          e.stopPropagation();
          this.onEscape();
          return true;
        }
        return false;
      default:
    }
    if (k.length === 1 && !e.metaKey && (!e.ctrlKey || e.altKey)) return go(typeChar(st, k));
    return false;
  }

  /** El texto que se copia: lo seleccionado, o toda la ecuación; en el formato lineal de Word. */
  copyText(): string {
    const sel = selectedNodes(this.st);
    return toUnicodeMath(sel.length ? mkRow(sel) : this.tree);
  }
  cut(): string {
    const text = this.copyText();
    this.apply(backspace(this.st));
    return text;
  }
  /** Pega un texto: LaTeX o formato lineal. */
  paste(text: string): void {
    const s = text.trim();
    if (!s) return;
    const tree = looksLikeTex(s) ? parseMath(s) : parseUnicodeMath(s);
    this.apply(insertNodes(this.st, asList(tree)));
  }

  /** Dónde cae un clic: la fila del nodo tocado y, según el lado, antes o después de él. */
  locate(e: { target: EventTarget | null; clientX: number }, root: HTMLElement): { path: Step[]; at: number } | null {
    const el = (e.target as Element | null)?.closest?.('[data-r]') as HTMLElement | null;
    if (!el || !root.contains(el)) return null;
    const i = +(el.getAttribute('data-i') ?? 0);
    const r = el.getBoundingClientRect();
    const after = el.classList.contains('nm-ph') ? 0 : e.clientX > r.left + r.width / 2 ? 1 : 0;
    return { path: parsePathKey(el.getAttribute('data-r') ?? ''), at: i + after };
  }
  mouseDown(e: { target: EventTarget | null; clientX: number; shiftKey: boolean }, root: HTMLElement): void {
    const hit = this.locate(e, root);
    if (hit) this.apply(placeCursor(this.st, hit.path, hit.at, e.shiftKey), false);
    else this.apply(end({ ...this.st, path: [] }), false);
  }
  mouseMove(e: { target: EventTarget | null; clientX: number; buttons: number }, root: HTMLElement): void {
    if (e.buttons !== 1) return;
    const hit = this.locate(e, root);
    if (hit) this.apply(placeCursor({ ...this.st, anchor: this.st.anchor ?? this.st.at }, hit.path, hit.at, true), false);
  }
}
