import { docText, type ShapeEl } from '@suitenova/slides-core';
import { describe, expect, it } from 'vitest';
import { SlidesCtl } from './ctl';

const lines = (...l: string[]) => l.join(String.fromCharCode(10));

function make(code: string) {
  const ctl = new SlidesCtl();
  ctl.macros = [{ name: 'Modulo1', code }];
  ctl.contentEnabled = true;
  return ctl;
}
const run = (ctl: SlidesCtl, name = 'Prueba') => {
  const r = ctl.macroRt.run(name);
  return r;
};
const shapeNamed = (ctl: SlidesCtl, slide: number, name: string) => ctl.realDeck.slides[slide]!.shapes.find((s) => s.name === name) as ShapeEl;

describe('macros de Slides', () => {
  it('agrega una diapositiva y un cuadro de texto con su texto, tamaño y posición', () => {
    const ctl = make(
      lines(
        'Sub Prueba()',
        '  Dim s, t',
        '  Set s = ActivePresentation.Slides.Add(2, ppLayoutBlank)',
        '  Set t = s.Shapes.AddTextbox(msoTextOrientationHorizontal, 50, 60, 300, 40)',
        '  t.Name = "Saludo"',
        '  t.TextFrame.TextRange.Text = "Hola mundo"',
        '  t.TextFrame.TextRange.Font.Bold = True',
        '  t.TextFrame.TextRange.Font.Size = 32',
        '  t.TextFrame.TextRange.Font.Color.RGB = RGB(200, 0, 0)',
        '  Debug.Print ActivePresentation.Slides.Count & " " & s.SlideIndex & " " & s.Shapes.Count',
        'End Sub',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(ctl.realDeck.slides.length).toBe(2);
    const t = shapeNamed(ctl, 1, 'Saludo');
    expect(docText(t.text!.doc)).toBe('Hola mundo');
    expect(t.xfrm).toMatchObject({ x: 50, y: 60, w: 300, h: 40 });
    const run0 = JSON.stringify(t.text!.doc);
    expect(run0).toContain('"b":true');
    expect(run0).toContain('"sz":32');
    expect(run0).toContain('#c80000');
    expect(ctl.macroRt.console.join('|')).toContain('2 2 1');
  });

  it('una macro es un solo paso de deshacer', () => {
    const ctl = make(
      lines('Sub Prueba()', '  Dim i', '  For i = 1 To 3', '    ActivePresentation.Slides.Add i + 1, ppLayoutBlank', '  Next i', 'End Sub'),
    );
    expect(run(ctl).error ?? '').toBe('');
    expect(ctl.realDeck.slides.length).toBe(4);
    ctl.undo();
    expect(ctl.realDeck.slides.length).toBe(1);
    ctl.redo();
    expect(ctl.realDeck.slides.length).toBe(4);
  });

  it('forma: posición, tamaño, giro, relleno y línea; leer lo escrito', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim f',
        '  Set f = ActivePresentation.Slides(1).Shapes.AddShape(msoShapeOval, 10, 20, 100, 80)',
        '  f.Left = 40',
        '  f.Width = 150',
        '  f.Rotation = 30',
        '  f.Fill.ForeColor.RGB = RGB(0, 128, 255)',
        '  f.Line.Weight = 4',
        '  f.Line.ForeColor.RGB = RGB(1, 2, 3)',
        '  Prueba = f.Left & "," & f.Top & "," & f.Width & "," & f.Height & "," & f.Rotation & "," & f.Line.Weight & "," & f.Fill.ForeColor.RGB & "," & f.Type',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe(`40,20,150,80,30,4,${255 * 65536 + 128 * 256},1`);
    const el = ctl.realDeck.slides[0]!.shapes.find((s) => s.kind === 'shape' && s.geom && 'prst' in s.geom && s.geom.prst === 'ellipse') as ShapeEl;
    expect(el.fill).toEqual({ t: 'solid', c: { rgb: '#0080ff' } });
    expect(el.ln?.w).toBe(4);
  });

  it('párrafos del texto: leer, cambiar uno, alineación, añadir al final', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim t',
        '  Set t = ActivePresentation.Slides(1).Shapes.AddTextbox(1, 0, 0, 200, 100).TextFrame.TextRange',
        '  t.Text = "uno" & vbCr & "dos" & vbCr & "tres"',
        '  t.Paragraphs(2).Text = "DOS"',
        '  t.Paragraphs(3).ParagraphFormat.Alignment = ppAlignCenter',
        '  t.Paragraphs(1).Font.Italic = True',
        '  t.InsertAfter "!"',
        '  Prueba = t.Paragraphs.Count & "|" & t.Paragraphs(2).Text & "|" & t.Paragraphs(3).ParagraphFormat.Alignment & "|" & t.Text',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(r.value).toBe(`3|DOS|2|uno\rDOS\rtres!`);
  });

  it('borrar y duplicar formas, mover y duplicar diapositivas, ir a una diapositiva', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim s, a, b',
        '  Set s = ActivePresentation.Slides(1)',
        '  Set a = s.Shapes.AddTextbox(1, 0, 0, 50, 50)',
        '  a.Name = "A"',
        '  Set b = a.Duplicate',
        '  b.Name = "B"',
        '  a.Delete',
        '  s.Duplicate',
        '  ActivePresentation.Slides(2).MoveTo 1',
        '  ActiveWindow.View.GotoSlide 2',
        '  Prueba = s.Shapes.Count & "|" & ActivePresentation.Slides.Count & "|" & ActiveWindow.View.Slide.SlideIndex',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.error ?? '').toBe('');
    expect(String(r.value)).toMatch(/^\d+\|2\|2$/);
    expect(ctl.realDeck.slides[1]!.shapes.some((x) => x.name === 'B')).toBe(true);
  });

  it('errores comprensibles: forma que no existe, índice fuera de rango, texto en una forma sin texto', () => {
    const ctl = make(lines('Sub Prueba()', '  ActivePresentation.Slides(1).Shapes("nada").Left = 1', 'End Sub'));
    const r = run(ctl);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nada');
    const c2 = make(lines('Sub Prueba()', '  ActivePresentation.Slides(9)', 'End Sub'));
    expect(run(c2).ok).toBe(false);
  });

  it('con el contenido activo deshabilitado no se ejecuta', () => {
    const ctl = make('Sub Prueba()\nEnd Sub');
    ctl.contentEnabled = false;
    expect(run(ctl).ok).toBe(false);
  });
});
