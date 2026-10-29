import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { inputRules, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from 'prosemirror-state';
import { columnResizing, TableView, tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import {
  DEFAULT_DOC_DEFAULTS,
  collectNotes,
  defaultNotesOptions,
  defaultPage,
  defaultSection,
  defaultStyles,
  docFromText,
  docOf,
  emptyDoc,
  emptyWriterDoc,
  ensureSections,
  hfKindFor,
  nodeTypes,
  noteBodyOf,
  noteDoc,
  newNoteId,
  plainText,
  previewText,
  ptToPx,
  resolvePart,
  sectionAttrs,
  sectionList,
  sectionPropsOf,
  verifySignature,
  styleCss,
  wordCount,
  writerSchema,
  type CiteStyle,
  type CommentData,
  type DocDefaults,
  type HFKind,
  type MacroModule,
  type MailMergeData,
  type NoteRef,
  type NotesOptions,
  type PageSetup,
  type Protection,
  type SectionInfo,
  type SectionProps,
  type SignatureData,
  type Source,
  type StyleTable,
  type SignatureStatus,
  type Watermark,
  type WriterDoc,
} from '@suitenova/writer-core';
import { removeCommentMarks } from './review';
import { backspaceCommand, deleteCommand, enterCommand, shiftTabCommand, tabCommand } from './editing';
import { tabsPlugin } from './tabs';
import { formsPlugin } from './forms';
import { WriterRuntime } from './macros';
import { loadSpeller, misspellingAt, setSpell, spellPlugin, type SpellLang } from './spell';
import { getLocale } from '@suitenova/core-ui';
import { ControlView, FieldView, MathView, ShapeView, type NodeViewHost } from './nodeviews';
import { commentRanges, getUser, protectionPlugin, trackTransaction } from './review';
import { outlinePlugin, setOutlineActive } from './outline';
import { joinSectionBackward, joinSectionForward } from './sections-edit';
import { NOTE_SEP, PAGE_GAP, paginationKey, paginationPlugin, repaginate, sectionFixup, setPaginationOff, trailingParagraph, type PageSpec } from './paginate';

export { PAGE_GAP, NOTE_SEP };

class NovaTableView extends TableView {
  constructor(node: PMNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.sync(node);
  }
  update(node: PMNode): boolean {
    if (!super.update(node)) return false;
    this.sync(node);
    return true;
  }
  private sync(node: PMNode) {
    this.table.className = `nw-table${node.attrs.borders ? ' nw-borders' : ''}`;
  }
}

export interface FindState {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  matches: { from: number; to: number }[];
  current: number;
}

export const findKey = new PluginKey<FindState>('find');

function findPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ query: '', matchCase: false, wholeWord: false, matches: [], current: -1 }),
      apply(tr, value) {
        const meta = tr.getMeta(findKey) as FindState | undefined;
        if (meta) return meta;
        if (tr.docChanged && value.matches.length) return { ...value, matches: [], current: -1 };
        return value;
      },
    },
    props: {
      decorations(state) {
        const f = findKey.getState(state);
        if (!f || !f.matches.length) return null;
        return DecorationSet.create(
          state.doc,
          f.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === f.current ? 'nw-find nw-find-cur' : 'nw-find' })),
        );
      },
    },
  });
}

export function findMatches(doc: PMNode, query: string, matchCase: boolean, wholeWord: boolean): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const q = matchCase ? query : query.toLocaleLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, '￼');
    const hay = matchCase ? text : text.toLocaleLowerCase();
    let i = hay.indexOf(q);
    while (i !== -1) {
      const end = i + q.length;
      const word = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
      if (!wholeWord || (!word(hay[i - 1]) && !word(hay[end]))) out.push({ from: pos + 1 + i, to: pos + 1 + end });
      i = hay.indexOf(q, end);
    }
    return false;
  });
  return out;
}

/** Labels the footnote references (the number is drawn by CSS from `data-label`). */
const notesKey = new PluginKey<{ notes: NoteRef[]; deco: DecorationSet }>('notes');

function notesPlugin(getOpts: () => NotesOptions): Plugin<{ notes: NoteRef[]; deco: DecorationSet }> {
  const compute = (doc: PMNode) => {
    const notes = collectNotes(doc, getOpts());
    const deco = DecorationSet.create(
      doc,
      notes.map((n) => Decoration.node(n.pos, n.pos + 1, { 'data-label': n.label })),
    );
    return { notes, deco };
  };
  return new Plugin({
    key: notesKey,
    state: {
      init: (_c, state) => compute(state.doc),
      apply: (tr, value, _old, state) => (tr.docChanged || tr.getMeta(notesKey) ? compute(state.doc) : value),
    },
    props: { decorations: (state) => notesKey.getState(state)?.deco },
  });
}

export type ViewMode = 'print' | 'web' | 'outline' | 'draft';

