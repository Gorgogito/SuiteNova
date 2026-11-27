import { describe, expect, it } from 'vitest';
import {
  addCategory,
  addRaw,
  brokenActions,
  buildMessage,
  categoriesOf,
  categoryHex,
  changeCategory,
  clearFollow,
  compareMessages,
  completeFollow,
  dateSpan,
  dueGroup,
  followFlag,
  groupOf,
  isBlockedSender,
  isSafeSender,
  listSender,
  newContact,
  newMailData,
  newTask,
  parseIcs,
  parseMailData,
  parseQuery,
  parseVcf,
  planRules,
  presetDue,
  reconcileFolder,
  remapFolder,
  removeCategory,
  ruleMatches,
  searchFolderMessages,
  searchFoldersOf,
  searchMessages,
  senderEntry,
  serializeMail,
  setCategory,
  setFollow,
  unlistSender,
  writeIcs,
  writeVcf,
  quickStepsOf,
  type Condition,
  type Draft,
  type MailData,
  type MailRecord,
  type Rule,
} from './index';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
/** A Wednesday. */
const NOW = at(2026, 6, 10);
const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

function add(d: MailData, p: Partial<Draft> & { subject: string }, folder = 'inbox', date = NOW): MailRecord {
  const raw = buildMessage({ from: { name: 'Ana López', email: 'ana@ejemplo.com' }, to: [{ name: 'Yo', email: 'yo@casa.net' }], cc: [], bcc: [], text: 'Hola', attachments: [], date: new Date(date), ...p } as Draft);
  return addRaw(d, folder, raw);
}
const subjects = (l: MailRecord[]) => l.map((m) => m.subject).sort();

describe('categorías', () => {
  it('empieza con las de siempre y las nuevas se validan', () => {
    const d = newMailData();
    expect(categoriesOf(d).map((c) => c.color)).toEqual(['blue', 'green', 'yellow', 'orange', 'purple', 'red']);
    expect(d.categories).toBeUndefined();
    addCategory(d, '  Clientes   VIP ', 'teal');
    expect(categoriesOf(d).at(-1)).toEqual({ name: 'Clientes VIP', color: 'teal' });
    expect(() => addCategory(d, 'clientes vip', 'red')).toThrow('Ya existe');
    expect(() => addCategory(d, 'a,b', 'red')).toThrow('comas');
    expect(() => addCategory(d, '  ', 'red')).toThrow('Escribe');
    expect(categoryHex(d, 'CLIENTES VIP')).toBe('#038387');
    expect(categoryHex(d, 'Desconocida')).toBe('#69797e');
  });

  it('cambiar el nombre llega a mensajes, citas, tareas, contactos, reglas y pasos rápidos; eliminar la quita de todo', () => {
    const d = newMailData();
    const m = add(d, { subject: 'Uno' });
    const task = newTask('t');
    const contact = newContact();
    d.tasks.push(task);
    d.contacts.push(contact);
    for (const x of [m, task, contact]) setCategory(x, 'Categoría azul', true);
    expect(setCategory(m, 'categoría AZUL', true)).toBe(false);
    d.rules = [{ id: 'r', name: 'r', enabled: true, conditions: [{ kind: 'hasAttachments' }], exceptions: [], actions: [{ kind: 'category', name: 'Categoría azul' }], stop: false }];
    d.quickSteps = [{ id: 'q', name: 'q', actions: [{ kind: 'category', name: 'categoría azul' }] }];
    changeCategory(d, 'Categoría azul', { name: 'Facturas', color: 'red' });
    expect([m.categories, task.categories, contact.categories]).toEqual([['Facturas'], ['Facturas'], ['Facturas']]);
    expect(d.rules[0]!.actions[0]).toEqual({ kind: 'category', name: 'Facturas' });
    expect(d.quickSteps[0]!.actions[0]).toEqual({ kind: 'category', name: 'Facturas' });
    // only the case changes
    changeCategory(d, 'Facturas', { name: 'FACTURAS' });
    expect(m.categories).toEqual(['FACTURAS']);
    removeCategory(d, 'facturas');
    expect([m.categories, task.categories, contact.categories]).toEqual([undefined, undefined, undefined]);
    expect(categoriesOf(d).map((c) => c.name)).not.toContain('FACTURAS');
  });

  it('viajan en .ics y .vcf', () => {
    const d = newMailData();
    const ev = { id: 'e', uid: 'u', title: 'Cita', location: '', description: '', start: NOW, end: NOW + 3600000, allDay: false, rrule: '', exdates: [], reminder: null, categories: ['Uno', 'Dos y tres'] };
    const task = { ...newTask('Tarea'), categories: ['Uno'] };
    const back = parseIcs(writeIcs([ev], [task]));
    expect(back.events[0]!.categories).toEqual(['Uno', 'Dos y tres']);
    expect(back.tasks[0]!.categories).toEqual(['Uno']);
    expect(parseIcs(writeIcs([{ ...ev, categories: undefined }])).events[0]).not.toHaveProperty('categories');
    const contact = { ...newContact(), first: 'Ana', categories: ['Familia', 'Club'] };
    expect(parseVcf(writeVcf([contact])).contacts[0]!.categories).toEqual(['Familia', 'Club']);
    expect(d.messages).toHaveLength(0);
  });
});

