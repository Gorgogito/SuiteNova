import { describe, expect, it } from 'vitest';
import {
  applyFetched, applyPlan, childrenOf, completeOp, descendants, encodeBase64, enqueueOp, folderPath, folderTarget, newMailData, parseMailData, pendingKeys, planFolders, reconcileFolder, serializeMail,
  type FolderPlan, type FolderState, type RemoteFolder,
} from './index';

const f = (name: string, ...attrs: string[]): RemoteFolder => ({ name, path: name, delimiter: '/', attrs });
const raw = (n: number, subject = `Mensaje ${n}`, mid = `<${n}@x>`) =>
  encodeBase64(new TextEncoder().encode(`From: Ana <ana@x.es>\r\nTo: yo@x.es\r\nSubject: ${subject}\r\nMessage-ID: ${mid}\r\nDate: Mon, 3 Mar 2025 10:00:00 +0000\r\n\r\ncuerpo ${n}\r\n`));
const state = (keys: string[], over: Partial<FolderState> = {}, flags: Record<string, string[]> = {}): FolderState => ({ validity: '7', items: keys.map((k) => ({ key: k, flags: flags[k] ?? [], size: 100 })), mirror_deletions: true, ...over });
const fetched = (keys: string[], flags: Record<string, string[]> = {}) => ({ messages: keys.map((k) => ({ key: k, flags: flags[k] ?? [], raw: raw(Number(k.replace(/\D/g, '')) || 1, `Mensaje ${k}`, `<${k}@x>`) })), skipped: [] });
const INBOX: FolderPlan = { local: 'inbox', remote: 'INBOX', path: 'INBOX', special: true };
const opts = { limit: 500, maxBytes: 1_000_000 };

describe('qué carpetas del servidor se sincronizan', () => {
  it('se reconocen por atributo de uso especial y por nombre, y las demás también se bajan', () => {
    const p = planFolders('a1', [f('INBOX'), f('Elementos enviados'), f('Borradores'), f('Proyectos'), f('Trabajo/Papelera'), f('Raíz', '\\Noselect'), f('Spam', '\\Junk')]);
    const by = Object.fromEntries(p.folders.map((x) => [x.remote, x.local]));
    expect(by).toEqual({ INBOX: 'inbox', 'Elementos enviados': 'sent', Borradores: 'drafts', Proyectos: 's:a1:Proyectos', 'Trabajo/Papelera': 's:a1:Trabajo/Papelera', Spam: 'junk' });
    expect(p.containers).toEqual(['Raíz']);
    expect(p.targets).toEqual({ inbox: 'INBOX', sent: 'Elementos enviados', drafts: 'Borradores', junk: 'Spam' });
    expect(p.paths.junk).toBe('Spam');
  });
  it('si dos corresponden a la misma del sistema gana la que el servidor marca; la otra es una carpeta normal', () => {
    const p = planFolders('a1', [f('Sent'), f('INBOX'), f('Enviados', '\\Sent'), f('Trash', '\\Trash')]);
    expect(p.folders.find((x) => x.remote === 'Enviados')!.local).toBe('sent');
    expect(p.folders.find((x) => x.remote === 'Sent')!.local).toBe('s:a1:Sent');
    expect(p.targets.sent).toBe('Enviados');
  });
  it('el espacio «INBOX/» de algunos servidores no confunde los nombres', () => {
    const p = planFolders('a1', [f('INBOX'), f('INBOX/Sent'), f('INBOX/Proyecto')]);
    expect(p.folders.find((x) => x.remote === 'INBOX/Sent')!.local).toBe('sent');
    expect(p.folders.find((x) => x.remote === 'INBOX/Proyecto')!.local).toBe('s:a1:INBOX/Proyecto');
  });
  it('Gmail: las vistas que repiten correo no se bajan, pero «Todos» es adonde se archiva', () => {
    const p = planFolders('g', [f('INBOX'), f('[Gmail]', '\\Noselect'), f('[Gmail]/Sent Mail', '\\Sent'), f('[Gmail]/All Mail', '\\All'), f('[Gmail]/Starred', '\\Flagged'), f('[Gmail]/Important', '\\Important'), f('[Gmail]/Trash', '\\Trash'), f('Etiqueta')]);
    expect(p.folders.map((x) => x.remote).sort()).toEqual(['Etiqueta', 'INBOX', '[Gmail]/Sent Mail', '[Gmail]/Trash']);
    expect(p.targets.archive).toBe('[Gmail]/All Mail');
    expect(p.targets.trash).toBe('[Gmail]/Trash');
  });
  it('JMAP y Exchange: la bandeja de entrada se reconoce por su atributo', () => {
    const p = planFolders('j', [{ name: 'mb1', path: 'Entrada', attrs: ['\\Inbox'] }, { name: 'mb2', path: 'Trabajo/Proyecto A', attrs: [] }]);
    expect(p.folders[0]).toEqual({ local: 'inbox', remote: 'mb1', path: 'Entrada', special: true });
    expect(p.folders[1]!.local).toBe('s:j:mb2');
  });
});

