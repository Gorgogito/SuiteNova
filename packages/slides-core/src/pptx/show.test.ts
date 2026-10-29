import { describe, expect, it } from 'vitest';
import { newDeck } from '../defaults';
import { addSlide } from '../ops';
import { readPptx } from './read';
import { writePptx } from './write';

describe('show settings in the file', () => {
  it('keeps custom shows, the chosen show, kiosk mode and the animation/timing switches', async () => {
    let d = newDeck();
    for (let i = 0; i < 2; i++) d = addSlide(d, d.layouts[1]!.id, d.slides.length - 1).deck;
    const [a, , c] = d.slides.map((s) => s.id);
    d = { ...d, show: { mode: 'kiosk', loop: true, showAnimation: false, useTimings: false, customShows: [{ name: 'Corta & clara', slideIds: [c!, a!] }], range: { show: 'Corta & clara' } } };
    const { data } = await writePptx(d);
    const back = (await readPptx(data)).deck;
    expect(back.show.mode).toBe('kiosk');
    expect(back.show.loop).toBe(true);
    expect(back.show.showAnimation).toBe(false);
    expect(back.show.useTimings).toBe(false);
    expect(back.show.range).toEqual({ show: 'Corta & clara' });
    const cs = back.show.customShows!;
    expect(cs.length).toBe(1);
    expect(cs[0]!.name).toBe('Corta & clara');
    expect(cs[0]!.slideIds).toEqual([back.slides[2]!.id, back.slides[0]!.id]);
  });
});
