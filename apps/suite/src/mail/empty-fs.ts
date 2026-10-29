/**
 * Sustituye al módulo `fs` de Node en el navegador: `pst-extractor` lo importa para abrir archivos por ruta, algo que la
 * aplicación nunca hace (le pasa el contenido ya leído).
 */
const unavailable = (): never => {
  throw new Error('El acceso a archivos por ruta no está disponible aquí.');
};
export const openSync = unavailable;
export const readSync = unavailable;
export const closeSync = unavailable;
export const fstatSync = unavailable;
export const statSync = unavailable;
export const readFileSync = unavailable;
export default { openSync, readSync, closeSync, fstatSync, statSync, readFileSync };