describe('las carpetas de Nova Mail siguen al servidor, con subcarpetas', () => {
  const server = [f('INBOX'), f('Sent', '\\Sent'), f('Trabajo', '\\Noselect'), f('Trabajo/Proyecto A'), f('Trabajo/Proyecto A/Fase 1'), f('Personal'), f('INBOX/Facturas')];
  it('crea la jerarquía: contenedores, subcarpetas y las que cuelgan de la bandeja de entrada', () => {
    const d = newMailData();
    const r = applyPlan(d, 'a1', planFolders('a1', server));
    expect(r.added).toBe(5);
    const byPath = (p: string) => d.folders.find((x) => x.remote?.path === p)!;
    expect(d.folders.find((x) => x.id === 'c:a1:Trabajo')!.name).toBe('Trabajo');
    expect(d.folders.find((x) => x.id === 'c:a1:Trabajo')!.parent).toBeUndefined();
    expect(byPath('Trabajo/Proyecto A').parent).toBe('c:a1:Trabajo');
    expect(byPath('Trabajo/Proyecto A/Fase 1').parent).toBe(byPath('Trabajo/Proyecto A').id);
    expect(byPath('Trabajo/Proyecto A/Fase 1').name).toBe('Fase 1');
    expect(byPath('INBOX/Facturas').parent).toBe('inbox');
    expect(byPath('Personal').parent).toBeUndefined();
    expect(folderPath(d, byPath('Trabajo/Proyecto A/Fase 1').id)).toBe('Trabajo/Proyecto A/Fase 1');
    expect(childrenOf(d, 'inbox').map((x) => x.name)).toEqual(['Facturas']);
    expect(descendants(d, 'c:a1:Trabajo')).toHaveLength(3);
    expect(d.servers!.a1!.targets).toEqual({ inbox: 'INBOX', sent: 'Sent' });
    expect(d.servers!.a1!.paths).toEqual({ inbox: 'INBOX', sent: 'Sent' });
    // otra vez igual: nada cambia
    expect(applyPlan(d, 'a1', planFolders('a1', server))).toEqual({ added: 0, removed: 0 });
  });
  it('quita las carpetas que ya no existen y sus mensajes del servidor; lo local pasa a Archivo; no toca otras cuentas', () => {
    const d = newMailData();
    applyPlan(d, 'a1', planFolders('a1', server));
    applyPlan(d, 'a2', planFolders('a2', [f('INBOX'), f('Personal')]));
    const pid = 's:a1:Personal';
    const a = applyFetched(d, 'a1', { local: pid, remote: 'Personal', path: 'Personal', special: false }, fetched(['1', '2']));
    expect(a).toBe(2);
    d.messages.push({ ...d.messages[0]!, id: 'local', folder: pid, remote: undefined });
    const r = applyPlan(d, 'a1', planFolders('a1', [f('INBOX'), f('Sent', '\\Sent')]));
    expect(r.removed).toBe(5);
    expect(d.folders.some((x) => x.id.startsWith('s:a1:') || x.id.startsWith('c:a1:'))).toBe(false);
    expect(d.folders.some((x) => x.id === 's:a2:Personal')).toBe(true);
    expect(d.messages.filter((m) => m.remote)).toHaveLength(0);
    expect(d.messages.find((m) => m.id === 'local')!.folder).toBe('archive');
  });
  it('folderTarget da el nombre del servidor para una carpeta del sistema o una propia de esa cuenta', () => {
    const d = newMailData();
    applyPlan(d, 'a1', planFolders('a1', server));
    applyPlan(d, 'a2', planFolders('a2', [f('INBOX'), f('Otra')]));
    expect(folderTarget(d, 'a1', 'sent')).toBe('Sent');
    expect(folderTarget(d, 'a1', 's:a1:Personal')).toBe('Personal');
    expect(folderTarget(d, 'a1', 's:a2:Otra')).toBeUndefined();
    expect(folderTarget(d, 'a1', 'archive')).toBeUndefined();
    expect(folderTarget(d, 'a1', 'carpeta-local')).toBeUndefined();
  });
});

