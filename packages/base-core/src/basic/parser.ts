import { BasicSyntaxError, tokenize, type Token } from './lexer';

// ------------------------------------------------------------------------------------------------ AST

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'date'; v: Date }
  | { k: 'null' }
  | { k: 'empty' }
  | { k: 'nothing' }
  | { k: 'id'; name: string; line: number }
  /** `obj.name`; `obj` is null inside `With` for `.name`. */
  | { k: 'member'; obj: Expr | null; name: string; line: number }
  /** `obj!name` */
  | { k: 'bang'; obj: Expr | null; name: string; line: number }
  /** `fn(args)`: a call, an array index or a default-member index. `null` args are omitted ones (`f(a, , b)`). */
  | { k: 'call'; fn: Expr; args: (Arg | null)[]; line: number; /** `,` or `;` after each argument of a call without parentheses (Debug.Print). */ seps?: string[] }
  | { k: 'un'; op: 'neg' | 'not'; a: Expr; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'new'; cls: string; line: number };

export interface Arg {
  name?: string;
  value: Expr;
}

export interface TypeRef {
  name: string;
}

export interface Decl {
  name: string;
  /** `Dim a(1 To 5)`: bounds as expressions; `[]` for `Dim a()`. */
  dims?: { lo?: Expr; hi?: Expr }[];
  type?: string;
  init?: Expr;
  /** `Dim c As New Collection` */
  isNew?: boolean;
}

export type CaseTest = { kind: 'value'; v: Expr } | { kind: 'range'; lo: Expr; hi: Expr } | { kind: 'is'; op: string; v: Expr };

export type Stmt = { line: number } & (
  | { k: 'dim'; decls: Decl[]; isConst: boolean }
  | { k: 'redim'; preserve: boolean; decls: Decl[] }
  | { k: 'assign'; target: Expr; value: Expr }
  | { k: 'call'; expr: Expr }
  | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; else?: Stmt[] }
  | { k: 'select'; expr: Expr; cases: { tests: CaseTest[] | 'else'; body: Stmt[] }[] }
  | { k: 'for'; v: Expr; from: Expr; to: Expr; step?: Expr; body: Stmt[] }
  | { k: 'foreach'; v: Expr; coll: Expr; body: Stmt[] }
  | { k: 'do'; pre?: { until: boolean; cond: Expr }; post?: { until: boolean; cond: Expr }; body: Stmt[] }
  | { k: 'exit'; what: 'sub' | 'function' | 'for' | 'do' }
  | { k: 'onerror'; mode: 'next' | 'zero' | 'label'; label?: string }
  | { k: 'resume'; mode: 'next' | 'label' | 'here'; label?: string }
  | { k: 'goto'; label: string }
  | { k: 'label'; name: string }
  | { k: 'with'; obj: Expr; body: Stmt[] }
  | { k: 'erase'; names: string[] }
);

export interface Param {
  name: string;
  byRef: boolean;
  optional: boolean;
  isArray: boolean;
  paramArray: boolean;
  type?: string;
  def?: Expr;
}

export interface Proc {
  kind: 'sub' | 'function';
  name: string;
  params: Param[];
  returns?: string;
  isPublic: boolean;
  body: Stmt[];
  line: number;
  module: string;
}

export interface ModuleAst {
  name: string;
  explicit: boolean;
  /** Declarations at the top of the module (variables and constants). */
  decls: Stmt[];
  procs: Proc[];
}

// ------------------------------------------------------------------------------------------------ parser

const END_OF_BLOCK = new Set(['end', 'else', 'elseif', 'case', 'loop', 'next', 'wend']);

