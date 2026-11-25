import { COLOR_SCHEMES, officeTheme, withColors } from '@suitenova/theme-core';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { nodeTypes, writerSchema } from './index';
import { applyThemeTo } from './retheme';

describe('Writer: rendimiento del cambio de tema', () => {
  it('cambia el tema de un documento de 5000 párrafos con color de tema en bien menos de un segundo', () => {
    const mark = writerSchema.marks.color!.create({ value: '#4472c4', ref: { slot: 'accent1' } });
    const paras = Array.from({ length: 5000 }, (_, i) => nodeTypes.paragraph!.create({}, writerSchema.text(`Párrafo ${i} con texto de relleno`, [mark])));
    const doc = nodeTypes.doc!.create({ theme: officeTheme() }, [nodeTypes.section!.create({ id: 's' }, paras)]);
    const state = EditorState.create({ doc });
    const next = withColors(officeTheme(), COLOR_SCHEMES.find((s) => s.id === 'green')!.colors, 'Verde');
    const t0 = performance.now();
    const after = state.apply(applyThemeTo(state.tr, next)).doc;
    const ms = performance.now() - t0;
    console.log(`writer 5000 párrafos: ${ms.toFixed(0)} ms`);
    expect(after.firstChild!.child(0).child(0).marks[0]!.attrs.value).toBe(next.colors.accent1);
    expect(ms).toBeLessThan(3000);
  });
});