describe('poner al día una carpeta con lo que dice el servidor', () => {
  it('lo nuevo se baja con sus marcas; lo ya descargado no se repite', () => {
    const d = newMailData();
    const r = reconcileFolder(d, 'a1', INBOX, state(['3', '2', '1'], {}, { '1': ['\\Seen'], '3': ['\\Flagged', '\\Answered'] }), opts);
    expect(r.missing).toEqual(['3', '2', '1']);
    expect(applyFetched(d, 'a1', INBOX, fetched(['1', '2', '3'], { '1': ['\\Seen'], '3': ['\\Flagged', '\\Answered'] }))).toBe(3);
    expect(d.messages.map((m) => [m.remote!.key, m.read, m.flagged, m.answered]).sort()).toEqual([['1', true, false, false], ['2', false, false, false], ['3', false, true, true]]);
    expect(d.messages.every((m) => m.folder === 'inbox' && m.remote!.account === 'a1' && m.remote!.folder === 'INBOX')).toBe(true);
    const again = reconcileFolder(d, 'a1', INBOX, state(['4', '3', '2', '1'], {}, { '1': ['\\Seen'], '3': ['\\Flagged', '\\Answered'] }), opts);
    expect(again.missing).toEqual(['4']);
    expect(again.removed + again.updated).toBe(0);
  });
  it('lo que se borró o se movió en el servidor desaparece de aquí; lo local sin origen se queda', () => {
    const d = newMailData();
    reconcileFolder(d, 'a1', INBOX, state(['1', '2', '3']), opts);
    applyFetched(d, 'a1', INBOX, fetched(['1', '2', '3']));
    d.messages.push({ ...d.messages[0]!, id: 'importado', remote: undefined });
    const r = reconcileFolder(d, 'a1', INBOX, state(['3']), opts);
    expect(r.removed).toBe(2);
    expect(d.messages.map((m) => m.remote?.key ?? m.id).sort()).toEqual(['3', 'importado']);
  });
  it('las marcas cambiadas en el servidor se reflejan, salvo en los mensajes con un cambio pendiente', () => {
    const d = newMailData();
    reconcileFolder(d, 'a1', INBOX, state(['1', '2']), opts);
    applyFetched(d, 'a1', INBOX, fetched(['1', '2']));
    enqueueOp(d, { account: 'a1', kind: 'flag', folder: 'INBOX', keys: ['2'], flag: '\\Seen', on: true });
    d.messages.find((m) => m.remote!.key === '2')!.read = true;
    const r = reconcileFolder(d, 'a1', INBOX, state(['2', '1'], {}, { '1': ['\\Seen', '\\Flagged'] }), opts);
    expect(r.updated).toBe(1);
    const m1 = d.messages.find((m) => m.remote!.key === '1')!;
    expect([m1.read, m1.flagged]).toEqual([true, true]);
    expect(d.messages.find((m) => m.remote!.key === '2')!.read).toBe(true);
  });
  it('un mensaje con un cambio de carpeta pendiente no se vuelve a bajar ni se quita', () => {
    const d = newMailData();
    reconcileFolder(d, 'a1', INBOX, state(['1', '2']), opts);
    applyFetched(d, 'a1', INBOX, fetched(['1', '2']));
    enqueueOp(d, { account: 'a1', kind: 'remove', folder: 'INBOX', keys: ['2'] });
    d.messages = d.messages.filter((m) => m.remote!.key !== '2'); // borrado aquí
    const r = reconcileFolder(d, 'a1', INBOX, state(['2', '1']), opts);
    expect(r.missing).toEqual([]);
    expect(pendingKeys(d, 'a1', 'INBOX').moved.has('2')).toBe(true);
    completeOp(d, d.pending![0]!.id);
    expect(d.pending).toBeUndefined();
  });
  it('POP3 (sin reflejar borrados): lo que ya no está en el servidor se conserva y las marcas no se tocan', () => {
    const d = newMailData();
    const pop: FolderPlan = { local: 'inbox', remote: 'INBOX', path: 'INBOX', special: true };
    reconcileFolder(d, 'p', pop, state(['u1', 'u2'], { mirror_deletions: false, validity: 'pop3' }), opts);
    applyFetched(d, 'p', pop, fetched(['u1', 'u2']));
    d.messages[0]!.read = true;
    const r = reconcileFolder(d, 'p', pop, state(['u2'], { mirror_deletions: false, validity: 'pop3' }), opts);
    expect(r.removed).toBe(0);
    expect(d.messages).toHaveLength(2);
    expect(d.messages[0]!.read).toBe(true);
  });
  it('se conservan solo los N más nuevos del servidor y los demasiado grandes no se bajan', () => {
    const d = newMailData();
    const st = state(['9', '8', '7', '6', '5']);
    st.items[1]!.size = 90_000_000;
    const r = reconcileFolder(d, 'a1', INBOX, st, { limit: 3, maxBytes: 25_000_000 });
    expect(r.missing).toEqual(['9', '7']);
    expect(r.tooBig).toBe(1);
  });
  it('si el servidor renumera la carpeta se empieza de cero sin tocar lo local', () => {
    const d = newMailData();
    reconcileFolder(d, 'a1', INBOX, state(['1', '2']), opts);
    applyFetched(d, 'a1', INBOX, fetched(['1', '2']));
    d.messages.push({ ...d.messages[0]!, id: 'local-1', remote: undefined });
    const r = reconcileFolder(d, 'a1', INBOX, state(['1', '2', '3'], { validity: '8' }), opts);
    expect(r.reset).toBe(true);
    expect(r.missing).toEqual(['1', '2', '3']);
    expect(d.messages.filter((m) => m.remote)).toHaveLength(0);
    expect(d.messages.some((m) => m.id === 'local-1')).toBe(true);
  });
  it('cuentas y carpetas distintas no se mezclan', () => {
    const d = newMailData();
    reconcileFolder(d, 'a1', INBOX, state(['1']), opts);
    applyFetched(d, 'a1', INBOX, fetched(['1']));
    reconcileFolder(d, 'a2', INBOX, state([]), opts);
    expect(d.messages).toHaveLength(1);
    expect(Object.keys(d.sync!).sort()).toEqual(['a1|INBOX', 'a2|INBOX']);
  });
  it('un mensaje ilegible no detiene la sincronización', () => {
    const d = newMailData();
    const n = applyFetched(d, 'a1', INBOX, { skipped: [], messages: [{ key: '1', flags: [], raw: raw(1) }, { key: '2', flags: [], raw: '***no es base64***' }, { key: '3', flags: [], raw: raw(3) }] });
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('la copia local se reconoce cuando el servidor devuelve la suya', () => {
  it('lo enviado o movido aquí no queda repetido: se adopta la local', () => {
    const d = newMailData();
    const sent: FolderPlan = { local: 'sent', remote: 'Sent', path: 'Sent', special: true };
    const mine = encodeBase64(new TextEncoder().encode('From: yo@x.es\r\nTo: ana@x.es\r\nSubject: Enviado\r\nMessage-ID: <abc@nova>\r\nDate: Mon, 3 Mar 2025 10:00:00 +0000\r\n\r\nhola\r\n'));
    const tmp = newMailData();
    applyFetched(tmp, 'tmp', sent, { skipped: [], messages: [{ key: '0', flags: ['\\Seen'], raw: mine }] });
    d.messages.push({ ...tmp.messages[0]!, id: 'mia', remote: undefined, mid: undefined });
    const n = applyFetched(d, 'a1', sent, { skipped: [], messages: [{ key: '9', flags: ['\\Seen'], raw: mine }, ...fetched(['10']).messages] });
    expect(n).toBe(1);
    expect(d.messages.filter((m) => m.subject === 'Enviado')).toHaveLength(1);
    expect(d.messages.find((m) => m.id === 'mia')!.remote).toEqual({ account: 'a1', folder: 'Sent', key: '9' });
  });
  it('solo se adopta en la misma carpeta de Nova Mail', () => {
    const d = newMailData();
    const mine = fetched(['1']).messages[0]!;
    const tmp = newMailData();
    applyFetched(tmp, 'tmp', INBOX, { skipped: [], messages: [mine] });
    d.messages.push({ ...tmp.messages[0]!, id: 'en-archivo', folder: 'archive', remote: undefined, mid: undefined });
    expect(applyFetched(d, 'a1', INBOX, { skipped: [], messages: [mine] })).toBe(1);
    expect(d.messages).toHaveLength(2);
  });
});

describe('cola de cambios pendientes', () => {
  it('una marca nueva sustituye a la anterior del mismo mensaje y los cambios iguales y seguidos se juntan', () => {
    const d = newMailData();
    enqueueOp(d, { account: 'a', kind: 'flag', folder: 'INBOX', keys: ['1'], flag: '\\Seen', on: true });
    enqueueOp(d, { account: 'a', kind: 'flag', folder: 'INBOX', keys: ['2'], flag: '\\Seen', on: true });
    expect(d.pending).toHaveLength(1);
    expect(d.pending![0]).toMatchObject({ keys: ['1', '2'] });
    enqueueOp(d, { account: 'a', kind: 'flag', folder: 'INBOX', keys: ['1'], flag: '\\Seen', on: false });
    expect(d.pending!.map((o) => (o as { keys: string[]; on: boolean }).keys.join() + (o as { on: boolean }).on)).toEqual(['2true', '1false']);
    enqueueOp(d, { account: 'a', kind: 'move', folder: 'INBOX', keys: ['2'], to: 'Trash' });
    expect(d.pending!.map((o) => o.kind)).toEqual(['flag', 'flag', 'move']);
    enqueueOp(d, { account: 'a', kind: 'move', folder: 'INBOX', keys: ['5'], to: 'Trash' });
    expect(d.pending![2]).toMatchObject({ keys: ['2', '5'] });
    enqueueOp(d, { account: 'a', kind: 'move', folder: 'INBOX', keys: ['6'], to: 'Archive' });
    expect(d.pending).toHaveLength(4);
    enqueueOp(d, { account: 'a', kind: 'remove', folder: 'INBOX', keys: ['1'] });
    expect(d.pending!.map((o) => o.kind)).toEqual(['flag', 'move', 'move', 'remove']);
  });
  it('leer un mensaje y moverlo antes de enviar el cambio: la marca sale antes del movimiento', () => {
    const d = newMailData();
    enqueueOp(d, { account: 'a', kind: 'flag', folder: 'INBOX', keys: ['7'], flag: '\\Seen', on: true });
    enqueueOp(d, { account: 'a', kind: 'move', folder: 'INBOX', keys: ['7'], to: 'Archive' });
    expect(d.pending!.map((o) => [o.kind, (o as { keys: string[] }).keys.join()])).toEqual([['flag', '7'], ['move', '7']]);
  });
  it('se guarda en el archivo y lo dañado se descarta; los mensajes antiguos con UID se convierten', () => {
    const d = newMailData();
    reconcileFolder(d, 'a1', INBOX, state(['1']), opts);
    applyFetched(d, 'a1', INBOX, fetched(['1']));
    enqueueOp(d, { account: 'a1', kind: 'append', folder: 'Sent', raw: 'eA==', seen: true });
    enqueueOp(d, { account: 'a1', kind: 'createFolder', path: 'Nueva/Sub' });
    applyPlan(d, 'a1', planFolders('a1', [f('INBOX'), f('Sent', '\\Sent'), f('Trabajo/Proyecto A')]));
    const back = parseMailData(serializeMail(d));
    expect(back.pending).toEqual(d.pending);
    expect(back.sync).toEqual(d.sync);
    expect(back.servers).toEqual(d.servers);
    expect(back.messages[0]!.remote).toEqual({ account: 'a1', folder: 'INBOX', key: '1' });
    expect(back.folders.find((x) => x.remote?.path === 'Trabajo/Proyecto A')).toEqual(d.folders.find((x) => x.remote?.path === 'Trabajo/Proyecto A'));
    const old = JSON.parse(serializeMail(d));
    old.messages[0].remote = { account: 'a1', folder: 'INBOX', uid: 42 };
    old.sync = { 'a|b': { validity: 7, lastUid: 3 } };
    old.pending = [{ kind: 'flag', id: 'x' }, { kind: 'raro', id: 'y', account: 'a' }, ...old.pending];
    old.servers = { a1: { targets: { sent: 'Sent', basura: 'x', trash: 5 } }, a2: 5 };
    old.folders.push({ id: 'huerfana', name: 'X', system: false, parent: 'no-existe' }, { id: 'ciclo1', name: 'C1', system: false, parent: 'ciclo2' }, { id: 'ciclo2', name: 'C2', system: false, parent: 'ciclo1' });
    const r = parseMailData(JSON.stringify(old));
    expect(r.messages[0]!.remote).toEqual({ account: 'a1', folder: 'INBOX', key: '42' });
    expect(r.sync).toEqual({ 'a|b': { validity: '7' } });
    expect(r.pending!.map((o) => o.kind)).toEqual(['append', 'createFolder']);
    expect(r.servers).toEqual({ a1: { targets: { sent: 'Sent' } }, a2: { targets: {} } });
    expect(back.servers!.a1!.paths).toEqual(d.servers!.a1!.paths);
    expect(r.folders.find((x) => x.id === 'huerfana')!.parent).toBeUndefined();
    expect(r.folders.filter((x) => x.id.startsWith('ciclo')).some((x) => x.parent === undefined)).toBe(true);
  });
});
