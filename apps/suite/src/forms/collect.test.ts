import { newForm, newQuestion, type Form } from '@suitenova/forms-core';
import { afterEach, describe, expect, it } from 'vitest';
import { formResponses } from '../mail/FormResponses';
import { Collector, servedContent, setCollectBridge, type CollectBridge, type Served, type Verdict } from './collect';
import { FormsCtl } from './ctl';
import { inboxItem } from './inbox';

const form = (): Form => ({ ...newForm('Encuesta'), id: 'f', questions: [{ ...newQuestion('text'), id: 't', title: 'Color', required: true }] });
const body = (id: string, answers: object = { t: 'verde' }, formId = 'f') => JSON.stringify({ format: 'novaforms-response', formId, id, at: '2026-01-01T00:00:00Z', answers });

function setup(persist: () => Promise<boolean> = async () => true) {
  const log: string[] = [];
  let served: Served | null = null;
  let arrive: ((b: string) => Promise<Verdict>) | null = null;
  const bridge: CollectBridge = {
    addresses: async () => [],
    async start(address, content, arrived) {
      if (address === 'mala') throw new Error('No se pudo abrir un puerto.');
      served = content;
      arrive = arrived;
      log.push(`start ${address}`);
      return { url: `http://${address}/x` };
    },
    update: async (content) => {
      served = content;
      log.push('update');
    },
    stop: async () => void log.push('stop'),
  };
  setCollectBridge(bridge);
  const ctl = new FormsCtl();
  ctl.load({ form: form(), responses: [] }, 'e.novaforms', null);
  const counts: number[] = [];
  const collector = new Collector(ctl, persist, (n) => counts.push(n));
  return { ctl, collector, log, counts, served: () => served!, arrive: (b: string) => arrive!(b) };
}

afterEach(() => setCollectBridge(null));

