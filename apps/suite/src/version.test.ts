import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const app = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(app, file), 'utf8');
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : /(?<!\.test)\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('versión de la aplicación', () => {
  it('es la misma en package.json, Cargo.toml y tauri.conf.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect((JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string }).version).toBe(VERSION);
    expect(/^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]).toBe(VERSION);
  });

  it('ninguna ventana lleva un número escrito a mano', () => {
    const written = sources(path.join(app, 'src')).flatMap((f) => {
      const found = fs.readFileSync(f, 'utf8').match(/(Nova \w+|SuiteNova)(<\/strong>)?( ·)? \d+\.\d+(\.\d+)?\s*<|version: '\d+\.\d+/g);
      return found ? [`${path.basename(f)}: ${found.join(' | ')}`] : [];
    });
    expect(written).toEqual([]);
  });

  it('cada «Acerca de» la muestra', () => {
    const about = ['base/BaseApp.tsx', 'calc/dialogs.tsx', 'diagram/DiagramApp.tsx', 'forms/FormsApp.tsx', 'mail/MailApp.tsx', 'notes/NotesApp.tsx', 'plan/PlanApp.tsx', 'slides/Dialogs.tsx', 'writer/dialogs.tsx', 'options.tsx'];
    for (const file of about) expect(read(`src/${file}`), file).toContain('VERSION');
  });
});