describe('seguimiento', () => {
  it('las fechas rápidas caen donde en Outlook', () => {
    expect(presetDue('today', NOW)).toBe(midnight(2026, 6, 10));
    expect(presetDue('tomorrow', NOW)).toBe(midnight(2026, 6, 11));
    expect(presetDue('week', NOW)).toBe(midnight(2026, 6, 12));
    expect(presetDue('nextweek', NOW)).toBe(midnight(2026, 6, 19));
    // on Saturday the Friday of the week has passed
    expect(presetDue('week', at(2026, 6, 13))).toBe(midnight(2026, 6, 13));
    // Sunday still belongs to the week that ends
    expect(presetDue('nextweek', at(2026, 6, 14))).toBe(midnight(2026, 6, 19));
    expect(presetDue('nodate', NOW)).toBeNull();
  });

  it('marcar, completar y quitar; lo que cambia en el servidor manda', () => {
    const m: Pick<MailRecord, 'flagged' | 'follow'> = { flagged: false };
    setFollow(m, midnight(2026, 6, 9));
    expect(dueGroup(m, NOW).label).toBe('Vencidos');
    completeFollow(m, NOW);
    expect(m).toEqual({ flagged: false, follow: { due: midnight(2026, 6, 9), done: NOW } });
    expect(dueGroup(m, NOW).label).toBe('Completados');
    // flagged again elsewhere: no longer completed
    m.flagged = true;
    followFlag(m);
    expect(m.follow).toBeUndefined();
    setFollow(m, midnight(2026, 6, 30));
    m.flagged = false;
    followFlag(m);
    expect(m.follow).toBeUndefined();
    setFollow(m, null);
    expect(m).toEqual({ flagged: true });
    clearFollow(m);
    expect(m).toEqual({ flagged: false });
  });

  it('la sincronización respeta el seguimiento mientras la bandera no cambie', () => {
    const d = newMailData();
    const m = add(d, { subject: 'En el servidor' });
    m.remote = { account: 'a', folder: 'INBOX', key: '1' };
    setFollow(m, midnight(2026, 6, 20));
    const plan = { local: 'inbox', remote: 'INBOX', path: 'INBOX', special: true };
    const state = (flags: string[]) => ({ validity: '1', mirror_deletions: true, items: [{ key: '1', flags, size: 10 }] });
    reconcileFolder(d, 'a', plan, state(['\\Flagged', '\\Seen']), { limit: 10, maxBytes: 1e6 });
    expect(m.follow).toEqual({ due: midnight(2026, 6, 20) });
    reconcileFolder(d, 'a', plan, state(['\\Seen']), { limit: 10, maxBytes: 1e6 });
    expect(m.flagged).toBe(false);
    expect(m.follow).toBeUndefined();
  });

  it('ordena y agrupa por seguimiento y por categoría', () => {
    const d = newMailData();
    const none = add(d, { subject: 'nada' });
    const undated = add(d, { subject: 'sin fecha' });
    const later = add(d, { subject: 'luego' });
    const late = add(d, { subject: 'tarde' });
    const done = add(d, { subject: 'hecho' });
    setFollow(undated, null);
    setFollow(later, midnight(2026, 7, 1));
    setFollow(late, midnight(2026, 6, 1));
    completeFollow(done, NOW);
    const order = [...d.messages].sort(compareMessages({ sort: 'flag', reverse: false }));
    expect(order.map((m) => m.subject)).toEqual(['tarde', 'luego', 'sin fecha', 'hecho', 'nada']);
    expect(order.map((m) => groupOf(m, 'flag', NOW).label)).toEqual(['Vencidos', 'Más adelante', 'Sin fecha', 'Completados', 'Sin bandera']);
    setCategory(none, 'Zeta', true);
    setCategory(late, 'Alfa', true);
    const byCategory = [...d.messages].sort(compareMessages({ sort: 'category', reverse: false }));
    expect(byCategory.slice(0, 2).map((m) => m.subject)).toEqual(['tarde', 'nada']);
    expect(groupOf(none, 'category', NOW)).toMatchObject({ label: 'Zeta', plain: true });
    expect(groupOf(done, 'category', NOW).label).toBe('Sin categoría');
  });
});

