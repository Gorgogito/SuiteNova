import { beforeEach, describe, expect, it } from 'vitest';
import { PlanCtl } from '../plan/ctl';
import {
  addLocation, applyOpenPolicy, certificates, codeModules, createCertificate, getSecurity, inTrustedLocation, levelAllows, libraryOf, removeSignature, resetLibraryCache, saveLibrary, setLevel, signModules,
  trustPublisher, verifyModules, SIGNATURE_MODULE, type MacroOwner,
} from './security';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  resetLibraryCache();
});

const mods = () => [{ name: 'Modulo1', code: 'Sub A()\nEnd Sub' }];
const owner = (): MacroOwner & { touched: number } => ({ contentEnabled: false, touched: 0, touch() { this.touched++; } });
const settled = () => new Promise((r) => setTimeout(r, 20));

describe('Centro de confianza', () => {
  it('guarda el nivel, y los lugares de confianza valen para lo que hay dentro de la carpeta', () => {
    expect(getSecurity().level).toBe('warn');
    setLevel('signed');
    expect(getSecurity().level).toBe('signed');
    addLocation('C:\\Docs\\Macros\\');
    expect(inTrustedLocation('c:/docs/macros/uno.novaplan')).toBe(true);
    expect(inTrustedLocation('C:\\Docs\\Macros\\sub\\dos.pptx')).toBe(true);
    expect(inTrustedLocation('C:\\Docs\\MacrosOtras\\tres.pptx')).toBe(false);
    expect(inTrustedLocation(null)).toBe(false);
  });

  it('un archivo con macros se abre deshabilitado, salvo en un lugar de confianza o con el nivel «todas»', () => {
    const a = owner();
    applyOpenPolicy(a, mods(), 'C:\\Otro\\a.novaplan');
    expect(a.contentEnabled).toBe(false);
    addLocation('C:\\Docs');
    const b = owner();
    applyOpenPolicy(b, mods(), 'C:\\Docs\\b.novaplan');
    expect(b.contentEnabled).toBe(true);
    setLevel('all');
    const c = owner();
    applyOpenPolicy(c, mods(), null);
    expect(c.contentEnabled).toBe(true);
    // without macros there is nothing to enable
    const d = owner();
    applyOpenPolicy(d, [], null);
    expect(d.contentEnabled).toBe(true);
  });
});

describe('firma de las macros', () => {
  it('firma, verifica, y cualquier cambio del código la invalida', async () => {
    const cert = await createCertificate('Ana Pérez');
    expect(certificates()).toHaveLength(1);
    const m = mods();
    expect((await verifyModules(m)).state).toBe('none');
    await signModules(m, cert);
    expect(m.some((x) => x.name === SIGNATURE_MODULE)).toBe(true);
    expect(codeModules(m)).toHaveLength(1);
    const ok = await verifyModules(m);
    expect(ok).toMatchObject({ state: 'valid', publisher: 'Ana Pérez', trusted: false });
    m[0]!.code += '\n\' cambio';
    expect((await verifyModules(m)).state).toBe('invalid');
    removeSignature(m);
    expect((await verifyModules(m)).state).toBe('none');
  });

  it('una firma copiada con otro nombre de publicador o con otra clave no vale', async () => {
    const a = await createCertificate('Ana');
    const b = await createCertificate('Beto');
    const m = mods();
    await signModules(m, a);
    const sig = JSON.parse(m[1]!.code);
    // the key of Beto with the signature of Ana
    m[1] = { name: SIGNATURE_MODULE, code: JSON.stringify({ ...sig, publicKey: b.publicKey, fingerprint: b.fingerprint }) };
    expect((await verifyModules(m)).state).toBe('invalid');
  });

  it('con un publicador de confianza, el archivo firmado se abre habilitado; con el nivel «firmadas» solo así corre', async () => {
    const cert = await createCertificate('Ana');
    const m = mods();
    await signModules(m, cert);
    setLevel('signed');
    // unknown publisher: stays disabled and the level refuses
    const a = owner();
    applyOpenPolicy(a, m, null);
    await settled();
    expect(a.contentEnabled).toBe(false);
    expect(a.touched).toBeGreaterThan(0);
    expect(levelAllows(m).ok).toBe(false);
    trustPublisher({ name: cert.name, fingerprint: cert.fingerprint });
    const b = owner();
    applyOpenPolicy(b, m, null);
    await settled();
    expect(b.contentEnabled).toBe(true);
    expect(levelAllows(m).ok).toBe(true);
    // unsigned macros are refused at that level
    expect(levelAllows(mods()).ok).toBe(false);
    // and «all macros off» refuses everything
    setLevel('off');
    expect(levelAllows(m).ok).toBe(false);
  });
});

describe('biblioteca global', () => {
  it('los módulos de la biblioteca están disponibles en cualquier archivo y se guardan', () => {
    libraryOf('plan').push({ name: 'Utiles', code: 'Function Doble(x)\n  Doble = x * 2\nEnd Function\n' });
    saveLibrary('plan');
    resetLibraryCache();
    expect(libraryOf('plan').map((x) => x.name)).toEqual(['Utiles']);
    const ctl = new PlanCtl();
    ctl.contentEnabled = true;
    ctl.macros = [{ name: 'Modulo1', code: 'Function Prueba()\n  Prueba = Doble(21)\nEnd Function\n' }];
    const r = ctl.macroRt.run('Prueba');
    expect(r.ok ? r.value : r.error).toBe(42);
    // another file of the same product sees it too, one of another product does not
    const otro = new PlanCtl();
    otro.contentEnabled = true;
    otro.macros = [{ name: 'M', code: 'Function P()\n  P = Doble(1)\nEnd Function\n' }];
    expect(otro.macroRt.run('P').ok).toBe(true);
  });

  it('un procedimiento del archivo con el nombre de uno de la biblioteca gana, y la biblioteca no estorba', () => {
    libraryOf('plan').push({ name: 'Utiles', code: 'Function Doble(x)\n  Doble = x * 2\nEnd Function\n' });
    const ctl = new PlanCtl();
    ctl.contentEnabled = true;
    ctl.macros = [{ name: 'Modulo1', code: 'Function Doble(x)\n  Doble = x * 3\nEnd Function\nFunction Prueba()\n  Prueba = Doble(10)\nEnd Function\n' }];
    const r = ctl.macroRt.run('Prueba');
    expect(r.ok ? r.value : r.error).toBe(30);
    expect(ctl.macroRt.console.join('\n')).toMatch(/Utiles \(biblioteca\)/);
  });

  it('las macros de la biblioteca aparecen entre los procedimientos con su módulo «global»', () => {
    libraryOf('plan').push({ name: 'Utiles', code: 'Sub Hola()\nEnd Sub\n' });
    const ctl = new PlanCtl();
    expect(ctl.macroRt.procedures().map((p) => [p.name, p.module])).toEqual([['Hola', 'Global_Utiles']]);
  });
});