describe('recoger por la red local', () => {
  it('sirve la página que envía, toma las respuestas y no se deshacen', async () => {
    const s = setup();
    await s.collector.start('10.0.0.2');
    expect([s.collector.running, s.collector.url]).toEqual([true, 'http://10.0.0.2/x']);
    expect(s.served()).toMatchObject({ key: 'f', once: false });
    expect(s.served().page).toContain('var SEND=true;');
    expect(s.served().answered).toContain('Ya has enviado tu respuesta.');
    s.ctl.setForm({ title: 'Otro título' });
    s.ctl.setDraft({ t: 'a medias' });
    expect(await s.arrive(body('r1'))).toMatchObject({ ok: true });
    expect(await s.arrive(body('r2'))).toMatchObject({ ok: true });
    expect([s.collector.received, s.counts, s.ctl.responses.length, s.ctl.dirty]).toEqual([2, [1, 2], 2, true]);
    expect(s.ctl.draft).toEqual({ t: 'a medias' });
    s.ctl.undo();
    expect([s.ctl.form.title, s.ctl.responses.length]).toEqual(['Encuesta', 2]);
    // again the same one: said to be taken, not added nor counted twice
    expect(await s.arrive(body('r1', { t: 'cambiada' }))).toMatchObject({ ok: true });
    expect([s.ctl.responses.length, s.collector.received, s.ctl.responses[0]!.answers.t]).toEqual([2, 2, 'verde']);
  });

  it('cuenta las rechazadas y dice por qué', async () => {
    const s = setup();
    await s.collector.start('10.0.0.2');
    expect(await s.arrive(body('r1', {}))).toEqual({ ok: false, message: 'La respuesta está vacía.' });
    s.ctl.setForm({ closed: true });
    expect(await s.arrive(body('r2'))).toEqual({ ok: false, message: 'Este formulario ya no admite respuestas.' });
    expect([s.collector.refused, s.collector.lastRefusal, s.ctl.responses.length]).toEqual([2, 'Este formulario ya no admite respuestas.', 0]);
  });

  it('solo da por recibida la que queda escrita; al reintentar no se repite', async () => {
    let works = false;
    let writes = 0;
    const s = setup(async () => (writes++, works));
    await s.collector.start('10.0.0.2');
    expect(await s.arrive(body('r1'))).toMatchObject({ ok: false, message: expect.stringMatching(/No se pudo guardar/) });
    expect([s.ctl.responses.length, s.collector.received, s.collector.error !== '']).toEqual([1, 0, true]);
    works = true;
    expect(await s.arrive(body('r1'))).toMatchObject({ ok: true });
    expect([s.ctl.responses.length, s.collector.received, s.collector.error, writes]).toEqual([1, 1, '', 2]);
  });

  it('de una en una, aunque lleguen a la vez', async () => {
    let busy = 0;
    let most = 0;
    const s = setup(async () => {
      most = Math.max(most, ++busy);
      await new Promise((r) => setTimeout(r, 5));
      busy--;
      return true;
    });
    await s.collector.start('10.0.0.2');
    await Promise.all(['a', 'b', 'c', 'a'].map((id) => s.arrive(body(id))));
    expect([most, s.ctl.responses.length, s.collector.received]).toEqual([1, 3, 3]);
  });

  it('la página sigue al formulario; otro formulario o parar acaban', async () => {
    const s = setup();
    await s.collector.start('10.0.0.2');
    s.ctl.setForm({ noAgain: true, title: 'Nuevo título' });
    await s.collector.refresh('otro');
    expect(s.served().once).toBe(true);
    expect(s.served().page).toContain('<title>Nuevo título</title>');
    s.ctl.reset();
    expect(await s.arrive(body('r1'))).toMatchObject({ ok: false, message: expect.stringMatching(/otro formulario/) });
    await s.collector.refresh('Se abrió otro.');
    expect([s.collector.running, s.collector.stopped, s.log.at(-1)]).toEqual([false, 'Se abrió otro.', 'stop']);
    expect(await s.arrive(body('r2'))).toMatchObject({ ok: false });
    expect(s.ctl.responses).toEqual([]);
  });

  it('si no puede escuchar lo dice', async () => {
    const s = setup();
    await s.collector.start('mala');
    expect([s.collector.running, s.collector.starting, s.collector.error]).toEqual([false, false, 'No se pudo abrir un puerto.']);
    await s.collector.start('10.0.0.3');
    expect([s.collector.running, s.collector.error]).toEqual([true, '']);
  });

  it('lo que se sirve admite más peso solo si se suben archivos', () => {
    const plain = servedContent(form());
    const files = servedContent({ ...form(), questions: [{ ...newQuestion('file'), id: 'a' }] });
    expect(plain.maxBody).toBe(1024 * 1024);
    expect(files.maxBody).toBeGreaterThan(30 * 1024 * 1024);
  });
});

describe('respuestas que llegan por correo', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('solo los adjuntos .json que son respuestas', () => {
    const items = formResponses(
      [
        { filename: 'respuesta-r1.json', contentType: 'application/json', inline: false, data: bytes(body('r1')) },
        { filename: 'otra.JSON', contentType: 'text/plain', inline: false, data: bytes(body('r2', {}, 'g')) },
        { filename: 'datos.json', contentType: 'application/json', inline: false, data: bytes('{"a":1}') },
        { filename: 'respuesta.txt', contentType: 'text/plain', inline: false, data: bytes(body('r3')) },
      ],
      'ana@ejemplo.es',
    );
    expect(items.map((i) => [i.key, i.formId, i.from])).toEqual([
      ['f|r1', 'f', 'ana@ejemplo.es'],
      ['g|r2', 'g', 'ana@ejemplo.es'],
    ]);
    expect(inboxItem('no es', 'x')).toBeNull();
  });

  it('se añaden juntas, como un solo cambio, y las repetidas se omiten', () => {
    const ctl = new FormsCtl();
    ctl.load({ form: form(), responses: [] }, null, null);
    const r = ctl.importMany([body('r1'), body('r2'), body('r1'), body('r3', {}, 'g'), 'basura']);
    expect(r.added).toBe(2);
    expect(r.warnings.join(' ')).toMatch(/ya estaban[\s\S]*otro formulario[\s\S]*JSON/);
    ctl.undo();
    expect(ctl.responses).toEqual([]);
  });
});