describe('búsqueda por campos', () => {
  const d = newMailData();
  const a = add(d, { subject: 'Plan anual', text: 'Presupuesto de marketing' }, 'inbox', at(2026, 6, 10, 9));
  const b = add(d, { subject: 'Factura 33', from: { name: 'Luis', email: 'luis@proveedor.es' }, cc: [{ name: 'Marta', email: 'marta@casa.net' }], attachments: [{ filename: 'factura-mayo.pdf', contentType: 'application/pdf', data: new Uint8Array(3000000) }] }, 'inbox', at(2026, 6, 9, 9));
  const c = add(d, { subject: 'Reunión', to: [{ name: 'Equipo', email: 'equipo@casa.net' }], text: `${'relleno '.repeat(700)}contraseña escondida al final`, importance: 'high' }, 'archive', at(2026, 4, 2));
  const t = add(d, { subject: 'Basura con presupuesto' }, 'trash', at(2025, 12, 1));
  a.read = true;
  setCategory(a, 'Categoría azul', true);
  setFollow(b, midnight(2026, 6, 1));
  const find = (q: string) => subjects(searchMessages(d, q, null, NOW));

  it('palabras, frases y exclusiones, sin mirar acentos ni mayúsculas', () => {
    expect(find('reunion')).toEqual(['Reunión']);
    expect(find('presupuesto')).toEqual(['Basura con presupuesto', 'Plan anual']);
    expect(find('presupuesto -basura')).toEqual(['Plan anual']);
    expect(find('"de marketing"')).toEqual(['Plan anual']);
    expect(find('"marketing de"')).toEqual([]);
    expect(find('https://nada')).toEqual([]);
  });

  it('busca en todo el texto, más allá de lo que guarda la lista', () => {
    expect(c.search).not.toContain('escondida');
    expect(find('escondida')).toEqual(['Reunión']);
    expect(find('cuerpo:"contraseña escondida"')).toEqual(['Reunión']);
    expect(subjects(searchMessages(d, 'escondida', 'inbox', NOW))).toEqual([]);
  });

  it('por quién, a quién, asunto y adjuntos', () => {
    expect(find('de:luis')).toEqual(['Factura 33']);
    expect(find('de:proveedor.es')).toEqual(['Factura 33']);
    expect(find('from:ana para:equipo')).toEqual(['Reunión']);
    expect(find('cc:marta')).toEqual(['Factura 33']);
    expect(find('asunto:plan')).toEqual(['Plan anual']);
    expect(find('asunto:marketing')).toEqual([]);
    expect(find('adjuntos:sí')).toEqual(['Factura 33']);
    expect(find('adjunto:factura-mayo')).toEqual(['Factura 33']);
    expect(find('adjunto:*')).toEqual(['Factura 33']);
    expect(find('-adjuntos:sí de:luis')).toEqual([]);
  });

  it('por estado, categoría, importancia, tamaño y carpeta', () => {
    expect(find('es:leído')).toContain('Plan anual');
    expect(find('es:no-leido de:ana')).not.toContain('Plan anual');
    expect(find('es:marcado')).toEqual(['Factura 33']);
    expect(find('es:vencido')).toEqual(['Factura 33']);
    expect(find('categoria:azul')).toEqual(['Plan anual']);
    expect(find('categoría:"categoría azul"')).toEqual(['Plan anual']);
    expect(find('categoria:*')).toEqual(['Plan anual']);
    expect(find('importancia:alta')).toEqual(['Reunión']);
    expect(find('tamaño:>1mb')).toEqual(['Factura 33']);
    expect(find('tamaño:grande')).toEqual(['Factura 33']);
    expect(find('carpeta:archivo')).toEqual(['Reunión']);
  });

  it('por fecha', () => {
    expect(find('fecha:hoy')).toEqual(['Plan anual']);
    expect(find('fecha:ayer')).toEqual(['Factura 33']);
    expect(find('fecha:semana')).toEqual(['Factura 33', 'Plan anual']);
    expect(find('fecha:04/2026')).toEqual(['Reunión']);
    expect(find('fecha:2025')).toEqual(['Basura con presupuesto']);
    expect(find('fecha:9/6/2026')).toEqual(['Factura 33']);
    expect(find('desde:09/06/2026')).toEqual(['Factura 33', 'Plan anual']);
    expect(find('hasta:2026-06-09')).toEqual(['Basura con presupuesto', 'Factura 33', 'Reunión']);
    expect(find('antes:9/6')).toEqual(['Basura con presupuesto', 'Reunión']);
    expect(find('fecha:>9/6/26')).toEqual(['Plan anual']);
    expect(find('fecha:01/04/2026..09/06/2026')).toEqual(['Factura 33', 'Reunión']);
    expect(dateSpan('semana pasada', NOW)).toEqual([midnight(2026, 6, 1), midnight(2026, 6, 8)]);
    expect(dateSpan('31/02/2026', NOW)).toBeNull();
    expect(dateSpan('13/2026', NOW)).toBeNull();
  });

  it('dice lo que no entiende y espera lo que se está escribiendo', () => {
    const bad = parseQuery('de:ana fecha:mañanita adjuntos:quizá', NOW);
    expect(bad.errors).toEqual(['fecha:mañanita', 'adjuntos:quizá']);
    expect(bad.matches(a, d)).toBe(false);
    expect(parseQuery('de:', NOW).empty).toBe(true);
    expect(parseQuery('de:ana asunto:', NOW).matches(a, d)).toBe(true);
    expect(parseQuery('  ', NOW).empty).toBe(true);
  });

  it('las carpetas de búsqueda dejan fuera lo eliminado, salvo que nombren la carpeta', () => {
    expect(searchFoldersOf(d).map((s) => s.name)).toEqual(['Correo no leído', 'Para seguimiento']);
    expect(subjects(searchFolderMessages(d, { id: 'q:x', name: 'x', query: 'presupuesto' }, NOW))).toEqual(['Plan anual']);
    expect(subjects(searchFolderMessages(d, { id: 'q:x', name: 'x', query: 'presupuesto carpeta:eliminados' }, NOW))).toEqual([t.subject]);
    expect(searchFolderMessages(d, { id: 'q:x', name: 'x', query: '' }, NOW)).toEqual([]);
  });
});

