import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // `pst-extractor` (archivos .pst/.ost de Outlook) importa `fs` de Node; en la aplicación solo recibe el contenido ya leído
  resolve: { alias: [{ find: /^fs$/, replacement: fileURLToPath(new URL('./src/mail/empty-fs.ts', import.meta.url)) }] },
  // se preparan al arrancar: si no, el servidor de desarrollo recarga la página la primera vez que se abre un archivo de Outlook
  optimizeDeps: { include: ['pst-extractor', '@kenjiuno/msgreader', 'buffer'] },
  build: { target: 'es2022' },
});
