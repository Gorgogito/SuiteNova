import initSqlJs, { type SqlJsStatic } from 'sql.js';

let cached: Promise<SqlJsStatic> | null = null;

/** Load the SQLite engine (WebAssembly). `locateFile` tells the browser where the .wasm file is served from. */
export function loadSql(locateFile?: (file: string) => string): Promise<SqlJsStatic> {
  cached ??= initSqlJs(locateFile ? { locateFile } : undefined);
  return cached;
}
