import { describe, expect, it } from 'vitest';
import { bootColor } from './desktop';

describe('color de la ventana antes de dibujar la página', () => {
  it('es el del marco del tema que se va a mostrar', () => {
    expect(bootColor('calc', 'black', false, false)).toBe('#1a1a1a');
    expect(bootColor('calc', 'system', true, false)).toBe('#1a1a1a');
    expect(bootColor('calc', 'darkgray', true, false)).toBe('#525252');
    expect(bootColor('calc', 'white', true, false)).toBe('#e6e6e6');
  });

  it('con un tema de contraste de Windows es negro si es oscuro y blanco si es claro', () => {
    expect(bootColor('writer', 'colorful', true, true)).toBe('#000000');
    expect(bootColor('writer', 'colorful', false, true)).toBe('#ffffff');
  });
});