export class WriterCtl {
  /** The main document view. */
  mainView: EditorView | null = null;
  /** A header, footer or note editor that has the focus of the commands, if any. */
  activeView: EditorView | null = null;
  /** The view that commands act on. */
  get view(): EditorView | null {
    return this.activeView && this.activeView.dom.isConnected ? this.activeView : this.mainView;
  }
  set view(v: EditorView | null) {
    this.mainView = v;
  }
  host: HTMLElement | null = null;
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  defaults: DocDefaults = { ...DEFAULT_DOC_DEFAULTS };
  styles: StyleTable = defaultStyles();
  title?: string;
  author?: string;
  pageSpecs: PageSpec[] = [{ section: 0, blank: false, notes: [], number: 1, inSection: 0 }];
  showMarks = false;
  viewMode: ViewMode = 'print';
  showRuler = true;
  showNav = false;
  showReview = false;
  reviewTab: 'comments' | 'changes' = 'comments';
  markup: 'all' | 'simple' | 'none' | 'original' = 'all';
  activeComment: string | null = null;
  editingComment: string | null = null;
  /** The footnote or endnote whose text is being written, by id. */
  noteEdit: string | null = null;
  tabKind: 'left' | 'center' | 'right' | 'decimal' | 'bar' = 'left';
  /** Header and footer documents by id (sections point at them). */
  parts = new Map<string, PMNode>();
  evenAndOdd = false;
  comments: CommentData[] = [];
  trackChanges = false;
  protection: Protection | null = null;
  watermark: Watermark | null = null;
  sources: Source[] = [];
  citeStyle: CiteStyle = 'apa';
  notesOptions: NotesOptions = defaultNotesOptions();
  macros: MacroModule[] = [];
  mailMerge: MailMergeData | null = null;
  signature: SignatureData | null = null;
  isTemplate = false;
  /** Active content (macros) may run. A document that arrives with macros starts with it disabled, as in Word. */
  contentEnabled = true;
  private runtime: WriterRuntime | null = null;
  get macroRt(): WriterRuntime {
    return (this.runtime ??= new WriterRuntime(this));
  }
  enableContent(): void {
    this.contentEnabled = true;
    this.touch();
    this.macroRt.runOpenHandlers();
  }
  /** The header/footer being edited on the page, if any. */
  hfEdit: { kind: 'header' | 'footer'; section: number; variant: HFKind; page: number } | null = null;
  private initialDoc: PMNode = docOf([]);
  private version = 0;
  private listeners = new Set<() => void>();
  private noteCache = new Map<string, number>();
  private noteMeasure: HTMLElement | null = null;
  /** Plugins added by feature modules (review, spelling, forms…). */
  extraPlugins: Plugin[] = [];
  /** Language of the spelling check ('off' = not checking while typing). */
  spellLang: SpellLang | 'off' = (() => {
    try {
      const v = localStorage.getItem('nova.writer.spellLang');
      if (v === 'es' || v === 'en' || v === 'off') return v;
    } catch {
      /* no storage */
    }
    return getLocale() === 'en' ? 'en' : 'es';
  })();
  spellLoading = false;
  onSpellMenu: (m: { from: number; to: number; word: string; x: number; y: number }) => void = () => {};

  /** Load the dictionary of the chosen language and underline the mistakes (or stop doing so). */
  async applySpell(): Promise<void> {
    const v = this.mainView;
    if (!v) return;
    if (this.spellLang === 'off') {
      setSpell(v, { on: false });
      this.touch();
      return;
    }
    this.spellLoading = true;
    this.touch();
    try {
      const engine = await loadSpeller(this.spellLang);
      if (this.mainView === v) setSpell(v, { engine, on: true });
    } catch {
      if (this.mainView === v) setSpell(v, { engine: null, on: false });
    } finally {
      this.spellLoading = false;
      this.touch();
    }
  }

  setSpellLang(lang: SpellLang | 'off'): void {
    this.spellLang = lang;
    try {
      localStorage.setItem('nova.writer.spellLang', lang);
    } catch {
      /* no storage */
    }
    void this.applySpell();
  }

