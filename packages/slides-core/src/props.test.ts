import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';

describe('document properties', () => {
  it('title, author, subject, keywords, category and description survive a .pptx round trip, with special characters', async () => {
    const d = newDeck();
    d.props = { title: 'Plan & «prueba» <1>', author: 'Ana "A"', subject: 'Asunto', keywords: 'uno, dos', category: 'Informe', description: "Descripción con 'comillas' y & más" };
    const { data } = await writePptx(d);
    const back = (await readPptx(data)).deck;
    expect(back.props.title).toBe(d.props.title);
    expect(back.props.author).toBe(d.props.author);
    expect(back.props.subject).toBe('Asunto');
    expect(back.props.keywords).toBe('uno, dos');
    expect(back.props.category).toBe('Informe');
    expect(back.props.description).toBe(d.props.description);
  });
});
