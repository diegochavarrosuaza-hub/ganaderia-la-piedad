// db.js — almacenamiento local (IndexedDB) con carga inicial desde seed-data.js
import { SEED, SEED_VERSION } from './seed-data.js';

// Queda en true si al abrir la app se actualizaron los datos del hato.
export let datosActualizados = false;

const DB_NAME = 'ganaderia-la-piedad';
const DB_VERSION = 3; // v3: se agregó 'tratamientos' (sanidad)
// Las facturas se manejan fuera de la app (Google Sheets + Claude); aquí solo el hato.
export const STORES = ['vacas', 'terneros', 'servicios', 'prenez', 'pesajes', 'tratamientos', 'eventos'];

let _db = null;

function req2p(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function initDB() {
  if (_db) return _db;
  _db = await new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        }
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await seedSiVacio();
  return _db;
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}

export function all(store)      { return req2p(tx(store).getAll()); }
export function get(store, id)  { return req2p(tx(store).get(id)); }
export function add(store, obj) { return req2p(tx(store, 'readwrite').add(obj)); }
export function put(store, obj) { return req2p(tx(store, 'readwrite').put(obj)); }
export function del(store, id)  { return req2p(tx(store, 'readwrite').delete(id)); }

export function bulkAdd(store, objs) {
  return new Promise((res, rej) => {
    const t = _db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const o of objs) os.add(o);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export function clear(store) { return req2p(tx(store, 'readwrite').clear()); }

async function metaGet(key) {
  const r = await req2p(tx('meta').get(key));
  return r ? r.value : undefined;
}
function metaSet(key, value) { return req2p(tx('meta', 'readwrite').put({ key, value })); }

// Siembra / actualiza los datos del hato.
//  · Instalación nueva → carga la semilla completa.
//  · Semilla más nueva que la del dispositivo (SEED_VERSION distinta) → guarda
//    un respaldo de seguridad de lo que hubiera y recarga los datos, para que
//    TODOS los dispositivos vean las mismas correcciones.
//  · Igual versión → solo rellena stores vacíos (ej. uno agregado por upgrade).
async function seedSiVacio() {
  const versionLocal = await metaGet('seedVersion');
  const primeraVez = !(await metaGet('seeded'));

  if (!primeraVez && versionLocal !== SEED_VERSION) {
    // Copia de seguridad de lo que tenía el dispositivo, por si acaso.
    try {
      const previo = await loadState();
      await metaSet('respaldoPrevio', {
        fecha: new Date().toISOString(), versionAnterior: versionLocal || '(inicial)', datos: previo,
      });
    } catch { /* si falla el respaldo, seguimos: la semilla es la fuente buena */ }
    for (const s of STORES) {
      await clear(s);
      if (SEED[s] && SEED[s].length) await bulkAdd(s, SEED[s]);
    }
    await metaSet('seedVersion', SEED_VERSION);
    datosActualizados = true;
    return;
  }

  for (const s of STORES) {
    if (!(SEED[s] && SEED[s].length)) continue;
    const existente = await all(s);
    if (!existente.length) await bulkAdd(s, SEED[s]);
  }
  if (primeraVez) await metaSet('seeded', new Date().toISOString());
  if (versionLocal !== SEED_VERSION) await metaSet('seedVersion', SEED_VERSION);
}

// Respaldo de seguridad guardado antes de la última actualización de datos.
export function respaldoPrevio() { return metaGet('respaldoPrevio'); }

// Estado completo en memoria (la finca es pequeña: leer todo es instantáneo)
export async function loadState() {
  const [vacas, terneros, servicios, prenez, pesajes, tratamientos, eventos] =
    await Promise.all(STORES.map(s => all(s)));
  return { vacas, terneros, servicios, prenez, pesajes, tratamientos, eventos };
}

// ── Respaldo ──────────────────────────────────────────────────────
export async function exportarTodo() {
  const state = await loadState();
  return {
    app: 'ganaderia-la-piedad',
    version: DB_VERSION,
    exportado: new Date().toISOString(),
    datos: state,
  };
}

export async function importarTodo(respaldo) {
  if (!respaldo || respaldo.app !== 'ganaderia-la-piedad' || !respaldo.datos) {
    throw new Error('El archivo no es un respaldo válido de esta app.');
  }
  for (const s of STORES) {
    await clear(s);
    const filas = (respaldo.datos[s] || []).map(({ id, ...resto }) => resto);
    if (filas.length) await bulkAdd(s, filas);
  }
  await metaSet('seeded', 'import:' + new Date().toISOString());
}