  /** Set by the application: opens dialogs and pop-ups requested from inside the document. */
  onDialog: (kind: string, arg?: unknown) => void = () => {};
  onControl: (pos: number) => void = () => {};
  readonly nodeHost: NodeViewHost = {
    openDialog: (k, a) => this.onDialog(k, a),
    openControl: (p) => this.onControl(p),
    readOnly: () => this.readOnly,
    canFill: () => this.protection?.mode === 'forms',
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  touch(): void {
    this.version++;
    this.listeners.forEach((l) => l());
    if (this.signature) this.scheduleSignatureCheck();
  }

  // ---------- digital signature and password ----------

  /** Whether the signature still matches the content (null: not signed or not checked yet). */
  signatureStatus: SignatureStatus | null = null;
  private signatureTimer: ReturnType<typeof setTimeout> | null = null;
  /** Password the file opens with (kept so that saving encrypts again); null when the file is not encrypted. */
  password: string | null = null;

  private scheduleSignatureCheck(): void {
    if (this.signatureTimer) clearTimeout(this.signatureTimer);
    this.signatureTimer = setTimeout(() => void this.refreshSignature(), 700);
  }

  async refreshSignature(): Promise<void> {
    this.signatureTimer = null;
    const sig = this.signature;
    this.signatureStatus = sig ? await verifySignature(this.toWriterDoc(), sig) : null;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setSignature(sig: SignatureData | null): void {
    this.signature = sig;
    this.signatureStatus = sig ? 'valid' : null;
    this.dirty = true;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get styleSheet(): string {
    return styleCss(this.styles, this.defaults);
  }
  get docTitle(): string {
    return (this.fileName ?? 'Documento1') + (this.dirty ? ' •' : '');
  }
  get state(): EditorState | null {
    return this.view?.state ?? null;
  }
  get mainState(): EditorState | null {
    return this.mainView?.state ?? null;
  }
  get readOnly(): boolean {
    return !!this.protection && this.protection.mode === 'readOnly';
  }
  get pages(): number {
    return this.pageSpecs.length;
  }

  // ---------- editor lifecycle ----------

  private plugins(): Plugin[] {
    const isList = (n: string) => nodeTypes[n]!;
    return [
      history(),
      inputRules({
        rules: [
          wrappingInputRule(/^\s*([-+*•])\s$/, isList('bullet_list')),
          wrappingInputRule(/^(\d+)\.\s$/, isList('ordered_list'), (m) => ({ start: Number(m[1]), format: 'decimal' }), (m, node) => node.childCount + (node.attrs.start as number) === Number(m[1])),
        ],
      }),
      keymap({
        Enter: enterCommand,
        Tab: tabCommand,
        'Shift-Tab': shiftTabCommand,
        Backspace: chainCommands(joinSectionBackward, backspaceCommand),
        Delete: chainCommands(joinSectionForward, deleteCommand),
        'Mod-z': undo,
        'Mod-y': redo,
      }),
      keymap(baseKeymap),
      columnResizing({ cellMinWidth: 30, View: NovaTableView as never }),
      tableEditing(),
      sectionFixup(),
      trailingParagraph(),
      findPlugin(),
      notesPlugin(() => this.notesOptions),
      tabsPlugin(),
      formsPlugin(),
      spellPlugin(),
      outlinePlugin(),
      protectionPlugin(() => this.protection?.mode ?? null),
      this.commentHighlight(),
      this.mergePreviewPlugin(),
      ...this.extraPlugins,
      paginationPlugin({
        host: () => this.host,
        enabled: () => this.viewMode === 'print',
        context: () => ({ noteHeight: (n, w) => this.noteHeight(n, w) }),
        endnotes: {
          signature: (doc) => {
            const list = collectNotes(doc, this.notesOptions).filter((n) => n.kind === 'endnote');
            return list.length ? list.map((n) => `${n.id}:${JSON.stringify(n.node.attrs.body ?? '').length}:${n.label}`).join('|') : '';
          },
          render: (doc, breaks) => this.renderEndnotes(doc, breaks),
        },
        onLayout: (specs) => {
          if (JSON.stringify(specs) !== JSON.stringify(this.pageSpecs)) {
            this.pageSpecs = specs;
            this.touch();
          }
        },
      }),
    ];
  }

  /** Create the ProseMirror view inside `mount`. `host` is the element whose class toggles during measurement. */
  attach(mount: HTMLElement, host: HTMLElement): void {
    this.host = host;
    const state = EditorState.create({ doc: this.initialDoc, plugins: this.plugins() });
    this.mainView = new EditorView(mount, {
      state,
      editable: () => !this.readOnly || this.protection?.mode === 'forms',
      nodeViews: {
        math: (n, v, g) => new MathView(n, v, g as () => number | undefined, this.nodeHost),
        shape: (n, v, g) => new ShapeView(n, v, g as () => number | undefined, this.nodeHost),
        content_control: (n, v, g) => new ControlView(n, v, g as () => number | undefined, this.nodeHost),
        field: (n, _v, _g, d) => new FieldView(n, d),
      },
      attributes: { class: 'nw-doc', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Documento' },
      dispatchTransaction: (tr: Transaction) => {
        const v = this.mainView!;
        const tracking = !this.readOnly && (this.trackChanges || this.protection?.mode === 'trackedChanges');
        if (tracking) tr = trackTransaction(tr, v.state, getUser());
        const next = v.state.apply(tr);
        v.updateState(next);
        if (tr.docChanged && !tr.getMeta('nw-load')) this.dirty = true;
        this.touch();
      },
      handleDOMEvents: {
        contextmenu: (v, event) => {
          const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
          const m = at ? misspellingAt(v, at.pos) : null;
          if (!m) return false;
          event.preventDefault();
          this.onSpellMenu({ ...m, x: event.clientX, y: event.clientY });
          return true;
        },
        dblclick: (_v, event) => {
          const el = event.target as HTMLElement | null;
          const ref = el?.closest?.('.nw-fnref') as HTMLElement | null;
          const item = el?.closest?.('.nw-en-item') as HTMLElement | null;
          const id = ref?.dataset.id ?? item?.dataset.id;
          if (id) {
            event.preventDefault();
            this.beginNoteEdit(id);
            return true;
          }
          return false;
        },
      },
      handleClickOn: (_v, _pos, _node, _p, event) => {
        const a = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
        if (a && (event.ctrlKey || event.metaKey)) {
          window.open(a.getAttribute('href') ?? '', '_blank', 'noopener');
          return true;
        }
        return false;
      },
    });
    // images and fonts change the layout after they load
    const again = () => this.mainView && repaginate(this.mainView);
    host.addEventListener('load', again, true);
    setTimeout(() => void this.applySpell(), 300);
    void document.fonts?.ready.then(again);
  }

  detach(): void {
    this.mainView?.destroy();
    this.mainView = null;
  }

  // ---------- documents ----------

  load(doc: WriterDoc, fileName: string | null, filePath: string | null): void {
    this.parts = new Map(Object.entries(doc.parts));
    this.evenAndOdd = doc.evenAndOdd;
    this.defaults = doc.defaults;
    this.styles = doc.styles ?? defaultStyles();
    this.title = doc.title;
    this.author = doc.author;
    this.comments = doc.comments;
    this.trackChanges = doc.trackChanges;
    this.protection = doc.protection;
    this.watermark = doc.watermark;
    this.sources = doc.sources;
    this.citeStyle = doc.citeStyle;
    this.notesOptions = doc.notes;
    this.macros = doc.macros;
    this.contentEnabled = doc.macros.length === 0;
    this.runtime?.load(true);
    this.mailMerge = doc.mailMerge;
    this.signature = doc.signature;
    this.signatureStatus = null;
    this.password = null;
    this.isTemplate = doc.isTemplate;
    this.hfEdit = null;
    this.noteCache.clear();
    this.fileName = fileName;
    this.filePath = filePath;
    this.setBody(ensureSections(doc.body));
    this.dirty = false;
    this.touch();
    if (doc.signature) void this.refreshSignature();
  }

  private setBody(body: PMNode): void {
    if (!this.mainView) {
      this.initialDoc = body;
      return;
    }
    const v = this.mainView;
    const state = EditorState.create({ doc: body, plugins: this.plugins() });
    v.updateState(state);
    repaginate(v);
    void this.applySpell();
  }

  private blank(): WriterDoc {
    return emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS });
  }

  newDoc(): void {
    this.load(this.blank(), null, null);
  }

  loadText(text: string, name: string): void {
    this.load({ ...this.blank(), body: docOf(docFromText(text).content) }, name.replace(/\.[^.]+$/, '') + '.docx', null);
    this.dirty = true;
    this.touch();
  }

  loadHtml(html: string, name: string): void {
    const parsed = new window.DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    const doc = PMDOMParser.fromSchema(writerSchema).parse(parsed.body);
    this.load({ ...this.blank(), body: docOf(doc.content) }, name.replace(/\.[^.]+$/, '') + '.docx', null);
    this.dirty = true;
    this.touch();
  }

  toWriterDoc(): WriterDoc {
    const body = this.mainView?.state.doc ?? this.initialDoc;
    const used = new Set<string>();
    body.forEach((sec) => {
      const p = sectionPropsOf(sec);
      for (const g of [p.header, p.footer]) for (const id of [g.default, g.first, g.even]) if (id) used.add(id);
    });
    const parts: Record<string, PMNode> = {};
    for (const id of used) {
      const part = this.parts.get(id);
      if (part) parts[id] = part;
    }
    return {
      body,
      parts,
      evenAndOdd: this.evenAndOdd,
      defaults: this.defaults,
      styles: this.styles,
      title: this.title,
      author: this.author,
      comments: this.comments,
      trackChanges: this.trackChanges,
      protection: this.protection,
      watermark: this.watermark,
      sources: this.sources,
      citeStyle: this.citeStyle,
      notes: this.notesOptions,
      macros: this.macros,
      mailMerge: this.mailMerge,
      signature: this.signature,
      isTemplate: this.isTemplate,
    };
  }

  markSaved(name: string, path: string | null): void {
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }

  get body(): PMNode {
    return this.mainView?.state.doc ?? this.initialDoc;
  }

  text(): string {
    return plainText(this.body);
  }

  html(): string {
    const frag = DOMSerializer.fromSchema(writerSchema).serializeFragment(this.body.content);
    const div = document.createElement('div');
    div.appendChild(frag);
    return div.innerHTML;
  }

  words(): { total: number; selection: number | null } {
    const st = this.state;
    if (!st) return { total: 0, selection: null };
    const sel = st.selection.empty ? null : wordCount(st.doc.textBetween(st.selection.from, st.selection.to, '\n', ' '));
    return { total: wordCount(st.doc), selection: sel };
  }

  // ---------- sections and pages ----------

  sections(): SectionInfo[] {
    return sectionList(this.body);
  }

  /** The section that holds the caret. */
  currentSection(): SectionInfo {
    const list = this.sections();
    const head = this.mainState?.selection.head ?? 0;
    let found = list[0]!;
    for (const s of list) if (s.pos <= head) found = s;
    return found;
  }

  /** Page setup of the section with the caret (all sections share it in most documents). */
  get page(): PageSetup {
    return this.currentSection()?.props.page ?? defaultPage();
  }

  /** Change section properties; the change is an undoable step of the document. */
  setSectionProps(index: number, patch: Partial<SectionProps>, addToHistory = true): void {
    const v = this.mainView;
    if (!v) return;
    const info = this.sections()[index];
    if (!info) return;
    const attrs = { ...sectionAttrs(info.props), ...patch };
    const tr = v.state.tr.setNodeMarkup(info.pos, undefined, attrs);
    if (!addToHistory) tr.setMeta('addToHistory', false);
    v.dispatch(tr);
  }

  /** Change the page setup of one section, or of all of them. */
  setPage(patch: Partial<PageSetup>, scope: 'section' | 'document' = 'section'): void {
    const v = this.mainView;
    if (!v) return;
    const list = this.sections();
    const targets = scope === 'document' || list.length === 1 ? list : [this.currentSection()];
    let tr = v.state.tr;
    for (const s of targets) tr = tr.setNodeMarkup(s.pos, undefined, { ...sectionAttrs(s.props), page: { ...s.props.page, ...patch } });
    v.dispatch(tr);
    repaginate(v);
  }

  /** The header or footer document that applies to a page, following "same as previous" links. */
  partFor(section: number, kind: 'header' | 'footer', variant: HFKind): PMNode | null {
    const id = resolvePart(this.sections().map((s) => s.props), section, kind, variant);
    return id ? (this.parts.get(id) ?? null) : null;
  }

  /** Which variant (first/even/default) applies to a page. */
  variantFor(spec: PageSpec): HFKind {
    const sec = this.sections()[spec.section]?.props;
    if (!sec) return 'default';
    return hfKindFor({ ...spec, label: '', section: spec.section, inSection: spec.inSection, number: spec.number } as never, sec, this.evenAndOdd);
  }

  /** The id of the part a section uses for a header/footer variant (its own or an inherited one). */
  partIdFor(section: number, kind: 'header' | 'footer', variant: HFKind): string | null {
    return resolvePart(this.sections().map((s) => s.props), section, kind, variant);
  }

  /** Whether a section has its own part for the variant (otherwise it is linked to the previous section). */
  hasOwnPart(section: number, kind: 'header' | 'footer', variant: HFKind): boolean {
    return !!this.sections()[section]?.props[kind][variant];
  }

  /**
   * Store the text of a header/footer. An inherited part is edited in place (it is shared with the sections that
   * link to it); a section without any gets its own.
   */
  setPart(section: number, kind: 'header' | 'footer', variant: HFKind, doc: PMNode | null): void {
    const list = this.sections();
    const info = list[section];
    if (!info) return;
    const id = this.partIdFor(section, kind, variant);
    const empty = !doc || (doc.childCount === 1 && doc.child(0).type.name === 'paragraph' && doc.child(0).content.size === 0);
    if (id) {
      if (empty) this.parts.set(id, doc ?? emptyDoc());
      else this.parts.set(id, doc!);
    } else if (!empty) {
      const own = `${kind}-${info.props.id}-${variant}`;
      this.parts.set(own, doc!);
      this.setSectionProps(section, { [kind]: { ...info.props[kind], [variant]: own } } as Partial<SectionProps>, false);
    }
    this.dirty = true;
    this.touch();
  }

  /** "Link to previous": the section uses the part of the section before it, or gets a copy of it to edit apart. */
  setLinkToPrevious(section: number, kind: 'header' | 'footer', variant: HFKind, linked: boolean): void {
    const info = this.sections()[section];
    if (!info || section === 0) return;
    if (linked) {
      const own = info.props[kind][variant];
      if (own) this.parts.delete(own);
      this.setSectionProps(section, { [kind]: { ...info.props[kind], [variant]: null } } as Partial<SectionProps>, false);
    } else if (!info.props[kind][variant]) {
      const inherited = this.partFor(section, kind, variant);
      const own = `${kind}-${info.props.id}-${variant}`;
      this.parts.set(own, inherited ?? emptyDoc());
      this.setSectionProps(section, { [kind]: { ...info.props[kind], [variant]: own } } as Partial<SectionProps>, false);
    }
    this.dirty = true;
    this.touch();
  }

  setWatermark(wm: Watermark | null): void {
    this.watermark = wm;
    this.dirty = true;
    this.touch();
  }

  /** Move header/footer editing to the footer or header of the same page. */
  switchHF(kind: 'header' | 'footer'): void {
    const e = this.hfEdit;
    if (!e) return;
    this.hfEdit = { ...e, kind };
    this.activeView = null;
    this.touch();
  }

  /** Move header/footer editing to the previous or next section. */
  stepHF(dir: 1 | -1): void {
    const e = this.hfEdit;
    if (!e) return;
    const target = e.section + dir;
    const page = this.pageSpecs.findIndex((p) => p.section === target);
    if (page < 0) return;
    this.hfEdit = { kind: e.kind, page, section: target, variant: this.variantFor(this.pageSpecs[page]!) };
    this.activeView = null;
    this.touch();
  }

  // ---------- comments ----------

  /** Highlights the text of the comment that is selected in the pane. */
  private commentHighlight(): Plugin {
    return new Plugin({
      props: {
        decorations: (state) => {
          const id = this.activeComment;
          if (!id) return null;
          const r = commentRanges(state.doc).get(id);
          return r ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: 'nw-comment-active' })]) : null;
        },
      },
    });
  }

  // ---------- mail merge ----------

  /** Whether merge fields show the values of record `index` instead of their names. */
  mergePreview = { on: false, index: 0 };

  setMergeData(data: MailMergeData | null): void {
    this.mailMerge = data;
    this.mergePreview = { on: !!data && this.mergePreview.on, index: 0 };
    this.dirty = true;
    this.refreshMergePreview();
  }

  setMergePreview(on: boolean, index = this.mergePreview.index): void {
    const n = this.mailMerge?.records.length ?? 0;
    this.mergePreview = { on: on && n > 0, index: Math.max(0, Math.min(index, Math.max(0, n - 1))) };
    this.refreshMergePreview();
  }

  private refreshMergePreview(): void {
    if (this.mainView) this.mainView.dispatch(this.mainView.state.tr.setMeta('nw-merge', true).setMeta('addToHistory', false));
    this.touch();
  }

  /** Decorations that show the previewed record in the place of the merge fields. */
  private mergePreviewPlugin(): Plugin {
    return new Plugin({
      props: {
        decorations: (state) => {
          const data = this.mailMerge;
          if (!this.mergePreview.on || !data) return null;
          const decos: Decoration[] = [];
          state.doc.descendants((n, pos) => {
            if (n.type.name === 'field' && (n.attrs.kind === 'mergefield' || n.attrs.kind === 'merge-rule')) decos.push(Decoration.node(pos, pos + 1, {}, { pv: previewText(n, data, this.mergePreview.index) }));
            return true;
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    });
  }

  /** Replace the whole body (a merge result, a label sheet…) in a transaction that can be undone. */
  replaceBody(body: PMNode): void {
    const v = this.mainView;
    if (!v) return;
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, body.content).setMeta('nw-no-track', true).setMeta('nw-allow', true).scrollIntoView());
    this.dirty = true;
    this.touch();
  }

  /** Put a section (an envelope) before everything else. */
  insertSectionFirst(section: PMNode): void {
    const v = this.mainView;
    if (!v) return;
    v.dispatch(v.state.tr.insert(0, section).setMeta('nw-no-track', true).setMeta('nw-allow', true));
    this.dirty = true;
    this.touch();
  }

  /** Apply (or lift) an editing restriction; the editor re-reads whether it is editable. */
  setProtection(p: Protection | null): void {
    this.protection = p;
    if (p?.mode === 'trackedChanges') this.trackChanges = true;
    this.dirty = true;
    if (this.mainView) this.mainView.updateState(this.mainView.state);
    this.touch();
  }

  toggleReview(tab: 'comments' | 'changes'): void {
    if (this.showReview && this.reviewTab === tab) this.showReview = false;
    else {
      this.showReview = true;
      this.reviewTab = tab;
    }
    this.touch();
  }

  /** Comments in the order of their anchors (those without an anchor last). */
  threads(): { root: CommentData; replies: CommentData[]; from: number | null }[] {
    const ranges = this.mainView ? commentRanges(this.body) : new Map<string, { from: number; to: number }>();
    const roots = this.comments.filter((c) => !c.parent);
    return roots
      .map((root) => ({ root, replies: this.comments.filter((c) => c.parent === root.id), from: ranges.get(root.id)?.from ?? null }))
      .sort((a, b) => (a.from ?? 1e12) - (b.from ?? 1e12));
  }

  editComment(id: string, text: string): void {
    this.comments = this.comments.map((c) => (c.id === id ? { ...c, text } : c));
    this.dirty = true;
    this.touch();
  }

  replyTo(parent: string, text: string): void {
    const u = getUser();
    this.comments = [...this.comments, { id: `k${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, author: u.name, initials: u.initials, date: new Date().toISOString(), text, parent, done: false }];
    this.dirty = true;
    this.touch();
  }

  resolveComment(id: string, done: boolean): void {
    this.comments = this.comments.map((c) => (c.id === id || c.parent === id ? { ...c, done } : c));
    this.dirty = true;
    this.touch();
  }

  deleteComment(id: string): void {
    const ids = new Set([id, ...this.comments.filter((c) => c.parent === id).map((c) => c.id)]);
    const target = this.comments.find((c) => c.id === id);
    // deleting a reply only removes the reply
    if (target?.parent) {
      this.comments = this.comments.filter((c) => c.id !== id);
    } else {
      this.comments = this.comments.filter((c) => !ids.has(c.id));
      if (this.mainView) removeCommentMarks(this.mainView, [...ids]);
    }
    if (this.activeComment && ids.has(this.activeComment)) this.activeComment = null;
    this.dirty = true;
    this.touch();
  }

  deleteAllComments(): void {
    const ids = this.comments.map((c) => c.id);
    if (this.mainView) removeCommentMarks(this.mainView, ids);
    this.comments = [];
    this.activeComment = null;
    this.dirty = true;
    this.touch();
  }

  /** Select the text of a comment and make it the active one. */
  goToComment(id: string): void {
    const v = this.mainView;
    this.activeComment = id;
    const r = v && commentRanges(v.state.doc).get(id);
    if (v && r) {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.from, r.to)).scrollIntoView());
    }
    this.touch();
  }

  stepComment(dir: 1 | -1): void {
    const list = this.threads().filter((t) => t.from !== null);
    if (!list.length) return;
    const head = this.mainView?.state.selection.from ?? 0;
    const cur = this.activeComment ? list.findIndex((t) => t.root.id === this.activeComment) : -1;
    let idx: number;
    if (cur >= 0) idx = (cur + dir + list.length) % list.length;
    else if (dir === 1) idx = Math.max(0, list.findIndex((t) => (t.from ?? 0) > head)) === -1 ? 0 : Math.max(0, list.findIndex((t) => (t.from ?? 0) > head));
    else idx = Math.max(0, [...list].reverse().findIndex((t) => (t.from ?? 0) < head));
    this.goToComment(list[idx]!.root.id);
    this.showReview = true;
    this.reviewTab = 'comments';
    this.touch();
  }

  /** Remove every header and footer of the document. */
  clearHeadersFooters(): void {
    for (const s of this.sections()) {
      this.setSectionProps(s.index, { header: { default: null, first: null, even: null }, footer: { default: null, first: null, even: null } }, false);
    }
    this.parts.clear();
    this.dirty = true;
    this.touch();
  }

  beginHFEdit(kind: 'header' | 'footer', page: number): void {
    const spec = this.pageSpecs[page];
    if (!spec || this.readOnly) return;
    this.hfEdit = { kind, page, section: spec.section, variant: this.variantFor(spec) };
    this.touch();
  }

  endHFEdit(): void {
    if (!this.hfEdit) return;
    this.hfEdit = null;
    this.activeView = null;
    this.touch();
    this.mainView?.focus();
  }

  /** 1-based page that holds the caret. */
  currentPage(): number {
    const v = this.mainView;
    if (!v || !this.host) return 1;
    try {
      const c = v.coordsAtPos(v.state.selection.head);
      const sheet = this.host.getBoundingClientRect();
      const s = this.host.offsetWidth ? sheet.width / this.host.offsetWidth || 1 : 1;
      const y = (c.top - sheet.top) / s;
      const rects = this.pageRects();
      for (let i = 0; i < rects.length; i++) if (y < rects[i]!.top + rects[i]!.height + PAGE_GAP / 2) return i + 1;
      return rects.length;
    } catch {
      return 1;
    }
  }

  /** Position and size of every page in the sheet (px, zoom 100 %). */
  pageRects(): { top: number; topCss: string; left: number; width: number; height: number; spec: PageSpec }[] {
    const sections = this.sections();
    const sheetW = this.sheetWidth();
    const out: { top: number; topCss: string; left: number; width: number; height: number; spec: PageSpec }[] = [];
    let y = 0;
    let sum = 0;
    for (const spec of this.pageSpecs) {
      const p = (sections[spec.section] ?? sections[0])?.props.page ?? defaultPage();
      const w = ptToPx(p.width);
      const h = ptToPx(p.height);
      out.push({ top: y, topCss: `calc(${sum}px + ${out.length} * var(--nw-gap, ${PAGE_GAP}px))`, left: (sheetW - w) / 2, width: w, height: h, spec });
      y += h + PAGE_GAP;
      sum += h;
    }
    return out;
  }

  sheetWidth(): number {
    const sections = this.sections();
    return Math.max(...sections.map((s) => ptToPx(s.props.page.width)), 100);
  }

  sheetHeight(): number {
    const r = this.pageRects();
    const last = r[r.length - 1];
    return last ? last.top + last.height : 0;
  }

  // ---------- notes ----------

  /** The list of endnotes drawn at the end of the document, with the page breaks that fall between them. */
  private renderEndnotes(doc: PMNode, breaks: Map<number, number>): HTMLElement | null {
    const list = collectNotes(doc, this.notesOptions).filter((n) => n.kind === 'endnote');
    if (!list.length) return null;
    const root = document.createElement('div');
    root.className = 'nw-endnotes nw-doc';
    root.contentEditable = 'false';
    list.forEach((n, i) => {
      const base = breaks.get(i);
      if (base !== undefined) {
        const gap = document.createElement('div');
        gap.className = 'nw-gap';
        gap.setAttribute('style', `height:calc(${base.toFixed(2)}px + var(--nw-gap, 0px))`);
        root.appendChild(gap);
      }
      const holder = document.createElement('div');
      holder.innerHTML = noteHtml(n.node, n.label);
      const item = holder.firstElementChild as HTMLElement;
      item.classList.add('nw-en-item');
      item.dataset.id = n.id;
      root.appendChild(item);
    });
    return root;
  }

  beginNoteEdit(id: string): void {
    if (this.readOnly && this.protection?.mode !== 'comments') return;
    this.noteEdit = id;
    this.touch();
  }

  endNoteEdit(): void {
    if (!this.noteEdit) return;
    this.noteEdit = null;
    this.activeView = null;
    this.touch();
    this.mainView?.focus();
  }

  /** Store the text of a note (the paragraphs of `doc`) in its reference. */
  setNoteBody(id: string, doc: PMNode): void {
    const v = this.mainView;
    const n = this.notes().find((x) => x.id === id);
    if (!v || !n) return;
    const paras: PMNode[] = [];
    doc.forEach((b) => b.type.name === 'paragraph' && paras.push(b));
    const body = noteBodyOf(paras);
    v.dispatch(v.state.tr.setNodeMarkup(n.pos, undefined, { ...n.node.attrs, body }).setMeta('nw-no-track', true).setMeta('nw-allow', true));
    this.invalidateNotes();
    if (this.mainView) repaginate(this.mainView);
  }

  /** Insert a footnote or endnote at the caret and open its text for writing. */
  insertNote(kind: 'footnote' | 'endnote'): void {
    const v = this.mainView;
    if (!v || this.readOnly) return;
    const used = new Set(this.notes().map((n) => n.id));
    const id = newNoteId(used);
    const node = nodeTypes.footnote!.create({ kind, id, body: noteBodyOf([nodeTypes.paragraph!.create()]) });
    v.dispatch(v.state.tr.replaceSelectionWith(node, false).scrollIntoView());
    this.beginNoteEdit(id);
  }

  stepNote(dir: 1 | -1, kind?: 'footnote' | 'endnote'): void {
    const v = this.mainView;
    if (!v) return;
    const list = this.notes().filter((n) => !kind || n.kind === kind);
    if (!list.length) return;
    const head = v.state.selection.head;
    const target = dir === 1 ? (list.find((n) => n.pos >= head) ?? list[0]!) : ([...list].reverse().find((n) => n.pos + 1 < head) ?? list[list.length - 1]!);
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, target.pos)).scrollIntoView());
    v.focus();
  }


  notes(): NoteRef[] {
    return notesKey.getState(this.mainView!.state)?.notes ?? collectNotes(this.body, this.notesOptions);
  }

  /** Height (px) of a footnote laid out `widthPx` wide, used to reserve room at the bottom of the page. */
  noteHeight(node: PMNode, widthPx: number): number {
    const key = `${node.attrs.id}|${Math.round(widthPx)}|${JSON.stringify(node.attrs.body ?? null).length}|${node.attrs.custom ?? ''}`;
    const hit = this.noteCache.get(key);
    if (hit !== undefined) return hit;
    const host = this.host;
    if (!host) return 20;
    if (!this.noteMeasure || !this.noteMeasure.isConnected) {
      const m = document.createElement('div');
      m.className = 'nw-doc nw-fn-measure';
      m.setAttribute('aria-hidden', 'true');
      m.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
      host.appendChild(m);
      this.noteMeasure = m;
    }
    this.noteMeasure.style.width = `${widthPx}px`;
    const label = this.notes().find((n) => n.id === node.attrs.id)?.label ?? '1';
    this.noteMeasure.innerHTML = noteHtml(node, label);
    const h = this.noteMeasure.offsetHeight;
    this.noteCache.set(key, h);
    if (this.noteCache.size > 800) this.noteCache.clear();
    return h;
  }

  /** Recompute note numbers (after changing their format). */
  refreshNotes(): void {
    if (this.mainView) this.mainView.dispatch(this.mainView.state.tr.setMeta(notesKey, true).setMeta('addToHistory', false));
    this.touch();
  }

  invalidateNotes(): void {
    this.noteCache.clear();
  }

  // ---------- find / replace ----------

  find(query: string, opts: { matchCase?: boolean; wholeWord?: boolean } = {}, from?: number): FindState {
    const v = this.mainView!;
    const matchCase = !!opts.matchCase, wholeWord = !!opts.wholeWord;
    const matches = findMatches(v.state.doc, query, matchCase, wholeWord);
    const start = from ?? v.state.selection.from;
    let current = matches.findIndex((m) => m.from >= start);
    if (current === -1) current = matches.length ? 0 : -1;
    const st: FindState = { query, matchCase, wholeWord, matches, current };
    v.dispatch(v.state.tr.setMeta(findKey, st).setMeta('addToHistory', false));
    this.reveal(st);
    return st;
  }

  private reveal(st: FindState): void {
    const v = this.mainView!;
    const m = st.matches[st.current];
    if (!m) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).setMeta(findKey, st).scrollIntoView());
  }

  findStep(dir: 1 | -1): FindState | null {
    const v = this.mainView!;
    const f = findKey.getState(v.state);
    if (!f || !f.matches.length) return f ?? null;
    const st = { ...f, current: (f.current + dir + f.matches.length) % f.matches.length };
    this.reveal(st);
    return st;
  }

  replaceCurrent(text: string): FindState | null {
    const v = this.mainView!;
    const f = findKey.getState(v.state);
    const m = f?.matches[f.current];
    if (!f || !m) return f ?? null;
    v.dispatch(v.state.tr.insertText(text, m.from, m.to));
    return this.find(f.query, f, m.from + text.length);
  }

  replaceAll(query: string, text: string, opts: { matchCase?: boolean; wholeWord?: boolean } = {}): number {
    const v = this.mainView!;
    const matches = findMatches(v.state.doc, query, !!opts.matchCase, !!opts.wholeWord);
    if (!matches.length) return 0;
    const tr = v.state.tr;
    for (const m of [...matches].reverse()) tr.insertText(text, m.from, m.to);
    v.dispatch(tr);
    return matches.length;
  }

  clearFind(): void {
    const v = this.mainView;
    if (!v) return;
    v.dispatch(v.state.tr.setMeta(findKey, { query: '', matchCase: false, wholeWord: false, matches: [], current: -1 }).setMeta('addToHistory', false));
  }

  focus(): void {
    this.view?.focus();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    if (this.mainView) {
      setPaginationOff(this.mainView, mode !== 'print');
      setOutlineActive(mode === 'outline')(this.mainView.state, this.mainView.dispatch);
    }
    this.touch();
  }

  /** Page breaks currently applied (positions, kinds and spacer heights); used by tests. */
  layoutSignature(): string {
    return this.mainView ? (paginationKey.getState(this.mainView.state)?.signature ?? '') : '';
  }

  pageCount(): number {
    return paginationKey.getState(this.mainView!.state)?.pages ?? this.pages;
  }
}

/** HTML of one note as shown at the bottom of a page: its number and its paragraphs. */
export function noteHtml(node: PMNode, label: string): string {
  const doc = noteDoc(node.attrs.body);
  let inner = '';
  if (doc) {
    const div = document.createElement('div');
    div.appendChild(DOMSerializer.fromSchema(writerSchema).serializeFragment(doc.content));
    inner = div.innerHTML;
  }
  return `<div class="nw-fn-item"><span class="nw-fn-num">${escapeHtml(label)}</span><div class="nw-fn-text">${inner || '<p class="nw-p"></p>'}</div></div>`;
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
void defaultSection;