describe('remitentes bloqueados y seguros', () => {
  it('direcciones y dominios; el seguro gana', () => {
    expect(senderEntry(' Ana <Ana@Ejemplo.COM> ')).toBe('ana@ejemplo.com');
    expect(senderEntry('ejemplo.com')).toBe('@ejemplo.com');
    expect(senderEntry('*@ejemplo.com')).toBe('@ejemplo.com');
    expect(senderEntry('no es nada')).toBeNull();
    expect(senderEntry('a@b')).toBeNull();
    const d = newMailData();
    listSender(d, 'blocked', 'ejemplo.com');
    expect(isBlockedSender(d, 'x@ejemplo.com')).toBe(true);
    expect(isBlockedSender(d, 'x@boletines.ejemplo.com')).toBe(true);
    expect(isBlockedSender(d, 'x@otroejemplo.com')).toBe(false);
    listSender(d, 'safe', 'ana@ejemplo.com');
    expect(isBlockedSender(d, 'ana@ejemplo.com')).toBe(false);
    expect(isSafeSender(d, 'Ana@ejemplo.com')).toBe(true);
    // the same entry cannot be in both lists
    listSender(d, 'blocked', 'ana@ejemplo.com');
    expect(d.junk).toEqual({ blocked: ['@ejemplo.com', 'ana@ejemplo.com'], safe: [] });
    expect(() => listSender(d, 'safe', 'x')).toThrow('Escribe');
    unlistSender(d, 'blocked', '@ejemplo.com');
    unlistSender(d, 'blocked', 'ana@ejemplo.com');
    expect(d.junk).toBeUndefined();
  });
});