export function parseModule(modName: string, src: string, opts: { labels?: boolean } = {}): ModuleAst {
  const toks = tokenize(src);
  let p = 0;
  const ast: ModuleAst = { name: modName, explicit: false, decls: [], procs: [] };

  const peek = (o = 0): Token => toks[Math.min(p + o, toks.length - 1)]!;
  const next = (): Token => toks[p++]!;
  const fail = (msg: string, t: Token = peek()): never => {
    throw new BasicSyntaxError(msg, t.line, t.col);
  };
  const isKw = (...w: string[]) => peek().kind === 'kw' && w.includes(peek().text);
  const isOp = (v: string) => peek().kind === 'op' && peek().text === v;
  const isId = (v: string) => peek().kind === 'id' && peek().text.toLowerCase() === v;
  const expectKw = (w: string) => {
    if (!isKw(w)) fail(`Se esperaba "${w}".`);
    return next();
  };
  const expectOp = (v: string) => {
    if (!isOp(v)) fail(`Se esperaba "${v}".`);
    return next();
  };
  const atEol = () => peek().kind === 'eol' || peek().kind === 'eof';
  const skipEols = () => {
    while (peek().kind === 'eol') p++;
  };
  const endOfStatement = () => {
    if (!atEol()) fail(`No se esperaba "${peek().text}" aquí.`);
    while (peek().kind === 'eol') p++;
  };
  /** A name: an identifier, or a keyword used as a member name (`.Error`, `.End`). */
  const name = (afterDot = false): Token => {
    const t = peek();
    if (t.kind === 'id' || (afterDot && t.kind === 'kw')) return next();
    return fail(t.kind === 'eof' || t.kind === 'eol' ? 'Falta un nombre.' : `Se esperaba un nombre y se encontró "${t.text}".`);
  };

  // ---- expressions (lowest precedence first)
  const expr = (): Expr => imp();
  const bin = (op: string, a: Expr, b: Expr, line: number): Expr => ({ k: 'bin', op, a, b, line });
  const imp = (): Expr => {
    let a = eqv();
    while (isKw('imp')) {
      const l = next().line;
      a = bin('imp', a, eqv(), l);
    }
    return a;
  };
  const eqv = (): Expr => {
    let a = xor();
    while (isKw('eqv')) {
      const l = next().line;
      a = bin('eqv', a, xor(), l);
    }
    return a;
  };
  const xor = (): Expr => {
    let a = or();
    while (isKw('xor')) {
      const l = next().line;
      a = bin('xor', a, or(), l);
    }
    return a;
  };
  const or = (): Expr => {
    let a = and();
    while (isKw('or')) {
      const l = next().line;
      a = bin('or', a, and(), l);
    }
    return a;
  };
  const and = (): Expr => {
    let a = not();
    while (isKw('and')) {
      const l = next().line;
      a = bin('and', a, not(), l);
    }
    return a;
  };
  const not = (): Expr => {
    if (isKw('not')) {
      const l = next().line;
      return { k: 'un', op: 'not', a: not(), line: l };
    }
    return cmp();
  };
  const cmp = (): Expr => {
    let a = concat();
    for (;;) {
      const t = peek();
      if (t.kind === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.text)) {
        next();
        a = bin(t.text, a, concat(), t.line);
      } else if (isKw('is')) {
        next();
        a = bin('is', a, concat(), t.line);
      } else if (isKw('like')) {
        next();
        a = bin('like', a, concat(), t.line);
      } else return a;
    }
  };
  const concat = (): Expr => {
    let a = add();
    while (isOp('&')) {
      const l = next().line;
      a = bin('&', a, add(), l);
    }
    return a;
  };
  const add = (): Expr => {
    let a = mod();
    while (isOp('+') || isOp('-')) {
      const t = next();
      a = bin(t.text, a, mod(), t.line);
    }
    return a;
  };
  const mod = (): Expr => {
    let a = idiv();
    while (isKw('mod')) {
      const l = next().line;
      a = bin('mod', a, idiv(), l);
    }
    return a;
  };
  const idiv = (): Expr => {
    let a = mul();
    while (isOp('\\')) {
      const l = next().line;
      a = bin('\\', a, mul(), l);
    }
    return a;
  };
  const mul = (): Expr => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const t = next();
      a = bin(t.text, a, unary(), t.line);
    }
    return a;
  };
  const unary = (): Expr => {
    if (isOp('-')) {
      const l = next().line;
      return { k: 'un', op: 'neg', a: unary(), line: l };
    }
    if (isOp('+')) {
      next();
      return unary();
    }
    return pow();
  };
  const pow = (): Expr => {
    const a = postfix();
    if (isOp('^')) {
      const l = next().line;
      // VBA: ^ is left-associative and binds tighter than unary minus on its left
      let r: Expr = a;
      r = bin('^', r, powOperand(), l);
      while (isOp('^')) {
        const l2 = next().line;
        r = bin('^', r, powOperand(), l2);
      }
      return r;
    }
    return a;
  };
  const powOperand = (): Expr => (isOp('-') ? { k: 'un', op: 'neg', a: (next(), postfix()), line: peek().line } : postfix());

  const args = (): (Arg | null)[] => {
    const out: (Arg | null)[] = [];
    if (isOp(')')) return out;
    for (;;) {
      if (isOp(',')) {
        out.push(null);
        next();
        continue;
      }
      if (peek().kind === 'id' && peek(1).kind === 'op' && peek(1).text === ':=') {
        const n = next().text;
        next();
        out.push({ name: n, value: expr() });
      } else out.push({ value: expr() });
      if (isOp(',')) {
        next();
        if (isOp(')')) out.push(null);
        continue;
      }
      return out;
    }
  };

  const postfix = (): Expr => {
    let e = primary();
    for (;;) {
      if (isOp('(')) {
        const l = next().line;
        const a = args();
        expectOp(')');
        e = { k: 'call', fn: e, args: a, line: l };
      } else if (isOp('.') && !(e.k === 'num')) {
        const l = next().line;
        e = { k: 'member', obj: e, name: name(true).text, line: l };
      } else if (isOp('!')) {
        const l = next().line;
        e = { k: 'bang', obj: e, name: name(true).text, line: l };
      } else return e;
    }
  };

  const primary = (): Expr => {
    const t = peek();
    switch (t.kind) {
      case 'num':
        next();
        return { k: 'num', v: t.num! };
      case 'str':
        next();
        return { k: 'str', v: t.text };
      case 'date':
        next();
        return { k: 'date', v: t.date! };
      case 'id':
        next();
        return { k: 'id', name: t.text, line: t.line };
      case 'kw':
        if (t.text === 'true' || t.text === 'false') return next(), { k: 'bool', v: t.text === 'true' };
        if (t.text === 'null') return next(), { k: 'null' };
        if (t.text === 'empty') return next(), { k: 'empty' };
        if (t.text === 'nothing') return next(), { k: 'nothing' };
        if (t.text === 'new') {
          next();
          return { k: 'new', cls: name().text, line: t.line };
        }
        return fail(`No se esperaba "${t.text}" en una expresión.`);
      case 'op':
        if (t.text === '(') {
          next();
          const e = expr();
          expectOp(')');
          return e;
        }
        if (t.text === '.') {
          // inside With: .Member
          next();
          return { k: 'member', obj: null, name: name(true).text, line: t.line };
        }
        if (t.text === '!') {
          next();
          return { k: 'bang', obj: null, name: name(true).text, line: t.line };
        }
        return fail(`No se esperaba "${t.text}" en una expresión.`);
      default:
        return fail('La expresión está incompleta.');
    }
  };

  // ---- statements
  const typeName = (): string => {
    const t = name();
    let n = t.text;
    while (isOp('.')) {
      next();
      n += '.' + name().text;
    }
    return n;
  };

  const declList = (isConst: boolean): Decl[] => {
    const out: Decl[] = [];
    for (;;) {
      const nm = name().text;
      const d: Decl = { name: nm };
      if (isOp('(')) {
        next();
        d.dims = [];
        if (!isOp(')')) {
          for (;;) {
            let lo: Expr | undefined;
            let hi = expr();
            if (isKw('to')) {
              next();
              lo = hi;
              hi = expr();
            }
            d.dims.push({ lo, hi });
            if (isOp(',')) next();
            else break;
          }
        }
        expectOp(')');
      }
      if (isKw('as')) {
        next();
        if (isKw('new')) {
          next();
          d.isNew = true;
        }
        d.type = typeName();
      }
      if (isConst) {
        expectOp('=');
        d.init = expr();
      }
      out.push(d);
      if (isOp(',')) next();
      else return out;
    }
  };

  const block = (...terminators: string[]): Stmt[] => {
    const body: Stmt[] = [];
    skipEols();
    while (peek().kind !== 'eof') {
      const t = peek();
      if (t.kind === 'kw' && END_OF_BLOCK.has(t.text)) {
        if (t.text === 'end') {
          const n = peek(1);
          // "End If", "End Sub"… close a block; a lone "End" is a statement
          if (n.kind === 'kw' || n.kind === 'id') {
            if (terminators.includes('end')) break;
            fail(`"End ${n.text}" no corresponde a ningún bloque abierto.`);
          }
        } else {
          if (terminators.includes(t.text)) break;
          fail(`"${t.text}" no corresponde a ningún bloque abierto.`);
        }
      }
      body.push(statement());
      skipEols();
    }
    return body;
  };

  const condThen = (): Expr => {
    const c = expr();
    expectKw('then');
    return c;
  };

  /** A statement on one line after `Then` / `Else` (no block). */
  const inlineBody = (): Stmt[] => {
    const body: Stmt[] = [];
    for (;;) {
      body.push(statement(true));
      if (peek().kind === 'eol' && peek().text === ':' && !(peek(1).kind === 'kw' && peek(1).text === 'else')) {
        next();
        continue;
      }
      return body;
    }
  };

  const ifStmt = (line: number): Stmt => {
    const first = condThen();
    if (!atEol()) {
      // single-line If
      const body = inlineBody();
      let elseBody: Stmt[] | undefined;
      if (peek().kind === 'eol' && peek().text === ':' && peek(1).kind === 'kw' && peek(1).text === 'else') next();
      if (isKw('else')) {
        next();
        elseBody = inlineBody();
      }
      return { k: 'if', line, branches: [{ cond: first, body }], else: elseBody };
    }
    const branches = [{ cond: first, body: block('else', 'elseif', 'end') }];
    let elseBody: Stmt[] | undefined;
    for (;;) {
      if (isKw('elseif')) {
        next();
        const c = condThen();
        branches.push({ cond: c, body: block('else', 'elseif', 'end') });
      } else if (isKw('else')) {
        next();
        elseBody = block('end');
      } else break;
    }
    expectKw('end');
    expectKw('if');
    return { k: 'if', line, branches, else: elseBody };
  };

  const selectStmt = (line: number): Stmt => {
    if (!isKw('case')) fail('Se esperaba "Case" después de "Select".');
    next();
    const e = expr();
    endOfStatement();
    const cases: { tests: CaseTest[] | 'else'; body: Stmt[] }[] = [];
    skipEols();
    while (isKw('case')) {
      next();
      if (isKw('else')) {
        next();
        cases.push({ tests: 'else', body: block('case', 'end') });
        continue;
      }
      const tests: CaseTest[] = [];
      for (;;) {
        if (isKw('is')) {
          next();
          const t = peek();
          if (!(t.kind === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.text))) fail('Se esperaba un operador de comparación después de "Is".');
          next();
          tests.push({ kind: 'is', op: t.text, v: concat() });
        } else {
          const lo = concat();
          if (isKw('to')) {
            next();
            tests.push({ kind: 'range', lo, hi: concat() });
          } else tests.push({ kind: 'value', v: lo });
        }
        if (isOp(',')) next();
        else break;
      }
      cases.push({ tests, body: block('case', 'end') });
    }
    expectKw('end');
    expectKw('select');
    return { k: 'select', line, expr: e, cases };
  };

  const forStmt = (line: number): Stmt => {
    if (isKw('each')) {
      next();
      const v = postfix();
      expectKw('in');
      const coll = expr();
      const body = block('next');
      expectKw('next');
      if (!atEol()) postfix();
      return { k: 'foreach', line, v, coll, body };
    }
    const v = postfix();
    expectOp('=');
    const from = expr();
    expectKw('to');
    const to = expr();
    let step: Expr | undefined;
    if (isKw('step')) {
      next();
      step = expr();
    }
    const body = block('next');
    expectKw('next');
    if (!atEol()) postfix();
    return { k: 'for', line, v, from, to, step, body };
  };

  const doStmt = (line: number): Stmt => {
    let pre: { until: boolean; cond: Expr } | undefined;
    if (isKw('while', 'until')) {
      const until = next().text === 'until';
      pre = { until, cond: expr() };
    }
    const body = block('loop');
    expectKw('loop');
    let post: { until: boolean; cond: Expr } | undefined;
    if (isKw('while', 'until')) {
      const until = next().text === 'until';
      post = { until, cond: expr() };
    }
    return { k: 'do', line, pre, post, body };
  };

  const statement = (inline = false): Stmt => {
    const t = peek();
    const line = t.line;
    const done = <T extends Stmt>(s: T): T => {
      if (!inline) endOfStatement();
      return s;
    };
    if (t.kind === 'kw') {
      switch (t.text) {
        case 'dim':
        case 'static':
        case 'private':
        case 'public':
        case 'const': {
          let isConst = t.text === 'const';
          next();
          if (isKw('const')) {
            next();
            isConst = true;
          }
          return done({ k: 'dim', line, decls: declList(isConst), isConst });
        }
        case 'redim': {
          next();
          const preserve = isKw('preserve');
          if (preserve) next();
          return done({ k: 'redim', line, preserve, decls: declList(false) });
        }
        case 'erase': {
          next();
          const names = [name().text];
          while (isOp(',')) {
            next();
            names.push(name().text);
          }
          return done({ k: 'erase', line, names });
        }
        case 'if':
          next();
          return ifStmt(line);
        case 'select':
          next();
          return selectStmt(line);
        case 'for':
          next();
          return forStmt(line);
        case 'do':
          next();
          return doStmt(line);
        case 'while': {
          next();
          const cond = expr();
          const body = block('wend');
          expectKw('wend');
          return { k: 'do', line, pre: { until: false, cond }, body };
        }
        case 'with': {
          next();
          const obj = expr();
          const body = block('end');
          expectKw('end');
          expectKw('with');
          return { k: 'with', line, obj, body };
        }
        case 'exit': {
          next();
          if (!isKw('sub', 'function', 'for', 'do')) fail('Después de "Exit" va Sub, Function, For o Do.');
          return done({ k: 'exit', line, what: next().text as 'sub' | 'function' | 'for' | 'do' });
        }
        case 'goto':
          next();
          return done({ k: 'goto', line, label: name().text });
        case 'on': {
          next();
          expectKw('error');
          if (isKw('resume')) {
            next();
            expectKw('next');
            return done({ k: 'onerror', line, mode: 'next' });
          }
          expectKw('goto');
          if (peek().kind === 'num') {
            if (peek().num !== 0) fail('Solo se admite "On Error GoTo 0" o una etiqueta.');
            next();
            return done({ k: 'onerror', line, mode: 'zero' });
          }
          return done({ k: 'onerror', line, mode: 'label', label: name().text });
        }
        case 'resume': {
          next();
          if (isKw('next')) {
            next();
            return done({ k: 'resume', line, mode: 'next' });
          }
          if (!atEol()) return done({ k: 'resume', line, mode: 'label', label: name().text });
          return done({ k: 'resume', line, mode: 'here' });
        }
        case 'call': {
          next();
          const e = postfix();
          return done({ k: 'call', line, expr: e });
        }
        case 'set':
        case 'let': {
          next();
          const target = postfix();
          expectOp('=');
          return done({ k: 'assign', line, target, value: expr() });
        }
        case 'end':
          if (peek(1).kind === 'eol' || peek(1).kind === 'eof') {
            next();
            return done({ k: 'exit', line, what: 'sub' }); // a lone End stops the procedure
          }
          return fail(`"End ${peek(1).text}" no corresponde a ningún bloque abierto.`);
        case 'option':
          next();
          next();
          if (!atEol()) next();
          return done({ k: 'call', line, expr: { k: 'null' } });
        default:
          return fail(`No se esperaba "${t.text}" aquí.`);
      }
    }
    // ? expr  prints the expression (immediate window)
    if (t.kind === 'op' && t.text === '?') {
      next();
      const items: Arg[] = [];
      const seps: string[] = [];
      if (!atEol()) {
        for (;;) {
          items.push({ value: expr() });
          if (isOp(',') || isOp(';')) {
            seps.push(next().text);
            if (atEol()) break;
            continue;
          }
          break;
        }
      }
      const print: Expr = { k: 'call', fn: { k: 'member', obj: { k: 'id', name: 'Debug', line }, name: 'Print', line }, args: items, seps, line };
      return done({ k: 'call', line, expr: print });
    }
    // a label:  Name:
    if (t.kind === 'id' && peek(1).kind === 'eol' && peek(1).text === ':' && !inline && opts.labels !== false) {
      next();
      next();
      return { k: 'label', line, name: t.text };
    }
    if (t.kind === 'id' || (t.kind === 'op' && (t.text === '.' || t.text === '!'))) {
      const target = postfix();
      if (isOp('=')) {
        next();
        return done({ k: 'assign', line, target, value: expr() });
      }
      // a call without parentheses:  DoCmd.OpenForm "x", 1   /   MsgBox "hi"
      if (!atEol() && !(peek().kind === 'kw' && peek().text === 'else')) {
        const list: (Arg | null)[] = [];
        const seps: string[] = [];
        for (;;) {
          if (isOp(',')) {
            list.push(null); // an omitted argument: DoCmd.GoToRecord , , acNext
            seps.push(next().text);
            continue;
          }
          if (peek().kind === 'id' && peek(1).kind === 'op' && peek(1).text === ':=') {
            const n = next().text;
            next();
            list.push({ name: n, value: expr() });
          } else list.push({ value: expr() });
          if (isOp(',') || isOp(';')) {
            seps.push(next().text);
            if (atEol()) break;
            continue;
          }
          break;
        }
        const call: Expr = { k: 'call', fn: target, args: list, seps, line };
        return done({ k: 'call', line, expr: call });
      }
      return done({ k: 'call', line, expr: target });
    }
    return fail(`No se esperaba "${t.text}" aquí.`);
  };

  // ---- procedures and module-level declarations
  const paramList = (): Param[] => {
    const out: Param[] = [];
    expectOp('(');
    if (!isOp(')')) {
      for (;;) {
        const prm: Param = { name: '', byRef: true, optional: false, isArray: false, paramArray: false };
        for (;;) {
          if (isKw('optional')) {
            next();
            prm.optional = true;
          } else if (isKw('byval')) {
            next();
            prm.byRef = false;
          } else if (isKw('byref')) {
            next();
            prm.byRef = true;
          } else if (isKw('paramarray')) {
            next();
            prm.paramArray = true;
          } else break;
        }
        prm.name = name().text;
        if (isOp('(')) {
          next();
          expectOp(')');
          prm.isArray = true;
        }
        if (isKw('as')) {
          next();
          prm.type = typeName();
        }
        if (isOp('=')) {
          next();
          prm.def = expr();
        }
        out.push(prm);
        if (isOp(',')) next();
        else break;
      }
    }
    expectOp(')');
    return out;
  };

  skipEols();
  while (peek().kind !== 'eof') {
    const t = peek();
    let isPublic = true;
    let q = 0;
    while (peek(q).kind === 'kw' && (peek(q).text === 'private' || peek(q).text === 'public' || peek(q).text === 'static')) {
      if (peek(q).text === 'private') isPublic = false;
      q++;
    }
    const head = peek(q);
    if (head.kind === 'kw' && (head.text === 'sub' || head.text === 'function')) {
      p += q + 1;
      const kind = head.text as 'sub' | 'function';
      const nm = name().text;
      const params = isOp('(') ? paramList() : [];
      let returns: string | undefined;
      if (isKw('as')) {
        next();
        returns = typeName();
      }
      endOfStatement();
      const body = block('end');
      expectKw('end');
      if (!isKw(kind)) fail(`Se esperaba "End ${kind === 'sub' ? 'Sub' : 'Function'}".`);
      next();
      ast.procs.push({ kind, name: nm, params, returns, isPublic, body, line: head.line, module: modName });
      endOfStatement();
    } else if (t.kind === 'kw' && t.text === 'option') {
      next();
      if (isId('explicit')) ast.explicit = true;
      while (!atEol()) next();
      endOfStatement();
    } else if (t.kind === 'kw' && (t.text === 'dim' || t.text === 'const' || t.text === 'private' || t.text === 'public' || t.text === 'static')) {
      ast.decls.push(statement());
    } else {
      fail('Fuera de un procedimiento solo puede haber declaraciones (Dim, Const) y procedimientos (Sub, Function).');
    }
    skipEols();
  }
  return ast;
}

/** Parse the statements of one line typed in the immediate window. */
export function parseStatements(src: string): Stmt[] {
  const ast = parseModule('Inmediato', `Sub __inmediato()\n${src}\nEnd Sub`, { labels: false });
  return ast.procs[0]!.body;
}
