// db.js — almacenamiento local (IndexedDB) con carga inicial desde seed-data.js
//
// Cada registro lleva tres campos de control para poder sincronizarse entre
// dispositivos (tablet, celular) sin perder nada:
//   uid       → identidad global: el MISMO animal tiene el mismo uid en todos
//               los aparatos (el 'id' de IndexedDB es local y no sirve).
//   updatedAt → cuándo se tocó por última vez; ante un choque gana el más nuevo.
//   deletedAt → borrado "lógico": el registro se marca en vez de desaparecer,
//               para que el borrado también llegue a los otros aparatos.
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

export const ahora = () => new Date().toISOString();

function nuevoUid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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
  await completarUids();
  return _db;
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}

// Todo lo guardado, incluidos los borrados (lo usa la sincronización).
export function allRaw(store) { return req2p(tx(store).getAll()); }

// Lo que la app ve: sin los registros borrados.
export async function all(store) {
  return (await allRaw(store)).filter(r => !r.deletedAt);
}

export function get(store, id) { return req2p(tx(store).get(id)); }

export async function add(store, obj) {
  const r = { ...obj };
  if (!r.uid) {
    // Clave derivada del contenido: si el mismo hecho se registra en la tablet
    // y en el celular, al sincronizar se reconoce como uno solo.
    const base = claveEstable(store, r);
    const usados = new Set((await allRaw(store)).map(x => x.uid));
    let uid = base, n = 0;
    while (usados.has(uid)) uid = `${base}#${++n}`;
    r.uid = uid;
  }
  r.updatedAt = ahora();
  return req2p(tx(store, 'readwrite').add(r));
}

export async function put(store, obj) {
  const r = { ...obj };
  if (!r.uid) r.uid = nuevoUid();
  r.updatedAt = ahora();
  return req2p(tx(store, 'readwrite').put(r));
}

// Borrado lógico: se marca para que el otro dispositivo también lo borre.
export async function del(store, id) {
  const r = await get(store, id);
  if (!r) return;
  r.deletedAt = ahora();
  r.updatedAt = r.deletedAt;
  return req2p(tx(store, 'readwrite').put(r));
}

// Guarda tal cual, sin tocar updatedAt (la sincronización trae el suyo).
export function putCrudo(store, obj) {
  return req2p(tx(store, 'readwrite').put(obj));
}

export function bulkAdd(store, objs) {
  return new Promise((res, rej) => {
    const t = _db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const o of objs) {
      const r = { ...o };
      if (!r.uid) r.uid = nuevoUid();
      if (!r.updatedAt) r.updatedAt = ahora();
      os.add(r);
    }
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export function clear(store) { return req2p(tx(store, 'readwrite').clear()); }

export async function metaGet(key) {
  const r = await req2p(tx('meta').get(key));
  return r ? r.value : undefined;
}
export function metaSet(key, value) { return req2p(tx('meta', 'readwrite').put({ key, value })); }

// Identidad CALCULADA a partir del contenido del registro.
// Es clave que sea determinística: la tablet y el celular deben llegar al
// mismo uid para el mismo animal, o al sincronizar se duplicaría todo.
// Usa la misma fórmula con la que se preparó el seed.
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function claveEstable(store, r) {
  switch (store) {
    case 'vacas':        return `vaca:${norm(r.chapeta)}`;
    case 'terneros':     return `ternero:${norm(r.nombre)}`;
    case 'prenez':       return `prenez:${norm(r.chapeta)}:${r.fechaPrenez || ''}`;
    case 'servicios':    return `serv:${norm(r.chapeta)}:${r.fecha || ''}:${r.tipo || ''}`;
    case 'pesajes':      return `pesaje:${norm(r.nombre)}:${r.fecha || ''}`;
    case 'tratamientos': return `trat:${r.fecha || ''}:${norm(r.producto)}:${norm(r.aplicadoA)}`;
    case 'eventos':      return `evt:${r.timestamp || ''}:${norm(r.refId)}:${norm(r.tipo)}:${r.fecha || ''}`;
    default:             return `${store}:?`;
  }
}

// Los datos guardados antes de la sincronización no tienen uid. Se les calcula
// uno estable para que puedan viajar entre dispositivos sin duplicarse.
async function completarUids() {
  for (const s of STORES) {
    const filas = await allRaw(s);
    const usados = new Set(filas.map(r => r.uid).filter(Boolean));
    // Orden estable (por id) para que el desempate sea igual en todos lados.
    for (const r of filas.sort((a, b) => (a.id || 0) - (b.id || 0))) {
      if (r.uid && r.updatedAt) continue;
      if (!r.uid) {
        const base = claveEstable(s, r);
        let uid = base, n = 0;
        while (usados.has(uid)) uid = `${base}#${++n}`;
        usados.add(uid);
        r.uid = uid;
      }
      if (!r.updatedAt) r.updatedAt = ahora();
      await putCrudo(s, r);
    }
  }
}

// Siembra / actualiza los datos del hato.
//  · Instalación nueva → carga la semilla completa.
//  · Semilla más nueva (SEED_VERSION distinta) → guarda un respaldo de
//    seguridad y recarga los datos, para que todos los aparatos vean las
//    mismas correcciones. OJO: si la sincronización está activa, la nube manda
//    y NO se re-siembra (las correcciones se aplican allá).
//  · Igual versión → solo rellena stores vacíos.
async function seedSiVacio() {
  const versionLocal = await metaGet('seedVersion');
  const primeraVez = !(await metaGet('seeded'));
  const haySync = !!localStorage.getItem('la-piedad-sync-url');

  if (!primeraVez && !haySync && versionLocal !== SEED_VERSION) {
    try {
      const previo = await loadState();
      await metaSet('respaldoPrevio', {
        fecha: ahora(), versionAnterior: versionLocal || '(inicial)', datos: previo,
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
    const existente = await allRaw(s);
    if (!existente.length) await bulkAdd(s, SEED[s]);
  }
  if (primeraVez) await metaSet('seeded', ahora());
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
    exportado: ahora(),
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
  await metaSet('seeded', 'import:' + ahora());
}