describe('reglas y pasos rápidos', () => {
  const d = newMailData();
  const own = new Set(['yo@casa.net']);
  const invoice = add(d, { subject: 'Factura de junio', attachments: [{ filename: 'f.pdf', contentType: 'application/pdf', data: new Uint8Array(5000) }] });
  const group = add(d, { subject: 'Comida', to: [{ name: '', email: 'yo@casa.net' }, { name: '', email: 'otra@casa.net' }], cc: [{ name: '', email: 'jefa@casa.net' }], text: 'El viernes' });
  const holds = (c: Condition, m: MailRecord) => ruleMatches({ id: 'r', name: 'r', enabled: true, conditions: [c], exceptions: [], actions: [], stop: false }, m, { own });

  it('condiciones', () => {
    expect(holds({ kind: 'from', words: ['nadie', 'ANA'] }, invoice)).toBe(true);
    expect(holds({ kind: 'subject', words: ['factura'] }, invoice)).toBe(true);
    expect(holds({ kind: 'subject', words: ['factura'] }, group)).toBe(false);
    expect(holds({ kind: 'body', words: ['viernes'] }, group)).toBe(true);
    expect(holds({ kind: 'subjectOrBody', words: ['viernes'] }, group)).toBe(true);
    expect(holds({ kind: 'cc', words: ['jefa'] }, group)).toBe(true);
    expect(holds({ kind: 'recipient', words: ['jefa'] }, group)).toBe(true);
    expect(holds({ kind: 'to', words: ['jefa'] }, group)).toBe(false);
    expect(holds({ kind: 'attachment', words: ['.pdf'] }, invoice)).toBe(true);
    expect(holds({ kind: 'hasAttachments' }, group)).toBe(false);
    expect(holds({ kind: 'toMe' }, group)).toBe(true);
    expect(holds({ kind: 'onlyMe' }, group)).toBe(false);
    expect(holds({ kind: 'onlyMe' }, invoice)).toBe(true);
    expect(holds({ kind: 'ccMe' }, group)).toBe(false);
    expect(holds({ kind: 'larger', kb: 4 }, invoice)).toBe(true);
    expect(holds({ kind: 'larger', kb: 4 }, group)).toBe(false);
    expect(holds({ kind: 'account', account: 'a' }, invoice)).toBe(false);
  });

  const rule = (p: Partial<Rule>): Rule => ({ id: 'r', name: 'r', enabled: true, conditions: [{ kind: 'toMe' }], exceptions: [], actions: [{ kind: 'read' }], stop: false, ...p });

  it('todas las condiciones, ninguna excepción, en orden y hasta donde se pare', () => {
    expect(ruleMatches(rule({ conditions: [] }), invoice, { own })).toBe(false);
    expect(ruleMatches(rule({ conditions: [{ kind: 'toMe' }, { kind: 'hasAttachments' }] }), group, { own })).toBe(false);
    expect(ruleMatches(rule({ exceptions: [{ kind: 'subject', words: ['comida'] }, { kind: 'hasAttachments' }] }), group, { own })).toBe(false);
    const rules = [
      rule({ id: '1', actions: [{ kind: 'category', name: 'A' }] }),
      rule({ id: '2', enabled: false, actions: [{ kind: 'delete' }] }),
      rule({ id: '3', actions: [{ kind: 'read' }], stop: true }),
      rule({ id: '4', actions: [{ kind: 'delete' }] }),
    ];
    const plan = planRules(rules, invoice, { own });
    expect(plan.rules.map((r) => r.id)).toEqual(['1', '3']);
    expect(plan.actions.map((a) => a.kind)).toEqual(['category', 'read']);
    const gone = planRules([rule({ actions: [{ kind: 'deletePermanent' }, { kind: 'read' }] }), rule({ id: 'x' })], invoice, { own });
    expect(gone.actions).toEqual([{ kind: 'deletePermanent' }]);
  });

  it('se guardan; una regla que no se lee entera queda desactivada', () => {
    const data = newMailData();
    data.rules = [
      rule({ id: 'ok' }),
      { ...rule({ id: 'mal' }), conditions: [{ kind: 'toMe' }, { kind: 'otra' } as unknown as Condition] },
      { ...rule({ id: 'accion' }), actions: [{ kind: 'forward', to: 'x@y.es' }] },
    ];
    data.quickSteps = [];
    data.searchFolders = [{ id: 'q:1', name: 'Mía', query: 'de:ana' }];
    data.categories = [{ name: 'Solo', color: 'inventado' }];
    data.junk = { blocked: ['MAL@x.com', 'nada'], safe: [] };
    const m = add(data, { subject: 's' });
    m.categories = ['Solo', 'solo', '' as string];
    m.follow = { due: NOW, remind: 'x' as unknown as number };
    data.tasks.push({ ...newTask('t'), categories: 5 as unknown as string[] });
    const back = parseMailData(serializeMail(data));
    expect(back.rules!.map((r) => [r.id, r.enabled, r.conditions.length, r.actions.length])).toEqual([['ok', true, 1, 1], ['mal', false, 1, 1], ['accion', false, 1, 0]]);
    expect(back.quickSteps).toEqual([]);
    expect(quickStepsOf(back)).toEqual([]);
    expect(quickStepsOf(newMailData()).map((q) => q.name)).toEqual(['Listo', 'Responder y eliminar']);
    expect(back.searchFolders).toEqual(data.searchFolders);
    expect(back.categories).toEqual([{ name: 'Solo', color: 'gray' }]);
    expect(back.junk).toEqual({ blocked: ['mal@x.com'], safe: [] });
    expect(back.messages[0]!.categories).toEqual(['Solo']);
    expect(back.messages[0]!.follow).toEqual({ due: NOW });
    expect(back.tasks[0]).not.toHaveProperty('categories');
  });

  it('renombrar una carpeta alcanza las reglas; una carpeta que falta se avisa', () => {
    const data = newMailData();
    data.folders.push({ id: 's:a:Vieja', name: 'Vieja', system: false, remote: { account: 'a', name: 'Vieja', path: 'Vieja' } });
    data.rules = [rule({ actions: [{ kind: 'move', folder: 's:a:Vieja' }] })];
    data.quickSteps = [{ id: 'q', name: 'q', actions: [{ kind: 'copy', folder: 's:a:Vieja' }] }];
    remapFolder(data, 'a', { id: 's:a:Vieja', name: 'Vieja' }, { id: 's:a:Nueva', name: 'Nueva' });
    expect(data.rules[0]!.actions[0]).toEqual({ kind: 'move', folder: 's:a:Nueva' });
    expect(data.quickSteps[0]!.actions[0]).toEqual({ kind: 'copy', folder: 's:a:Nueva' });
    expect(brokenActions(data, data.rules[0]!.actions)).toBe('');
    expect(brokenActions(data, [{ kind: 'move', folder: 'no' }])).toContain('carpeta');
  });
});
