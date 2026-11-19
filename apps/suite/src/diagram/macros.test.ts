import { describe, expect, it } from 'vitest';
import { DiagramCtl } from './ctl';

const lines = (...l: string[]) => l.join(String.fromCharCode(10));

function make(code: string) {
  const ctl = new DiagramCtl();
  ctl.macros = [{ name: 'Modulo1', code }];
  ctl.contentEnabled = true;
  return ctl;
}
const run = (ctl: DiagramCtl, name = 'Prueba') => ctl.macroRt.run(name);

describe('macros de Diagram', () => {
  it('suelta formas, les pone texto y color, las conecta y lee sus celdas', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim a, b',
        '  Set a = ActivePage.Drop(ActiveDocument.Masters.ItemU("Proceso"), 200, 150)',
        '  Set b = ActivePage.Drop(ActiveDocument.Masters.ItemU("Decisión"), 450, 150)',
        '  a.Text = "Inicio"',
        '  a.Cells("FillForegnd").FormulaU = "RGB(255, 0, 0)"',
        '  a.Cells("Width").ResultIU = 200',
        '  a.AutoConnect b',
        '  Prueba = ActivePage.Shapes.Count & "|" & a.Text & "|" & a.Cells("PinX").ResultIU & "|" & a.Cells("Width").ResultIU & "|" & a.Cells("FillForegnd").ResultIU',
        'End Function',
      ),
    );
    const r = run(ctl);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('3|Inicio|200|200|255');
    expect(ctl.basePage.shapes).toHaveLength(2);
    expect(ctl.basePage.connectors).toHaveLength(1);
    expect(ctl.basePage.shapes[0]!.style.fill).toBe('#ff0000');
  });

  it('una macro es un solo paso de deshacer', () => {
    const ctl = make(lines('Sub Prueba()', '  ActivePage.Drop "Proceso", 100, 100', '  ActivePage.Drop "Proceso", 300, 100', '  ActivePage.Shapes(1).Text = "A"', 'End Sub'));
    expect(run(ctl).ok).toBe(true);
    expect(ctl.basePage.shapes).toHaveLength(2);
    ctl.undo();
    expect(ctl.basePage.shapes).toHaveLength(0);
  });

  it('páginas, datos de forma, borrar y un nombre que no existe da error', () => {
    const ctl = make(
      lines(
        'Function Prueba()',
        '  Dim s',
        '  Set s = ActivePage.DrawRectangle(10, 20, 110, 70)',
        '  s.Cells("Prop.Responsable").FormulaU = "Ana"',
        '  ActiveDocument.Pages.Add',
        '  ActiveDocument.Pages(2).Name = "Segunda"',
        '  Prueba = s.Cells("Prop.Responsable").ResultStr("") & "|" & ActiveDocument.Pages.Count & "|" & ActiveDocument.Pages("Segunda").Index & "|" & s.Cells("Height").ResultIU',
        '  s.Delete',
        'End Function',
        'Sub Mala()',
        '  ActivePage.Drop "No existe", 1, 1',
        'End Sub',
      ),
    );
    const r = run(ctl);
    expect(r.value).toBe('Ana|2|2|50');
    expect(ctl.basePage.shapes).toHaveLength(0);
    const bad = run(ctl, 'Mala');
    expect(bad.ok).toBe(false);
  });
});

describe('grabadora de Diagram', () => {
  it('graba formas, texto, tamaño, conectores y borrados, y la macro los reproduce', () => {
    const a = new DiagramCtl();
    const b = new DiagramCtl();
    b.load(a.diagram, null, null);
    a.startRecording('Grabada', '');
    a.edit((p) => ({ ...p, shapes: p.shapes }));
    // drop two shapes like the stencil panel does
    const added = (stencil: string, x: number, y: number, text: string) => {
      a.edit((p) => {
        const sh = { id: `s${p.shapes.length}${stencil}`, stencil, x, y, w: stencil === 'rect' ? 140 : 120, h: 60, rot: 0, text, style: { fill: '#ffffff', stroke: '#2f4f6f', strokeWidth: 1.5, dash: 'solid' as const, opacity: 1, shadow: false }, font: { family: 'Segoe UI', size: 13, color: '#1b1b1b', bold: false, italic: false, underline: false, align: 'center' as const, valign: 'middle' as const }, locked: false };
        return { ...p, shapes: [...p.shapes, sh] };
      });
    };
    added('rect', 100, 100, 'Uno');
    added('ellipse', 400, 100, 'Dos');
    const [s1, s2] = a.basePage.shapes;
    a.edit((p) => ({ ...p, connectors: [{ id: 'c1', from: { shape: s1!.id, port: 'auto' }, to: { shape: s2!.id, port: 'auto' }, routing: 'elbow', stroke: '#2f4f6f', strokeWidth: 1.5, dash: 'solid', startArrow: 'none', endArrow: 'arrow', text: '', font: s1!.font }] }));
    a.stopRecording();
    const code = a.macros.find((m) => m.name === 'Grabadas')!.code;
    expect(code).toContain('ActivePage.Drop ActiveDocument.Masters.ItemU(');
    expect(code).toContain('AutoConnect');
    b.macros = a.macros;
    const r = b.macroRt.run('Grabada');
    expect(r.ok ? '' : r.error).toBe('');
    expect(b.basePage.shapes.map((s) => [s.stencil, s.text, Math.round(s.x), Math.round(s.y), s.w])).toEqual(a.basePage.shapes.map((s) => [s.stencil, s.text, Math.round(s.x), Math.round(s.y), s.w]));
    expect(b.basePage.connectors).toHaveLength(1);
  });
});
